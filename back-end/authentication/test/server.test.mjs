import { createHash } from 'node:crypto';
import { after, test } from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'development';
process.env.DB_PATH = ':memory:';
process.env.DEMO_EMAIL = 'admin@example.test';
process.env.DEMO_PASSWORD = 'TemporaryPass123';
process.env.DEMO_TOTP_SECRET = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
process.env.APP_ENCRYPTION_KEY = Buffer.from('0123456789abcdef0123456789abcdef').toString('base64');

const {
  db,
  generateTotp,
  hashPassword,
  startServer,
  validatePassword,
  verifyPassword,
  verifyTotp,
} = await import('../server.mjs');
const server = await startServer();
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const baseUrl = `http://127.0.0.1:${server.address().port}`;

after(async () => {
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  db.close();
});

async function post(path, body, cookie) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: JSON.stringify(body),
  });
  return { response, payload: await response.json() };
}

test('password policy and TOTP validation', () => {
  assert.equal(validatePassword('StrongPassword123', 'person@example.test'), null);
  assert.match(validatePassword('short', 'person@example.test'), /10 caracteres/);
  assert.match(validatePassword('Person123@example.test', 'person@example.test'), /e-mail/);
  assert.match(validatePassword('Password123!', 'person@example.test'), /menos comum/);
  const timestamp = 1_700_000_000_000;
  const code = generateTotp(process.env.DEMO_TOTP_SECRET, timestamp);
  assert.equal(verifyTotp(process.env.DEMO_TOTP_SECRET, code, timestamp), true);
  assert.equal(verifyTotp(process.env.DEMO_TOTP_SECRET, '000000', timestamp), false);
  assert.match(db.prepare('SELECT totp_secret FROM users').get().totp_secret, /^enc:v1:/);
});

test('rate limits count every request and authentication keeps a single sliding session', async () => {
  const healthResponse = await fetch(`${baseUrl}/api/health`);
  assert.equal(healthResponse.status, 200);
  assert.equal(healthResponse.headers.get('x-frame-options'), 'DENY');
  assert.match(healthResponse.headers.get('content-security-policy'), /default-src 'self'/);

  db.prepare('DELETE FROM rate_limits').run();
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    const { response } = await post('/api/auth/forgot', { email: 'unknown@example.test' });
    assert.equal(response.status, attempt <= 3 ? 202 : 429);
  }

  db.prepare('DELETE FROM rate_limits').run();
  for (let attempt = 1; attempt <= 21; attempt += 1) {
    const { response, payload } = await post('/api/auth/login', {
      email: `unknown${attempt}@example.test`,
      password: 'InvalidPassword123',
    });
    assert.equal(response.status, attempt <= 20 ? 401 : 429);
    if (attempt === 1) assert.equal(payload.error, 'E-mail ou senha inválidos.');
    if (attempt === 21) assert.equal(payload.code, 'IP_BLOCKED');
  }
  assert.ok(db.prepare("SELECT id FROM security_events WHERE event_type = 'ip_rate_limited'").get());

  db.prepare('DELETE FROM rate_limits').run();
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    const { response, payload } = await post('/api/auth/login', {
      email: process.env.DEMO_EMAIL,
      password: 'WrongPassword123',
    });
    assert.equal(response.status, attempt === 5 ? 423 : 401);
    if (attempt === 5) assert.equal(payload.error, 'Acesso bloqueado por 15 minutos após 5 tentativas incorretas.');
  }
  assert.ok(db.prepare("SELECT id FROM security_events WHERE event_type = 'login_blocked'").get());

  db.prepare('DELETE FROM rate_limits').run();
  const resetEmail = 'user@example.test';
  const originalHash = await hashPassword('OldPassword123');
  db.prepare(`
    INSERT INTO users(id, email, password_hash, totp_secret, force_password_change, created_at)
    VALUES ('reset-user', ?, ?, ?, 0, ?)
  `).run(resetEmail, originalHash, process.env.DEMO_TOTP_SECRET, Date.now());
  db.prepare('INSERT INTO password_history(user_id, password_hash, created_at) VALUES (?, ?, ?)')
    .run('reset-user', originalHash, Date.now());
  const resetToken = 'single-use-reset-token';
  db.prepare('INSERT INTO reset_tokens(token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)')
    .run(createHash('sha256').update(resetToken).digest('hex'), 'reset-user', Date.now() + 15 * 60 * 1000, Date.now());
  const resetAttempts = await Promise.all([
    post('/api/auth/reset', { token: resetToken, password: 'NewSecurePass456' }),
    post('/api/auth/reset', { token: resetToken, password: 'AnotherSecurePass789' }),
  ]);
  assert.deepEqual(resetAttempts.map(({ response }) => response.status).sort(), [200, 400]);
  const winningPassword = resetAttempts[0].response.status === 200
    ? 'NewSecurePass456'
    : 'AnotherSecurePass789';
  const { response: reusedResetResponse } = await post('/api/auth/reset', {
    token: resetToken,
    password: 'FreshSecurePass321',
  });
  assert.equal(reusedResetResponse.status, 400);
  const updatedUser = db.prepare('SELECT password_hash FROM users WHERE id = ?').get('reset-user');
  assert.equal(await verifyPassword(winningPassword, updatedUser.password_hash), true);

  db.prepare('DELETE FROM rate_limits').run();
  const { response: loginResponse, payload: login } = await post('/api/auth/login', {
    email: process.env.DEMO_EMAIL,
    password: process.env.DEMO_PASSWORD,
  });
  assert.equal(loginResponse.status, 200);
  const { response: mfaResponse } = await post('/api/auth/verify-otp', {
    challengeId: login.challengeId,
    code: generateTotp(process.env.DEMO_TOTP_SECRET),
  });
  assert.equal(mfaResponse.status, 200);
  const oldCookie = mfaResponse.headers.get('set-cookie').split(';')[0];

  const beforePassiveCheck = db.prepare('SELECT last_activity FROM sessions').get().last_activity;
  const sessionResponse = await fetch(`${baseUrl}/api/session`, { headers: { Cookie: oldCookie } });
  const session = await sessionResponse.json();
  assert.equal(session.mustChangePassword, true);
  assert.equal(sessionResponse.headers.get('set-cookie'), null);
  assert.equal(db.prepare('SELECT last_activity FROM sessions').get().last_activity, beforePassiveCheck);

  const { response: activityResponse } = await post('/api/session/activity', {}, oldCookie);
  assert.equal(activityResponse.status, 200);
  assert.match(activityResponse.headers.get('set-cookie'), /Max-Age=1800/);

  const { response: reusedPasswordResponse, payload: reusedPasswordPayload } = await post('/api/auth/change-password', {
    currentPassword: process.env.DEMO_PASSWORD,
    newPassword: process.env.DEMO_PASSWORD,
  }, oldCookie);
  assert.equal(reusedPasswordResponse.status, 400);
  assert.match(reusedPasswordPayload.error, /últimas 3 senhas/);

  const { response: changeResponse } = await post('/api/auth/change-password', {
    currentPassword: process.env.DEMO_PASSWORD,
    newPassword: 'NewStrongPassword456',
  }, oldCookie);
  assert.equal(changeResponse.status, 200);

  const { payload: secondLogin } = await post('/api/auth/login', {
    email: process.env.DEMO_EMAIL,
    password: 'NewStrongPassword456',
  });
  const { response: secondMfaResponse } = await post('/api/auth/verify-otp', {
    challengeId: secondLogin.challengeId,
    code: generateTotp(process.env.DEMO_TOTP_SECRET),
  });
  assert.equal(secondMfaResponse.status, 200);
  const newCookie = secondMfaResponse.headers.get('set-cookie').split(';')[0];

  const oldSessionResponse = await fetch(`${baseUrl}/api/session`, { headers: { Cookie: oldCookie } });
  assert.equal((await oldSessionResponse.json()).authenticated, false);

  const token = decodeURIComponent(newCookie.slice('sid='.length));
  const tokenHash = createHash('sha256').update(token).digest('hex');
  db.prepare('UPDATE sessions SET last_activity = ? WHERE token_hash = ?')
    .run(Date.now() - 31 * 60 * 1000, tokenHash);
  const expiredResponse = await fetch(`${baseUrl}/api/session`, { headers: { Cookie: newCookie } });
  const expired = await expiredResponse.json();
  assert.equal(expiredResponse.status, 401);
  assert.equal(expired.code, 'SESSION_EXPIRED');
  assert.match(expiredResponse.headers.get('set-cookie'), /Max-Age=0/);
});

// =========================================================================
// US-19 / v1.7: CRITÉRIOS DE ACEITE DE AUTENTICAÇÃO E SESSÃO SEGURA
// =========================================================================

test('US-19 / Critério 1: Login com e-mail e senha com segundo fator TOTP obrigatório', async () => {
  db.prepare('DELETE FROM rate_limits').run();
  const emailC1 = 'us19_c1@example.test';
  const passC1 = 'ValidPassword123#';
  const hashC1 = await hashPassword(passC1);

  db.prepare(`
    INSERT INTO users(id, email, password_hash, totp_secret, force_password_change, created_at)
    VALUES ('us19-u1', ?, ?, ?, 0, ?)
  `).run(emailC1, hashC1, process.env.DEMO_TOTP_SECRET, Date.now());

  // 1. Login inicial aceita credenciais e devolve desafio de segundo fator (sem cookie de sessão)
  const { response: loginRes, payload: loginPayload } = await post('/api/auth/login', {
    email: emailC1,
    password: passC1,
  });
  assert.equal(loginRes.status, 200);
  assert.equal(loginPayload.requiresMfa, true);
  assert.ok(loginPayload.challengeId, 'Deve emitir challengeId para o segundo fator');
  assert.equal(loginRes.headers.get('set-cookie'), null, 'Não deve emitir cookie de sessão antes do segundo fator');

  // 2. Tentar acessar sessão sem concluir 2FA
  const noSessionRes = await fetch(`${baseUrl}/api/session`);
  assert.equal((await noSessionRes.json()).authenticated, false);

  // 3. Código de segundo fator incorreto é rejeitado
  const { response: badOtpRes, payload: badOtpPayload } = await post('/api/auth/verify-otp', {
    challengeId: loginPayload.challengeId,
    code: '000000',
  });
  assert.equal(badOtpRes.status, 401);
  assert.equal(badOtpPayload.error, 'Código inválido. Digite o código do aplicativo.');

  // 4. Código TOTP válido conclui autenticação e emite cookie de sessão
  const validOtp = generateTotp(process.env.DEMO_TOTP_SECRET);
  const { response: goodOtpRes } = await post('/api/auth/verify-otp', {
    challengeId: loginPayload.challengeId,
    code: validOtp,
  });
  assert.equal(goodOtpRes.status, 200);
  const cookie = goodOtpRes.headers.get('set-cookie');
  assert.ok(cookie, 'Deve emitir cookie de sessão após segundo fator');
  assert.match(cookie, /sid=/);
});

test('US-19 / Critério 2: Senha incorreta ou e-mail inexistente apresenta mensagem genérica "E-mail ou senha inválidos."', async () => {
  db.prepare('DELETE FROM rate_limits').run();

  // 1. E-mail inexistente
  const { response: resInexistente, payload: payInexistente } = await post('/api/auth/login', {
    email: 'nao_cadastrado@example.test',
    password: 'QualquerSenhaValida123',
  });
  assert.equal(resInexistente.status, 401);
  assert.equal(payInexistente.error, 'E-mail ou senha inválidos.');

  // 2. E-mail existente com senha incorreta
  const { response: resSenhaErrada, payload: paySenhaErrada } = await post('/api/auth/login', {
    email: 'us19_c1@example.test',
    password: 'SenhaCompletamenteIncorreta999',
  });
  assert.equal(resSenhaErrada.status, 401);
  assert.equal(paySenhaErrada.error, 'E-mail ou senha inválidos.');

  // Mensagem e status são idênticos, impedindo enumeração de usuários
  assert.strictEqual(payInexistente.error, paySenhaErrada.error);
});

test('US-19 / Critério 3: Bloquear acesso a rotas protegidas sem sessão válida e expiração após 30 minutos sem atividade', async () => {
  db.prepare('DELETE FROM rate_limits').run();

  // 1. Bloquear acesso a endpoint protegido sem cookie de sessão
  const { response: unauthRes, payload: unauthPay } = await post('/api/session/activity', {});
  assert.equal(unauthRes.status, 401);
  assert.equal(unauthPay.code, 'AUTH_REQUIRED');
  assert.equal(unauthPay.error, 'Entre para continuar.');

  // 2. Bloquear acesso com cookie forjado/inexistente
  const fakeSessionRes = await fetch(`${baseUrl}/api/session`, {
    headers: { Cookie: 'sid=cookie-falso-inexistente-12345' },
  });
  assert.equal((await fakeSessionRes.json()).authenticated, false);

  // 3. Login válido com sessão ativa
  const { payload: loginPay } = await post('/api/auth/login', {
    email: 'us19_c1@example.test',
    password: 'ValidPassword123#',
  });
  const { response: otpRes } = await post('/api/auth/verify-otp', {
    challengeId: loginPay.challengeId,
    code: generateTotp(process.env.DEMO_TOTP_SECRET),
  });
  const cookie = otpRes.headers.get('set-cookie').split(';')[0];

  // 4. Sessão ativa responde com sucesso
  const validRes = await fetch(`${baseUrl}/api/session`, { headers: { Cookie: cookie } });
  assert.equal((await validRes.json()).authenticated, true);

  // 5. Simula expiração por inatividade (> 30 minutos)
  const token = decodeURIComponent(cookie.slice('sid='.length));
  const tokenHash = createHash('sha256').update(token).digest('hex');
  db.prepare('UPDATE sessions SET last_activity = ? WHERE token_hash = ?')
    .run(Date.now() - 31 * 60 * 1000, tokenHash);

  // 6. Consulta pós-expiração retorna 401 SESSION_EXPIRED e limpa cookie (Max-Age=0)
  const expRes = await fetch(`${baseUrl}/api/session`, { headers: { Cookie: cookie } });
  const expPay = await expRes.json();
  assert.equal(expRes.status, 401);
  assert.equal(expPay.code, 'SESSION_EXPIRED');
  assert.match(expRes.headers.get('set-cookie'), /Max-Age=0/);
});

test('US-19 / Critério 4: Bloqueio por 15 min após 5 tentativas e redefinição de senha encerra sessões ativas', async () => {
  db.prepare('DELETE FROM rate_limits').run();
  const emailC4 = 'us19_c4@example.test';
  const passC4 = 'InitialPassword123#';
  const hashC4 = await hashPassword(passC4);

  db.prepare(`
    INSERT INTO users(id, email, password_hash, totp_secret, force_password_change, created_at)
    VALUES ('us19-u4', ?, ?, ?, 0, ?)
  `).run(emailC4, hashC4, process.env.DEMO_TOTP_SECRET, Date.now());

  // 1. Bloqueio por 5 tentativas incorretas
  for (let i = 1; i <= 4; i++) {
    const { response, payload } = await post('/api/auth/login', {
      email: emailC4,
      password: `WrongPassword${i}`,
    });
    assert.equal(response.status, 401);
    assert.equal(payload.error, 'E-mail ou senha inválidos.');
  }

  // 5ª tentativa bloqueia a conta por 15 minutos (HTTP 423)
  const { response: res5, payload: pay5 } = await post('/api/auth/login', {
    email: emailC4,
    password: 'WrongPassword5',
  });
  assert.equal(res5.status, 423);
  assert.match(pay5.error, /Acesso bloqueado por 15 minutos/);

  // 6ª tentativa, mesmo com senha correta, permanece bloqueada
  const { response: res6, payload: pay6 } = await post('/api/auth/login', {
    email: emailC4,
    password: passC4,
  });
  assert.equal(res6.status, 423);
  assert.match(pay6.error, /Acesso bloqueado por 15 minutos/);

  // 2. Redefinição de senha encerra todas as sessões ativas
  db.prepare('DELETE FROM rate_limits').run();

  // Cria sessão ativa para us19-u4
  const activeToken = 'sessao-ativa-pre-reset';
  const activeTokenHash = createHash('sha256').update(activeToken).digest('hex');
  db.prepare('INSERT INTO sessions(token_hash, user_id, last_activity, created_at) VALUES (?, ?, ?, ?)')
    .run(activeTokenHash, 'us19-u4', Date.now(), Date.now());

  const activeCookie = `sid=${activeToken}`;
  const sessPreReset = await fetch(`${baseUrl}/api/session`, { headers: { Cookie: activeCookie } });
  assert.equal((await sessPreReset.json()).authenticated, true, 'Sessão pré-reset deve estar ativa');

  // Gera token de redefinição e executa reset
  const resetTokenC4 = 'token-reset-c4-unico';
  const resetTokenHashC4 = createHash('sha256').update(resetTokenC4).digest('hex');
  db.prepare('INSERT INTO reset_tokens(token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)')
    .run(resetTokenHashC4, 'us19-u4', Date.now() + 15 * 60 * 1000, Date.now());

  const { response: resetRes } = await post('/api/auth/reset', {
    token: resetTokenC4,
    password: 'NewStrongPasswordC4#456',
  });
  assert.equal(resetRes.status, 200);

  // Confirma que a sessão anterior foi sumariamente excluída do banco de dados
  const sessoesRestantes = db.prepare('SELECT COUNT(*) as count FROM sessions WHERE user_id = ?').get('us19-u4').count;
  assert.equal(sessoesRestantes, 0, 'Todas as sessões ativas devem ser encerradas após redefinição de senha');

  // Tentativa de uso do cookie anterior agora é rejeitada
  const sessPosReset = await fetch(`${baseUrl}/api/session`, { headers: { Cookie: activeCookie } });
  assert.equal((await sessPosReset.json()).authenticated, false);
});

test('US-19 / Critério 5: Senhas em hash scrypt, histórico das últimas 3 senhas e registro de eventos no log de segurança', async () => {
  db.prepare('DELETE FROM rate_limits').run();
  const emailC5 = 'us19_c5@example.test';
  const p1 = 'FirstStrongPassword1#';
  const p2 = 'SecondStrongPassword2#';
  const p3 = 'ThirdStrongPassword3#';
  const p4 = 'FourthStrongPassword4#';

  const hash1 = await hashPassword(p1);
  assert.match(hash1, /^[0-9a-f]{32}:[0-9a-f]{128}$/i, 'A senha deve ser armazenada com hash seguro scrypt');

  db.prepare(`
    INSERT INTO users(id, email, password_hash, totp_secret, force_password_change, created_at)
    VALUES ('us19-u5', ?, ?, ?, 0, ?)
  `).run(emailC5, hash1, process.env.DEMO_TOTP_SECRET, Date.now());
  db.prepare('INSERT INTO password_history(user_id, password_hash, created_at) VALUES (?, ?, ?)')
    .run('us19-u5', hash1, Date.now());

  // Login e obtenção de sessão
  const { payload: logPay } = await post('/api/auth/login', { email: emailC5, password: p1 });
  const { response: otpRes } = await post('/api/auth/verify-otp', {
    challengeId: logPay.challengeId,
    code: generateTotp(process.env.DEMO_TOTP_SECRET),
  });
  const cookie = otpRes.headers.get('set-cookie').split(';')[0];

  // 1. Troca para p2 (sucesso)
  const { response: resP2 } = await post('/api/auth/change-password', {
    currentPassword: p1,
    newPassword: p2,
  }, cookie);
  assert.equal(resP2.status, 200);

  // 2. Troca para p3 (sucesso)
  const { response: resP3 } = await post('/api/auth/change-password', {
    currentPassword: p2,
    newPassword: p3,
  }, cookie);
  assert.equal(resP3.status, 200);

  // 3. Tentar reutilizar p1 (está entre as últimas 3) -> Rejeitado
  const { response: resReusoP1, payload: payReusoP1 } = await post('/api/auth/change-password', {
    currentPassword: p3,
    newPassword: p1,
  }, cookie);
  assert.equal(resReusoP1.status, 400);
  assert.match(payReusoP1.error, /últimas 3 senhas/);

  // 4. Tentar reutilizar p2 (está entre as últimas 3) -> Rejeitado
  const { response: resReusoP2, payload: payReusoP2 } = await post('/api/auth/change-password', {
    currentPassword: p3,
    newPassword: p2,
  }, cookie);
  assert.equal(resReusoP2.status, 400);
  assert.match(payReusoP2.error, /últimas 3 senhas/);

  // 5. Troca para p4 (nova) -> Aceito
  const { response: resP4 } = await post('/api/auth/change-password', {
    currentPassword: p3,
    newPassword: p4,
  }, cookie);
  assert.equal(resP4.status, 200);

  // 6. Registro de eventos de segurança no log (security_events)
  const eventos = db.prepare('SELECT event_type, details FROM security_events WHERE email = ?').all(emailC5);
  assert.ok(eventos.length >= 4, 'Eventos de segurança devem ser registrados na auditoria');
  assert.ok(eventos.some((e) => e.event_type === 'password_accepted'));
  assert.ok(eventos.some((e) => e.event_type === 'login_success'));
  assert.ok(eventos.some((e) => e.event_type === 'password_changed'));
});
