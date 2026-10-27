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
