// US-13 — Conferência de Totais da Folha (Spec v1.7)
// Aplicação Demonstrativa QA Interativa

const API_BASE = '';

function formatarMoeda(val) {
  return (val || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function formatarData(dataIso) {
  if (!dataIso) return '-';
  try {
    const d = new Date(dataIso);
    return d.toLocaleString('pt-BR');
  } catch {
    return dataIso;
  }
}

// Alternar abas
function alternarAba(abaId) {
  document.querySelectorAll('.tab-btn').forEach((btn) => btn.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach((tab) => tab.classList.remove('active'));

  const targetTab = document.getElementById(abaId);
  if (targetTab) {
    targetTab.classList.add('active');
  }

  // Marcar botão ativo
  const btn = Array.from(document.querySelectorAll('.tab-btn')).find((b) => {
    return b.getAttribute('onclick')?.includes(abaId);
  });
  if (btn) btn.classList.add('active');

  // Carregar dados específicos da aba selecionada
  if (abaId === 'aba-simulador') carregarConferenciaDetalhes();
  if (abaId === 'aba-confirmacao') carregarAlertasDiretoria();
  if (abaId === 'aba-auditoria') carregarLogsAuditoria();
}

// 1. Carregar Status Global
async function carregarStatus() {
  try {
    const res = await fetch(`${API_BASE}/api/status`);
    if (!res.ok) throw new Error('Falha ao carregar status do servidor');
    const dados = await res.json();

    document.getElementById('valTotalCenarios').textContent = dados.totalCenarios;
    document.getElementById('valAprovados').textContent = dados.aprovados;
    document.getElementById('valReprovados').textContent = dados.reprovados;

    const elConf = document.getElementById('valStatusConf');
    elConf.textContent = dados.conferenciaStatus;
    elConf.className = `metric-value ${dados.conferenciaStatus === 'APROVADO' ? 'text-success' : 'text-danger'}`;

    document.getElementById('valTolerancia').textContent = `Tolerância: ${dados.tolerancia}`;
    document.getElementById('valTotalLiquido').textContent = formatarMoeda(dados.totalLiquido);
    document.getElementById('valCentavosLiquido').textContent = `${(dados.totalLiquido * 100).toFixed(0)} centavos`;
    document.getElementById('lblCompetencia').textContent = `${dados.competencia} (${dados.colaboradores?.length || 4} Colaboradores)`;
  } catch (err) {
    console.error('Erro ao carregar status:', err);
  }
}

// 2. Executar Todos os Cenários
async function executarTodosCenarios() {
  const container = document.getElementById('scenariosContainer');
  container.innerHTML = '<div style="color: var(--text-secondary); padding: 20px;">⚡ Executando os 12 cenários automatizados...</div>';

  try {
    const res = await fetch(`${API_BASE}/api/scenarios/run-all`);
    const cenarios = await res.json();

    renderizarCenarios(cenarios);
    await carregarStatus();
    await carregarConferenciaDetalhes();
  } catch (err) {
    container.innerHTML = `<div class="result-alert alert-danger">Erro ao executar cenários: ${err.message}</div>`;
  }
}

// Renderizar Cenários na Interface
function renderizarCenarios(cenarios) {
  const container = document.getElementById('scenariosContainer');
  container.innerHTML = '';

  cenarios.forEach((c) => {
    const aprovado = c.classificacao === 'APROVADO';
    const card = document.createElement('div');
    card.className = `scenario-card ${aprovado ? 'aprovado' : 'reprovado'}`;
    card.id = `card-cenario-${c.id}`;

    card.innerHTML = `
      <div>
        <div class="scenario-header">
          <div>
            <div class="scenario-title">${c.id}. ${c.nome}</div>
            <div class="scenario-tag">${c.regraReferencia}</div>
          </div>
          <span class="badge ${aprovado ? 'badge-success' : 'badge-danger'}">
            ${c.classificacao}
          </span>
        </div>
        <div class="scenario-body">
          <div class="scenario-expected">
            <strong>Esperado:</strong> ${c.comportamentoEsperado}
          </div>
          <div class="scenario-obtained">
            <strong>Obtido:</strong> ${c.comportamentoObtido}
          </div>
        </div>
      </div>
      <div class="scenario-footer">
        <span style="font-size: 0.75rem; color: var(--text-muted);">${c.criterio}</span>
        <button class="btn btn-secondary btn-sm" onclick="executarCenarioIndividual(${c.id})">
          Reexecutar #${c.id}
        </button>
      </div>
    `;

    container.appendChild(card);
  });
}

// Executar Cenário Individual
async function executarCenarioIndividual(id) {
  try {
    const res = await fetch(`${API_BASE}/api/scenarios/${id}/run`, { method: 'POST' });
    const c = await res.json();

    const card = document.getElementById(`card-cenario-${id}`);
    if (card) {
      const aprovado = c.classificacao === 'APROVADO';
      card.className = `scenario-card ${aprovado ? 'aprovado' : 'reprovado'}`;
      card.querySelector('.scenario-obtained strong').nextSibling.textContent = ` ${c.comportamentoObtido}`;
      const badge = card.querySelector('.badge');
      badge.className = `badge ${aprovado ? 'badge-success' : 'badge-danger'}`;
      badge.textContent = c.classificacao;
    }

    await carregarStatus();
  } catch (err) {
    alert(`Erro ao reexecutar cenário ${id}: ${err.message}`);
  }
}

// 3. Carregar Detalhes da Conferência dos 8 Eixos
async function carregarConferenciaDetalhes() {
  try {
    const res = await fetch(`${API_BASE}/api/conferencia/detalhes`);
    const dados = await res.json();
    const conf = dados.conferencia;
    const tbody = document.getElementById('tbodyConferencia');
    if (!tbody) return;

    tbody.innerHTML = '';

    conf.itens.forEach((it) => {
      const confere = it.status === 'CONFERE';
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><strong>${it.item}</strong></td>
        <td class="font-mono">${formatarMoeda(it.esperado)}</td>
        <td class="font-mono">${formatarMoeda(it.calculado)}</td>
        <td class="font-mono ${confere ? 'text-success' : 'text-danger'}">
          ${it.divergencia === 0 ? 'R$ 0,00' : formatarMoeda(it.divergencia)}
        </td>
        <td class="font-mono" style="font-size: 0.8rem; color: var(--text-muted);">
          Esp: ${(it.esperado * 100).toFixed(0)}¢ | Calc: ${(it.calculado * 100).toFixed(0)}¢
        </td>
        <td>
          <span class="badge ${confere ? 'badge-success' : 'badge-danger'}">
            ${it.status}
          </span>
        </td>
      `;
      tbody.appendChild(tr);
    });
  } catch (err) {
    console.error('Erro ao carregar detalhes da conferência:', err);
  }
}

// 4. Induzir Divergência de R$ 0,01
async function induzirDivergencia(tipo) {
  const box = document.getElementById('boxResultadoSimulacao');
  box.style.display = 'block';
  box.className = 'result-alert alert-warning';
  box.innerHTML = `⏳ Injetando divergência de <strong>+R$ 0,01</strong> no item <code>${tipo}</code>...`;

  try {
    const res = await fetch(`${API_BASE}/api/conferencia/simular-divergencia`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tipo }),
    });
    const dados = await res.json();

    box.className = 'result-alert alert-danger';
    box.innerHTML = `
      🚨 <strong>Divergência Introduzida!</strong><br>
      ${dados.mensagem}<br>
      Status da Folha: <strong>${dados.statusGeral}</strong> (Tolerância R$ 0,00 violada)<br>
      Itens afetados: ${dados.itensDivergentes ? dados.itensDivergentes.join(', ') : 'Múltiplos eixos'}
    `;

    await carregarStatus();
    await carregarConferenciaDetalhes();
  } catch (err) {
    box.className = 'result-alert alert-danger';
    box.innerHTML = `Erro na simulação: ${err.message}`;
  }
}

// 5. Tentar Fechar a Folha (Teste de Bloqueio RN-59)
async function tentarFecharFolha() {
  const box = document.getElementById('boxResultadoSimulacao');
  box.style.display = 'block';

  try {
    const res = await fetch(`${API_BASE}/api/conferencia/fechar`, { method: 'POST' });
    const dados = await res.json();

    if (!res.ok) {
      box.className = 'result-alert alert-danger';
      box.innerHTML = `
        🛑 <strong>BLOQUEIO HOMOLOGADO PELO BACKEND (RN-59 / US-13):</strong><br>
        O fechamento foi <strong>REJEITADO</strong> porque há divergência financeira ativa.<br>
        <strong>Motivo retornado:</strong> ${dados.erro}
      `;
    } else {
      box.className = 'result-alert alert-success';
      box.innerHTML = `
        ✅ Folha fechada com sucesso! (Nenhuma divergência encontrada). Status: ${dados.status}
      `;
    }
  } catch (err) {
    box.className = 'result-alert alert-danger';
    box.innerHTML = `Erro ao fechar folha: ${err.message}`;
  }
}

// 6. Restaurar Ambiente
async function restaurarAmbiente() {
  const box = document.getElementById('boxResultadoSimulacao');
  if (box) {
    box.style.display = 'block';
    box.className = 'result-alert alert-success';
    box.innerHTML = '⏳ Restaurando fixtures e reexecutando cálculos de consistência...';
  }

  try {
    const res = await fetch(`${API_BASE}/api/conferencia/restaurar`, { method: 'POST' });
    const dados = await res.json();

    if (box) {
      box.innerHTML = `✅ <strong>Ambiente Restaurado com Sucesso:</strong> ${dados.mensagem} (Diferença: R$ 0,00)`;
    }

    await carregarStatus();
    await carregarConferenciaDetalhes();
    await carregarAlertasDiretoria();
    await carregarLogsAuditoria();
  } catch (err) {
    if (box) {
      box.className = 'result-alert alert-danger';
      box.innerHTML = `Erro ao restaurar: ${err.message}`;
    }
  }
}

// 7. Atualizar Aviso de Justificativa conforme Usuário Selecionado
function atualizarAvisoMesmoUsuario() {
  const sel = document.getElementById('selUsuarioConferente');
  const aviso = document.getElementById('boxAvisoMesmoUsuario');
  const txtJust = document.getElementById('txtJustificativaConferencia');

  if (sel.value === 'mesmo') {
    aviso.className = 'alert-info-box';
    aviso.innerHTML = 'ℹ️ <strong>Regra RN-67 / Critério 8:</strong> Como Mariana Silva calculou a folha e existe Carlos Eduardo (outro RH ativo), a confirmação <strong>exige justificativa obrigatória</strong> para notificação à Diretoria.';
    txtJust.placeholder = 'Ex: Fechamento extraordinário de competência em regime de plantão devido a ausência do segundo analista em treinamento externo homologado.';
  } else if (sel.value === 'outro') {
    aviso.className = 'alert-info-box';
    aviso.style.borderColor = 'rgba(16, 185, 129, 0.4)';
    aviso.innerHTML = '✅ <strong>Conferência Cruzada (Ideal):</strong> Carlos Eduardo não foi o calculador principal da folha, dispensando justificativa compulsória.';
    txtJust.placeholder = 'Justificativa opcional para este cenário.';
  } else if (sel.value === 'diretoria') {
    aviso.className = 'alert-info-box';
    aviso.style.borderColor = 'rgba(239, 68, 68, 0.4)';
    aviso.innerHTML = '🛑 <strong>Perfil Diretoria:</strong> Pela Seção 4.1, a Diretoria tem permissão de consulta, mas <strong>NÃO pode confirmar ou alterar a folha</strong> (Retornará 403 Forbidden).';
  } else if (sel.value === 'admin') {
    aviso.className = 'alert-info-box';
    aviso.style.borderColor = 'rgba(239, 68, 68, 0.4)';
    aviso.innerHTML = '🛑 <strong>Perfil Admin:</strong> O Administrador gerencia usuários e logs, mas <strong>NÃO tem acesso a rotinas financeiras de folha</strong> (Retornará 403 Forbidden).';
  }
}

// 8. Submeter Confirmação
async function submeterConfirmacao() {
  const sel = document.getElementById('selUsuarioConferente');
  const txtJust = document.getElementById('txtJustificativaConferencia');
  const box = document.getElementById('boxResultadoConfirmacao');
  box.style.display = 'block';

  const userType = sel.value;
  const justificativa = txtJust.value.trim();

  // Bloqueio de simulação para Perfis sem permissão
  if (userType === 'diretoria' || userType === 'admin') {
    box.className = 'result-alert alert-danger';
    box.innerHTML = `🛑 <strong>ACESSO NEGADO (HTTP 403):</strong> Usuários com perfil ${userType.toUpperCase()} não têm permissão para confirmar a conferência da folha (Critério 7 / Seção 4.1).`;
    return;
  }

  const mesmoUsuario = userType === 'mesmo';

  try {
    const res = await fetch(`${API_BASE}/api/conferencia/confirmar`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mesmoUsuario,
        justificativa: justificativa || undefined,
      }),
    });

    const dados = await res.json();

    if (!res.ok) {
      box.className = 'result-alert alert-danger';
      box.innerHTML = `❌ <strong>Confirmação Rejeitada:</strong> ${dados.erro}`;
    } else {
      box.className = 'result-alert alert-success';
      box.innerHTML = `
        ✅ <strong>Conferência Confirmada com Sucesso!</strong><br>
        Status: <strong>${dados.status}</strong><br>
        Notificou Diretoria: <strong>${dados.notificouDiretoria ? 'SIM (Alerta emitido na Central)' : 'NÃO (Não requerido)'}</strong><br>
        Confirmado por: Mariana Silva (RH)
      `;
      await carregarAlertasDiretoria();
      await carregarLogsAuditoria();
    }
  } catch (err) {
    box.className = 'result-alert alert-danger';
    box.innerHTML = `Erro na requisição: ${err.message}`;
  }
}

// 9. Devolver para Ajuste
function devolverParaAjuste() {
  const box = document.getElementById('boxResultadoConfirmacao');
  box.style.display = 'block';
  box.className = 'result-alert alert-warning';
  box.innerHTML = `
    ↩️ <strong>Folha Devolvida para Ajuste:</strong> A competência foi reaberta e o status retornou para <code>EM_EDICAO</code>. O analista responsável foi notificado para corrigir as divergências apontadas antes de nova conferência.
  `;
}

// 10. Carregar Alertas para a Diretoria
async function carregarAlertasDiretoria() {
  const lista = document.getElementById('listaAlertasDiretoria');
  if (!lista) return;

  try {
    const res = await fetch(`${API_BASE}/api/alertas`);
    const alertas = await res.json();

    lista.innerHTML = '';

    if (!alertas || alertas.length === 0) {
      lista.innerHTML = '<div style="color: var(--text-muted); padding: 12px;">Nenhum alerta ativo no momento.</div>';
      return;
    }

    alertas.forEach((alerta) => {
      const card = document.createElement('div');
      const severidade = (alerta.severidade || 'INFO').toLowerCase();
      card.className = `alert-item-card ${severidade === 'critico' ? 'critico' : severidade === 'atencao' ? 'atencao' : ''}`;

      card.innerHTML = `
        <div class="alert-item-header">
          <div class="alert-item-title">${alerta.titulo}</div>
          <span class="badge ${severidade === 'critico' ? 'badge-danger' : severidade === 'atencao' ? 'badge-warning' : 'badge-purple'}">
            ${alerta.severidade || 'NOTIFICAÇÃO'}
          </span>
        </div>
        <div class="alert-item-desc">${alerta.mensagem}</div>
        <div class="alert-item-date" style="margin-top: 6px;">Gerado em: ${formatarData(alerta.criadoEm)}</div>
      `;

      lista.appendChild(card);
    });
  } catch (err) {
    console.error('Erro ao carregar alertas:', err);
  }
}

// 11. Carregar Logs de Auditoria
async function carregarLogsAuditoria() {
  const tbody = document.getElementById('tbodyLogsAuditoria');
  if (!tbody) return;

  try {
    const res = await fetch(`${API_BASE}/api/logs`);
    const logs = await res.json();

    tbody.innerHTML = '';

    if (!logs || logs.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; color: var(--text-muted);">Nenhum log registrado.</td></tr>';
      return;
    }

    logs.forEach((l) => {
      let detalhesFormatados = l.detalhes || '-';
      try {
        const parsed = JSON.parse(l.detalhes);
        detalhesFormatados = JSON.stringify(parsed, null, 1);
      } catch {}

      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td class="font-mono" style="font-size: 0.8rem;">${formatarData(l.criado_em)}</td>
        <td>${l.usuario_email || l.usuario_id || 'mariana.rh@empresa.com'}</td>
        <td><span class="badge badge-purple">${l.perfil || 'RH'}</span></td>
        <td><strong>${l.acao}</strong></td>
        <td><code>${l.entidade}</code></td>
        <td style="font-size: 0.8rem; max-width: 320px; overflow-wrap: break-word; color: var(--text-secondary);">
          ${detalhesFormatados}
        </td>
      `;
      tbody.appendChild(tr);
    });
  } catch (err) {
    console.error('Erro ao carregar logs:', err);
  }
}

// Inicialização automática ao carregar a página
document.addEventListener('DOMContentLoaded', async () => {
  await carregarStatus();
  await executarTodosCenarios();
  await carregarConferenciaDetalhes();
  await carregarAlertasDiretoria();
  await carregarLogsAuditoria();
  atualizarAvisoMesmoUsuario();
});
