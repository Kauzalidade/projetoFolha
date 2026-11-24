/**
 * documentosAlertasService.ts - Documentos, Exames, Incidentes e Central de Alertas (RN-52, RN-53, RN-56, RN-58, RN-77, RN-84).
 */

import { DatabaseSync } from 'node:sqlite';
import { registrarLog } from './logService.js';

export function anexarDocumento(
  db: DatabaseSync,
  usuarioSolicitante: { id: number; email: string; perfil: string },
  dados: { colaboradorId: number; tipo: string; nomeArquivo: string; dataValidade?: string }
): any {
  if (usuarioSolicitante.perfil !== 'RH') {
    throw new Error('Você não tem permissão para esta ação.');
  }

  const agora = new Date().toISOString();
  const stmt = db.prepare(`
    INSERT INTO documentos_colaborador (
      colaborador_id, tipo, nome_arquivo, data_validade, anexado_por_usuario_id, criado_em
    ) VALUES (?, ?, ?, ?, ?, ?)
  `);

  const res = stmt.run(
    dados.colaboradorId,
    dados.tipo,
    dados.nomeArquivo,
    dados.dataValidade ?? null,
    usuarioSolicitante.id,
    agora
  );

  return { id: Number(res.lastInsertRowid), ...dados };
}

export function cadastrarExameOcupacional(
  db: DatabaseSync,
  usuarioSolicitante: { id: number; email: string; perfil: string },
  dados: { colaboradorId: number; tipo: string; dataUltimoExame: string; periodicidadeMeses?: number }
): any {
  if (usuarioSolicitante.perfil !== 'RH') {
    throw new Error('Você não tem permissão para esta ação.');
  }

  const periodicidade = dados.periodicidadeMeses || 12;
  const dProx = new Date(dados.dataUltimoExame);
  dProx.setMonth(dProx.getMonth() + periodicidade);
  const dataProximoVencimento = dProx.toISOString().slice(0, 10);
  const agora = new Date().toISOString();

  const stmt = db.prepare(`
    INSERT INTO exames_ocupacionais (
      colaborador_id, tipo, data_ultimo_exame, periodicidade_meses, data_proximo_vencimento, criado_em
    ) VALUES (?, ?, ?, ?, ?, ?)
  `);

  const res = stmt.run(
    dados.colaboradorId,
    dados.tipo,
    dados.dataUltimoExame,
    periodicidade,
    dataProximoVencimento,
    agora
  );

  return { id: Number(res.lastInsertRowid), dataProximoVencimento };
}

export interface AlertaItem {
  tipo: 'DOCUMENTO_VENCENDO' | 'EXAME_VENCENDO' | 'FERIAS_CONCESSIVO' | 'PRAZO_PAGAMENTO_FOLHA' | 'DECIMO_TERCEIRO' | 'DADOS_FORA_PRAZO_GUARDA' | 'NOTIFICACAO_DIRETORIA_CONFERENCIA';
  titulo: string;
  detalhes: string;
  descricao?: string;
  referenciaId?: number;
  diasRestantes?: number;
}

export function consultarAlertas(
  db: DatabaseSync,
  usuarioSolicitante: { id: number; email: string; perfil: string },
  dataReferenciaIso?: string
): AlertaItem[] {
  const alertas: AlertaItem[] = [];
  const hoje = dataReferenciaIso ? new Date(dataReferenciaIso) : new Date();

  // 1. Documentos a vencer em até 30 dias (RN-52)
  const docs = db.prepare(`
    SELECT d.id, d.tipo, d.nome_arquivo, d.data_validade, c.nome as colaborador_nome
    FROM documentos_colaborador d
    JOIN colaboradores c ON c.id = d.colaborador_id
    WHERE d.data_validade IS NOT NULL
  `).all() as any[];

  for (const doc of docs) {
    const dVal = new Date(doc.data_validade);
    const diffDias = Math.ceil((dVal.getTime() - hoje.getTime()) / (1000 * 60 * 60 * 24));
    if (diffDias >= 0 && diffDias <= 30) {
      alertas.push({
        tipo: 'DOCUMENTO_VENCENDO',
        titulo: `Documento a vencer em ${diffDias} dias`,
        detalhes: `O documento ${doc.nome_arquivo} (${doc.tipo}) de ${doc.colaborador_nome} vence em ${doc.data_validade}.`,
        referenciaId: doc.id,
        diasRestantes: diffDias,
      });
    }
  }

  // 2. Alerta de prazo de pagamento da folha (RN-58)
  // Alerta no 3º dia útil se a competência ainda não estiver fechada OU se fechada mas ainda não paga (RN-61)
  const competenciasPendentesPagamento = db.prepare(`
    SELECT id, mes_ano, situacao, pago_em
    FROM competencias
    WHERE situacao != 'FECHADA' OR (situacao = 'FECHADA' AND pago_em IS NULL)
  `).all() as any[];

  for (const comp of competenciasPendentesPagamento) {
    if (comp.situacao !== 'FECHADA') {
      alertas.push({
        tipo: 'PRAZO_PAGAMENTO_FOLHA',
        titulo: 'Alerta de prazo de pagamento da folha',
        detalhes: `A competência ${comp.mes_ano} ainda não está fechada no prazo limite para pagamento.`,
        referenciaId: comp.id,
      });
    } else if (!comp.pago_em) {
      alertas.push({
        tipo: 'PRAZO_PAGAMENTO_FOLHA',
        titulo: 'Registro de pagamento pendente',
        detalhes: `A competência ${comp.mes_ano} está fechada mas o pagamento ainda não foi registrado pelo RH (RN-61).`,
        referenciaId: comp.id,
      });
    }
  }

  // 3. Dados fora do prazo de guarda (LGPD - RN-56)
  // Colaboradores desligados há mais de 5 anos
  const colabsDesligados = db.prepare("SELECT id, nome, desligamento FROM colaboradores WHERE situacao = 'INATIVO' AND desligamento IS NOT NULL").all() as any[];
  for (const colab of colabsDesligados) {
    const dDesl = new Date(colab.desligamento);
    const diffAnos = (hoje.getTime() - dDesl.getTime()) / (1000 * 60 * 60 * 24 * 365.25);
    if (diffAnos >= 5) {
      alertas.push({
        tipo: 'DADOS_FORA_PRAZO_GUARDA',
        titulo: 'Dados fora do prazo de guarda (LGPD)',
        detalhes: `O colaborador ${colab.nome} está desligado desde ${colab.desligamento} (mais de 5 anos). Sinalizado para anonimização/eliminação com confirmação do RH.`,
        referenciaId: colab.id,
      });
    }
  }

  // 4. Exames ocupacionais periódicos a vencer em até 30 dias (RN-53)
  const exames = db.prepare(`
    SELECT e.id, e.tipo, e.data_proximo_vencimento, c.nome as colaborador_nome
    FROM exames_ocupacionais e
    JOIN colaboradores c ON c.id = e.colaborador_id
  `).all() as any[];

  for (const ex of exames) {
    const dVenc = new Date(ex.data_proximo_vencimento);
    const diffDias = Math.ceil((dVenc.getTime() - hoje.getTime()) / (1000 * 60 * 60 * 24));
    if (diffDias >= 0 && diffDias <= 30) {
      alertas.push({
        tipo: 'EXAME_VENCENDO',
        titulo: `Exame ocupacional a vencer em ${diffDias} dias`,
        detalhes: `O exame ${ex.tipo} de ${ex.colaborador_nome} vence em ${ex.data_proximo_vencimento}.`,
        referenciaId: ex.id,
        diasRestantes: diffDias,
      });
    }
  }

  // 5. Alerta de período concessivo de férias perto do fim (RN-45: 60 dias)
  const colabsAtivos = db.prepare("SELECT id, nome, admissao FROM colaboradores WHERE situacao = 'ATIVO'").all() as any[];
  for (const c of colabsAtivos) {
    const dAdm = new Date(c.admissao);
    const diffMeses = (hoje.getFullYear() - dAdm.getFullYear()) * 12 + (hoje.getMonth() - dAdm.getMonth());
    if (diffMeses >= 12) {
      const anos = Math.floor(diffMeses / 12);
      const fimConcessivo = new Date(dAdm);
      fimConcessivo.setFullYear(fimConcessivo.getFullYear() + anos + 1);

      const diffDiasConcessivo = Math.ceil((fimConcessivo.getTime() - hoje.getTime()) / (1000 * 60 * 60 * 24));
      if (diffDiasConcessivo >= 0 && diffDiasConcessivo <= 60) {
        alertas.push({
          tipo: 'FERIAS_CONCESSIVO',
          titulo: `Férias com período concessivo a vencer em ${diffDiasConcessivo} dias`,
          detalhes: `O período concessivo de férias de ${c.nome} encerra em ${fimConcessivo.toISOString().slice(0, 10)}. Programe o gozo para evitar passivo legal.`,
          referenciaId: c.id,
          diasRestantes: diffDiasConcessivo,
        });
      }
    }
  }

  // 6. Alerta do 13º Salário (RN-84: 15 dias antes de 30/11 e de 20/12)
  const anoAtual = hoje.getFullYear();
  const data1aParcela = new Date(`${anoAtual}-11-30`);
  const data2aParcela = new Date(`${anoAtual}-12-20`);

  const diff1a = Math.ceil((data1aParcela.getTime() - hoje.getTime()) / (1000 * 60 * 60 * 24));
  if (diff1a >= 0 && diff1a <= 15) {
    alertas.push({
      tipo: 'DECIMO_TERCEIRO',
      titulo: `Prazo da 1ª parcela do 13º salário em ${diff1a} dias`,
      detalhes: `O pagamento da 1ª parcela do 13º salário deve ocorrer até 30/11/${anoAtual}.`,
      diasRestantes: diff1a,
    });
  }

  const diff2a = Math.ceil((data2aParcela.getTime() - hoje.getTime()) / (1000 * 60 * 60 * 24));
  if (diff2a >= 0 && diff2a <= 15) {
    alertas.push({
      tipo: 'DECIMO_TERCEIRO',
      titulo: `Prazo da 2ª parcela do 13º salário em ${diff2a} dias`,
      detalhes: `O pagamento da 2ª parcela do 13º salário deve ocorrer até 20/12/${anoAtual}.`,
      diasRestantes: diff2a,
    });
  }

  // 7. Notificações à Diretoria e RH: Conferência realizada pelo mesmo usuário que calculou (RN-67 / US-13)
  try {
    const compsJustificadas = db.prepare(`
      SELECT c.id, c.mes_ano, c.conferido_em, c.justificativa_conferencia, u.email as conferente_email
      FROM competencias c
      JOIN usuarios u ON u.id = c.conferido_por
      WHERE c.justificativa_conferencia IS NOT NULL AND c.justificativa_conferencia != ''
    `).all() as any[];

    for (const c of compsJustificadas) {
      alertas.push({
        tipo: 'NOTIFICACAO_DIRETORIA_CONFERENCIA',
        titulo: `Notificação à Diretoria: Conferência pelo mesmo usuário (${c.mes_ano})`,
        detalhes: `A conferência da folha ${c.mes_ano} foi confirmada pelo mesmo analista de RH (${c.conferente_email}) com a justificativa: "${c.justificativa_conferencia}".`,
        referenciaId: c.id,
      });
    }
  } catch {
    // Coluna pode não existir em esquemas não migrados
  }

  return alertas.map(a => ({
    ...a,
    descricao: a.detalhes,
  }));
}

/**
 * RN-77 / US-18: Registro e Tratamento de Incidentes de Segurança da Informação (LGPD art. 48).
 * - RH, Diretoria e Admin registram incidentes;
 * - Diretoria e Admin tratam e acompanham, registrando providências até o encerramento;
 * - Decisão de comunicar ANPD e titulares cabe exclusivamente à Diretoria com orientação jurídica.
 */
export interface IncidenteSegurancaRegistroDTO {
  descricao: string;
  dadosAfetados: string;
  pessoasAfetadas: string;
  providenciasIniciais?: string;
}

export interface DecisaoComunicacaoIncidenteDTO {
  comunicarANPD: boolean;
  comunicarTitulares: boolean;
  orientacaoJuridica: string;
}

export function registrarIncidenteSeguranca(
  db: DatabaseSync,
  usuarioSolicitante: { id: number; email: string; perfil: string },
  dados: IncidenteSegurancaRegistroDTO
): any {
  if (usuarioSolicitante.perfil !== 'RH' && usuarioSolicitante.perfil !== 'ADMIN' && usuarioSolicitante.perfil !== 'DIRETORIA') {
    throw new Error('Apenas RH, Admin e Diretoria podem registrar incidentes de segurança (RN-77 / US-18).');
  }

  if (!dados.descricao || !dados.descricao.trim() || !dados.dadosAfetados || !dados.dadosAfetados.trim() || !dados.pessoasAfetadas || !dados.pessoasAfetadas.trim()) {
    throw new Error('Informe a descrição, os dados possivelmente afetados e as pessoas afetadas.');
  }

  const agora = new Date().toISOString();
  const stmt = db.prepare(`
    INSERT INTO incidentes_seguranca (
      data_hora, descricao, dados_afetados, pessoas_afetadas,
      responsavel_usuario_id, responsavel_email, providencias, situacao, criado_em, atualizado_em
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 'ABERTO', ?, ?)
  `);

  const providenciaInicialTexto = dados.providenciasIniciais && dados.providenciasIniciais.trim()
    ? `[${agora} ${usuarioSolicitante.email}]: ${dados.providenciasIniciais.trim()}`
    : null;

  const res = stmt.run(
    agora,
    dados.descricao.trim(),
    dados.dadosAfetados.trim(),
    dados.pessoasAfetadas.trim(),
    usuarioSolicitante.id,
    usuarioSolicitante.email,
    providenciaInicialTexto,
    agora,
    agora
  );

  const incidenteId = Number(res.lastInsertRowid);

  if (dados.providenciasIniciais && dados.providenciasIniciais.trim()) {
    try {
      db.prepare(`
        INSERT INTO incidentes_providencias (
          incidente_id, data_hora, usuario_id, usuario_email, usuario_perfil,
          descricao_providencia, situacao_resultante
        ) VALUES (?, ?, ?, ?, ?, ?, 'ABERTO')
      `).run(
        incidenteId,
        agora,
        usuarioSolicitante.id,
        usuarioSolicitante.email,
        usuarioSolicitante.perfil,
        dados.providenciasIniciais.trim()
      );
    } catch (_) {}
  }

  registrarLog(db, {
    usuarioId: usuarioSolicitante.id,
    usuarioEmail: usuarioSolicitante.email,
    usuarioPerfil: usuarioSolicitante.perfil,
    acao: 'REGISTRAR_INCIDENTE_SEGURANCA',
    entidade: 'INCIDENTE',
    registroId: incidenteId,
    detalhes: `Incidente de segurança registrado: "${dados.descricao.trim()}"`,
  });

  return { id: incidenteId, situacao: 'ABERTO', criadoEm: agora };
}

export function atualizarIncidenteSeguranca(
  db: DatabaseSync,
  usuarioSolicitante: { id: number; email: string; perfil: string },
  incidenteId: number,
  dados: {
    providencias?: string;
    situacao?: 'ABERTO' | 'EM_TRATAMENTO' | 'ENCERRADO';
  }
): void {
  // Apenas Diretoria e Admin tratam incidentes (RN-77 / US-18)
  if (usuarioSolicitante.perfil !== 'DIRETORIA' && usuarioSolicitante.perfil !== 'ADMIN') {
    throw new Error('Apenas Diretoria e Admin podem tratar e encerrar incidentes de segurança (RN-77 / US-18).');
  }

  const atual = db.prepare('SELECT * FROM incidentes_seguranca WHERE id = ?').get(incidenteId) as any;
  if (!atual) throw new Error('Incidente de segurança não encontrado.');

  const agora = new Date().toISOString();
  const novaSituacao = dados.situacao || atual.situacao;

  let novasProvidenciasTexto = atual.providencias;
  if (dados.providencias && dados.providencias.trim()) {
    const descTrim = dados.providencias.trim();
    novasProvidenciasTexto = `${atual.providencias ? atual.providencias + '\n' : ''}[${agora} ${usuarioSolicitante.email}]: ${descTrim}`;

    try {
      db.prepare(`
        INSERT INTO incidentes_providencias (
          incidente_id, data_hora, usuario_id, usuario_email, usuario_perfil,
          descricao_providencia, situacao_resultante
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        incidenteId,
        agora,
        usuarioSolicitante.id,
        usuarioSolicitante.email,
        usuarioSolicitante.perfil,
        descTrim,
        novaSituacao
      );
    } catch (_) {}
  }

  db.prepare(`
    UPDATE incidentes_seguranca
    SET providencias = ?, situacao = ?, atualizado_em = ?
    WHERE id = ?
  `).run(novasProvidenciasTexto, novaSituacao, agora, incidenteId);

  registrarLog(db, {
    usuarioId: usuarioSolicitante.id,
    usuarioEmail: usuarioSolicitante.email,
    usuarioPerfil: usuarioSolicitante.perfil,
    acao: 'TRATAR_INCIDENTE_SEGURANCA',
    entidade: 'INCIDENTE',
    registroId: incidenteId,
    detalhes: `Incidente ID ${incidenteId} atualizado por ${usuarioSolicitante.email}: situação ${novaSituacao}${dados.providencias ? `. Providência: "${dados.providencias.trim()}"` : ''}`,
  });
}

/**
 * US-18: Decisão de comunicação à ANPD e aos titulares de dados pessoais.
 * Restrito exclusivamente à Diretoria com fundamentação jurídica (RN-77).
 */
export function decidirComunicacaoIncidente(
  db: DatabaseSync,
  usuarioSolicitante: { id: number; email: string; perfil: string },
  incidenteId: number,
  dados: DecisaoComunicacaoIncidenteDTO
): {
  incidenteId: number;
  comunicarANPD: boolean;
  comunicarTitulares: boolean;
  orientacaoJuridica: string;
  decisaoPor: string;
  decisaoEm: string;
} {
  // Apenas Diretoria pode decidir sobre comunicação à ANPD e titulares (RN-77 / US-18)
  if (usuarioSolicitante.perfil !== 'DIRETORIA') {
    throw new Error('Apenas a Diretoria, com orientação jurídica, pode decidir sobre a comunicação à ANPD e aos titulares (RN-77 / US-18).');
  }

  if (!dados.orientacaoJuridica || !dados.orientacaoJuridica.trim()) {
    throw new Error('A orientação jurídica e fundamentação técnica são obrigatórias para a decisão de comunicação (RN-77 / US-18).');
  }

  const atual = db.prepare('SELECT * FROM incidentes_seguranca WHERE id = ?').get(incidenteId) as any;
  if (!atual) throw new Error('Incidente de segurança não encontrado.');

  const agora = new Date().toISOString();
  const comunicarAnpdInt = dados.comunicarANPD ? 1 : 0;
  const comunicarTitularesInt = dados.comunicarTitulares ? 1 : 0;
  const orientacao = dados.orientacaoJuridica.trim();

  db.prepare(`
    UPDATE incidentes_seguranca
    SET comunicar_anpd = ?,
        comunicar_titulares = ?,
        orientacao_juridica = ?,
        decisao_comunicacao_por = ?,
        decisao_comunicacao_email = ?,
        decisao_comunicacao_em = ?,
        atualizado_em = ?
    WHERE id = ?
  `).run(
    comunicarAnpdInt,
    comunicarTitularesInt,
    orientacao,
    usuarioSolicitante.id,
    usuarioSolicitante.email,
    agora,
    agora,
    incidenteId
  );

  const descDecisao = `[Decisão da Diretoria com Parecer Jurídico]: Notificar ANPD: ${dados.comunicarANPD ? 'SIM' : 'NÃO'}; Notificar Titulares: ${dados.comunicarTitulares ? 'SIM' : 'NÃO'}. Parecer Jurídico: "${orientacao}"`;
  const novasProvidencias = `${atual.providencias ? atual.providencias + '\n' : ''}[${agora} ${usuarioSolicitante.email}]: ${descDecisao}`;

  db.prepare('UPDATE incidentes_seguranca SET providencias = ? WHERE id = ?').run(novasProvidencias, incidenteId);

  try {
    db.prepare(`
      INSERT INTO incidentes_providencias (
        incidente_id, data_hora, usuario_id, usuario_email, usuario_perfil,
        descricao_providencia, situacao_resultante
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      incidenteId,
      agora,
      usuarioSolicitante.id,
      usuarioSolicitante.email,
      usuarioSolicitante.perfil,
      descDecisao,
      atual.situacao
    );
  } catch (_) {}

  registrarLog(db, {
    usuarioId: usuarioSolicitante.id,
    usuarioEmail: usuarioSolicitante.email,
    usuarioPerfil: usuarioSolicitante.perfil,
    acao: 'DECISAO_COMUNICACAO_INCIDENTE_LGPD',
    entidade: 'INCIDENTE',
    registroId: incidenteId,
    detalhes: `Decisão de comunicação do Incidente ID ${incidenteId}: ANPD=${dados.comunicarANPD ? 'SIM' : 'NÃO'}, Titulares=${dados.comunicarTitulares ? 'SIM' : 'NÃO'}. Parecer jurídico registrado.`,
  });

  return {
    incidenteId,
    comunicarANPD: Boolean(dados.comunicarANPD),
    comunicarTitulares: Boolean(dados.comunicarTitulares),
    orientacaoJuridica: orientacao,
    decisaoPor: usuarioSolicitante.email,
    decisaoEm: agora
  };
}

/**
 * Consulta detalhada de um incidente de segurança, incluindo histórico estruturado de providências.
 */
export function obterIncidenteSeguranca(
  db: DatabaseSync,
  usuarioSolicitante: { perfil: string },
  incidenteId: number
): any {
  if (usuarioSolicitante.perfil !== 'RH' && usuarioSolicitante.perfil !== 'ADMIN' && usuarioSolicitante.perfil !== 'DIRETORIA') {
    throw new Error('Apenas RH, Admin e Diretoria podem consultar incidentes de segurança (RN-77 / US-18).');
  }

  const inc = db.prepare('SELECT * FROM incidentes_seguranca WHERE id = ?').get(incidenteId) as any;
  if (!inc) throw new Error('Incidente de segurança não encontrado.');

  let providencias: any[] = [];
  try {
    providencias = db.prepare('SELECT * FROM incidentes_providencias WHERE incidente_id = ? ORDER BY id ASC').all(incidenteId) as any[];
  } catch (_) {}

  return {
    id: inc.id,
    dataHora: inc.data_hora,
    descricao: inc.descricao,
    dadosAfetados: inc.dados_afetados,
    pessoasAfetadas: inc.pessoas_afetadas,
    responsavel: {
      id: inc.responsavel_usuario_id,
      email: inc.responsavel_email
    },
    situacao: inc.situacao,
    providenciasTexto: inc.providencias,
    historicoProvidencias: providencias.map((p) => ({
      id: p.id,
      dataHora: p.data_hora,
      usuarioId: p.usuario_id,
      usuarioEmail: p.usuario_email,
      usuarioPerfil: p.usuario_perfil,
      descricao: p.descricao_providencia,
      situacaoResultante: p.situacao_resultante
    })),
    comunicarANPD: Boolean(inc.comunicar_anpd),
    comunicarTitulares: Boolean(inc.comunicar_titulares),
    orientacaoJuridica: inc.orientacao_juridica,
    decisaoComunicacaoPor: inc.decisao_comunicacao_email,
    decisaoComunicacaoEm: inc.decisao_comunicacao_em,
    criadoEm: inc.criado_em,
    atualizadoEm: inc.atualizado_em
  };
}

export function listarIncidentesSeguranca(
  db: DatabaseSync,
  usuarioSolicitante: { perfil: string }
): any[] {
  if (usuarioSolicitante.perfil !== 'RH' && usuarioSolicitante.perfil !== 'ADMIN' && usuarioSolicitante.perfil !== 'DIRETORIA') {
    throw new Error('Apenas RH, Admin e Diretoria podem acompanhar incidentes de segurança (RN-77 / US-18).');
  }
  return db.prepare('SELECT * FROM incidentes_seguranca ORDER BY id DESC').all();
}

// =========================================================================
// US-17 / RN-56, RNF-29, RNF-55: GESTÃO DE RETENÇÃO E DESCARTE SEGURO LGPD
// =========================================================================

export interface RetencaoCategoriaInfo {
  nome: string;
  prazoAnos: number;
  fundamentoLegal: string;
  vencido: boolean;
  retidoPorMaiorPrazo: boolean;
}

export interface AvaliacaoRetencaoDTO {
  colaboradorId: number;
  nome: string;
  cpf: string;
  situacao: string;
  desligamento: string | null;
  anosPosDesligamento: number;
  aptoParaEliminacao: boolean;
  motivoBloqueio?: string;
  categorias: {
    pessoaisEBancarios: RetencaoCategoriaInfo;
    folhaEContrato: RetencaoCategoriaInfo;
    saudeOcupacionalNR7: RetencaoCategoriaInfo;
  };
}

/**
 * RN-56 / RNF-29 / Tabela 6.4: Avaliação de Retenção de Dados por Categoria.
 * Prazos:
 * - Documentos pessoais e bancários: 5 anos pós-desligamento (prescrição trabalhista CF art. 7º, XXIX).
 * - Folha, recibos e contratos: 10 anos pós-desligamento (prescrição civil e previdenciária).
 * - Saúde ocupacional e exames (NR-7): 20 anos pós-desligamento.
 * Regra do Maior Prazo (RNF-29): Se pertencer a mais de uma categoria, prevalece o maior prazo.
 */
export function avaliarRetencaoColaborador(
  db: DatabaseSync,
  colaboradorId: number,
  dataReferencia?: string
): AvaliacaoRetencaoDTO {
  const colab = db.prepare('SELECT id, nome, cpf, situacao, desligamento FROM colaboradores WHERE id = ?').get(colaboradorId) as any;
  if (!colab) {
    throw new Error('Colaborador não encontrado.');
  }

  const hoje = dataReferencia ? new Date(dataReferencia) : new Date();

  if (colab.situacao === 'ATIVO' || !colab.desligamento) {
    return {
      colaboradorId: colab.id,
      nome: colab.nome,
      cpf: colab.cpf,
      situacao: colab.situacao,
      desligamento: null,
      anosPosDesligamento: 0,
      aptoParaEliminacao: false,
      motivoBloqueio: 'Colaborador com vínculo ativo ou sem data de desligamento. Dados mantidos para execução do contrato (LGPD art. 7º, V / RN-56).',
      categorias: {
        pessoaisEBancarios: {
          nome: 'Documentos Pessoais e Dados Bancários',
          prazoAnos: 5,
          fundamentoLegal: 'Prescrição trabalhista bienal/quinquenal (CF art. 7º, XXIX)',
          vencido: false,
          retidoPorMaiorPrazo: false,
        },
        folhaEContrato: {
          nome: 'Dados Cadastrais, Folhas e Recibos',
          prazoAnos: 10,
          fundamentoLegal: 'Prescrição civil e previdenciária (Código Civil art. 205)',
          vencido: false,
          retidoPorMaiorPrazo: false,
        },
        saudeOcupacionalNR7: {
          nome: 'Saúde Ocupacional e Exames Periódicos',
          prazoAnos: 20,
          fundamentoLegal: 'Guarda de prontuários médicos ocupacionais (NR-7 item 7.4.5)',
          vencido: false,
          retidoPorMaiorPrazo: false,
        },
      },
    };
  }

  const dDesl = new Date(colab.desligamento);
  const anosPosDesligamento = (hoje.getTime() - dDesl.getTime()) / (1000 * 60 * 60 * 24 * 365.25);

  const vencPessoais = anosPosDesligamento >= 5;
  const vencFolha = anosPosDesligamento >= 10;
  const vencSaude = anosPosDesligamento >= 20;

  const aptoParaEliminacao = vencPessoais;
  let motivoBloqueio: string | undefined = undefined;

  if (!aptoParaEliminacao) {
    const faltamAnos = Math.max(0, 5 - anosPosDesligamento).toFixed(1);
    motivoBloqueio = `Colaborador desligado há ${anosPosDesligamento.toFixed(1)} anos. Dentro do prazo legal mínimo de retenção de 5 anos (faltam aprox. ${faltamAnos} anos). Descarte bloqueado (CF art. 7º / RN-56).`;
  }

  return {
    colaboradorId: colab.id,
    nome: colab.nome,
    cpf: colab.cpf,
    situacao: colab.situacao,
    desligamento: colab.desligamento,
    anosPosDesligamento: parseFloat(anosPosDesligamento.toFixed(2)),
    aptoParaEliminacao,
    motivoBloqueio,
    categorias: {
      pessoaisEBancarios: {
        nome: 'Documentos Pessoais e Dados Bancários',
        prazoAnos: 5,
        fundamentoLegal: 'Prescrição trabalhista bienal/quinquenal (CF art. 7º, XXIX)',
        vencido: vencPessoais,
        retidoPorMaiorPrazo: false,
      },
      folhaEContrato: {
        nome: 'Dados Cadastrais, Folhas e Recibos',
        prazoAnos: 10,
        fundamentoLegal: 'Prescrição civil e previdenciária (Código Civil art. 205)',
        vencido: vencFolha,
        retidoPorMaiorPrazo: !vencFolha && vencPessoais,
      },
      saudeOcupacionalNR7: {
        nome: 'Saúde Ocupacional e Exames Periódicos',
        prazoAnos: 20,
        fundamentoLegal: 'Guarda de prontuários médicos ocupacionais (NR-7 item 7.4.5)',
        vencido: vencSaude,
        retidoPorMaiorPrazo: !vencSaude,
      },
    },
  };
}

/**
 * RN-56 / RNF-29 / RNF-55: Eliminação e Anonimização de Dados após prazo de retenção.
 * - Exige confirmação expressa do RH (nunca elimina automaticamente).
 * - Exige justificativa e fundamento legal.
 * - Respeita a regra do maior prazo (RNF-29): exames NR-7 permanecem por 20 anos.
 * - Gera o Termo de Eliminação com registro detalhado no log de auditoria imutável (RNF-55).
 */
export function executarEliminacaoAnonimizacaoLGPD(
  db: DatabaseSync,
  usuarioSolicitante: { id: number; email: string; perfil: string },
  colaboradorId: number,
  dados: {
    confirmacaoRH: boolean;
    justificativa: string;
    dataReferencia?: string;
  }
): {
  sucesso: boolean;
  mensagem: string;
  termo: any;
} {
  if (usuarioSolicitante.perfil !== 'RH') {
    throw new Error('Você não tem permissão para esta ação. Apenas o perfil RH pode homologar a eliminação ou anonimização de dados.');
  }

  if (!dados.confirmacaoRH) {
    throw new Error('A eliminação/anonimização exige confirmação expressa do RH (RN-56 / RNF-55).');
  }

  if (!dados.justificativa || !dados.justificativa.trim()) {
    throw new Error('Informe a justificativa e o fundamento legal para a eliminação/anonimização dos dados.');
  }

  const avaliacao = avaliarRetencaoColaborador(db, colaboradorId, dados.dataReferencia);
  if (!avaliacao.aptoParaEliminacao) {
    throw new Error(`Eliminação rejeitada: ${avaliacao.motivoBloqueio}`);
  }

  const agora = new Date().toISOString();
  const termoId = `TERMO-LGPD-${colaboradorId}-${Date.now()}`;

  const categoriasEliminadas: string[] = [];
  const categoriasRetidas: string[] = [];

  // 1. Categoria Pessoais e Bancários (5 anos)
  if (avaliacao.categorias.pessoaisEBancarios.vencido) {
    categoriasEliminadas.push('Documentos Pessoais e Dados Bancários (5 anos expirados)');

    db.prepare(`
      UPDATE colaboradores
      SET nome = 'COLABORADOR ANONIMIZADO #' || id,
        banco = '***',
        agencia = '***',
        conta = '***',
        titular_conta = 'ANONIMIZADO',
        cpf = '00000000000',
        nascimento = '1900-01-01',
        email = NULL,
        atualizado_em = ?
      WHERE id = ?
    `).run(agora, colaboradorId);

    db.prepare(`
      DELETE FROM documentos_colaborador
      WHERE colaborador_id = ?
    `).run(colaboradorId);

    db.prepare(`
      UPDATE dependentes
      SET nome = 'DEPENDENTE ANONIMIZADO', nascimento = '1900-01-01'
      WHERE colaborador_id = ?
    `).run(colaboradorId);
  }

  // 2. Categoria Folha e Contratos (10 anos)
  if (avaliacao.categorias.folhaEContrato.vencido) {
    categoriasEliminadas.push('Folhas de Pagamento, Recibos e Contrato (10 anos expirados)');
  } else {
    categoriasRetidas.push('Dados Contratuais e Previdenciários (Retidos até completar 10 anos pós-desligamento)');
  }

  // 3. Categoria Saúde Ocupacional (20 anos - NR-7)
  if (avaliacao.categorias.saudeOcupacionalNR7.vencido) {
    categoriasEliminadas.push('Saúde Ocupacional e Exames NR-7 (20 anos expirados)');
    db.prepare('DELETE FROM exames_ocupacionais WHERE colaborador_id = ?').run(colaboradorId);
  } else {
    // Respeita a regra do maior prazo: exames médicos NR-7 continuam retidos
    categoriasRetidas.push('Saúde Ocupacional e Exames NR-7 (Retidos por 20 anos pós-desligamento conforme NR-7)');
  }

  const termo = {
    termoId,
    dataHora: agora,
    responsavel: {
      id: usuarioSolicitante.id,
      email: usuarioSolicitante.email,
      perfil: usuarioSolicitante.perfil,
    },
    colaboradorId,
    colaboradorNomeOriginal: avaliacao.nome,
    dataDesligamento: avaliacao.desligamento!,
    anosPosDesligamento: avaliacao.anosPosDesligamento,
    categoriasEliminadas,
    categoriasRetidas,
    fundamentoLegal: dados.justificativa.trim(),
    status: 'CONCLUIDO',
  };

  // Registra no Log de Auditoria Imutável (RNF-03 / RNF-55)
  registrarLog(db, {
    usuarioId: usuarioSolicitante.id,
    usuarioEmail: usuarioSolicitante.email,
    usuarioPerfil: usuarioSolicitante.perfil,
    acao: 'ELIMINACAO_DADOS_LGPD',
    entidade: 'COLABORADOR',
    registroId: colaboradorId,
    detalhes: `Termo de eliminação/anonimização ${termoId} homologado pelo RH (${usuarioSolicitante.email}) para colaborador ID ${colaboradorId} (${avaliacao.nome}). Categorias eliminadas: [${categoriasEliminadas.join('; ')}]. Categorias retidas por maior prazo: [${categoriasRetidas.join('; ')}]. Fundamento legal: "${dados.justificativa.trim()}".`,
  });

  return {
    sucesso: true,
    mensagem: 'Eliminação e anonimização de dados concluída com sucesso com termo registrado em log (RN-56 / RNF-55).',
    termo,
  };
}
