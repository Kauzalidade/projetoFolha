/**
 * competenciaService.ts - Controle do Ciclo de Vida da Competência (RN-04, RN-08, Tabela 7.5, Seção 4).
 * 
 * Ciclo: Aberta -> Calculada -> Fechada
 * Reabertura: Apenas RH com justificativa obrigatória, grava evento destacado no Log de Auditoria (RN-04).
 */

import { DatabaseSync } from 'node:sqlite';
import { registrarLog } from './logService.js';

export interface CompetenciaRegistro {
  id: number;
  mes_ano: string;
  situacao: 'ABERTA' | 'CALCULADA' | 'FECHADA';
  fechado_em: string | null;
  justificativa_reabertura: string | null;
  criado_em: string;
}

export function abrirOuObterCompetencia(
  db: DatabaseSync,
  usuarioSolicitante: { id: number; email: string; perfil: string },
  mesAno: string
): CompetenciaRegistro {
  if (!/^\d{4}-\d{2}$/.test(mesAno)) {
    throw new Error('Formato de competência inválido. Use AAAA-MM (ex: 2026-10).');
  }

  const stmtBusca = db.prepare('SELECT * FROM competencias WHERE mes_ano = ?');
  const existente = stmtBusca.get(mesAno) as CompetenciaRegistro | undefined;

  if (existente) {
    return existente;
  }

  // Se não existir, somente RH cria nova competência (Seção 4)
  if (usuarioSolicitante.perfil !== 'RH') {
    throw new Error('Você não tem permissão para abrir uma nova competência.');
  }

  const agora = new Date().toISOString();
  const stmtInsert = db.prepare(`
    INSERT INTO competencias (mes_ano, situacao, criado_em)
    VALUES (?, 'ABERTA', ?)
  `);
  const res = stmtInsert.run(mesAno, agora);

  registrarLog(db, {
    usuarioId: usuarioSolicitante.id,
    usuarioEmail: usuarioSolicitante.email,
    usuarioPerfil: usuarioSolicitante.perfil,
    acao: 'ABRIR_COMPETENCIA',
    entidade: 'COMPETENCIA',
    registroId: Number(res.lastInsertRowid),
    detalhes: `Competência ${mesAno} aberta`,
  });

  return {
    id: Number(res.lastInsertRowid),
    mes_ano: mesAno,
    situacao: 'ABERTA',
    fechado_em: null,
    justificativa_reabertura: null,
    criado_em: agora,
  };
}

export function fecharCompetencia(
  db: DatabaseSync,
  usuarioSolicitante: { id: number; email: string; perfil: string },
  mesAno: string
): void {
  // Somente RH fecha a folha/competência (Seção 4 e Cenário: Diretoria nao fecha a folha)
  if (usuarioSolicitante.perfil !== 'RH') {
    registrarLog(db, {
      usuarioId: usuarioSolicitante.id,
      usuarioEmail: usuarioSolicitante.email,
      usuarioPerfil: usuarioSolicitante.perfil,
      acao: 'TENTATIVA_FECHAMENTO_NEGADA',
      entidade: 'COMPETENCIA',
      detalhes: `Usuário com perfil ${usuarioSolicitante.perfil} tentou fechar competência ${mesAno}`,
    });
    throw new Error('Você não tem permissão para esta ação.');
  }

  const comp = db.prepare('SELECT id, situacao FROM competencias WHERE mes_ano = ?').get(mesAno) as CompetenciaRegistro | undefined;
  if (!comp) {
    throw new Error('Competência não encontrada.');
  }

  const agora = new Date().toISOString();
  db.prepare("UPDATE competencias SET situacao = 'FECHADA', fechado_em = ? WHERE id = ?")
    .run(agora, comp.id);

  registrarLog(db, {
    usuarioId: usuarioSolicitante.id,
    usuarioEmail: usuarioSolicitante.email,
    usuarioPerfil: usuarioSolicitante.perfil,
    acao: 'FECHAR_COMPETENCIA',
    entidade: 'COMPETENCIA',
    registroId: comp.id,
    detalhes: `Competência ${mesAno} fechada com sucesso`,
    valorAnterior: comp.situacao,
    valorNovo: 'FECHADA',
  });
}

export function reabrirCompetencia(
  db: DatabaseSync,
  usuarioSolicitante: { id: number; email: string; perfil: string },
  mesAno: string,
  justificativa: string
): void {
  // Diretoria não reabre competência (Cenário: Diretoria nao reabre competencia)
  if (usuarioSolicitante.perfil !== 'RH') {
    registrarLog(db, {
      usuarioId: usuarioSolicitante.id,
      usuarioEmail: usuarioSolicitante.email,
      usuarioPerfil: usuarioSolicitante.perfil,
      acao: 'TENTATIVA_REABERTURA_NEGADA',
      entidade: 'COMPETENCIA',
      detalhes: `Usuário ${usuarioSolicitante.email} (${usuarioSolicitante.perfil}) tentou reabrir competência ${mesAno}`,
    });
    throw new Error('Você não tem permissão para esta ação.');
  }

  // RN-04: Reabertura sem justificativa é rejeitada (Cenário: Reabertura sem justificativa)
  if (!justificativa || !justificativa.trim()) {
    throw new Error('Para reabrir uma competência fechada, informe a justificativa obrigatória.');
  }

  const comp = db.prepare('SELECT id, situacao FROM competencias WHERE mes_ano = ?').get(mesAno) as CompetenciaRegistro | undefined;
  if (!comp) {
    throw new Error('Competência não encontrada.');
  }

  if (comp.situacao !== 'FECHADA') {
    throw new Error('A competência informada não está fechada.');
  }

  const agora = new Date().toISOString();
  // Homologa na hora: volta para ABERTA sem aguardar aprovação externa (RN-04)
  db.prepare("UPDATE competencias SET situacao = 'ABERTA', justificativa_reabertura = ?, fechado_em = NULL WHERE id = ?")
    .run(justificativa.trim(), comp.id);

  // Grava evento destacado no Log de Auditoria imutável (RN-04 e Cenário: Reabertura de competencia pelo RH)
  registrarLog(db, {
    usuarioId: usuarioSolicitante.id,
    usuarioEmail: usuarioSolicitante.email,
    usuarioPerfil: usuarioSolicitante.perfil,
    acao: 'REABERTURA_COMPETENCIA_DESTACADA',
    entidade: 'COMPETENCIA',
    registroId: comp.id,
    detalhes: `REABERTURA HOMOLOGADA NA HORA pelo RH. Justificativa: "${justificativa.trim()}". Notificação enviada à Diretoria.`,
    valorAnterior: 'FECHADA',
    valorNovo: 'ABERTA',
  });
}

export function verificarCompetenciaAberta(db: DatabaseSync, competenciaId: number): void {
  const comp = db.prepare('SELECT mes_ano, situacao FROM competencias WHERE id = ?').get(competenciaId) as any;
  if (!comp) {
    throw new Error('Competência inexistente.');
  }

  // RN-04: Competência fechada não aceita alteração
  if (comp.situacao === 'FECHADA') {
    throw new Error('Esta competência está fechada. Para alterar, reabra informando a justificativa.');
  }
}
