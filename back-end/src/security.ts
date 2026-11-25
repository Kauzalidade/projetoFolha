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
 * Valida a força da senha conforme RNF-19 e Requisitos de Segurança:
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
 * Gera uma senha aleatória, exclusiva e de alta entropia (mínimo 12 caracteres, padrão 16).
 * Atende aos requisitos da Seção 5: maiúsculas, minúsculas, números e caracteres especiais.
 */
export function gerarSenhaForteAleatoria(tamanho: number = 16): string {
  const tam = Math.max(12, tamanho);
  const maiusculas = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const minusculas = 'abcdefghijkmnopqrstuvwxyz';
  const numeros = '23456789';
  const especiais = '!@#$%&*_-';
  const todos = maiusculas + minusculas + numeros + especiais;

  // Garante ao menos um caractere de cada grupo obrigatório
  const obrigatorios = [
    maiusculas[crypto.randomInt(0, maiusculas.length)],
    minusculas[crypto.randomInt(0, minusculas.length)],
    numeros[crypto.randomInt(0, numeros.length)],
    especiais[crypto.randomInt(0, especiais.length)],
  ];

  const restantes: string[] = [];
  for (let i = obrigatorios.length; i < tam; i++) {
    restantes.push(todos[crypto.randomInt(0, todos.length)]);
  }

  // Embaralha com Fisher-Yates
  const caracteres = [...obrigatorios, ...restantes];
  for (let i = caracteres.length - 1; i > 0; i--) {
    const j = crypto.randomInt(0, i + 1);
    [caracteres[i], caracteres[j]] = [caracteres[j], caracteres[i]];
  }

  return caracteres.join('');
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

/**
 * Encerra todas as sessões ativas de um determinado usuário (Critério US-12 / RNF-01).
 * Invocado na redefinição de senha ou inativação do usuário.
 * Retorna o número de sessões invalidadas.
 */
export function invalidarSessoesUsuario(usuarioId: number): number {
  let encerradas = 0;
  for (const [token, sessao] of sessoesAtivas.entries()) {
    if (sessao.usuarioId === usuarioId) {
      sessoesAtivas.delete(token);
      encerradas++;
    }
  }
  return encerradas;
}

/**
 * Retorna a quantidade de sessões atualmente ativas para o usuário.
 */
export function contarSessoesAtivasUsuario(usuarioId: number): number {
  let ativas = 0;
  const agora = Date.now();
  for (const [token, sessao] of sessoesAtivas.entries()) {
    if (sessao.usuarioId === usuarioId) {
      if (agora - sessao.ultimoAcesso <= TEMPO_EXPIRACAO_SESSAO) {
        ativas++;
      } else {
        sessoesAtivas.delete(token);
      }
    }
  }
  return ativas;
}

/**
 * Utilitários criptográficos de Segundo Fator de Autenticação (2FA) - US-12.
 */

// Armazenamento em memória do canal de entrega out-of-band simulado (e-mail/SMS corporativo)
// Usado estritamente para testes automatizados e simulador de homologação
interface MensagemOutbox2FA {
  codigo: string;
  expiraEm: number;
}
const outbox2FA = new Map<number, MensagemOutbox2FA>();

export function gerarCodigoNumerico2FA(): string {
  // Código numérico de 6 dígitos criptograficamente seguro (100000 a 999999)
  const codeInt = crypto.randomInt(100000, 1000000);
  return codeInt.toString();
}

export function gerarHashCodigo2FA(codigo: string): string {
  return crypto.createHash('sha256').update(codigo.trim()).digest('hex');
}

export function verificarCodigo2FA(codigoInformado: string, hashEsperado: string): boolean {
  if (!codigoInformado || !hashEsperado) return false;
  const hashInformado = gerarHashCodigo2FA(codigoInformado);
  const bufEsperado = Buffer.from(hashEsperado, 'hex');
  const bufInformado = Buffer.from(hashInformado, 'hex');
  if (bufEsperado.length !== bufInformado.length) return false;
  return crypto.timingSafeEqual(bufEsperado, bufInformado);
}

export function despacharCodigo2FAOutbox(usuarioId: number, codigo: string, expiraEmMs: number): void {
  outbox2FA.set(usuarioId, {
    codigo,
    expiraEm: Date.now() + expiraEmMs,
  });
}

export function obterUltimoCodigo2FAOutbox(usuarioId: number): string | null {
  const item = outbox2FA.get(usuarioId);
  if (!item) return null;
  if (Date.now() > item.expiraEm) {
    outbox2FA.delete(usuarioId);
    return null;
  }
  return item.codigo;
}

export function limparOutbox2FA(): void {
  outbox2FA.clear();
}

/**
 * Gestão de Tokens de Recuperação de Senha (15 minutos de validade)
 */
interface ItemRecuperacaoSenha {
  email: string;
  expiraEm: number;
}
const tokensRecuperacaoSenha = new Map<string, ItemRecuperacaoSenha>();

export function solicitarTokenRecuperacao(email: string): { token: string; expiraEm: number } {
  const token = crypto.randomBytes(32).toString('hex');
  const expiraEm = Date.now() + 15 * 60 * 1000; // 15 minutos
  tokensRecuperacaoSenha.set(token, {
    email: email.trim().toLowerCase(),
    expiraEm,
  });
  return { token, expiraEm };
}

export function consumirTokenRecuperacao(token: string): string | null {
  if (!token) return null;
  const item = tokensRecuperacaoSenha.get(token);
  if (!item) return null;

  if (Date.now() > item.expiraEm) {
    tokensRecuperacaoSenha.delete(token);
    return null;
  }

  tokensRecuperacaoSenha.delete(token);
  return item.email;
}

export function limparTodasSessoes(): void {
  sessoesAtivas.clear();
  tentativasPorEmail.clear();
  limparOutbox2FA();
  tokensRecuperacaoSenha.clear();
}
