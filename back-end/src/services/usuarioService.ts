/**
 * usuarioService.ts - Autenticação, sessão e gerenciamento de usuários (RNF-01, RNF-02, RNF-19, Seção 4).
 */

import { DatabaseSync } from 'node:sqlite';
import {
  validarForcaSenha,
  gerarHashSenha,
  verificarSenha,
  verificarBloqueio,
  registrarFalhaLogin,
  limparFalhasLogin,
  criarSessao,
} from '../security.js';
import { registrarLog } from './logService.js';

export interface CriarUsuarioDTO {
  nome: string;
  email: string;
  senha: string;
  perfil: 'RH' | 'DIRETORIA' | 'ADMIN';
}

export function criarUsuario(
  db: DatabaseSync,
  adminSolicitante: { id: number; email: string; perfil: string },
  dados: CriarUsuarioDTO
): { id: number; nome: string; email: string; perfil: string } {
  // Somente ADMIN gerencia usuários (Seção 4)
  if (adminSolicitante.perfil !== 'ADMIN') {
    throw new Error('Você não tem permissão para esta ação.');
  }

  if (!dados.nome || dados.nome.trim().length < 3) {
    throw new Error('Informe o nome do usuário (mínimo 3 caracteres).');
  }

  const emailLimpo = (dados.email || '').trim().toLowerCase();
  if (!emailLimpo || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailLimpo)) {
    throw new Error('Informe um e-mail válido.');
  }

  const validaSenha = validarForcaSenha(dados.senha);
  if (!validaSenha.valido) {
    throw new Error(validaSenha.motivo);
  }

  if (!['RH', 'DIRETORIA', 'ADMIN'].includes(dados.perfil)) {
    throw new Error('Perfil inválido. Deve ser RH, DIRETORIA ou ADMIN.');
  }

  // Verifica se e-mail já existe
  const buscaStmt = db.prepare('SELECT id FROM usuarios WHERE email = ?');
  const existente = buscaStmt.get(emailLimpo);
  if (existente) {
    throw new Error('Já existe um usuário cadastrado com este e-mail.');
  }

  const hash = gerarHashSenha(dados.senha);
  const agora = new Date().toISOString();

  const insertStmt = db.prepare(`
    INSERT INTO usuarios (nome, email, senha_hash, perfil, ativo, criado_em, atualizado_em)
    VALUES (?, ?, ?, ?, 1, ?, ?)
  `);

  const result = insertStmt.run(dados.nome.trim(), emailLimpo, hash, dados.perfil, agora, agora);
  const idCriado = Number(result.lastInsertRowid);

  // Registra no Log de Auditoria (Cenário: Admin gerencia usuarios)
  registrarLog(db, {
    usuarioId: adminSolicitante.id,
    usuarioEmail: adminSolicitante.email,
    usuarioPerfil: adminSolicitante.perfil,
    acao: 'CRIAR_USUARIO',
    entidade: 'USUARIO',
    registroId: idCriado,
    detalhes: `Usuário ${emailLimpo} criado com perfil ${dados.perfil}`,
    valorNovo: JSON.stringify({ nome: dados.nome.trim(), email: emailLimpo, perfil: dados.perfil }),
  });

  return {
    id: idCriado,
    nome: dados.nome.trim(),
    email: emailLimpo,
    perfil: dados.perfil,
  };
}

export function autenticarUsuario(
  db: DatabaseSync,
  email: string,
  senha: string
): { token: string; usuario: { id: number; nome: string; email: string; perfil: 'RH' | 'DIRETORIA' | 'ADMIN' } } {
  const emailChave = (email || '').trim().toLowerCase();

  // Verifica bloqueio por tentativas excessivas (RNF-19)
  const statusBloqueio = verificarBloqueio(emailChave);
  if (statusBloqueio.bloqueado) {
    throw new Error('Acesso bloqueado por 15 minutos após 5 tentativas incorretas.');
  }

  const stmt = db.prepare('SELECT id, nome, email, senha_hash, perfil, ativo FROM usuarios WHERE email = ?');
  const usuario = stmt.get(emailChave) as any;

  if (!usuario || usuario.ativo !== 1) {
    const falha = registrarFalhaLogin(emailChave);
    if (falha.bloqueadoAgora) {
      throw new Error('Acesso bloqueado por 15 minutos após 5 tentativas incorretas.');
    }
    // Mensagem padrão: E-mail ou senha inválidos (Seção 14.6)
    throw new Error('E-mail ou senha inválidos.');
  }

  const senhaCorreta = verificarSenha(senha, usuario.senha_hash);
  if (!senhaCorreta) {
    const falha = registrarFalhaLogin(emailChave);
    if (falha.bloqueadoAgora) {
      throw new Error('Acesso bloqueado por 15 minutos após 5 tentativas incorretas.');
    }
    throw new Error('E-mail ou senha inválidos.');
  }

  // Sucesso: limpa contador de falhas e gera token de sessão
  limparFalhasLogin(emailChave);
  const token = criarSessao(usuario);

  return {
    token,
    usuario: {
      id: usuario.id,
      nome: usuario.nome,
      email: usuario.email,
      perfil: usuario.perfil,
    },
  };
}

export function inativarUsuario(
  db: DatabaseSync,
  adminSolicitante: { id: number; email: string; perfil: string },
  usuarioId: number
): void {
  if (adminSolicitante.perfil !== 'ADMIN') {
    throw new Error('Você não tem permissão para esta ação.');
  }

  const agora = new Date().toISOString();
  const stmt = db.prepare('UPDATE usuarios SET ativo = 0, atualizado_em = ? WHERE id = ?');
  stmt.run(agora, usuarioId);

  registrarLog(db, {
    usuarioId: adminSolicitante.id,
    usuarioEmail: adminSolicitante.email,
    usuarioPerfil: adminSolicitante.perfil,
    acao: 'INATIVAR_USUARIO',
    entidade: 'USUARIO',
    registroId: usuarioId,
    detalhes: `Usuário ID ${usuarioId} inativado`,
  });
}
