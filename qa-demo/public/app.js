/**
 * app.js - Lógica Frontend da Demonstração de QA da Etapa 2.
 */

let cenariosAtuais = [];
let contextoStatus = null;

// Elementos do DOM
const scenariosContainer = document.getElementById('scenarios-container');
const lacunasContainer = document.getElementById('lacunas-container');
const btnRunAll = document.getElementById('btn-run-all');
const btnReset = document.getElementById('btn-reset');
const kpiTotal = document.getElementById('kpi-total');
const kpiAprovados = document.getElementById('kpi-aprovados');
const kpiReprovados = document.getElementById('kpi-reprovados');
const tbodyEventos = document.getElementById('tbody-eventos');
const filterTabs = document.querySelectorAll('.filter-tabs .tab');

// Inicialização
document.addEventListener('DOMContentLoaded', () => {
  carregarStatusEFormularios();
  executarTodosCenarios();
  configurarEventos();
});

function configurarEventos() {
  btnRunAll.addEventListener('click', executarTodosCenarios);
  btnReset.addEventListener('click', reiniciarBanco);

  filterTabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      filterTabs.forEach((t) => t.classList.remove('active'));
      tab.classList.add('active');
      aplicarFiltro(tab.dataset.filter);
    });
  });

  // Formulário Horas Extras
  document.getElementById('form-he').addEventListener('submit', async (e) => {
    e.preventDefault();
    const formData = new FormData(e.target);
    const payload = Object.fromEntries(formData.entries());
    const feedback = document.getElementById('feedback-he');
    feedback.className = 'form-feedback';

    try {
      const res = await fetch('/api/manual/horas-extras', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (res.ok && data.sucesso) {
        feedback.className = 'form-feedback success';
        feedback.innerHTML = `<strong>Sucesso!</strong> Gravado evento ID ${data.dados.id}. Valor calculado: <strong>R$ ${data.dados.valorCalculado.toFixed(2)}</strong> (${data.dados.descricao}).`;
      } else {
        feedback.className = 'form-feedback error';
        feedback.innerHTML = `<strong>Bloqueio / Erro:</strong> ${data.erro || 'Falha ao registrar'}`;
      }
      atualizarTabelaEventos();
    } catch (err) {
      feedback.className = 'form-feedback error';
      feedback.innerText = `Erro de rede: ${err.message}`;
    }
  });

  // Formulário Falta
  document.getElementById('form-falta').addEventListener('submit', async (e) => {
    e.preventDefault();
    const formData = new FormData(e.target);
    const payload = Object.fromEntries(formData.entries());
    const feedback = document.getElementById('feedback-falta');
    feedback.className = 'form-feedback';

    try {
      const res = await fetch('/api/manual/faltas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (res.ok && data.sucesso) {
        feedback.className = 'form-feedback success';
        feedback.innerHTML = `<strong>Falta Registrada!</strong> Desconto Falta: <strong>R$ ${data.dados.descontoFalta.toFixed(2)}</strong> | Perda DSR: <strong>R$ ${data.dados.descontoDSR.toFixed(2)}</strong> (Total desconto: R$ ${(data.dados.descontoFalta + data.dados.descontoDSR).toFixed(2)}).`;
      } else {
        feedback.className = 'form-feedback error';
        feedback.innerHTML = `<strong>Bloqueio / Erro:</strong> ${data.erro || 'Falha ao registrar'}`;
      }
      atualizarTabelaEventos();
    } catch (err) {
      feedback.className = 'form-feedback error';
      feedback.innerText = `Erro de rede: ${err.message}`;
    }
  });

  // Formulário Vale-Transporte
  document.getElementById('form-vt').addEventListener('submit', async (e) => {
    e.preventDefault();
    const formData = new FormData(e.target);
    const payload = {
      colaboradorId: formData.get('colaboradorId'),
      competenciaId: formData.get('competenciaId'),
      optante: formData.get('optante') === 'true',
      custoMensalInformado: formData.get('custoMensalInformado'),
    };
    const feedback = document.getElementById('feedback-vt');
    feedback.className = 'form-feedback';

    try {
      const res = await fetch('/api/manual/vale-transporte', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (res.ok && data.sucesso) {
        feedback.className = 'form-feedback success';
        if (data.dados.optante) {
          feedback.innerHTML = `<strong>VT Calculado!</strong> Teto 6%: R$ ${data.dados.teto6PorCento.toFixed(2)} | Custo Informado: R$ ${data.dados.custoInformado.toFixed(2)} &rarr; <strong>Desconto Aplicado: R$ ${data.dados.valorDesconto.toFixed(2)}</strong> (menor valor conforme RN-50).`;
        } else {
          feedback.innerHTML = `<strong>Não Optante:</strong> Desconto de VT = <strong>R$ 0,00</strong>.`;
        }
      } else {
        feedback.className = 'form-feedback error';
        feedback.innerHTML = `<strong>Bloqueio / Erro:</strong> ${data.erro || 'Falha ao registrar'}`;
      }
      atualizarTabelaEventos();
    } catch (err) {
      feedback.className = 'form-feedback error';
      feedback.innerText = `Erro de rede: ${err.message}`;
    }
  });

  // Formulário Atestado
  document.getElementById('form-atestado').addEventListener('submit', async (e) => {
    e.preventDefault();
    const formData = new FormData(e.target);
    const payload = Object.fromEntries(formData.entries());
    const feedback = document.getElementById('feedback-atestado');
    feedback.className = 'form-feedback';

    try {
      const res = await fetch('/api/manual/atestados', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (res.ok && data.sucesso) {
        feedback.className = 'form-feedback success';
        feedback.innerHTML = `<strong>Atestado Válido!</strong> Registrado com status <code>${data.dados.status}</code> (sem desconto em folha ou DSR).`;
      } else {
        feedback.className = 'form-feedback error';
        feedback.innerHTML = `<strong>Bloqueio / Validação:</strong> ${data.erro || 'Falha ao registrar'}`;
      }
      atualizarTabelaEventos();
    } catch (err) {
      feedback.className = 'form-feedback error';
      feedback.innerText = `Erro de rede: ${err.message}`;
    }
  });
}

async function carregarStatusEFormularios() {
  try {
    const res = await fetch('/api/status');
    const data = await res.json();
    contextoStatus = data;

    // Popula selects de colaboradores
    const colabSelects = ['he-colaborador', 'falta-colaborador', 'vt-colaborador', 'atestado-colaborador'];
    colabSelects.forEach((id) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.innerHTML = data.colaboradores.map((c) => `
        <option value="${c.id}">${c.nome} (${c.cargo} - R$ ${c.salarioBase})</option>
      `).join('');
    });

    // Popula selects de competências
    const compSelects = ['he-competencia', 'falta-competencia', 'vt-competencia', 'atestado-competencia'];
    compSelects.forEach((id) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.innerHTML = data.competencias.map((comp) => `
        <option value="${comp.id}" ${comp.situacao === 'FECHADA' ? 'style="color:#f87171;"' : ''}>
          ${comp.mes_ano} [${comp.situacao}]
        </option>
      `).join('');
    });

    renderizarTabelaEventos(data.eventos);
  } catch (err) {
    console.error('Erro ao carregar status inicial:', err);
  }
}

async function executarTodosCenarios() {
  btnRunAll.disabled = true;
  btnRunAll.innerHTML = '<span class="icon">⏳</span> Executando testes reais...';

  try {
    const res = await fetch('/api/scenarios/run-all');
    const data = await res.json();
    cenariosAtuais = data.cenarios;

    kpiTotal.innerText = data.total;
    kpiAprovados.innerText = data.aprovados;
    if (kpiReprovados) kpiReprovados.innerText = data.reprovados;

    renderizarCenarios(cenariosAtuais);
    renderizarLacunas(data.lacunasUS02);
    atualizarTabelaEventos();
  } catch (err) {
    scenariosContainer.innerHTML = `<div class="form-feedback error">Erro ao executar cenários: ${err.message}</div>`;
  } finally {
    btnRunAll.disabled = false;
    btnRunAll.innerHTML = '<span class="icon">▶</span> Executar Todos os Cenários';
  }
}

async function reiniciarBanco() {
  btnReset.disabled = true;
  btnReset.innerHTML = '<span class="icon">⏳</span> Reiniciando...';
  try {
    const res = await fetch('/api/reset', { method: 'POST' });
    const data = await res.json();
    await carregarStatusEFormularios();
    await executarTodosCenarios();
    alert('Banco demo SQLite em memória reinicializado com sucesso com as fixtures padrão!');
  } catch (err) {
    alert('Erro ao reiniciar banco: ' + err.message);
  } finally {
    btnReset.disabled = false;
    btnReset.innerHTML = '<span class="icon">↺</span> Reiniciar Banco Demo (:memory:)';
  }
}

async function executarCenarioIndividual(id) {
  const cardEl = document.getElementById(`scenario-card-${id}`);
  const btnEl = document.getElementById(`btn-run-${id}`);
  if (btnEl) btnEl.disabled = true;

  try {
    const res = await fetch(`/api/scenarios/run/${id}`, { method: 'POST' });
    const cenarioAtualizado = await res.json();

    const idx = cenariosAtuais.findIndex((c) => c.id === id);
    if (idx !== -1) {
      cenariosAtuais[idx] = cenarioAtualizado;
    }
    renderizarCenarios(cenariosAtuais);
    atualizarTabelaEventos();
  } catch (err) {
    alert(`Erro ao executar cenário ${id}: ` + err.message);
  }
}

function renderizarCenarios(cenarios) {
  scenariosContainer.innerHTML = '';

  cenarios.forEach((c) => {
    const card = document.createElement('div');
    const classModifier = c.classificacao.toLowerCase();
    card.className = `scenario-card card-${classModifier}`;
    card.id = `scenario-card-${c.id}`;
    card.dataset.status = classModifier;

    let badgeClass = 'badge-success';
    let badgeText = 'APROVADO';
    let badgeIcon = '✔';

    if (c.classificacao === 'NAO_IMPLEMENTADO') {
      badgeClass = 'badge-warning';
      badgeText = 'NÃO IMPLEMENTADO';
      badgeIcon = '⚠️';
    } else if (c.classificacao === 'REPROVADO') {
      badgeClass = 'badge-danger';
      badgeText = 'REPROVADO';
      badgeIcon = '✖';
    }

    card.innerHTML = `
      <div class="card-header">
        <div class="card-title-group">
          <span class="card-number">#${c.id}</span>
          <h3>${c.nome}</h3>
        </div>
        <div class="card-badges">
          <span class="badge badge-rule">${c.regraReferencia}</span>
          <span class="badge ${badgeClass}">${badgeIcon} ${badgeText}</span>
        </div>
      </div>

      <div class="card-body">
        <div class="card-rule-desc">
          <strong>Regra da Spec:</strong> ${c.descricaoRegra}
        </div>

        <div class="comparison-box">
          <div class="compare-col esperado">
            <strong>Comportamento Esperado (Spec / QA)</strong>
            <p>${c.comportamentoEsperado}</p>
          </div>
          <div class="compare-col obtido">
            <strong>Comportamento Real do Backend</strong>
            <p>${c.comportamentoObtido}</p>
          </div>
        </div>

        <div class="card-footer">
          <button class="btn btn-secondary btn-sm" id="btn-run-${c.id}" onclick="executarCenarioIndividual(${c.id})">
            Reexecutar Cenário #${c.id}
          </button>
          <details class="json-details">
            <summary>Ver Detalhes Técnicos e JSON de Retorno</summary>
            <pre><code>${JSON.stringify(c.detalhesTecnicos, null, 2)}</code></pre>
          </details>
        </div>
      </div>
    `;

    scenariosContainer.appendChild(card);
  });
}

function renderizarLacunas(lacunas) {
  if (!lacunasContainer || !lacunas) return;
  lacunasContainer.innerHTML = lacunas.map((lac) => `
    <div class="lacuna-card">
      <div class="lacuna-header">
        <span class="lacuna-id">${lac.id}</span>
        <h4>${lac.titulo}</h4>
        <span class="tag">${lac.regra}</span>
      </div>
      <div class="lacuna-body">
        <div class="lacuna-status">
          <span class="badge ${lac.status.includes('NÃO') ? 'badge-danger' : 'badge-warning'}">
            ${lac.status}
          </span>
        </div>
        <p><strong>Diagnóstico Real:</strong> ${lac.diagnosticoReal}</p>
        <p><strong>Impacto na Folha:</strong> ${lac.impactoFolha}</p>
      </div>
    </div>
  `).join('');
}

function aplicarFiltro(tipo) {
  const cards = document.querySelectorAll('.scenario-card');
  cards.forEach((card) => {
    if (tipo === 'all') {
      card.style.display = 'block';
    } else if (tipo === 'aprovados') {
      card.style.display = card.dataset.status === 'aprovado' ? 'block' : 'none';
    } else if (tipo === 'reprovados') {
      card.style.display = card.dataset.status === 'reprovado' ? 'block' : 'none';
    }
  });
}

async function atualizarTabelaEventos() {
  try {
    const res = await fetch('/api/status');
    const data = await res.json();
    renderizarTabelaEventos(data.eventos);
  } catch (err) {
    console.error('Erro ao atualizar tabela de eventos:', err);
  }
}

function renderizarTabelaEventos(eventos) {
  if (!eventos || eventos.length === 0) {
    tbodyEventos.innerHTML = `<tr><td colspan="8" class="text-center">Nenhum evento registrado ainda.</td></tr>`;
    return;
  }

  tbodyEventos.innerHTML = eventos.map((ev) => {
    const valorReais = ev.valor_centavos ? (Number(ev.valor_centavos) / 100).toFixed(2) : '0.00';
    const dataCriacao = ev.criado_em ? ev.criado_em.replace('T', ' ').slice(0, 19) : '-';
    return `
      <tr>
        <td><code>${ev.id}</code></td>
        <td><strong>${ev.colaborador_nome || 'ID ' + ev.colaborador_id}</strong></td>
        <td><span class="tag">${ev.competencia_mes_ano || 'ID ' + ev.competencia_id}</span></td>
        <td><code>${ev.tipo}</code></td>
        <td>${ev.quantidade !== null ? ev.quantidade : '-'}</td>
        <td><strong>R$ ${valorReais}</strong></td>
        <td>${ev.descricao || ev.observacao || '-'}</td>
        <td style="font-size:0.78rem;color:var(--text-muted);">${dataCriacao}</td>
      </tr>
    `;
  }).join('');
}

// Expõe para o escopo global para onclick inline
window.executarCenarioIndividual = executarCenarioIndividual;

