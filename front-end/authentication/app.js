(function() {
// Se executando dentro da aplicação principal do projetoFolha SPA (que possui #app-shell),
// a orquestração e autenticação completa são geridas pelo script principal em index.html.
if (document.getElementById('app-shell')) {
  return;
}

const views = [...document.querySelectorAll('.view')];
const notice = document.querySelector('#notice');
const noticeIcon = document.querySelector('#notice-icon');
const noticeText = document.querySelector('#notice-text');
let challengeId = '';
let resetToken = new URLSearchParams(location.search).get('reset') || '';
let lastActivityPing = 0;

function showView(name) {
  for (const view of views) view.hidden = view.id !== `view-${name}`;
  clearNotice();
  const heading = document.querySelector(`#view-${name} h2`);
  heading?.focus({ preventScroll: true });
}

function announce(message, kind = 'error') {
  notice.className = `notice ${kind}`;
  noticeIcon.textContent = kind === 'success' ? '✓' : kind === 'warning' ? '!' : '×';
  noticeText.textContent = message;
  notice.hidden = false;
}

function clearNotice() {
  notice.hidden = true;
  noticeText.textContent = '';
}

async function request(path, data, method = 'POST') {
  const response = await fetch(path, {
    method,
    credentials: 'same-origin',
    headers: data ? { 'Content-Type': 'application/json' } : {},
    body: data ? JSON.stringify(data) : undefined,
  });
  let payload = {};
  try {
    payload = await response.json();
  } catch {
    throw new Error('O servidor retornou uma resposta inválida.');
  }
  if (!response.ok) {
    const error = new Error(payload.error || 'Não foi possível concluir a operação.');
    error.code = payload.code;
    throw error;
  }
  return payload;
}

function setBusy(form, busy) {
  const button = form.querySelector('button[type="submit"]');
  if (!button) return;
  button.disabled = busy;
  button.setAttribute('aria-busy', String(busy));
}

function formValues(form) {
  return Object.fromEntries(new FormData(form).entries());
}

document.querySelectorAll('[data-toggle-password]').forEach((button) => {
  button.addEventListener('click', () => {
    const input = document.getElementById(button.dataset.togglePassword);
    const showing = input.type === 'text';
    input.type = showing ? 'password' : 'text';
    button.textContent = showing ? 'Mostrar' : 'Ocultar';
    button.setAttribute('aria-pressed', String(!showing));
    input.focus();
  });
});

document.querySelector('#login-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  setBusy(form, true);
  try {
    const result = await request('/api/auth/login', formValues(form));
    challengeId = result.challengeId;
    document.querySelector('#mfa-code').value = '';
    showView('mfa');
    document.querySelector('#mfa-code').focus();
    announce('Digite o código do aplicativo.', 'warning');
  } catch (error) {
    announce(error.message);
  } finally {
    setBusy(form, false);
  }
});

document.querySelector('#mfa-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  setBusy(form, true);
  try {
    const result = await request('/api/auth/verify-otp', { challengeId, ...formValues(form) });
    challengeId = '';
    if (result.mustChangePassword) {
      showView('change');
      document.querySelector('#current-password').focus();
      return;
    }
    await showDashboard();
  } catch (error) {
    announce(error.message);
    if (error.code === 'ACCOUNT_BLOCKED' || error.code === 'INVALID_CHALLENGE') {
      challengeId = '';
      setTimeout(() => showView('login'), 1600);
    }
  } finally {
    setBusy(form, false);
  }
});

document.querySelector('#change-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const values = formValues(form);
  if (values.newPassword !== values.confirmPassword) {
    announce('As senhas não coincidem.');
    return;
  }
  setBusy(form, true);
  try {
    const result = await request('/api/auth/change-password', {
      currentPassword: values.currentPassword,
      newPassword: values.newPassword,
    });
    form.reset();
    await showDashboard();
    announce(result.message, 'success');
  } catch (error) {
    announce(error.message);
  } finally {
    setBusy(form, false);
  }
});

document.querySelector('#forgot-link').addEventListener('click', () => showView('forgot'));
document.querySelector('#back-to-login').addEventListener('click', () => showView('login'));
document.querySelectorAll('[data-show]').forEach((button) => {
  button.addEventListener('click', () => showView(button.dataset.show));
});

document.querySelector('#forgot-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  setBusy(form, true);
  try {
    const result = await request('/api/auth/forgot', formValues(form));
    announce(result.message, 'success');
  } catch (error) {
    announce(error.message);
  } finally {
    setBusy(form, false);
  }
});

document.querySelector('#reset-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const values = formValues(form);
  if (values.password !== values.confirmPassword) {
    announce('As senhas não coincidem.');
    return;
  }
  setBusy(form, true);
  try {
    const result = await request('/api/auth/reset', { token: resetToken, password: values.password });
    history.replaceState({}, '', '/');
    resetToken = '';
    showView('login');
    announce(result.message, 'success');
  } catch (error) {
    announce(error.message);
  } finally {
    setBusy(form, false);
  }
});

document.querySelector('#logout-button').addEventListener('click', async () => {
  try {
    await request('/api/auth/logout', {});
    showView('login');
    announce('Sessão encerrada.', 'success');
  } catch (error) {
    announce(error.message);
  }
});

async function showDashboard() {
  const session = await request('/api/session', null, 'GET');
  if (!session.authenticated) {
    showView('login');
    return;
  }
  if (session.mustChangePassword) {
    showView('change');
    return;
  }
  document.querySelector('#dashboard-email').textContent = session.email;
  showView('dashboard');
}

async function restoreSession() {
  if (resetToken) {
    showView('reset');
    document.querySelector('#reset-password').focus();
    return;
  }
  try {
    const session = await request('/api/session', null, 'GET');
    if (!session.authenticated) {
      showView('login');
      if (session.code === 'SESSION_EXPIRED') announce(session.error, 'warning');
      return;
    }
    if (session.mustChangePassword) {
      showView('change');
      return;
    }
    document.querySelector('#dashboard-email').textContent = session.email;
    showView('dashboard');
  } catch (error) {
    showView('login');
    if (error.code === 'SESSION_EXPIRED') announce(error.message, 'warning');
  }
}

window.setInterval(async () => {
  if (document.querySelector('#view-dashboard').hidden) return;
  try {
    const session = await request('/api/session', null, 'GET');
    if (!session.authenticated) {
      showView('login');
      announce('Sua sessão foi encerrada porque houve outro login.', 'warning');
    }
  } catch (error) {
    showView('login');
    announce(error.code === 'SESSION_EXPIRED' ? error.message : 'Sua sessão expirou. Entre novamente.', 'warning');
  }
}, 60_000);

async function reportActivity() {
  if (document.querySelector('#view-dashboard').hidden) return;
  const current = Date.now();
  if (current - lastActivityPing < 60_000) return;
  lastActivityPing = current;
  try {
    await request('/api/session/activity', {});
  } catch (error) {
    showView('login');
    announce(
      error.code === 'SESSION_EXPIRED' ? error.message : 'Não foi possível confirmar a atividade da sessão. Entre novamente.',
      'warning',
    );
  }
}

document.addEventListener('pointerdown', reportActivity);
document.addEventListener('keydown', reportActivity);
document.addEventListener('touchstart', reportActivity, { passive: true });
document.addEventListener('wheel', reportActivity, { passive: true });

restoreSession();
})();
