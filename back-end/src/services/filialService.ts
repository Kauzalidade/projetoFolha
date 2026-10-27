/**
 * filialService.ts - Gerenciamento de Matriz e Filiais (Seção 1.4, Seção 2, Seção 4).
 */

import { DatabaseSync } from 'node:sqlite';
import { registrarLog } from './logService.js';

export interface CriarFilialDTO {
  nome: string;
  tipo: 'MATRIZ' | 'FILIAL';
}

export function criarFilial(
  db: DatabaseSync,
  usuarioSolicitante: { id: number; email: string; perfil: string },
  dados: CriarFilialDTO
): { id: number; nome: string; tipo: 'MATRIZ' | 'FILIAL'; ativa: boolean } {
  // Somente perfil RH pode cadastrar filial (Seção 4)
  if (usuarioSolicitante.perfil !== 'RH') {
    throw new Error('Você não tem permissão para esta ação.');
  }

  if (!dados.nome || dados.nome.trim().length < 2) {
    throw new Error('Informe o nome da filial.');
  }

  if (dados.tipo !== 'MATRIZ' && dados.tipo !== 'FILIAL') {
    throw new Error('Tipo de filial deve ser MATRIZ ou FILIAL.');
  }

  const agora = new Date().toISOString();
  const stmt = db.prepare('INSERT INTO filiais (nome, tipo, ativa, criado_em) VALUES (?, ?, 1, ?)');
  const res = stmt.run(dados.nome.trim(), dados.tipo, agora);
  const idCriado = Number(res.lastInsertRowid);

  registrarLog(db, {
    usuarioId: usuarioSolicitante.id,
    usuarioEmail: usuarioSolicitante.email,
    usuarioPerfil: usuarioSolicitante.perfil,
    acao: 'CRIAR_FILIAL',
    entidade: 'FILIAL',
    registroId: idCriado,
    detalhes: `Filial ${dados.nome.trim()} (${dados.tipo}) criada`,
    valorNovo: JSON.stringify({ nome: dados.nome.trim(), tipo: dados.tipo }),
  });

  return {
    id: idCriado,
    nome: dados.nome.trim(),
    tipo: dados.tipo,
    ativa: true,
  };
}

export function listarFiliais(
  db: DatabaseSync,
  usuarioSolicitante: { perfil: string }
): any[] {
  // Apenas RH e DIRETORIA podem consultar dados cadastrais (Seção 4)
  if (usuarioSolicitante.perfil !== 'RH' && usuarioSolicitante.perfil !== 'DIRETORIA') {
    throw new Error('Você não tem permissão para esta ação.');
  }

  const stmt = db.prepare('SELECT id, nome, tipo, ativa, criado_em FROM filiais ORDER BY id ASC');
  return stmt.all();
}
