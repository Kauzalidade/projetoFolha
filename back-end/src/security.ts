/**
 * security.ts - Gerenciamento de senhas, tentativas de login e autenticação.
 * 
 * Atende aos requisitos:
 * - RNF-01: Senhas armazenadas com hash criptográfico seguro (scrypt). Sessão com expiração de 30 minutos.
 * - RNF-19: Senha com pelo menos 10 caracteres, contendo letras e números. Bloqueio de 15 minutos após 5 erros.
 * - Seção 14.6: Mensagens de erro padronizadas.
 */

import crypto from 'node:crypto';

export interface TentativaFalha {
  contagem: number;
  bloqueadoAte: number | null; // Timestamp em milissegundos
}

// Armazena tentativas de login falhas em memória por e-mail (ou IP)
const tentativasPorEmail = new Map<string, TentativaFalha>();

/**
 * Valida a força da senha conforme RNF-19:
 * Mínimo de 10 caracteres, com pelo menos uma letra e pelo menos um número.
 */
export function validarForcaSenha(senha: string): { valido: boolean; motivo?: string } {
  if (!senha || senha.length < 10) {
    return { valido: false, motivo: 'A senha deve ter pelo menos 10 caracteres.' };
  }
  const temLetra = /[a-zA-Z]/.test(senha);
  const temNumero = /[0-9]/.test(senha);

  if (!temLetra || !temNumero) {
    return { valido: false, motivo: 'A senha deve conter letras e números.' };
  }

  return { valido: true };
}

/**
 * Gera hash scrypt seguro da senha com salt aleatório.
 * Formato retornado: `salt:hash` (ambos em hex)
 */
export function gerarHashSenha(senha: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derivedKey = crypto.scryptSync(senha, salt, 64);
  return `${salt}:${derivedKey.toString('hex')}`;
}

/**
 * Verifica se a senha informada confere com o hash armazenado.
 */
export function verificarSenha(senha: string, hashArmazenado: string): boolean {
  if (!hashArmazenado || !hashArmazenado.includes(':')) {
    return false;
  }
  const [salt, hashOriginal] = hashArmazenado.split(':');
  const bufferOriginal = Buffer.from(hashOriginal, 'hex');
  const bufferTeste = crypto.scryptSync(senha, salt, 64);

  return crypto.timingSafeEqual(bufferOriginal, bufferTeste);
}

/**
 * Verifica se uma conta/e-mail está atualmente bloqueada por tentativas excessivas (RNF-19).
 */
export function verificarBloqueio(email: string): { bloqueado: boolean; minutosRestantes?: number } {
  const emailChave = email.trim().toLowerCase();
  const tentativa = tentativasPorEmail.get(emailChave);

  if (!tentativa || !tentativa.bloqueadoAte) {
    return { bloqueado: false };
  }

  const agora = Date.now();
  if (agora < tentativa.bloqueadoAte) {
    const restanteMin = Math.ceil((tentativa.bloqueadoAte - agora) / (1000 * 60));
    return { bloqueado: true, minutosRestantes: restanteMin };
  }

  // Bloqueio expirou: remove o bloqueio
  tentativasPorEmail.delete(emailChave);
  return { bloqueado: false };
}

/**
 * Registra uma tentativa de senha incorreta.
 * Se atingir 5 tentativas, bloqueia por 15 minutos (RNF-19).
 */
export function registrarFalhaLogin(email: string): { bloqueadoAgora: boolean } {
  const emailChave = email.trim().toLowerCase();
  const agora = Date.now();
  const dados = tentativasPorEmail.get(emailChave) || { contagem: 0, bloqueadoAte: null };

  dados.contagem += 1;

  if (dados.contagem >= 5) {
    dados.bloqueadoAte = agora + 15 * 60 * 1000; // 15 minutos de bloqueio
    tentativasPorEmail.set(emailChave, dados);
    return { bloqueadoAgora: true };
  }

  tentativasPorEmail.set(emailChave, dados);
  return { bloqueadoAgora: false };
}

/**
 * Limpa o histórico de falhas após login bem-sucedido.
 */
export function limparFalhasLogin(email: string): void {
  const emailChave = email.trim().toLowerCase();
  tentativasPorEmail.delete(emailChave);
}

/**
 * Estrutura de token de sessão em memória com expiração de 30 minutos sem atividade (RNF-01).
 */
export interface SessaoUsuario {
  token: string;
  usuarioId: number;
  email: string;
  nome: string;
  perfil: 'RH' | 'DIRETORIA' | 'ADMIN';
  ultimoAcesso: number;
}

const sessoesAtivas = new Map<string, SessaoUsuario>();
const TEMPO_EXPIRACAO_SESSAO = 30 * 60 * 1000; // 30 minutos

export function criarSessao(usuario: { id: number; email: string; nome: string; perfil: 'RH' | 'DIRETORIA' | 'ADMIN' }): string {
  const token = crypto.randomBytes(32).toString('hex');
  const agora = Date.now();

  sessoesAtivas.set(token, {
    token,
    usuarioId: usuario.id,
    email: usuario.email,
    nome: usuario.nome,
    perfil: usuario.perfil,
    ultimoAcesso: agora,
  });

  return token;
}

export function validarSessao(token: string): SessaoUsuario | null {
  if (!token) return null;
  const sessao = sessoesAtivas.get(token);
  if (!sessao) return null;

  const agora = Date.now();
  if (agora - sessao.ultimoAcesso > TEMPO_EXPIRACAO_SESSAO) {
    // Sessão expirada
    sessoesAtivas.delete(token);
    return null;
  }

  // Renova último acesso
  sessao.ultimoAcesso = agora;
  return sessao;
}

export function encerrarSessao(token: string): void {
  sessoesAtivas.delete(token);
}

export function limparTodasSessoes(): void {
  sessoesAtivas.clear();
  tentativasPorEmail.clear();
}
