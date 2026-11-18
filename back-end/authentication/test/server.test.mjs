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

test('serves the login page and authentication assets from the frontend root', async () => {
  const pageResponse = await fetch(`${baseUrl}/`);
  assert.equal(pageResponse.status, 200);
  const pageHtml = await pageResponse.text();
  assert.match(pageHtml, /<script src="\/authentication\/app\.js" defer><\/script>/);
  assert.match(pageHtml, /<form id="login-form" method="post" novalidate>/);

  const nestedPageResponse = await fetch(`${baseUrl}/authentication/index.html`);
  assert.equal(nestedPageResponse.status, 200);
  const nestedPageHtml = await nestedPageResponse.text();
  assert.match(nestedPageHtml, /href="\/authentication\/styles\.css"/);
  assert.match(nestedPageHtml, /src="\/authentication\/app\.js"/);

  for (const asset of ['/authentication/app.js', '/authentication/styles.css']) {
    const response = await fetch(`${baseUrl}${asset}`);
    assert.equal(response.status, 200, `${asset} should be served`);
  }
});
