/**
 * app.js - Lógica Frontend da Demonstração de QA da US-10 (Spec v1.7).
 */

let cenariosAtuais = [];
let contextoStatus = null;

// Elementos do DOM
const scenariosContainer = document.getElementById('scenarios-container');
const btnRunAll = document.getElementById('btn-run-all');
const btnReset = document.getElementById('btn-reset');
const kpiTotal = document.getElementById('kpi-total');
const kpiAprovados = document.getElementById('kpi-aprovados');
const kpiReprovados = document.getElementById('kpi-reprovados');
const kpiNaoExecutados = document.getElementById('kpi-nao-executados');
const kpiStatus = document.getElementById('kpi-status');
const tbodyEventos = document.getElementById('tbody-eventos');
const filterTabs = document.querySelectorAll('.filter-tabs .tab');
const tabCountAll = document.getElementById('tab-count-all');
const tabCountAprovados = document.getElementById('tab-count-aprovados');
const tabCountReprovados = document.getElementById('tab-count-reprovados');

// Elementos dos Formulários e Memória
const selectColab = document.getElementById('select-colaborador');
const selectComp = document.getElementById('select-competencia');
const selectColabMemoria = document.getElementById('select-colab-memoria');
const btnCalcularMemoria = document.getElementById('btn-calcular-memoria');

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

  // Formulário de Verba Avulsa Manual
  document.getElementById('form-verba').addEventListener('submit', async (e) => {
    e.preventDefault();
    const formData = new FormData(e.target);
    const payload = {
      colaboradorId: formData.get('colaboradorId'),
      competenciaId: formData.get('competenciaId'),
      tipo: formData.get('tipo'),
      descricao: formData.get('descricao'),
      valorReais: formData.get('valorReais'),
      incideINSS: formData.get('incideINSS') === 'on',
      incideIRRF: formData.get('incideIRRF') === 'on',
      incideFGTS: formData.get('incideFGTS') === 'on',
    };

    const feedback = document.getElementById('feedback-verba');
    feedback.className = 'form-feedback';

    try {
      const res = await fetch('/api/manual/verba-avulsa', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (res.ok && data.sucesso) {
        feedback.className = 'form-feedback success';
        const valorFormatado = (data.dados.valor_centavos / 100).toFixed(2);
        feedback.innerHTML = `<strong>Sucesso!</strong> Gravada verba ID #${data.dados.id}. Descrição: <strong>${data.dados.descricao}</strong> | Valor: <strong>R$ ${valorFormatado}</strong> (${data.dados.tipo}).`;
        // Atualiza a memória de cálculo automaticamente para o colaborador lançado
        selectColabMemoria.value = payload.colaboradorId;
        carregarMemoriaCalculo(payload.colaboradorId, payload.competenciaId);
      } else {
        feedback.className = 'form-feedback error';
        feedback.innerHTML = `<strong>Bloqueio da Regra de Negócio:</strong> ${data.erro || 'Falha ao registrar a verba avulsa'}`;
      }
      atualizarTabelaEventos();
    } catch (err) {
      feedback.className = 'form-feedback error';
      feedback.innerText = `Erro de conexão: ${err.message}`;
    }
  });

  // Botão Calcular Memória de Cálculo
  btnCalcularMemoria.addEventListener('click', () => {
    const colabId = selectColabMemoria.value;
    const compId = selectComp.value;
    if (colabId && compId) {
      calcularEAtualizarMemoria(colabId, compId);
    }
  });
}

async function carregarStatusEFormularios() {
  try {
    const res = await fetch('/api/status');
    const data = await res.json();
    contextoStatus = data;

    // Popula selects de colaboradores
    selectColab.innerHTML = data.colaboradores.map((c) =>
      `<option value="${c.id}">${c.nome} (Salário: R$ ${c.salarioBase})</option>`
    ).join('');

    selectColabMemoria.innerHTML = data.colaboradores.map((c) =>
      `<option value="${c.id}">${c.nome} (ID #${c.id})</option>`
    ).join('');

    // Popula selects de competências
    selectComp.innerHTML = data.competencias.map((comp) =>
      `<option value="${comp.id}">Competência ${comp.mes_ano} (${comp.situacao})</option>`
    ).join('');

    renderizarTabelaEventos(data.eventos);
  } catch (err) {
    console.error('Erro ao carregar status inicial:', err);
  }
}

async function executarTodosCenarios() {
  scenariosContainer.innerHTML = '<div class="loading-placeholder">Executando bateria de testes no backend...</div>';
  btnRunAll.disabled = true;

  try {
    const res = await fetch('/api/scenarios/run-all');
    const data = await res.json();
    cenariosAtuais = data;

    const total = data.length;
    const aprovados = data.filter((c) => c.classificacao === 'APROVADO').length;
    const reprovados = data.filter((c) => c.classificacao === 'REPROVADO').length;
    const naoExecutados = data.filter((c) => c.classificacao === 'NAO_IMPLEMENTADO').length;

    kpiTotal.innerText = total;
    kpiAprovados.innerText = aprovados;
    kpiReprovados.innerText = reprovados;
    kpiNaoExecutados.innerText = naoExecutados;

    tabCountAll.innerText = total;
    tabCountAprovados.innerText = aprovados;
    tabCountReprovados.innerText = reprovados;

    if (aprovados === total) {
      kpiStatus.innerText = '100% CONFORME';
      kpiStatus.style.color = '#34d399';
    } else {
      kpiStatus.innerText = 'COM RESSALVAS';
      kpiStatus.style.color = '#f59e0b';
    }

    renderizarCenarios(data);
    atualizarTabelaEventos();

    // Se houver colaborador no select de memória, dispara o cálculo para visualização
    if (selectColabMemoria.value && selectComp.value) {
      calcularEAtualizarMemoria(selectColabMemoria.value, selectComp.value);
    }
  } catch (err) {
    scenariosContainer.innerHTML = `<div class="loading-placeholder" style="color:var(--color-danger);">Erro ao executar cenários: ${err.message}</div>`;
  } finally {
    btnRunAll.disabled = false;
  }
}

async function executarCenarioIndividual(id) {
  const btn = document.getElementById(`btn-run-${id}`);
  if (btn) {
    btn.disabled = true;
    btn.innerText = 'Executando...';
  }

  try {
    const res = await fetch(`/api/scenarios/${id}/run`, { method: 'POST' });
    const novoResultado = await res.json();

    const idx = cenariosAtuais.findIndex((c) => c.id === id);
    if (idx !== -1) {
      cenariosAtuais[idx] = novoResultado;
    }

    renderizarCenarios(cenariosAtuais);
    atualizarTabelaEventos();
  } catch (err) {
    alert(`Erro ao reexecutar cenário #${id}: ` + err.message);
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
          <strong>Regra da Spec v1.7:</strong> ${c.descricaoRegra}
        </div>

        <div class="comparison-box">
          <div class="compare-col esperado">
            <strong>Comportamento Esperado (Spec / Critério de Aceite)</strong>
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

async function reiniciarBanco() {
  if (!confirm('Deseja reinicializar o banco de teste SQLite isolado com fixtures padrão?')) return;
  try {
    const res = await fetch('/api/reset', { method: 'POST' });
    const data = await res.json();
    alert(data.mensagem);
    await carregarStatusEFormularios();
    await executarTodosCenarios();
  } catch (err) {
    alert('Erro ao reiniciar banco: ' + err.message);
  }
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
    const natBadge = ev.natureza === 'PROVENTO'
      ? `<span class="badge-natureza-provento">➕ PROVENTO</span>`
      : `<span class="badge-natureza-desconto">➖ DESCONTO</span>`;

    const tagINSS = ev.incide_inss ? `<span class="tag-inc on">INSS: SIM</span>` : `<span class="tag-inc off">INSS: NÃO</span>`;
    const tagIRRF = ev.incide_irrf ? `<span class="tag-inc on">IRRF: SIM</span>` : `<span class="tag-inc off">IRRF: NÃO</span>`;
    const tagFGTS = ev.incide_fgts ? `<span class="tag-inc on">FGTS: SIM</span>` : `<span class="tag-inc off">FGTS: NÃO</span>`;

    return `
      <tr>
        <td><code>#${ev.id}</code></td>
        <td><strong>${ev.colaborador_nome || 'ID ' + ev.colaborador_id}</strong></td>
        <td><span class="tag">${ev.competencia_mes_ano || 'ID ' + ev.competencia_id}</span></td>
        <td>${natBadge}</td>
        <td><strong>${ev.descricao || ev.observacao || '-'}</strong></td>
        <td style="font-weight:700;">R$ ${valorReais}</td>
        <td>
          <div class="incidencia-tags">
            ${tagINSS}
            ${tagIRRF}
            ${tagFGTS}
          </div>
        </td>
        <td style="font-size:0.78rem;color:var(--text-muted);">${dataCriacao}</td>
      </tr>
    `;
  }).join('');
}

async function calcularEAtualizarMemoria(colaboradorId, competenciaId) {
  try {
    btnCalcularMemoria.disabled = true;
    btnCalcularMemoria.innerText = 'Calculando...';

    // 1. Dispara cálculo da folha
    await fetch('/api/folha/calcular', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ colaboradorId, competenciaId }),
    });

    // 2. Consulta memória de cálculo
    await carregarMemoriaCalculo(colaboradorId, competenciaId);
  } catch (err) {
    console.error('Erro ao calcular memória:', err);
  } finally {
    btnCalcularMemoria.disabled = false;
    btnCalcularMemoria.innerText = '⚡ Calcular Folha';
  }
}

async function carregarMemoriaCalculo(colaboradorId, competenciaId) {
  try {
    const res = await fetch(`/api/folha/memoria?colaboradorId=${colaboradorId}&competenciaId=${competenciaId}`);
    const data = await res.json();

    if (!res.ok) {
      document.getElementById('tbody-memoria-verbas').innerHTML = `<tr><td colspan="4" class="text-center" style="color:var(--color-warning);">${data.erro}</td></tr>`;
      return;
    }

    // Atualiza totais
    document.getElementById('mem-tot-proventos').innerText = `R$ ${data.folha.totalProventosReais}`;
    document.getElementById('mem-tot-descontos').innerText = `R$ ${data.folha.totalDescontosReais}`;
    document.getElementById('mem-tot-liquido').innerText = `R$ ${data.folha.liquidoReais}`;
    document.getElementById('mem-tot-fgts').innerText = `R$ ${data.folha.fgtsEncargoReais}`;

    // Localiza verbas chave para bases
    const verbaINSS = data.verbas.find((v) => v.tipo === 'INSS');
    const verbaIRRF = data.verbas.find((v) => v.tipo === 'IRRF');
    const verbaFGTS = data.verbas.find((v) => v.tipo === 'FGTS');

    if (verbaINSS) {
      document.getElementById('mem-base-inss').innerText = `R$ ${(verbaINSS.base_calculo_centavos / 100).toFixed(2)}`;
    }
    if (verbaIRRF) {
      document.getElementById('mem-base-irrf').innerText = `R$ ${(verbaIRRF.base_calculo_centavos / 100).toFixed(2)}`;
    }
    if (verbaFGTS) {
      document.getElementById('mem-base-fgts').innerText = `R$ ${(verbaFGTS.base_calculo_centavos / 100).toFixed(2)}`;
    }

    // Renderiza tabela de verbas
    const tbody = document.getElementById('tbody-memoria-verbas');
    tbody.innerHTML = data.verbas.map((v) => {
      const baseReais = (v.base_calculo_centavos / 100).toFixed(2);
      const valReais = (v.valor_centavos / 100).toFixed(2);
      const natStyle = v.natureza === 'PROVENTO'
        ? 'color:#34d399; font-weight:700;'
        : (v.natureza === 'DESCONTO' ? 'color:#f87171; font-weight:700;' : 'color:#60a5fa; font-weight:700;');

      return `
        <tr>
          <td>
            <strong>${v.descricao}</strong>
            <div style="font-size:0.7rem; color:var(--text-muted);">${v.tipo} &bull; ${v.regra_aplicada || '-'}</div>
          </td>
          <td><span style="${natStyle}">${v.natureza}</span></td>
          <td style="text-align:right;">R$ ${baseReais}</td>
          <td style="text-align:right; font-weight:700;">R$ ${valReais}</td>
        </tr>
      `;
    }).join('');
  } catch (err) {
    console.error('Erro ao buscar memória:', err);
  }
}

// Expõe para o escopo global
window.executarCenarioIndividual = executarCenarioIndividual;
