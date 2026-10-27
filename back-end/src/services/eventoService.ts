/**
 * eventoService.ts - Lançamento e validação de Eventos da Folha (Etapa 2).
 * 
 * Cobre:
 * - Horas extras 50% e 100% com convenção coletiva (RN-30, RN-35)
 * - Faltas injustificadas e perda do DSR (RN-33)
 * - Atestados médicos com anexo, período e controle de dados de saúde (RN-33, RN-54, RNF-21)
 * - Vale-Transporte com cálculo do menor entre 6% e custo (RN-50)
 * - Vale-Alimentação fixo (RN-51)
 * - Verbas avulsas com 3 incidências (RN-25)
 * - Trava de competência fechada (RN-04)
 */

import { DatabaseSync } from 'node:sqlite';
import { Dec } from '../dec.js';
import { verificarCompetenciaAberta } from './competenciaService.js';
import { registrarLog } from './logService.js';
import { obterParametroVigente } from './parametroFeriadoService.js';

export interface LancarHoraExtraDTO {
  colaboradorId: number;
  competenciaId: number;
  tipo: 'UTIL' | 'DOMINGO';
  quantidadeHoras: number;
  observacao?: string;
}

export interface LancarAtestadoDTO {
  colaboradorId: number;
  competenciaId: number;
  dataInicio: string;
  dataFim: string;
  anexoNome: string;
  anexoTipo: string; // 'application/pdf', 'image/jpeg', 'image/png'
  anexoTamanhoBytes: number;
  observacao?: string;
}

export interface LancarVerbaAvulsaDTO {
  colaboradorId: number;
  competenciaId: number;
  tipo: 'PROVENTO' | 'DESCONTO';
  descricao: string;
  valor: number | string;
  incideINSS: boolean;
  incideIRRF: boolean;
  incideFGTS: boolean;
  observacao?: string;
}

export function lancarHorasExtras(
  db: DatabaseSync,
  usuarioSolicitante: { id: number; email: string; perfil: string },
  dados: LancarHoraExtraDTO
): any {
  if (usuarioSolicitante.perfil !== 'RH') {
    throw new Error('Você não tem permissão para esta ação.');
  }

  // RN-04: Trava de competência fechada
  verificarCompetenciaAberta(db, dados.competenciaId);

  // Cenário: Hora extra negativa
  if (!dados.quantidadeHoras || dados.quantidadeHoras <= 0) {
    throw new Error('A quantidade de horas extras deve ser maior que zero.');
  }

  const colaborador = db.prepare('SELECT id, nome, salario_base_centavos, jornada_horas_mensais FROM colaboradores WHERE id = ?')
    .get(dados.colaboradorId) as any;
  if (!colaborador) {
    throw new Error('Colaborador não encontrado.');
  }

  const comp = db.prepare('SELECT mes_ano FROM competencias WHERE id = ?').get(dados.competenciaId) as any;
  const divisor = colaborador.jornada_horas_mensais || 220;
  const salarioBaseNum = Number(colaborador.salario_base_centavos) / 100;
  const valorHora = salarioBaseNum / divisor; // Ex: 2200 / 220 = 10,00

  let adicionalFator = 1.5; // Padrão dia útil: 50% (hora x 1.5)
  let tipoBanco = 'HORA_EXTRA_UTIL';

  if (dados.tipo === 'DOMINGO') {
    tipoBanco = 'HORA_EXTRA_DOMINGO';
    // Consulta se há convenção cadastrada para adicional de domingo (Cenário: Convenção coletiva altera o adicional de domingo)
    const paramAdicionalDomingo = obterParametroVigente(db, 'adicional_hora_extra_domingo', `${comp.mes_ano}-01`);
    if (paramAdicionalDomingo) {
      // Exemplo: se cadastrado 1.20 (120%), o fator total é 1.0 + 1.20 = 2.2
      const adicionalNum = parseFloat(paramAdicionalDomingo);
      adicionalFator = 1.0 + adicionalNum;
    } else {
      adicionalFator = 2.0; // Padrão CLT 100%
    }
  }

  // Cálculo: valorHora * adicionalFator * quantidadeHoras
  const valorTotal = valorHora * adicionalFator * dados.quantidadeHoras;
  const valorDec = Dec.fromMoeda(valorTotal);
  const agora = new Date().toISOString();

  const stmt = db.prepare(`
    INSERT INTO eventos (
      colaborador_id, competencia_id, tipo, quantidade, valor_centavos,
      descricao, incide_inss, incide_irrf, incide_fgts, observacao,
      criado_por_usuario_id, criado_em
    ) VALUES (?, ?, ?, ?, ?, ?, 1, 1, 1, ?, ?, ?)
  `);

  const desc = dados.tipo === 'UTIL'
    ? `${dados.quantidadeHoras}h extras em dia útil (50%)`
    : `${dados.quantidadeHoras}h extras em domingo/feriado (${Math.round((adicionalFator - 1) * 100)}%)`;

  const res = stmt.run(
    dados.colaboradorId,
    dados.competenciaId,
    tipoBanco,
    dados.quantidadeHoras,
    Number(valorDec.centavos),
    desc,
    dados.observacao ?? null,
    usuarioSolicitante.id,
    agora
  );

  return {
    id: Number(res.lastInsertRowid),
    tipo: tipoBanco,
    quantidade: dados.quantidadeHoras,
    valorCalculado: valorDec.toNumber(),
    descricao: desc,
  };
}

export function lancarFaltaInjustificada(
  db: DatabaseSync,
  usuarioSolicitante: { id: number; email: string; perfil: string },
  dados: { colaboradorId: number; competenciaId: number; diasFalta: number; observacao?: string }
): any {
  if (usuarioSolicitante.perfil !== 'RH') {
    throw new Error('Você não tem permissão para esta ação.');
  }

  verificarCompetenciaAberta(db, dados.competenciaId);

  if (!dados.diasFalta || dados.diasFalta <= 0) {
    throw new Error('A quantidade de dias de falta deve ser maior que zero.');
  }

  const colaborador = db.prepare('SELECT id, salario_base_centavos FROM colaboradores WHERE id = ?')
    .get(dados.colaboradorId) as any;
  if (!colaborador) throw new Error('Colaborador não encontrado.');

  const salarioBaseNum = Number(colaborador.salario_base_centavos) / 100;
  // RN-33: Falta desconta (salário-base / 30) x dias
  const descontoFalta = (salarioBaseNum / 30) * dados.diasFalta;
  const descontoFaltaDec = Dec.fromMoeda(descontoFalta);

  // Perda do DSR da semana correspondente (1 dia por semana com falta)
  const perdaDSR = (salarioBaseNum / 30) * 1;
  const perdaDSRDec = Dec.fromMoeda(perdaDSR);

  const agora = new Date().toISOString();

  // Insere evento de falta
  const stmtFalta = db.prepare(`
    INSERT INTO eventos (
      colaborador_id, competencia_id, tipo, quantidade, valor_centavos,
      descricao, incide_inss, incide_irrf, incide_fgts, observacao,
      criado_por_usuario_id, criado_em
    ) VALUES (?, ?, 'FALTA_INJUSTIFICADA', ?, ?, ?, -1, -1, -1, ?, ?, ?)
  `);

  const res = stmtFalta.run(
    dados.colaboradorId,
    dados.competenciaId,
    dados.diasFalta,
    Number(descontoFaltaDec.centavos),
    `${dados.diasFalta} dia(s) de falta injustificada`,
    dados.observacao ?? null,
    usuarioSolicitante.id,
    agora
  );

  return {
    id: Number(res.lastInsertRowid),
    diasFalta: dados.diasFalta,
    descontoFalta: descontoFaltaDec.toNumber(),
    descontoDSR: perdaDSRDec.toNumber(),
  };
}

export function lancarAtestado(
  db: DatabaseSync,
  usuarioSolicitante: { id: number; email: string; perfil: string },
  dados: LancarAtestadoDTO
): any {
  if (usuarioSolicitante.perfil !== 'RH') {
    throw new Error('Você não tem permissão para esta ação.');
  }

  verificarCompetenciaAberta(db, dados.competenciaId);

  // Cenário: Atestado sem anexo ou sem período
  if (!dados.anexoNome || !dados.dataInicio || !dados.dataFim) {
    throw new Error('Informe o anexo e o período do atestado.');
  }

  // RNF-21: Anexos em PDF, JPG ou PNG de até 10 MB (10 * 1024 * 1024 = 10485760 bytes)
  const formatosValidos = ['application/pdf', 'image/jpeg', 'image/png'];
  const extensaoValida = /\.(pdf|jpg|jpeg|png)$/i.test(dados.anexoNome);

  if (!extensaoValida || (dados.anexoTipo && !formatosValidos.includes(dados.anexoTipo))) {
    throw new Error('Arquivo inválido. Use PDF, JPG ou PNG de até 10 MB.');
  }

  if (dados.anexoTamanhoBytes && dados.anexoTamanhoBytes > 10 * 1024 * 1024) {
    throw new Error('Arquivo inválido. Use PDF, JPG ou PNG de até 10 MB.');
  }

  const agora = new Date().toISOString();

  // RN-33: Atestado válido não desconta salário nem DSR (valor_centavos = 0)
  const stmt = db.prepare(`
    INSERT INTO eventos (
      colaborador_id, competencia_id, tipo, quantidade, valor_centavos,
      descricao, incide_inss, incide_irrf, incide_fgts, data_inicio, data_fim,
      anexo_nome, anexo_tipo, observacao, criado_por_usuario_id, criado_em
    ) VALUES (?, ?, 'ATESTADO', 0, 0, ?, 0, 0, 0, ?, ?, ?, ?, ?, ?, ?)
  `);

  const res = stmt.run(
    dados.colaboradorId,
    dados.competenciaId,
    `Atestado médico válido (${dados.dataInicio} a ${dados.dataFim})`,
    dados.dataInicio,
    dados.dataFim,
    dados.anexoNome,
    dados.anexoTipo,
    dados.observacao ?? null,
    usuarioSolicitante.id,
    agora
  );

  return {
    id: Number(res.lastInsertRowid),
    status: 'ATESTADO_REGISTRADO_SEM_DESCONTO',
  };
}

export function consultarAtestado(
  db: DatabaseSync,
  usuarioSolicitante: { id: number; email: string; perfil: string },
  eventoId: number
): any {
  // Cenário: Diretoria não vê dados de saúde (RN-54 e Seção 4)
  if (usuarioSolicitante.perfil !== 'RH') {
    registrarLog(db, {
      usuarioId: usuarioSolicitante.id,
      usuarioEmail: usuarioSolicitante.email,
      usuarioPerfil: usuarioSolicitante.perfil,
      acao: 'TENTATIVA_ACESSO_DADO_SAUDE_NEGADA',
      entidade: 'ATESTADO',
      registroId: eventoId,
      detalhes: `Usuário ${usuarioSolicitante.email} (${usuarioSolicitante.perfil}) tentou consultar atestado ID ${eventoId}`,
    });
    throw new Error('Você não tem permissão para acessar dados de saúde.');
  }

  const evento = db.prepare("SELECT * FROM eventos WHERE id = ? AND tipo = 'ATESTADO'").get(eventoId) as any;
  if (!evento) {
    throw new Error('Atestado não encontrado.');
  }

  // Cenário: Log de acesso a dado de saúde (RN-54)
  registrarLog(db, {
    usuarioId: usuarioSolicitante.id,
    usuarioEmail: usuarioSolicitante.email,
    usuarioPerfil: usuarioSolicitante.perfil,
    acao: 'CONSULTAR_DADO_SAUDE',
    entidade: 'ATESTADO',
    registroId: eventoId,
    detalhes: `Consulta autorizada ao atestado médico do colaborador ID ${evento.colaborador_id}`,
  });

  return evento;
}

export function lancarValeTransporte(
  db: DatabaseSync,
  usuarioSolicitante: { id: number; email: string; perfil: string },
  dados: { colaboradorId: number; competenciaId: number; optante: boolean; custoMensalInformado?: number }
): any {
  if (usuarioSolicitante.perfil !== 'RH') {
    throw new Error('Você não tem permissão para esta ação.');
  }

  verificarCompetenciaAberta(db, dados.competenciaId);

  const colaborador = db.prepare('SELECT id, salario_base_centavos FROM colaboradores WHERE id = ?')
    .get(dados.colaboradorId) as any;
  if (!colaborador) throw new Error('Colaborador não encontrado.');

  // Cenário: Colaborador sem vale-transporte (não optante não desconta)
  if (!dados.optante) {
    return { optante: false, valorDesconto: 0 };
  }

  const salarioBaseNum = Number(colaborador.salario_base_centavos) / 100;
  const teto6PorCento = salarioBaseNum * 0.06;
  const custo = dados.custoMensalInformado || 0;

  // RN-50: Desconto = menor valor entre 6% do salário-base e o custo informado pelo RH
  const desconto = Math.min(teto6PorCento, custo);
  const descontoDec = Dec.fromMoeda(desconto);

  const agora = new Date().toISOString();
  const stmt = db.prepare(`
    INSERT INTO eventos (
      colaborador_id, competencia_id, tipo, quantidade, valor_centavos,
      descricao, incide_inss, incide_irrf, incide_fgts, criado_por_usuario_id, criado_em
    ) VALUES (?, ?, 'VALE_TRANSPORTE', 1, ?, 'Desconto Vale-Transporte (RN-50)', 0, 0, 0, ?, ?)
  `);

  const res = stmt.run(
    dados.colaboradorId,
    dados.competenciaId,
    Number(descontoDec.centavos),
    usuarioSolicitante.id,
    agora
  );

  return {
    id: Number(res.lastInsertRowid),
    optante: true,
    teto6PorCento,
    custoInformado: custo,
    valorDesconto: descontoDec.toNumber(),
  };
}

export function lancarVerbaAvulsa(
  db: DatabaseSync,
  usuarioSolicitante: { id: number; email: string; perfil: string },
  dados: LancarVerbaAvulsaDTO
): any {
  if (usuarioSolicitante.perfil !== 'RH') {
    throw new Error('Você não tem permissão para esta ação.');
  }

  // RN-25: Só entra em competência aberta
  verificarCompetenciaAberta(db, dados.competenciaId);

  if (!dados.descricao || !dados.descricao.trim()) {
    throw new Error('Informe a descrição da verba avulsa.');
  }

  const valorDec = typeof dados.valor === 'number'
    ? Dec.fromMoeda(dados.valor)
    : Dec.fromMoeda(String(dados.valor));

  if (!valorDec.isPositive()) {
    throw new Error('Informe um valor maior que zero para a verba avulsa.');
  }

  const tipoBanco = dados.tipo === 'PROVENTO' ? 'VERBA_AVULSA_PROVENTO' : 'VERBA_AVULSA_DESCONTO';
  const agora = new Date().toISOString();

  const stmt = db.prepare(`
    INSERT INTO eventos (
      colaborador_id, competencia_id, tipo, quantidade, valor_centavos,
      descricao, incide_inss, incide_irrf, incide_fgts, observacao,
      criado_por_usuario_id, criado_em
    ) VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const res = stmt.run(
    dados.colaboradorId,
    dados.competenciaId,
    tipoBanco,
    Number(valorDec.centavos),
    dados.descricao.trim(),
    dados.incideINSS ? 1 : 0,
    dados.incideIRRF ? 1 : 0,
    dados.incideFGTS ? 1 : 0,
    dados.observacao ?? null,
    usuarioSolicitante.id,
    agora
  );

  return {
    id: Number(res.lastInsertRowid),
    tipo: tipoBanco,
    descricao: dados.descricao.trim(),
    valor: valorDec.toNumber(),
    incideINSS: dados.incideINSS,
    incideIRRF: dados.incideIRRF,
    incideFGTS: dados.incideFGTS,
  };
}

export function listarEventosCompetencia(db: DatabaseSync, colaboradorId: number, competenciaId: number): any[] {
  return db.prepare('SELECT * FROM eventos WHERE colaborador_id = ? AND competencia_id = ?').all(colaboradorId, competenciaId);
}
