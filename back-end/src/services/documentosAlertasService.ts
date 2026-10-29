/**
 * documentosAlertasService.ts - Documentos, Exames e Central de Alertas (RN-52, RN-53, RN-56, RN-58).
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
  tipo: 'DOCUMENTO_VENCENDO' | 'EXAME_VENCENDO' | 'FERIAS_CONCESSIVO' | 'PRAZO_PAGAMENTO_FOLHA' | 'DADOS_FORA_PRAZO_GUARDA';
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
  // Alerta no 3º dia útil se a competência do mês anterior ainda não estiver fechada
  const competenciasNaoFechadas = db.prepare("SELECT id, mes_ano, situacao FROM competencias WHERE situacao != 'FECHADA'").all() as any[];
  for (const comp of competenciasNaoFechadas) {
    alertas.push({
      tipo: 'PRAZO_PAGAMENTO_FOLHA',
      titulo: 'Alerta de prazo de pagamento da folha',
      detalhes: `A competência ${comp.mes_ano} ainda não está fechada no prazo limite para pagamento.`,
      referenciaId: comp.id,
    });
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

  return alertas;
}
