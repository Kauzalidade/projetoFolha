/**
 * logService.ts - Registro e consulta de logs de auditoria imutáveis (RNF-03).
 */

import { DatabaseSync } from 'node:sqlite';

export interface RegistroLogDTO {
  usuarioId?: number | null;
  usuarioEmail: string;
  usuarioPerfil: string;
  acao: string;
  entidade: string;
  registroId?: string | number | null;
  detalhes?: string;
  valorAnterior?: string | null;
  valorNovo?: string | null;
}

export function registrarLog(db: DatabaseSync, dados: RegistroLogDTO): void {
  const agora = new Date().toISOString();
  const stmt = db.prepare(`
    INSERT INTO logs_auditoria (
      data_hora, usuario_id, usuario_email, usuario_perfil,
      acao, entidade, registro_id, detalhes, valor_anterior, valor_novo
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  stmt.run(
    agora,
    dados.usuarioId ?? null,
    dados.usuarioEmail,
    dados.usuarioPerfil,
    dados.acao,
    dados.entidade,
    dados.registroId ? String(dados.registroId) : null,
    dados.detalhes ?? null,
    dados.valorAnterior ?? null,
    dados.valorNovo ?? null
  );
}

export interface OperacaoCriticaDTO {
  operacaoId: string; // Ex: OP-CALC-2026-10-848392, OP-FECH-2026-10-184920
  tipo: 'CALCULO' | 'FECHAMENTO' | 'REABERTURA' | 'EXPORTACAO';
  competencia?: string;
  usuario: { id: number; email: string; perfil: string };
  resultado: 'CONCLUIDA' | 'CANCELADA' | 'PENDENTE';
  tempoExecucaoMs?: number;
  detalhes?: string;
}

/**
 * RN-71: Operações críticas (cálculo, fechamento, reabertura e exportação) têm identificador e resultado no log:
 * concluída, cancelada ou pendente. Cálculos acima de 5s são sinalizados (RNF-39).
 */
export function registrarOperacaoCritica(db: DatabaseSync, dados: OperacaoCriticaDTO): void {
  const alertaTempo = dados.tempoExecucaoMs && dados.tempoExecucaoMs > 5000 ? ' [ALERTA: Tempo > 5s (RNF-39)]' : '';
  const desc = `Operação ${dados.operacaoId} (${dados.tipo}) [${dados.resultado}]. ${dados.detalhes || ''}${dados.tempoExecucaoMs !== undefined ? ` (Tempo: ${dados.tempoExecucaoMs}ms)` : ''}${alertaTempo}`.trim();

  registrarLog(db, {
    usuarioId: dados.usuario.id,
    usuarioEmail: dados.usuario.email,
    usuarioPerfil: dados.usuario.perfil,
    acao: `OPERACAO_${dados.tipo}`,
    entidade: 'OPERACAO_CRITICA',
    registroId: dados.operacaoId,
    detalhes: desc,
    valorAnterior: dados.resultado === 'CONCLUIDA' ? 'PENDENTE' : null,
    valorNovo: dados.resultado,
  });
}

export function consultarLogs(
  db: DatabaseSync,
  usuarioSolicitante: { perfil: string },
  filtros?: { entidade?: string; usuarioEmail?: string }
): any[] {
  // Apenas DIRETORIA e ADMIN podem visualizar logs (Seção 4)
  if (usuarioSolicitante.perfil !== 'DIRETORIA' && usuarioSolicitante.perfil !== 'ADMIN') {
    throw new Error('Você não tem permissão para esta ação.');
  }

  let query = 'SELECT * FROM logs_auditoria WHERE 1=1';
  const params: any[] = [];

  if (filtros?.entidade) {
    query += ' AND entidade = ?';
    params.push(filtros.entidade);
  }
  if (filtros?.usuarioEmail) {
    query += ' AND usuario_email = ?';
    params.push(filtros.usuarioEmail);
  }

  query += ' ORDER BY id DESC';
  const stmt = db.prepare(query);
  return stmt.all(...params);
}
