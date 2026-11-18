import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { createServer as createHttpServer } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

const ROOT = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(ROOT, '..', '..', 'front-end');
const scryptAsync = promisify(scrypt);
const SESSION_IDLE_MS = 30 * 60 * 1000;
const LOGIN_BLOCK_MS = 15 * 60 * 1000;
const CHALLENGE_TTL_MS = 5 * 60 * 1000;
const RESET_TTL_MS = 15 * 60 * 1000;
const SCRYPT_OPTIONS = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const COMMON_PASSWORDS = new Set([
  'password', 'password1', 'password12', 'password123', 'password1234',
  'password12345', 'passw0rd', 'qwerty', 'qwerty123', 'qwerty12345',
  '1q2w3e4r', 'asdfghjkl', '123456789', '1234567890', '123123',
  '1111111111', '0000000000', 'admin123', 'admin123456', 'welcome123',
  'welcome1234', 'letmein123', 'letmein12345', 'iloveyou123',
  'sunshine123', 'monkey123', 'dragon123', 'football123', 'baseball123',
  'abc123456', 'secret123', 'senha123', 'senha1234', 'senha123456',
  'brasil123', 'flamengo123', 'gabriel123',
]);
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
};

const dbPath = process.env.DB_PATH || join(ROOT, 'data', 'auth.sqlite');
mkdirSync(dirname(dbPath), { recursive: true });
export const db = new DatabaseSync(dbPath);
db.exec(`
  PRAGMA foreign_keys = ON;
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    totp_secret TEXT NOT NULL,
    force_password_change INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS password_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    password_hash TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS password_history_user_time
    ON password_history(user_id, created_at DESC);
  CREATE TABLE IF NOT EXISTS rate_limits (
    bucket TEXT NOT NULL,
    subject TEXT NOT NULL,
    attempts INTEGER NOT NULL,
    window_started_at INTEGER NOT NULL,
    blocked_until INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (bucket, subject)
  );
  CREATE TABLE IF NOT EXISTS auth_challenges (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    attempts INTEGER NOT NULL DEFAULT 0,
    expires_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    last_activity INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS reset_tokens (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL,
    used_at INTEGER,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS security_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT,
    email TEXT,
    ip_address TEXT NOT NULL,
    event_type TEXT NOT NULL,
    details TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS security_events_created_at
    ON security_events(created_at DESC);
`);

function now() {
  return Date.now();
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function hashToken(token) {
  return createHash('sha256').update(token).digest('hex');
}

function getEncryptionKey() {
  const encoded = process.env.APP_ENCRYPTION_KEY;
  if (!encoded) return null;
  const key = Buffer.from(encoded, 'base64');
  if (key.length !== 32) throw new Error('APP_ENCRYPTION_KEY deve ser uma chave Base64 de 32 bytes.');
  return key;
}

function protectTotpSecret(secret) {
  const key = getEncryptionKey();
  if (!key) {
    if (process.env.NODE_ENV === 'production') throw new Error('APP_ENCRYPTION_KEY é obrigatório em produção.');
    return secret;
  }
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  return `enc:v1:${iv.toString('base64')}:${cipher.getAuthTag().toString('base64')}:${encrypted.toString('base64')}`;
}

function revealTotpSecret(storedSecret) {
  if (!storedSecret.startsWith('enc:v1:')) return storedSecret;
  const key = getEncryptionKey();
  if (!key) throw new Error('APP_ENCRYPTION_KEY é necessário para descriptografar o segredo TOTP.');
  const [, , iv, tag, encrypted] = storedSecret.split(':');
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(encrypted, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}

function encryptExistingTotpSecrets() {
  if (!getEncryptionKey()) return;
  const users = db.prepare('SELECT id, totp_secret FROM users').all();
  const update = db.prepare('UPDATE users SET totp_secret = ? WHERE id = ?');
  for (const user of users) {
    if (!user.totp_secret.startsWith('enc:v1:')) {
      update.run(protectTotpSecret(user.totp_secret), user.id);
    }
  }
}

async function hashPassword(password) {
  const salt = randomBytes(16);
  const derived = await scryptAsync(password, salt, 64, SCRYPT_OPTIONS);
  return `${salt.toString('hex')}:${derived.toString('hex')}`;
}

async function verifyPassword(password, storedHash) {
  const [saltHex, hashHex] = String(storedHash || '').split(':');
  if (!saltHex || !hashHex || !/^[0-9a-f]+$/i.test(saltHex) || !/^[0-9a-f]+$/i.test(hashHex)) {
    return false;
  }
  const expected = Buffer.from(hashHex, 'hex');
  const actual = await scryptAsync(password, Buffer.from(saltHex, 'hex'), expected.length, SCRYPT_OPTIONS);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function validatePassword(password, email) {
  if (typeof password !== 'string' || password.length < 10) {
    return 'A senha deve ter pelo menos 10 caracteres.';
  }
  if (!/[A-Z]/.test(password) || !/[a-z]/.test(password) || !/[0-9]/.test(password)) {
    return 'Use pelo menos uma letra maiúscula, uma minúscula e um número.';
  }
  const normalized = password.toLowerCase();
  const normalizedEmail = normalizeEmail(email);
  const localPart = normalizedEmail.split('@')[0];
  if (normalized === normalizedEmail || (localPart.length >= 4 && normalized.includes(localPart))) {
    return 'A senha não pode ser igual ao e-mail ou conter seu identificador.';
  }
  if (COMMON_PASSWORDS.has(normalized) || COMMON_PASSWORDS.has(normalized.replace(/[^a-z0-9]/g, ''))) {
    return 'Escolha uma senha menos comum.';
  }
  return null;
}

function base32Encode(input) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0;
  let value = 0;
  let output = '';
  for (const byte of input) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += alphabet[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += alphabet[(value << (5 - bits)) & 31];
  return output;
}

function base32Decode(text) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0;
  let value = 0;
  const output = [];
  for (const char of String(text).toUpperCase().replace(/=+$/g, '')) {
    const index = alphabet.indexOf(char);
    if (index < 0) throw new Error('Segredo TOTP inválido.');
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      output.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(output);
}

export function createTotpSecret() {
  return base32Encode(randomBytes(20));
}

export function generateTotp(secret, timestamp = now()) {
  const counter = BigInt(Math.floor(timestamp / 30_000));
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(counter);
  const digest = createHmac('sha1', base32Decode(secret)).update(message).digest();
  const offset = digest[digest.length - 1] & 15;
  const binary = ((digest[offset] & 127) << 24)
    | ((digest[offset + 1] & 255) << 16)
    | ((digest[offset + 2] & 255) << 8)
    | (digest[offset + 3] & 255);
  return String(binary % 1_000_000).padStart(6, '0');
}

export function verifyTotp(secret, code, timestamp = now()) {
  if (!/^\d{6}$/.test(String(code || ''))) return false;
  for (const delta of [-30_000, 0, 30_000]) {
    const expected = Buffer.from(generateTotp(secret, timestamp + delta));
    const supplied = Buffer.from(String(code));
    if (timingSafeEqual(expected, supplied)) return true;
  }
  return false;
}

function recordSecurityEvent({ userId = null, email = null, ip, type, details }) {
  db.prepare(`
    INSERT INTO security_events(user_id, email, ip_address, event_type, details, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(userId, email, ip, type, details, now());
}

function checkRateLimit(bucket, subject, windowMs) {
  const current = now();
  const row = db.prepare('SELECT * FROM rate_limits WHERE bucket = ? AND subject = ?').get(bucket, subject);
  if (row?.blocked_until > current) return { blocked: true, retryAfterMs: row.blocked_until - current };
  if (!row || current - row.window_started_at >= windowMs) {
    db.prepare(`
      INSERT INTO rate_limits(bucket, subject, attempts, window_started_at, blocked_until)
      VALUES (?, ?, 0, ?, 0)
      ON CONFLICT(bucket, subject)
      DO UPDATE SET attempts = 0, window_started_at = excluded.window_started_at, blocked_until = 0
    `).run(bucket, subject, current);
    return { blocked: false };
  }
  return { blocked: false };
}

function recordFailedAttempt(email, ip) {
  const current = now();
  const row = db.prepare('SELECT * FROM rate_limits WHERE bucket = ? AND subject = ?')
    .get('email', email);
  const inWindow = row && current - row.window_started_at < LOGIN_BLOCK_MS;
  const attempts = inWindow ? row.attempts + 1 : 1;
  const windowStartedAt = inWindow ? row.window_started_at : current;
  const blocked = attempts >= 5;
  db.prepare(`
    INSERT INTO rate_limits(bucket, subject, attempts, window_started_at, blocked_until)
    VALUES ('email', ?, ?, ?, ?)
    ON CONFLICT(bucket, subject)
    DO UPDATE SET attempts = excluded.attempts,
      window_started_at = excluded.window_started_at,
      blocked_until = excluded.blocked_until
  `).run(email, attempts, windowStartedAt, blocked ? current + LOGIN_BLOCK_MS : 0);
  if (blocked) {
    recordSecurityEvent({ email, ip, type: 'login_blocked', details: 'Bloqueio por cinco tentativas incorretas.' });
  }
  return blocked;
}

function consumeRateLimit(bucket, subject, limit, windowMs, blockMs = LOGIN_BLOCK_MS) {
  const current = now();
  const row = db.prepare('SELECT * FROM rate_limits WHERE bucket = ? AND subject = ?').get(bucket, subject);
  if (row?.blocked_until > current) return { blocked: true };
  const inWindow = row && current - row.window_started_at < windowMs;
  const attempts = inWindow ? row.attempts + 1 : 1;
  const windowStartedAt = inWindow ? row.window_started_at : current;
  const blocked = attempts > limit;
  db.prepare(`
    INSERT INTO rate_limits(bucket, subject, attempts, window_started_at, blocked_until)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(bucket, subject)
    DO UPDATE SET attempts = excluded.attempts,
      window_started_at = excluded.window_started_at,
      blocked_until = excluded.blocked_until
  `).run(bucket, subject, attempts, windowStartedAt, blocked ? current + blockMs : 0);
  return { blocked };
}

function clearRateLimit(bucket, subject) {
  db.prepare('DELETE FROM rate_limits WHERE bucket = ? AND subject = ?').run(bucket, subject);
}

function getClientIp(req) {
  const ip = req.socket.remoteAddress || 'unknown';
  return ip.startsWith('::ffff:') ? ip.slice(7) : ip;
}

function isLoopback(ip) {
  return ip === '127.0.0.1' || ip === '::1' || ip === 'localhost';
}

function getCookie(req, name) {
  const cookies = String(req.headers.cookie || '').split(';');
  for (const cookie of cookies) {
    const [key, ...value] = cookie.trim().split('=');
    if (key === name) return decodeURIComponent(value.join('='));
  }
  return null;
}

function setSessionCookie(res, token) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader('Set-Cookie', `sid=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=1800${secure}`);
}

function clearSessionCookie(res) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader('Set-Cookie', `sid=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${secure}`);
}

function sendJson(res, status, data, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(JSON.stringify(data));
}

async function readJson(req) {
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 16_384) throw Object.assign(new Error('Corpo da solicitação muito grande.'), { status: 413 });
  }
  try {
    return JSON.parse(body || '{}');
  } catch {
    throw Object.assign(new Error('JSON inválido.'), { status: 400 });
  }
}

function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}

function securityHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Content-Security-Policy', "default-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; script-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
  if (process.env.NODE_ENV === 'production') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
}

async function getSession(req, res, touch = true) {
  const token = getCookie(req, 'sid');
  if (!token) return { session: null, expired: false };
  const tokenHash = hashToken(token);
  const session = db.prepare(`
    SELECT s.token_hash, s.last_activity, u.id, u.email, u.force_password_change
    FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ?
  `).get(tokenHash);
  if (!session) return { session: null, expired: false };
  if (now() - session.last_activity >= SESSION_IDLE_MS) {
    db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash);
    clearSessionCookie(res);
    return { session: null, expired: true };
  }
  if (touch) {
    db.prepare('UPDATE sessions SET last_activity = ? WHERE token_hash = ?').run(now(), tokenHash);
    setSessionCookie(res, token);
  }
  return { session, expired: false };
}

async function requireSession(req, res) {
  const result = await getSession(req, res);
  if (!result.session) {
    sendJson(res, 401, {
      error: result.expired ? 'Sua sessão expirou. Entre novamente.' : 'Entre para continuar.',
      code: result.expired ? 'SESSION_EXPIRED' : 'AUTH_REQUIRED',
    });
    return null;
  }
  return result.session;
}

async function seedInitialUser() {
  const userCount = db.prepare('SELECT COUNT(*) AS count FROM users').get().count;
  if (userCount > 0) return;
  const production = process.env.NODE_ENV === 'production';
  const email = normalizeEmail(production ? process.env.INITIAL_ADMIN_EMAIL : (process.env.DEMO_EMAIL || 'faculdade@local.test'));
  let password = production ? process.env.INITIAL_ADMIN_PASSWORD : process.env.DEMO_PASSWORD;
  if (!email || !email.includes('@')) throw new Error('Configure um e-mail inicial válido.');
  if (!password) {
    if (production) throw new Error('INITIAL_ADMIN_PASSWORD é obrigatório em produção.');
    do {
      password = randomBytes(24).toString('base64url');
    } while (validatePassword(password, email));
    console.info(`[bootstrap] Senha temporária para ${email}: ${password}`);
  }
  const totpSecret = production ? process.env.INITIAL_ADMIN_TOTP_SECRET : (process.env.DEMO_TOTP_SECRET || createTotpSecret());
  if (!totpSecret) throw new Error('INITIAL_ADMIN_TOTP_SECRET é obrigatório em produção.');
  if (base32Decode(totpSecret).length < 20) throw new Error('O segredo TOTP deve conter pelo menos 160 bits.');
  const passwordError = validatePassword(password, email);
  if (passwordError) throw new Error(`Senha inicial inválida: ${passwordError}`);
  const id = randomBytes(16).toString('hex');
  const passwordHash = await hashPassword(password);
  db.prepare(`
    INSERT INTO users(id, email, password_hash, totp_secret, force_password_change, created_at)
    VALUES (?, ?, ?, ?, 1, ?)
  `).run(id, email, passwordHash, protectTotpSecret(totpSecret), now());
  db.prepare('INSERT INTO password_history(user_id, password_hash, created_at) VALUES (?, ?, ?)')
    .run(id, passwordHash, now());
  if (!production) {
    const issuer = encodeURIComponent('Folha Clara');
    const account = encodeURIComponent(email);
    console.info(`[bootstrap] Conta de demonstração: ${email}`);
    console.info(`[bootstrap] Código de demonstração 123456 funciona apenas em localhost e fora de produção.`);
    console.info(`[bootstrap] Segredo TOTP: ${totpSecret}`);
    console.info(`[bootstrap] URI TOTP: otpauth://totp/${issuer}:${account}?secret=${totpSecret}&issuer=${issuer}&digits=6&period=30`);
  }
}

function localDemoCodeAllowed(email, ip) {
  return process.env.NODE_ENV !== 'production'
    && isLoopback(ip)
    && email === normalizeEmail(process.env.DEMO_EMAIL || 'faculdade@local.test');
}

async function verifySecondFactor(user, code, ip) {
  if (localDemoCodeAllowed(user.email, ip) && code === '123456') return true;
  return verifyTotp(revealTotpSecret(user.totp_secret), code);
}

async function sendEmail(to, subject, text, html) {
  const endpoint = process.env.MAIL_API_URL;
  const apiKey = process.env.MAIL_API_KEY;
  if (!endpoint || !apiKey) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('MAIL_API_URL e MAIL_API_KEY devem ser configurados para envio de e-mail.');
    }
    console.info(`[email-outbox] Para: ${to}\nAssunto: ${subject}\n${text}`);
    return;
  }
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ to, subject, text, html }),
  });
  if (!response.ok) {
    throw new Error(`O provedor de e-mail respondeu com HTTP ${response.status}.`);
  }
}

async function passwordIsReused(userId, candidate) {
  const history = db.prepare(`
    SELECT password_hash FROM password_history
    WHERE user_id = ? ORDER BY created_at DESC LIMIT 3
  `).all(userId);
  for (const item of history) {
    if (await verifyPassword(candidate, item.password_hash)) return true;
  }
  return false;
}

function storePasswordHash(userId, passwordHash, changedAt = now()) {
  db.prepare('UPDATE users SET password_hash = ?, force_password_change = 0 WHERE id = ?')
    .run(passwordHash, userId);
  db.prepare('INSERT INTO password_history(user_id, password_hash, created_at) VALUES (?, ?, ?)')
    .run(userId, passwordHash, changedAt);
  db.prepare(`
    DELETE FROM password_history
    WHERE user_id = ? AND id NOT IN (
      SELECT id FROM password_history WHERE user_id = ? ORDER BY created_at DESC LIMIT 3
    )
  `).run(userId, userId);
}

async function updatePassword(user, password) {
  const policyError = validatePassword(password, user.email);
  if (policyError) return policyError;
  if (await passwordIsReused(user.id, password)) {
    return 'Não reutilize nenhuma das últimas 3 senhas.';
  }
  storePasswordHash(user.id, await hashPassword(password));
  return null;
}

async function handleApi(req, res, url) {
  const ip = getClientIp(req);
  if (req.method !== 'GET' && !sameOrigin(req)) {
    sendJson(res, 403, { error: 'Origem da solicitação não permitida.' });
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/health') {
    sendJson(res, 200, { status: 'ok' });
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/session') {
    const result = await getSession(req, res, false);
    if (!result.session) {
      sendJson(res, result.expired ? 401 : 200, result.expired
        ? { authenticated: false, code: 'SESSION_EXPIRED', error: 'Sua sessão expirou. Entre novamente.' }
        : { authenticated: false });
      return;
    }
    sendJson(res, 200, {
      authenticated: true,
      email: result.session.email,
      mustChangePassword: Boolean(result.session.force_password_change),
    });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/session/activity') {
    const session = await requireSession(req, res);
    if (!session) return;
    sendJson(res, 200, { active: true });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/auth/login') {
    const body = await readJson(req);
    const email = normalizeEmail(body.email);
    const password = String(body.password || '');
    const ipStatus = consumeRateLimit('ip', ip, 20, 60_000);
    const emailStatus = checkRateLimit('email', email, LOGIN_BLOCK_MS);
    if (ipStatus.blocked) {
      recordSecurityEvent({ email, ip, type: 'ip_rate_limited', details: 'Limite de 20 tentativas por minuto excedido.' });
      sendJson(res, 429, { error: 'Acesso bloqueado por 15 minutos após muitas tentativas deste endereço.', code: 'IP_BLOCKED' });
      return;
    }
    if (emailStatus.blocked) {
      sendJson(res, 423, {
        error: 'Acesso bloqueado por 15 minutos após 5 tentativas incorretas.',
        code: 'ACCOUNT_BLOCKED',
      });
      return;
    }
    const user = email ? db.prepare('SELECT * FROM users WHERE email = ?').get(email) : null;
    const valid = user && await verifyPassword(password, user.password_hash);
    if (!valid) {
      const blocked = recordFailedAttempt(email || '(vazio)', ip);
      recordSecurityEvent({
        userId: user?.id || null,
        email: email || null,
        ip,
        type: 'login_failed',
        details: 'Credenciais inválidas.',
      });
      sendJson(res, blocked ? 423 : 401, {
        error: blocked
          ? 'Acesso bloqueado por 15 minutos após 5 tentativas incorretas.'
          : 'E-mail ou senha inválidos.',
        code: blocked ? 'ACCOUNT_BLOCKED' : 'INVALID_CREDENTIALS',
      });
      return;
    }
    const challenge = randomBytes(32).toString('base64url');
    db.prepare('INSERT INTO auth_challenges(token_hash, user_id, attempts, expires_at, created_at) VALUES (?, ?, 0, ?, ?)')
      .run(hashToken(challenge), user.id, now() + CHALLENGE_TTL_MS, now());
    recordSecurityEvent({ userId: user.id, email, ip, type: 'password_accepted', details: 'Aguardando segundo fator.' });
    sendJson(res, 200, { requiresMfa: true, challengeId: challenge });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/auth/verify-otp') {
    const body = await readJson(req);
    const challengeId = String(body.challengeId || '');
    const code = String(body.code || '');
    const ipStatus = consumeRateLimit('ip', ip, 20, 60_000);
    if (ipStatus.blocked) {
      recordSecurityEvent({ email: null, ip, type: 'ip_rate_limited', details: 'Limite de 20 tentativas por endereço excedido.' });
      sendJson(res, 429, { error: 'Acesso bloqueado por 15 minutos após muitas tentativas deste endereço.', code: 'IP_BLOCKED' });
      return;
    }
    if (!/^\d{6}$/.test(code)) {
      sendJson(res, 400, { error: 'Digite o código do aplicativo.', code: 'OTP_REQUIRED' });
      return;
    }
    const challenge = db.prepare(`
      SELECT c.*, u.email, u.totp_secret, u.force_password_change
      FROM auth_challenges c JOIN users u ON u.id = c.user_id
      WHERE c.token_hash = ?
    `).get(hashToken(challengeId));
    if (!challenge || challenge.expires_at <= now() || challenge.attempts >= 5) {
      sendJson(res, 401, { error: 'Código inválido ou expirado.', code: 'INVALID_CHALLENGE' });
      return;
    }
    const valid = await verifySecondFactor(challenge, code, ip);
    if (!valid) {
      db.prepare('UPDATE auth_challenges SET attempts = attempts + 1 WHERE token_hash = ?')
        .run(hashToken(challengeId));
      const blocked = recordFailedAttempt(challenge.email, ip);
      recordSecurityEvent({
        userId: challenge.user_id,
        email: challenge.email,
        ip,
        type: 'mfa_failed',
        details: 'Segundo fator inválido.',
      });
      sendJson(res, blocked ? 423 : 401, {
        error: blocked
          ? 'Acesso bloqueado por 15 minutos após 5 tentativas incorretas.'
          : 'Código inválido. Digite o código do aplicativo.',
        code: blocked ? 'ACCOUNT_BLOCKED' : 'INVALID_OTP',
      });
      return;
    }
    db.prepare('DELETE FROM auth_challenges WHERE token_hash = ?').run(hashToken(challengeId));
    clearRateLimit('email', challenge.email);
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(challenge.user_id);
    const sessionToken = randomBytes(32).toString('base64url');
    db.prepare('INSERT INTO sessions(token_hash, user_id, last_activity, created_at) VALUES (?, ?, ?, ?)')
      .run(hashToken(sessionToken), challenge.user_id, now(), now());
    setSessionCookie(res, sessionToken);
    recordSecurityEvent({ userId: challenge.user_id, email: challenge.email, ip, type: 'login_success', details: 'Autenticação com segundo fator concluída.' });
    sendJson(res, 200, { authenticated: true, mustChangePassword: Boolean(challenge.force_password_change) });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/auth/forgot') {
    const body = await readJson(req);
    const email = normalizeEmail(body.email);
    const ipStatus = consumeRateLimit('reset-ip', ip, 3, 60_000);
    if (ipStatus.blocked) {
      recordSecurityEvent({ email: null, ip, type: 'reset_rate_limited', details: 'Limite de recuperação por IP excedido.' });
      sendJson(res, 429, { error: 'Aguarde antes de solicitar outra recuperação.' });
      return;
    }
    const row = db.prepare('SELECT id, email FROM users WHERE email = ?').get(email);
    if (row) {
      const token = randomBytes(32).toString('base64url');
      db.prepare('INSERT INTO reset_tokens(token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)')
        .run(hashToken(token), row.id, now() + RESET_TTL_MS, now());
      const base = process.env.PUBLIC_BASE_URL || `http://${req.headers.host}`;
      const link = `${base}/?reset=${encodeURIComponent(token)}`;
      try {
        await sendEmail(
          row.email,
          'Recuperação de senha — Folha Clara',
          `Use este link de uso único em até 15 minutos: ${link}`,
          `<p>Use este link de uso único em até 15 minutos:</p><p><a href="${link}">Redefinir senha</a></p>`,
        );
        recordSecurityEvent({ userId: row.id, email: row.email, ip, type: 'password_reset_requested', details: 'Link de recuperação emitido.' });
      } catch (error) {
        console.error('[email] Falha ao enviar link de recuperação:', error);
        sendJson(res, 503, { error: 'Não foi possível enviar o e-mail de recuperação agora. Tente novamente.' });
        return;
      }
    }
    sendJson(res, 202, { message: 'Se a conta estiver cadastrada, as instruções serão enviadas por e-mail.' });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/auth/reset') {
    const body = await readJson(req);
    const token = String(body.token || '');
    const password = String(body.password || '');
    const record = db.prepare(`
      SELECT r.token_hash, r.user_id, r.expires_at, r.used_at, u.email
      FROM reset_tokens r JOIN users u ON u.id = r.user_id
      WHERE r.token_hash = ?
    `).get(hashToken(token));
    if (!record || record.used_at || record.expires_at <= now()) {
      sendJson(res, 400, { error: 'O link de recuperação é inválido ou expirou.' });
      return;
    }
    const policyError = validatePassword(password, record.email);
    if (policyError) {
      sendJson(res, 400, { error: policyError });
      return;
    }
    const user = { id: record.user_id, email: record.email };
    if (await passwordIsReused(user.id, password)) {
      sendJson(res, 400, { error: 'Não reutilize nenhuma das últimas 3 senhas.' });
      return;
    }
    const passwordHash = await hashPassword(password);
    const changedAt = now();
    db.exec('BEGIN IMMEDIATE');
    try {
      const claimed = db.prepare(`
        UPDATE reset_tokens SET used_at = ?
        WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?
      `).run(changedAt, record.token_hash, changedAt);
      if (claimed.changes !== 1) {
        db.exec('ROLLBACK');
        sendJson(res, 400, { error: 'O link de recuperação é inválido ou expirou.' });
        return;
      }
      storePasswordHash(user.id, passwordHash, changedAt);
      db.prepare('DELETE FROM sessions WHERE user_id = ?').run(user.id);
      db.prepare('DELETE FROM auth_challenges WHERE user_id = ?').run(user.id);
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
    recordSecurityEvent({ userId: user.id, email: user.email, ip, type: 'password_reset_completed', details: 'Senha redefinida; segundo fator permanece obrigatório.' });
    try {
      await sendEmail(
        user.email,
        'Senha alterada — Folha Clara',
        'A senha da sua conta foi alterada. Se você não reconhece esta ação, entre em contato com o administrador.',
        '<p>A senha da sua conta foi alterada. Se você não reconhece esta ação, entre em contato com o administrador.</p>',
      );
    } catch (error) {
      console.error('[email] Falha ao enviar alerta de alteração de senha:', error);
      sendJson(res, 503, { error: 'A senha foi alterada, mas o alerta por e-mail não foi enviado. Avise o administrador.' });
      return;
    }
    sendJson(res, 200, { message: 'Senha redefinida. Entre novamente e confirme o segundo fator.' });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/auth/change-password') {
    const session = await requireSession(req, res);
    if (!session) return;
    const body = await readJson(req);
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(session.id);
    if (!user || !(await verifyPassword(String(body.currentPassword || ''), user.password_hash))) {
      sendJson(res, 400, { error: 'Senha atual inválida.' });
      return;
    }
    const updateError = await updatePassword(user, String(body.newPassword || ''));
    if (updateError) {
      sendJson(res, 400, { error: updateError });
      return;
    }
    recordSecurityEvent({ userId: user.id, email: user.email, ip, type: 'password_changed', details: 'Senha alterada com sessão autenticada.' });
    try {
      await sendEmail(
        user.email,
        'Senha alterada — Folha Clara',
        'A senha da sua conta foi alterada. Se você não reconhece esta ação, entre em contato com o administrador.',
        '<p>A senha da sua conta foi alterada. Se você não reconhece esta ação, entre em contato com o administrador.</p>',
      );
      sendJson(res, 200, { message: 'Senha alterada. Um alerta foi enviado por e-mail.' });
    } catch (error) {
      console.error('[email] Falha ao enviar alerta de alteração de senha:', error);
      sendJson(res, 200, { message: 'Senha alterada, mas o alerta por e-mail não pôde ser enviado.' });
    }
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/auth/logout') {
    const token = getCookie(req, 'sid');
    if (token) {
      const tokenHash = hashToken(token);
      const session = db.prepare(`
        SELECT u.id, u.email FROM sessions s JOIN users u ON u.id = s.user_id
        WHERE s.token_hash = ?
      `).get(tokenHash);
      db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash);
      if (session) recordSecurityEvent({ userId: session.id, email: session.email, ip, type: 'logout', details: 'Logout solicitado.' });
    }
    clearSessionCookie(res);
    sendJson(res, 200, { message: 'Sessão encerrada.' });
    return;
  }

  sendJson(res, 404, { error: 'Rota não encontrada.' });
}

function serveStatic(req, res, url) {
  const path = url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname);
  const safePath = normalize(path).replace(/^([/\\]|\\.\\.(?:[/\\]|$))+/, '');
  const file = join(PUBLIC_DIR, safePath);
  if (!file.startsWith(`${PUBLIC_DIR}/`) && !file.startsWith(`${PUBLIC_DIR}\\`)) {
    res.writeHead(403);
    res.end();
    return;
  }
  if (!existsSync(file) || extname(file) === '') {
    res.writeHead(404);
    res.end('Não encontrado.');
    return;
  }
  res.writeHead(200, {
    'Content-Type': MIME_TYPES[extname(file)] || 'application/octet-stream',
    'Cache-Control': 'no-cache',
  });
  res.end(readFileSync(file));
}

export async function requestHandler(req, res) {
  securityHeaders(res);
  try {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    if (url.pathname.startsWith('/api/')) {
      await handleApi(req, res, url);
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      sendJson(res, 405, { error: 'Método não permitido.' });
      return;
    }
    serveStatic(req, res, url);
  } catch (error) {
    console.error('[request] Falha ao processar solicitação:', error);
    if (res.headersSent) {
      res.destroy(error);
      return;
    }
    sendJson(res, error.status || 500, {
      error: error.status ? error.message : 'Erro interno. Tente novamente mais tarde.',
    });
  }
}

export async function startServer() {
  if (process.env.NODE_ENV === 'production') {
    const keyPath = process.env.HTTPS_KEY_FILE;
    const certPath = process.env.HTTPS_CERT_FILE;
    if (!keyPath || !certPath) throw new Error('HTTPS_KEY_FILE e HTTPS_CERT_FILE são obrigatórios em produção.');
    if (!process.env.APP_ENCRYPTION_KEY) throw new Error('APP_ENCRYPTION_KEY é obrigatório em produção.');
    getEncryptionKey();
    if (!process.env.MAIL_API_URL || !process.env.MAIL_API_KEY) throw new Error('MAIL_API_URL e MAIL_API_KEY são obrigatórios em produção.');
    if (!process.env.INITIAL_ADMIN_TOTP_SECRET) throw new Error('INITIAL_ADMIN_TOTP_SECRET é obrigatório em produção.');
    encryptExistingTotpSecrets();
    await seedInitialUser();
    return createHttpsServer({ key: readFileSync(keyPath), cert: readFileSync(certPath) }, requestHandler);
  }
  await seedInitialUser();
  encryptExistingTotpSecrets();
  return createHttpServer(requestHandler);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const server = await startServer();
  const host = process.env.HOST || '127.0.0.1';
  const port = Number(process.env.PORT || 3000);
  server.listen(port, host, () => {
    console.info(`[folha-clara-auth] http://${host}:${port}`);
  });
}

export { hashPassword, verifyPassword };
