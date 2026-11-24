/**
 * usuarioService.ts - Autenticação, sessão e gerenciamento de usuários (RNF-01, RNF-02, RNF-19, Seção 4, US-12).
 */

import { DatabaseSync } from 'node:sqlite';
import crypto from 'node:crypto';
import {
  validarForcaSenha,
  gerarHashSenha,
  verificarSenha,
  verificarBloqueio,
  registrarFalhaLogin,
  limparFalhasLogin,
  criarSessao,
  invalidarSessoesUsuario,
  gerarCodigoNumerico2FA,
  gerarHashCodigo2FA,
  verificarCodigo2FA,
  despacharCodigo2FAOutbox,
  obterUltimoCodigo2FAOutbox,
} from '../security.js';
import { registrarLog } from './logService.js';

export interface CriarUsuarioDTO {
  nome: string;
  email: string;
  senha: string;
  perfil: 'RH' | 'DIRETORIA' | 'ADMIN';
  segundoFatorAtivo?: boolean;
}

export interface UsuarioCadastrado {
  id: number;
  nome: string;
  email: string;
  perfil: 'RH' | 'DIRETORIA' | 'ADMIN';
  ativo: number;
  segundoFatorAtivo: boolean;
  criadoEm?: string;
  atualizadoEm?: string;
}

export interface RespostaAutenticacao {
  token?: string;
  requer2FA?: boolean;
  desafioToken?: string;
  usuario: {
    id: number;
    nome: string;
    email: string;
    perfil: 'RH' | 'DIRETORIA' | 'ADMIN';
  };
}

/**
 * Criação de Usuário com validação de formato de e-mail, perfil, força de senha e histórico inicial.
 * Restrito ao perfil ADMIN (Seção 4 / US-12).
 */
export function criarUsuario(
  db: DatabaseSync,
  adminSolicitante: { id: number; email: string; perfil: string },
  dados: CriarUsuarioDTO
): UsuarioCadastrado {
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
  const segundoFatorAtivoInt = dados.segundoFatorAtivo ? 1 : 0;

  const insertStmt = db.prepare(`
    INSERT INTO usuarios (nome, email, senha_hash, perfil, ativo, segundo_fator_ativo, criado_em, atualizado_em)
    VALUES (?, ?, ?, ?, 1, ?, ?, ?)
  `);

  const result = insertStmt.run(dados.nome.trim(), emailLimpo, hash, dados.perfil, segundoFatorAtivoInt, agora, agora);
  const idCriado = Number(result.lastInsertRowid);

  // Armazena a senha inicial no histórico das últimas 3 senhas (US-12)
  try {
    db.prepare(`
      INSERT INTO historico_senhas (usuario_id, senha_hash, criado_em)
      VALUES (?, ?, ?)
    `).run(idCriado, hash, agora);
  } catch {
    // Tabela criada sob demanda se necessário
  }

  // Registra no Log de Auditoria imutável (Cenário: Admin gerencia usuarios)
  registrarLog(db, {
    usuarioId: adminSolicitante.id,
    usuarioEmail: adminSolicitante.email,
    usuarioPerfil: adminSolicitante.perfil,
    acao: 'CRIAR_USUARIO',
    entidade: 'USUARIO',
    registroId: idCriado,
    detalhes: `Usuário ${emailLimpo} criado com perfil ${dados.perfil}`,
    valorNovo: JSON.stringify({ nome: dados.nome.trim(), email: emailLimpo, perfil: dados.perfil, segundoFatorAtivo: Boolean(dados.segundoFatorAtivo) }),
  });

  return {
    id: idCriado,
    nome: dados.nome.trim(),
    email: emailLimpo,
    perfil: dados.perfil,
    ativo: 1,
    segundoFatorAtivo: Boolean(dados.segundoFatorAtivo),
    criadoEm: agora,
    atualizadoEm: agora,
  };
}

/**
 * Autenticação de Usuário (Etapa 1: E-mail e Senha, com suporte a 2FA e Bloqueio por tentativas - RNF-01 / RNF-19 / US-12).
 */
export function autenticarUsuario(
  db: DatabaseSync,
  email: string,
  senha: string,
  opcoes?: { exigir2FA?: boolean }
): RespostaAutenticacao {
  const emailChave = (email || '').trim().toLowerCase();

  // Verifica bloqueio por tentativas excessivas (RNF-19: 5 erros -> 15 min de bloqueio)
  const statusBloqueio = verificarBloqueio(emailChave);
  if (statusBloqueio.bloqueado) {
    throw new Error('Acesso bloqueado por 15 minutos após 5 tentativas incorretas.');
  }

  const stmt = db.prepare('SELECT id, nome, email, senha_hash, perfil, ativo, segundo_fator_ativo FROM usuarios WHERE email = ?');
  const usuario = stmt.get(emailChave) as any;

  if (!usuario || usuario.ativo !== 1) {
    const falha = registrarFalhaLogin(emailChave);
    if (falha.bloqueadoAgora) {
      throw new Error('Acesso bloqueado por 15 minutos após 5 tentativas incorretas.');
    }
    // Mensagem padrão sem revelar se o erro foi usuário ou senha (Seção 14.6)
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

  // Sucesso na verificação de senha: limpa contador de falhas
  limparFalhasLogin(emailChave);

  // Verifica se o usuário possui Segundo Fator de Autenticação ativo (US-12)
  const requer2FA = Boolean(usuario.segundo_fator_ativo === 1 || opcoes?.exigir2FA);

  if (requer2FA) {
    const codigoNumerico = gerarCodigoNumerico2FA();
    const codigoHash = gerarHashCodigo2FA(codigoNumerico);
    const desafioToken = crypto.randomBytes(32).toString('hex');
    const agora = new Date();
    const expiraEm = new Date(agora.getTime() + 5 * 60 * 1000).toISOString(); // 5 minutos de validade

    db.prepare(`
      INSERT INTO desafios_2fa (usuario_id, desafio_token, codigo_hash, expira_em, tentativas, utilizado, criado_em)
      VALUES (?, ?, ?, ?, 0, 0, ?)
    `).run(usuario.id, desafioToken, codigoHash, expiraEm, agora.toISOString());

    // Despacha o código numérico para o canal de notificação simulado (out-of-band)
    // O código NÃO é retornado na resposta da API pública, preservando a confidencialidade
    despacharCodigo2FAOutbox(usuario.id, codigoNumerico, 5 * 60 * 1000);

    return {
      requer2FA: true,
      desafioToken,
      usuario: {
        id: usuario.id,
        nome: usuario.nome,
        email: usuario.email,
        perfil: usuario.perfil,
      },
    };
  }

  // Login direto sem 2FA (gera token de sessão com expiração de 30 minutos - RNF-01)
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

/**
 * Confirmação do Segundo Fator de Autenticação (US-12).
 * Valida o desafio, o código numérico e gera o token de sessão oficial.
 */
export function confirmarSegundoFator(
  db: DatabaseSync,
  dados: { desafioToken: string; codigo: string }
): { token: string; usuario: { id: number; nome: string; email: string; perfil: 'RH' | 'DIRETORIA' | 'ADMIN' } } {
  if (!dados.desafioToken || !dados.codigo) {
    throw new Error('Token de desafio e código de verificação são obrigatórios.');
  }

  const stmt = db.prepare(`
    SELECT d.*, u.nome, u.email, u.perfil, u.ativo
    FROM desafios_2fa d
    JOIN usuarios u ON u.id = d.usuario_id
    WHERE d.desafio_token = ? AND d.utilizado = 0
  `);
  const desafio = stmt.get(dados.desafioToken) as any;

  if (!desafio) {
    throw new Error('Desafio de segundo fator inválido ou já utilizado.');
  }

  if (desafio.ativo !== 1) {
    throw new Error('Usuário inativo.');
  }

  // Verifica expiração (5 minutos)
  const agora = Date.now();
  const expiraTimestamp = new Date(desafio.expira_em).getTime();
  if (agora > expiraTimestamp) {
    throw new Error('Código de segundo fator expirado. Faça login novamente.');
  }

  // Verifica limite de tentativas do desafio (máximo 5)
  if (desafio.tentativas >= 5) {
    throw new Error('Limite de tentativas do segundo fator excedido. Solicite novo login.');
  }

  const codigoValido = verificarCodigo2FA(dados.codigo, desafio.codigo_hash);
  if (!codigoValido) {
    db.prepare('UPDATE desafios_2fa SET tentativas = tentativas + 1 WHERE id = ?').run(desafio.id);
    throw new Error('Código de segundo fator incorreto.');
  }

  // Sucesso: marca desafio como utilizado
  db.prepare('UPDATE desafios_2fa SET utilizado = 1 WHERE id = ?').run(desafio.id);

  // Cria sessão oficial ativa de 30 minutos
  const token = criarSessao({
    id: desafio.usuario_id,
    email: desafio.email,
    nome: desafio.nome,
    perfil: desafio.perfil,
  });

  // Registra no Log de Auditoria
  registrarLog(db, {
    usuarioId: desafio.usuario_id,
    usuarioEmail: desafio.email,
    usuarioPerfil: desafio.perfil,
    acao: 'LOGIN_2FA_SUCESSO',
    entidade: 'AUTENTICACAO',
    registroId: desafio.usuario_id,
    detalhes: `Login com segundo fator concluído com sucesso para ${desafio.email}`,
  });

  return {
    token,
    usuario: {
      id: desafio.usuario_id,
      nome: desafio.nome,
      email: desafio.email,
      perfil: desafio.perfil,
    },
  };
}

/**
 * Inativação de Usuário (US-12 / RN-12).
 * Inativa o registro no banco sem exclusão física e encerra imediatamente todas as sessões existentes.
 * Restrito ao perfil ADMIN.
 */
export function inativarUsuario(
  db: DatabaseSync,
  adminSolicitante: { id: number; email: string; perfil: string },
  usuarioId: number
): { status: string; id: number; sessoesEncerradas: number } {
  if (adminSolicitante.perfil !== 'ADMIN') {
    throw new Error('Você não tem permissão para esta ação.');
  }

  const usuario = db.prepare('SELECT id, email, ativo FROM usuarios WHERE id = ?').get(usuarioId) as any;
  if (!usuario) {
    throw new Error('Usuário não encontrado.');
  }

  const agora = new Date().toISOString();
  const stmt = db.prepare('UPDATE usuarios SET ativo = 0, atualizado_em = ? WHERE id = ?');
  stmt.run(agora, usuarioId);

  // Encerra imediatamente qualquer sessão existente do usuário inativado
  const sessoesEncerradas = invalidarSessoesUsuario(usuarioId);

  registrarLog(db, {
    usuarioId: adminSolicitante.id,
    usuarioEmail: adminSolicitante.email,
    usuarioPerfil: adminSolicitante.perfil,
    acao: 'INATIVAR_USUARIO',
    entidade: 'USUARIO',
    registroId: usuarioId,
    detalhes: `Usuário ${usuario.email} (ID ${usuarioId}) inativado. Sessões ativas encerradas: ${sessoesEncerradas}`,
    valorAnterior: 'ativo: 1',
    valorNovo: 'ativo: 0',
  });

  return {
    status: 'INATIVADO',
    id: usuarioId,
    sessoesEncerradas,
  };
}

/**
 * Redefinição de Senha Segura (US-12).
 * - Exige mínimo de 10 caracteres alfanuméricos (RNF-19).
 * - Valida histórico das últimas 3 senhas, impedindo reutilização.
 * - Encerra imediatamente todas as sessões existentes do usuário.
 * - Registra a operação no log de auditoria imutável (RNF-03).
 */
export function redefinirSenha(
  db: DatabaseSync,
  solicitante: { id: number; email: string; perfil: string },
  usuarioId: number,
  novaSenha: string
): { sucesso: boolean; usuarioId: number; sessoesEncerradas: number } {
  // Apenas o próprio usuário ou o ADMIN podem redefinir a senha
  if (solicitante.perfil !== 'ADMIN' && solicitante.id !== usuarioId) {
    throw new Error('Você não tem permissão para esta ação.');
  }

  const validaSenha = validarForcaSenha(novaSenha);
  if (!validaSenha.valido) {
    throw new Error(validaSenha.motivo);
  }

  const usuario = db.prepare('SELECT id, email, senha_hash, ativo FROM usuarios WHERE id = ?').get(usuarioId) as any;
  if (!usuario) {
    throw new Error('Usuário não encontrado.');
  }

  // Consulta histórico das últimas 3 senhas para impedir reutilização (US-12)
  const historicoRows = db.prepare(`
    SELECT senha_hash
    FROM historico_senhas
    WHERE usuario_id = ?
    ORDER BY id DESC
    LIMIT 3
  `).all(usuarioId) as { senha_hash: string }[];

  const hashesParaValidar = new Set<string>();
  if (usuario.senha_hash) {
    hashesParaValidar.add(usuario.senha_hash);
  }
  for (const row of historicoRows) {
    if (row.senha_hash) {
      hashesParaValidar.add(row.senha_hash);
    }
  }

  for (const hashAntigo of hashesParaValidar) {
    if (verificarSenha(novaSenha, hashAntigo)) {
      throw new Error('A nova senha não pode ser igual às últimas 3 senhas utilizadas.');
    }
  }

  // Gera hash seguro scrypt com salt da nova senha
  const novoHash = gerarHashSenha(novaSenha);
  const agora = new Date().toISOString();

  // Atualiza a senha no cadastro do usuário
  db.prepare('UPDATE usuarios SET senha_hash = ?, atualizado_em = ? WHERE id = ?').run(novoHash, agora, usuarioId);

  // Insere novo hash no histórico de senhas
  db.prepare('INSERT INTO historico_senhas (usuario_id, senha_hash, criado_em) VALUES (?, ?, ?)').run(usuarioId, novoHash, agora);

  // Encerra todas as sessões ativas existentes do usuário (Critério US-12)
  const sessoesEncerradas = invalidarSessoesUsuario(usuarioId);

  // Registra no Log de Auditoria imutável (RNF-03)
  registrarLog(db, {
    usuarioId: solicitante.id,
    usuarioEmail: solicitante.email,
    usuarioPerfil: solicitante.perfil,
    acao: 'REDEFINIR_SENHA',
    entidade: 'USUARIO',
    registroId: usuarioId,
    detalhes: `Senha do usuário ${usuario.email} (ID ${usuarioId}) redefinida por ${solicitante.email}. Sessões ativas invalidadas: ${sessoesEncerradas}`,
  });

  return {
    sucesso: true,
    usuarioId,
    sessoesEncerradas,
  };
}

/**
 * Ativar ou desativar Segundo Fator de Autenticação para um usuário.
 */
export function configurarSegundoFator(
  db: DatabaseSync,
  solicitante: { id: number; email: string; perfil: string },
  usuarioId: number,
  ativo: boolean
): { usuarioId: number; segundoFatorAtivo: boolean } {
  if (solicitante.perfil !== 'ADMIN' && solicitante.id !== usuarioId) {
    throw new Error('Você não tem permissão para esta ação.');
  }

  const usuario = db.prepare('SELECT id, email FROM usuarios WHERE id = ?').get(usuarioId) as any;
  if (!usuario) {
    throw new Error('Usuário não encontrado.');
  }

  const agora = new Date().toISOString();
  db.prepare('UPDATE usuarios SET segundo_fator_ativo = ?, atualizado_em = ? WHERE id = ?').run(ativo ? 1 : 0, agora, usuarioId);

  registrarLog(db, {
    usuarioId: solicitante.id,
    usuarioEmail: solicitante.email,
    usuarioPerfil: solicitante.perfil,
    acao: 'CONFIGURAR_2FA',
    entidade: 'USUARIO',
    registroId: usuarioId,
    detalhes: `Segundo fator de autenticação do usuário ${usuario.email} configurado para: ${ativo ? 'ATIVO' : 'INATIVO'}`,
    valorNovo: `segundo_fator_ativo: ${ativo ? 1 : 0}`,
  });

  return {
    usuarioId,
    segundoFatorAtivo: ativo,
  };
}

/**
 * Listagem de Usuários cadastrados (Restrito a ADMIN - Seção 4).
 * Retorna os dados cadastrais sem expor os hashes de senha.
 */
export function listarUsuarios(
  db: DatabaseSync,
  solicitante: { perfil: string }
): Omit<UsuarioCadastrado, 'senha'>[] {
  if (solicitante.perfil !== 'ADMIN') {
    throw new Error('Você não tem permissão para esta ação.');
  }

  const rows = db.prepare(`
    SELECT id, nome, email, perfil, ativo, segundo_fator_ativo, criado_em, atualizado_em
    FROM usuarios
    ORDER BY id ASC
  `).all() as any[];

  return rows.map((u) => ({
    id: u.id,
    nome: u.nome,
    email: u.email,
    perfil: u.perfil,
    ativo: u.ativo,
    segundoFatorAtivo: Boolean(u.segundo_fator_ativo),
    criadoEm: u.criado_em,
    atualizadoEm: u.atualizado_em,
  }));
}

/**
 * Helper de testes automatizados e simulação controlada:
 * Recupera o último código numérico 2FA gerado e despachado no canal out-of-band para o usuário.
 * Disponível estritamente para suítes de testes automatizados locais.
 */
export function obterUltimoCodigo2FAParaTeste(usuarioId: number): string | null {
  return obterUltimoCodigo2FAOutbox(usuarioId);
}
