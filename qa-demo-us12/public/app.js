/**
 * app.js - Lógica interativa do Portal de Demonstração e QA da US-12 (Spec v1.7).
 */

document.addEventListener('DOMContentLoaded', () => {
  // Estado local
  let cenarios = [];
  let filtroAtual = 'all';
  let falhasConsecutivas = 0;
  let desafio2FAAtual = null;
  let usuario2FAAtual = null;

  // Elementos DOM
  const kpiTotal = document.getElementById('kpi-total');
  const kpiAprovados = document.getElementById('kpi-aprovados');
  const kpiReprovados = document.getElementById('kpi-reprovados');
  const kpiNaoExecutados = document.getElementById('kpi-nao-executados');
  const kpiStatus = document.getElementById('kpi-status');
  const tabCountAll = document.getElementById('tab-count-all');
  const tabCountAprovados = document.getElementById('tab-count-aprovados');
  const tabCountReprovados = document.getElementById('tab-count-reprovados');
  const scenariosContainer = document.getElementById('scenarios-container');

  // Inicialização de Abas Principais
  const navTabs = document.querySelectorAll('.nav-tab-main');
  navTabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      navTabs.forEach((t) => t.classList.remove('active'));
      document.querySelectorAll('.tab-content-panel').forEach((p) => p.classList.remove('active'));

      tab.classList.add('active');
      const targetId = tab.getAttribute('data-tab');
      const targetPanel = document.getElementById(targetId);
      if (targetPanel) targetPanel.classList.add('active');

      if (targetId === 'tab-simulador') carregarUsuarios();
      if (targetId === 'tab-permissoes') carregarMatrizPermissoes();
      if (targetId === 'tab-logs') carregarLogs();
    });
  });

  // Filtros de Cenários
  const filterTabs = document.querySelectorAll('.filter-tabs .tab');
  filterTabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      filterTabs.forEach((t) => t.classList.remove('active'));
      tab.classList.add('active');
      filtroAtual = tab.getAttribute('data-filter');
      renderizarCenarios();
    });
  });

  // Botões Globais
  document.getElementById('btn-run-all')?.addEventListener('click', executarTodosCenarios);
  document.getElementById('btn-reset')?.addEventListener('click', reiniciarAmbiente);

  // ---------------------------------------------------------------------------
  // Execução de Cenários de Aceite (1 a 12)
  // ---------------------------------------------------------------------------

  async function executarTodosCenarios() {
    try {
      scenariosContainer.innerHTML = '<div class="loading-box">Executando todos os 12 cenários no SQLite isolado...</div>';
      const res = await fetch('/api/scenarios/run-all', { method: 'POST' });
      const data = await res.json();
      cenarios = data.resultados || [];
      atualizarKPIs(data);
      renderizarCenarios();
    } catch (err) {
      scenariosContainer.innerHTML = `<div class="error-box">Erro ao executar cenários: ${err.message}</div>`;
    }
  }

  async function executarCenarioIndividual(id) {
    const cardEl = document.getElementById(`scenario-card-${id}`);
    if (cardEl) {
      cardEl.classList.add('executing');
    }

    try {
      const res = await fetch(`/api/scenarios/${id}/run`, { method: 'POST' });
      const resultado = await res.json();

      const idx = cenarios.findIndex((c) => c.id === id);
      if (idx !== -1) {
        cenarios[idx] = resultado;
      } else {
        cenarios.push(resultado);
      }

      recalcularContadoresLocais();
      renderizarCenarios();
    } catch (err) {
      alert(`Falha ao executar Cenário #${id}: ${err.message}`);
    }
  }

  function recalcularContadoresLocais() {
    const total = cenarios.length;
    const aprovados = cenarios.filter((c) => c.classificacao === 'APROVADO').length;
    const reprovados = cenarios.filter((c) => c.classificacao === 'REPROVADO').length;

    atualizarKPIs({ total, aprovados, reprovados, statusGeral: aprovados === total ? '100% CONFORME' : 'PARCIAL' });
  }

  function atualizarKPIs(data) {
    kpiTotal.textContent = data.total ?? cenarios.length;
    kpiAprovados.textContent = data.aprovados ?? 0;
    kpiReprovados.textContent = data.reprovados ?? 0;
    kpiNaoExecutados.textContent = data.naoExecutados ?? 0;

    tabCountAll.textContent = data.total ?? cenarios.length;
    tabCountAprovados.textContent = data.aprovados ?? 0;
    tabCountReprovados.textContent = data.reprovados ?? 0;

    if (data.reprovados > 0) {
      kpiStatus.textContent = 'COM REPROVAÇÃO';
      kpiStatus.className = 'summary-value status-badge-kpi status-danger';
    } else if (data.aprovados === 12) {
      kpiStatus.textContent = '100% CONFORME';
      kpiStatus.className = 'summary-value status-badge-kpi status-success';
    } else {
      kpiStatus.textContent = data.statusGeral || 'PARCIAL';
    }
  }

  function renderizarCenarios() {
    if (!cenarios.length) {
      scenariosContainer.innerHTML = '<div class="loading-box">Nenhum cenário avaliado. Clique em "Executar Todos os Cenários".</div>';
      return;
    }

    let filtrados = cenarios;
    if (filtroAtual === 'aprovados') {
      filtrados = cenarios.filter((c) => c.classificacao === 'APROVADO');
    } else if (filtroAtual === 'reprovados') {
      filtrados = cenarios.filter((c) => c.classificacao === 'REPROVADO');
    }

    if (!filtrados.length) {
      scenariosContainer.innerHTML = `<div class="loading-box">Nenhum cenário correspondente ao filtro "${filtroAtual}".</div>`;
      return;
    }

    scenariosContainer.innerHTML = filtrados.map((c) => {
      const isAprovado = c.classificacao === 'APROVADO';
      const badgeClass = isAprovado ? 'badge-success' : 'badge-danger';
      const statusIcon = isAprovado ? '✔' : '✖';

      return `
        <div class="scenario-card ${isAprovado ? 'border-success' : 'border-danger'}" id="scenario-card-${c.id}">
          <div class="scenario-header">
            <div class="scenario-title-area">
              <span class="scenario-number">Cenário #${c.id}</span>
              <h3 class="scenario-name">${escapeHtml(c.nome)}</h3>
            </div>
            <div class="scenario-badge ${badgeClass}">
              <span>${statusIcon}</span> ${escapeHtml(c.classificacao)}
            </div>
          </div>

          <div class="scenario-rule">
            <strong>Regra:</strong> <code>${escapeHtml(c.regraReferencia)}</code> &bull; ${escapeHtml(c.descricaoRegra)}
          </div>

          <div class="scenario-body">
            <div class="behavior-box expected">
              <span class="behavior-label">Comportamento Esperado:</span>
              <p>${escapeHtml(c.comportamentoEsperado)}</p>
            </div>
            <div class="behavior-box observed ${isAprovado ? 'observed-success' : 'observed-danger'}">
              <span class="behavior-label">Observado no Backend SQLite:</span>
              <p>${escapeHtml(c.comportamentoObtido)}</p>
            </div>
          </div>

          <div class="scenario-footer">
            <button class="btn btn-secondary btn-sm" onclick="window.executarCenarioIndividual(${c.id})">
              <span>↻</span> Reavaliar Cenário #${c.id}
            </button>
            <details class="tech-details">
              <summary>Detalhes Técnicos / Evidência JSON</summary>
              <pre><code>${escapeHtml(JSON.stringify(c.detalhesTecnicos, null, 2))}</code></pre>
            </details>
          </div>
        </div>
      `;
    }).join('');
  }

  window.executarCenarioIndividual = executarCenarioIndividual;

  // ---------------------------------------------------------------------------
  // Simulador de Gestão de Usuários
  // ---------------------------------------------------------------------------

  async function carregarUsuarios() {
    const tbody = document.getElementById('tbody-usuarios');
    try {
      const res = await fetch('/api/status');
      const data = await res.json();
      const usuarios = data.usuarios || [];

      if (!usuarios.length) {
        tbody.innerHTML = '<tr><td colspan="8" style="text-align: center; color: var(--text-secondary);">Nenhum usuário cadastrado.</td></tr>';
        return;
      }

      tbody.innerHTML = usuarios.map((u) => {
        const statusPill = u.ativo === 1
          ? '<span class="user-status-pill user-status-active">Ativo</span>'
          : '<span class="user-status-pill user-status-inactive">Inativo</span>';

        const badge2FA = u.segundoFatorAtivo
          ? '<span class="badge-2fa">2FA Ativo</span>'
          : '<span style="color: var(--text-muted); font-size: 0.75rem;">Desativado</span>';

        return `
          <tr>
            <td><strong>#${u.id}</strong></td>
            <td>${escapeHtml(u.nome)}</td>
            <td><code>${escapeHtml(u.email)}</code></td>
            <td><span class="brand-badge" style="background: ${u.perfil === 'ADMIN' ? '#b91c1c' : u.perfil === 'RH' ? '#1d4ed8' : '#6b21a8'}">${u.perfil}</span></td>
            <td>${statusPill}</td>
            <td>${badge2FA}</td>
            <td><span style="font-weight: 700; color: ${u.sessoesAtivas > 0 ? '#10b981' : '#64748b'}">${u.sessoesAtivas}</span> ativa(s)</td>
            <td>
              <div style="display: flex; gap: 6px; flex-wrap: wrap;">
                ${u.ativo === 1 ? `<button class="btn btn-secondary btn-sm" onclick="window.inativarUsuarioPrompt(${u.id})">Inativar</button>` : ''}
                <button class="btn btn-secondary btn-sm" onclick="window.redefinirSenhaPrompt(${u.id})">Trocar Senha</button>
                <button class="btn btn-secondary btn-sm" onclick="window.alternar2FA(${u.id}, ${!u.segundoFatorAtivo})">${u.segundoFatorAtivo ? 'Desativar 2FA' : 'Ativar 2FA'}</button>
              </div>
            </td>
          </tr>
        `;
      }).join('');
    } catch (err) {
      tbody.innerHTML = `<tr><td colspan="8" style="color: var(--color-danger);">Erro: ${err.message}</td></tr>`;
    }
  }

  document.getElementById('btn-atualizar-usuarios')?.addEventListener('click', carregarUsuarios);

  document.getElementById('form-criar-usuario')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const msg = document.getElementById('msg-criar-usuario');
    msg.innerHTML = '<span style="color: var(--text-secondary);">Cadastrando usuário...</span>';

    const payload = {
      nome: document.getElementById('user-nome').value.trim(),
      email: document.getElementById('user-email').value.trim(),
      senha: document.getElementById('user-senha').value,
      perfil: document.getElementById('user-perfil').value,
      segundoFatorAtivo: document.getElementById('user-2fa').checked,
    };

    try {
      const res = await fetch('/api/simulador/usuario/criar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.erro || 'Falha no cadastro');

      msg.innerHTML = `<span style="color: var(--color-success); font-weight: 700;">✔ Usuário ${data.usuario.email} cadastrado com sucesso!</span>`;
      document.getElementById('form-criar-usuario').reset();
      carregarUsuarios();
    } catch (err) {
      msg.innerHTML = `<span style="color: var(--color-danger); font-weight: 700;">✖ ${escapeHtml(err.message)}</span>`;
    }
  });

  window.inativarUsuarioPrompt = async (usuarioId) => {
    if (!confirm(`Deseja realmente inativar o usuário #${usuarioId}? Suas sessões ativas serão encerradas imediatamente.`)) return;
    try {
      const res = await fetch('/api/simulador/usuario/inativar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ usuarioId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.erro || 'Falha na inativação');
      alert(`Usuário #${usuarioId} inativado com sucesso! ${data.resultado.sessoesEncerradas} sessão(ões) encerrada(s).`);
      carregarUsuarios();
    } catch (err) {
      alert(`Erro: ${err.message}`);
    }
  };

  window.redefinirSenhaPrompt = async (usuarioId) => {
    const novaSenha = prompt(`Digite a nova senha para o usuário #${usuarioId} (mínimo 10 caracteres alfanuméricos, não reutilizar as últimas 3):`);
    if (!novaSenha) return;

    try {
      const res = await fetch('/api/simulador/usuario/redefinir-senha', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ usuarioId, novaSenha }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.erro || 'Falha na redefinição');
      alert(`Senha redefinida com sucesso! ${data.resultado.sessoesEncerradas} sessões ativas encerradas.`);
      carregarUsuarios();
    } catch (err) {
      alert(`Erro: ${err.message}`);
    }
  };

  window.alternar2FA = async (usuarioId, ativo) => {
    try {
      const res = await fetch('/api/simulador/usuario/2fa', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ usuarioId, ativo }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.erro || 'Falha ao alterar 2FA');
      carregarUsuarios();
    } catch (err) {
      alert(`Erro: ${err.message}`);
    }
  };

  // ---------------------------------------------------------------------------
  // Painel de Segurança: 2FA Interativo
  // ---------------------------------------------------------------------------

  document.getElementById('btn-iniciar-login-2fa')?.addEventListener('click', async () => {
    const email = document.getElementById('login-2fa-email').value.trim();
    const senha = document.getElementById('login-2fa-senha').value;
    const resEl = document.getElementById('res-etapa1-2fa');
    const boxInbox = document.getElementById('box-inbox-2fa');
    const boxEtapa2 = document.getElementById('box-etapa2-2fa');
    const inboxCodeVal = document.getElementById('inbox-code-value');

    resEl.innerHTML = 'Autenticando credenciais...';
    boxInbox.style.display = 'none';
    boxEtapa2.style.display = 'none';

    try {
      const res = await fetch('/api/seguranca/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, senha }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.erro || 'Falha na autenticação');

      const auth = data.autenticacao;
      usuario2FAAtual = auth.usuario;

      if (auth.requer2FA) {
        desafio2FAAtual = auth.desafioToken;
        resEl.innerHTML = `<span style="color: #38bdf8; font-weight: 700;">✔ 1ª Etapa Aprovada! Desafio de Segundo Fator emitido: <code>${auth.desafioToken.substring(0, 16)}...</code></span>`;

        // Consulta caixa de entrada simulada para obter o código despachado out-of-band
        const resOutbox = await fetch(`/api/seguranca/2fa/outbox?usuarioId=${auth.usuario.id}`);
        const dataOutbox = await resOutbox.json();

        if (dataOutbox.codigoDisponivel) {
          inboxCodeVal.textContent = dataOutbox.codigo;
          boxInbox.style.display = 'block';
          boxEtapa2.style.display = 'block';
        }
      } else {
        resEl.innerHTML = `<span style="color: var(--color-success); font-weight: 700;">✔ Login direto realizado sem 2FA. Token de sessão gerado!</span>`;
      }
    } catch (err) {
      resEl.innerHTML = `<span style="color: var(--color-danger); font-weight: 700;">✖ ${escapeHtml(err.message)}</span>`;
    }
  });

  document.getElementById('btn-confirmar-2fa')?.addEventListener('click', async () => {
    const codigo = document.getElementById('input-codigo-2fa').value.trim();
    const resEl = document.getElementById('res-etapa2-2fa');

    if (!desafio2FAAtual) {
      resEl.innerHTML = '<span style="color: var(--color-danger);">Inicie a 1ª etapa primeiro.</span>';
      return;
    }

    resEl.innerHTML = 'Validando código de segundo fator...';

    try {
      const res = await fetch('/api/seguranca/2fa/confirmar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ desafioToken: desafio2FAAtual, codigo }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.erro || 'Código inválido');

      resEl.innerHTML = `
        <div style="background: var(--color-success-bg); border: 1px solid var(--color-success-border); padding: 10px; border-radius: var(--radius-sm);">
          <strong style="color: var(--color-success);">✔ Segundo Fator Homologado com Sucesso!</strong><br>
          <span style="font-size: 0.8rem; color: #fff;">Sessão oficial emitida para <code>${escapeHtml(data.sessao.usuario.email)}</code> (${data.sessao.usuario.perfil}).</span><br>
          <span style="font-size: 0.75rem; color: var(--text-secondary);">Token criptográfico ativo com expiração de 30 minutos (RNF-01).</span>
        </div>
      `;
      carregarUsuarios();
    } catch (err) {
      resEl.innerHTML = `<span style="color: var(--color-danger); font-weight: 700;">✖ ${escapeHtml(err.message)}</span>`;
    }
  });

  // ---------------------------------------------------------------------------
  // Painel de Segurança: Bloqueio por Tentativas (RNF-19)
  // ---------------------------------------------------------------------------

  function atualizarDotsLockout(falhas, bloqueado) {
    for (let i = 1; i <= 5; i++) {
      const dot = document.getElementById(`dot-${i}`);
      if (dot) {
        if (i <= falhas || bloqueado) {
          dot.classList.add('filled');
        } else {
          dot.classList.remove('filled');
        }
      }
    }
    const contagemEl = document.getElementById('txt-falhas-contagem');
    if (contagemEl) contagemEl.textContent = `${Math.min(falhas, 5)} / 5`;
  }

  document.getElementById('btn-tentativa-errada')?.addEventListener('click', async () => {
    const email = document.getElementById('bloq-email').value.trim();
    const avisoEl = document.getElementById('txt-bloqueio-aviso');

    try {
      const res = await fetch('/api/seguranca/bloqueio/tentativa', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, senha: 'SenhaTotalmenteIncorreta' }),
      });
      const data = await res.json();

      falhasConsecutivas++;
      if (data.bloqueado) {
        atualizarDotsLockout(5, true);
        avisoEl.innerHTML = `<strong style="color: var(--color-danger);">⛔ BLOQUEADO:</strong> Acesso suspenso por 15 minutos (${data.minutosRestantes} min restantes) conforme RNF-19.`;
      } else {
        atualizarDotsLockout(falhasConsecutivas, false);
        avisoEl.innerHTML = `<span style="color: var(--color-warning);">Falha registrada (${falhasConsecutivas}/5): ${escapeHtml(data.erro || 'Senha incorreta')}</span>`;
      }
    } catch (err) {
      avisoEl.textContent = err.message;
    }
  });

  document.getElementById('btn-tentativa-correta')?.addEventListener('click', async () => {
    const email = document.getElementById('bloq-email').value.trim();
    const avisoEl = document.getElementById('txt-bloqueio-aviso');

    try {
      const res = await fetch('/api/seguranca/bloqueio/tentativa', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, senha: 'SenhaForte123' }),
      });
      const data = await res.json();

      if (res.ok) {
        falhasConsecutivas = 0;
        atualizarDotsLockout(0, false);
        avisoEl.innerHTML = `<span style="color: var(--color-success); font-weight: 700;">✔ Autenticação bem-sucedida! Contador de falhas reiniciado.</span>`;
      } else {
        if (data.bloqueado) {
          atualizarDotsLockout(5, true);
          avisoEl.innerHTML = `<strong style="color: var(--color-danger);">⛔ CONTA BLOQUEADA:</strong> Mesmo com a senha correta, o acesso é negado até expirar os 15 minutos (${data.minutosRestantes} min).`;
        } else {
          avisoEl.innerHTML = `<span style="color: var(--color-danger);">${escapeHtml(data.erro)}</span>`;
        }
      }
    } catch (err) {
      avisoEl.textContent = err.message;
    }
  });

  document.getElementById('btn-limpar-bloqueio')?.addEventListener('click', async () => {
    const email = document.getElementById('bloq-email').value.trim();
    await fetch('/api/seguranca/bloqueio/limpar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });
    falhasConsecutivas = 0;
    atualizarDotsLockout(0, false);
    document.getElementById('txt-bloqueio-aviso').innerHTML = 'Status: Contador reiniciado. Conta liberada.';
  });

  // ---------------------------------------------------------------------------
  // Painel de Segurança: Histórico das Últimas Senhas
  // ---------------------------------------------------------------------------

  async function carregarHistoricoSenhas() {
    const userId = document.getElementById('hist-user-id').value;
    const tbody = document.getElementById('tbody-historico-senhas');
    tbody.innerHTML = '<tr><td colspan="5" style="text-align: center;">Carregando histórico...</td></tr>';

    try {
      const res = await fetch(`/api/seguranca/historico-senhas?usuarioId=${userId}`);
      const data = await res.json();
      const rows = data.historico || [];

      if (!rows.length) {
        tbody.innerHTML = '<tr><td colspan="5" style="text-align: center; color: var(--text-secondary);">Nenhum histórico registrado para este usuário.</td></tr>';
        return;
      }

      tbody.innerHTML = rows.map((r, i) => {
        const bloqueada = i < 3;
        const badgeReuso = bloqueada
          ? '<span class="perm-badge-denied">✖ Reutilização Bloqueada</span>'
          : '<span class="perm-badge-allowed">✔ Liberada (fora da janela de 3)</span>';

        return `
          <tr>
            <td><strong>${escapeHtml(r.ordem)}</strong></td>
            <td><code>${escapeHtml(r.dataTroca)}</code></td>
            <td>${escapeHtml(r.formato)}</td>
            <td><code>${escapeHtml(r.hashOculto)}</code></td>
            <td>${badgeReuso}</td>
          </tr>
        `;
      }).join('');
    } catch (err) {
      tbody.innerHTML = `<tr><td colspan="5" style="color: var(--color-danger);">Erro: ${err.message}</td></tr>`;
    }
  }

  document.getElementById('btn-carregar-historico')?.addEventListener('click', carregarHistoricoSenhas);

  // ---------------------------------------------------------------------------
  // Matriz de Permissões em Tempo Real
  // ---------------------------------------------------------------------------

  async function carregarMatrizPermissoes() {
    const tbody = document.getElementById('tbody-permissoes');
    tbody.innerHTML = '<tr><td colspan="5" style="text-align: center;">Consultando backend real...</td></tr>';

    try {
      const res = await fetch('/api/permissoes/matriz');
      const data = await res.json();
      const matriz = data.matriz || [];

      tbody.innerHTML = matriz.map((item) => {
        const renderBadge = (permitido) => permitido
          ? '<span class="perm-badge-allowed">✔ PERMITIDO</span>'
          : '<span class="perm-badge-denied">✖ BLOQUEADO (403)</span>';

        return `
          <tr>
            <td><strong>${escapeHtml(item.acao)}</strong></td>
            <td>${renderBadge(item.rh)}</td>
            <td>${renderBadge(item.diretoria)}</td>
            <td>${renderBadge(item.admin)}</td>
            <td><code style="font-size: 0.78rem;">Seção 4 / Tabela 4.1</code></td>
          </tr>
        `;
      }).join('');
    } catch (err) {
      tbody.innerHTML = `<tr><td colspan="5" style="color: var(--color-danger);">Erro: ${err.message}</td></tr>`;
    }
  }

  document.getElementById('btn-retestar-permissoes')?.addEventListener('click', carregarMatrizPermissoes);

  // ---------------------------------------------------------------------------
  // Logs de Auditoria
  // ---------------------------------------------------------------------------

  async function carregarLogs() {
    const tbody = document.getElementById('tbody-logs');
    tbody.innerHTML = '<tr><td colspan="7" style="text-align: center;">Carregando logs...</td></tr>';

    try {
      const res = await fetch('/api/logs');
      const data = await res.json();
      const logs = data.logs || [];

      if (!logs.length) {
        tbody.innerHTML = '<tr><td colspan="7" style="text-align: center; color: var(--text-secondary);">Nenhum log gravado ainda.</td></tr>';
        return;
      }

      tbody.innerHTML = logs.map((l) => `
        <tr>
          <td>#${l.id}</td>
          <td><code style="font-size: 0.75rem;">${escapeHtml(l.data_hora)}</code></td>
          <td>${escapeHtml(l.usuario_email)}</td>
          <td><span class="brand-badge">${escapeHtml(l.usuario_perfil)}</span></td>
          <td><strong>${escapeHtml(l.acao)}</strong></td>
          <td><code>${escapeHtml(l.entidade)}</code></td>
          <td style="font-size: 0.8rem;">${escapeHtml(l.detalhes || '')}</td>
        </tr>
      `).join('');
    } catch (err) {
      tbody.innerHTML = `<tr><td colspan="7" style="color: var(--color-danger);">Erro: ${err.message}</td></tr>`;
    }
  }

  document.getElementById('btn-atualizar-logs')?.addEventListener('click', carregarLogs);

  // ---------------------------------------------------------------------------
  // Reiniciar Ambiente Demo
  // ---------------------------------------------------------------------------

  async function reiniciarAmbiente() {
    if (!confirm('Deseja reiniciar o banco de dados em memória (:memory:) para o estado inicial?')) return;
    try {
      await fetch('/api/reset', { method: 'POST' });
      falhasConsecutivas = 0;
      atualizarDotsLockout(0, false);
      alert('Ambiente reiniciado com fixtures limpas!');
      executarTodosCenarios();
      carregarUsuarios();
    } catch (err) {
      alert(`Erro: ${err.message}`);
    }
  }

  function escapeHtml(text) {
    if (text === null || text === undefined) return '';
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  // Executa automaticamente todos os cenários na primeira carga
  executarTodosCenarios();
});
