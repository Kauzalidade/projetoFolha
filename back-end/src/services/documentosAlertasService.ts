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
  tipo: 'DOCUMENTO_VENCENDO' | 'EXAME_VENCENDO' | 'FERIAS_CONCESSIVO' | 'PRAZO_PAGAMENTO_FOLHA' | 'DECIMO_TERCEIRO' | 'DADOS_FORA_PRAZO_GUARDA';
  titulo: string;
  detalhes: string;
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

  return alertas;
}

/**
 * RN-77: Registro de Incidentes de Segurança da Informação (LGPD art. 48).
 * RH, Diretoria e Admin registram incidentes; Diretoria e Admin tratam.
 */
export function registrarIncidenteSeguranca(
  db: DatabaseSync,
  usuarioSolicitante: { id: number; email: string; perfil: string },
  dados: {
    descricao: string;
    dadosAfetados: string;
    pessoasAfetadas: string;
    providenciasIniciais?: string;
  }
): any {
  if (!dados.descricao || !dados.dadosAfetados || !dados.pessoasAfetadas) {
    throw new Error('Informe a descrição, os dados possivelmente afetados e as pessoas afetadas.');
  }

  const agora = new Date().toISOString();
  const stmt = db.prepare(`
    INSERT INTO incidentes_seguranca (
      data_hora, descricao, dados_afetados, pessoas_afetadas,
      responsavel_usuario_id, responsavel_email, providencias, situacao, criado_em, atualizado_em
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 'ABERTO', ?, ?)
  `);

  const res = stmt.run(
    agora,
    dados.descricao.trim(),
    dados.dadosAfetados.trim(),
    dados.pessoasAfetadas.trim(),
    usuarioSolicitante.id,
    usuarioSolicitante.email,
    dados.providenciasIniciais ?? null,
    agora,
    agora
  );

  const incidenteId = Number(res.lastInsertRowid);

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
  // Apenas Diretoria e Admin tratam incidentes (Tabela 4.1)
  if (usuarioSolicitante.perfil !== 'DIRETORIA' && usuarioSolicitante.perfil !== 'ADMIN') {
    throw new Error('Apenas Diretoria e Admin podem tratar e encerrar incidentes de segurança.');
  }

  const atual = db.prepare('SELECT * FROM incidentes_seguranca WHERE id = ?').get(incidenteId) as any;
  if (!atual) throw new Error('Incidente não encontrado.');

  const agora = new Date().toISOString();
  const novaSituacao = dados.situacao || atual.situacao;
  const novasProvidencias = dados.providencias ? `${atual.providencias ? atual.providencias + '\n' : ''}[${agora} ${usuarioSolicitante.email}]: ${dados.providencias.trim()}` : atual.providencias;

  db.prepare(`
    UPDATE incidentes_seguranca
    SET providencias = ?, situacao = ?, atualizado_em = ?
    WHERE id = ?
  `).run(novasProvidencias, novaSituacao, agora, incidenteId);

  registrarLog(db, {
    usuarioId: usuarioSolicitante.id,
    usuarioEmail: usuarioSolicitante.email,
    usuarioPerfil: usuarioSolicitante.perfil,
    acao: 'TRATAR_INCIDENTE_SEGURANCA',
    entidade: 'INCIDENTE',
    registroId: incidenteId,
    detalhes: `Incidente ID ${incidenteId} atualizado para situação ${novaSituacao}`,
  });
}

export function listarIncidentesSeguranca(
  db: DatabaseSync,
  usuarioSolicitante: { perfil: string }
): any[] {
  return db.prepare('SELECT * FROM incidentes_seguranca ORDER BY id DESC').all();
}
