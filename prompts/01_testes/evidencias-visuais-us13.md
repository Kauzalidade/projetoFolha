# Relatório de Evidências Visuais e Técnicas — US-13: Conferência de Totais da Folha

**Projeto:** Sistema de RH e Folha de Pagamento — Correspondente Bancário S.A.  
**Especificação Técnica:** v1.7  
**História de Usuário:** US-13 — Conferência de Totais da Folha (Etapa 1 / Etapa 3)  
**Branch:** `feat/us-13-conferencia-totais`  
**Data:** 17/11/2026  
**Status de Aceite:** 100% CONCLUÍDO E APROVADO  

---

## 1. Resumo Executivo da História e Critérios de Aceite

> **História do Usuário (US-13):**  
> *"Como analista de RH, quero conferir os totais antes do fechamento para evitar divergências."*

| # | Critério de Aceite (Spec v1.7) | Implementação no Backend | Status | Evidência Automatizada |
|---|---|---|:---:|---|
| **1** | Conferir em centavos a soma dos líquidos individuais contra o total da folha. | `executarConferenciaFinanceira`: `somaLiquidosCentavos === totalLiquidoFolhaCentavos` | ✅ APROVADO | Teste #1 (`us13_conferencia_totais.test.ts`), Cenário #1 QA |
| **2** | Conferir proventos menos descontos contra líquido. | `executarConferenciaFinanceira`: `proventosCent - descontosCent === liquidoCent` | ✅ APROVADO | Teste #3 (`us13_conferencia_totais.test.ts`), Cenário #2 QA |
| **3** | Conferir totais por filial contra o total geral. | `executarConferenciaFinanceira`: soma de cada filial `somaFiliaisLiquidoCent === totalLiquidoFolhaCentavos` | ✅ APROVADO | Teste #4 (`us13_conferencia_totais.test.ts`), Cenário #3 QA |
| **4** | Conciliar Folha do mês, Dados de pagamento e soma dos contracheques. | `executarConferenciaFinanceira`: `relFolha.totais.totalLiquido === relPag.totalLiquido === somaContracheques` | ✅ APROVADO | Teste #5 (`us13_conferencia_totais.test.ts`), Cenário #4 QA |
| **5** | Conferir INSS, IRRF e FGTS dos relatórios contra as verbas individuais. | `executarConferenciaFinanceira`: verbas agrupadas por tipo em `folha_verbas` vs total retido e memória de cálculo | ✅ APROVADO | Testes #6, #7, #8 (`us13_conferencia_totais.test.ts`), Cenários #5, #6, #7 QA |
| **6** | Aplicar tolerância exata de R$ 0,00: qualquer diferença bloqueia o fechamento e identifica o item divergente. | `tolerancia = 0.00`; `fecharFolhaSegura` e `confirmarConferenciaFolha` lançam erro detalhado e listam itens divergentes | ✅ APROVADO | Testes #2, #9, #10 (`us13_conferencia_totais.test.ts`), Cenários #8, #9 QA |
| **7** | Exigir confirmação da conferência por usuário RH. | `confirmarConferenciaFolha`: validação do perfil do usuário na Seção 4.1. Admin e Diretoria recebem erro 403. | ✅ APROVADO | Teste #11 (`us13_conferencia_totais.test.ts`), Cenário #10 QA |
| **8** | Se a mesma pessoa lançou/calculou e confirmar a conferência, havendo outro RH ativo, exigir justificativa e notificar Diretoria. | `confirmarConferenciaFolha`: verifica `calculado_por`, contagem de outros analistas RH ativos, exige justificativa obrigatória, persiste no banco, registra log e emite alerta na Central da Diretoria | ✅ APROVADO | Testes #12, #13, #14, #15 (`us13_conferencia_totais.test.ts`), Cenários #11, #12 QA |

---

## 2. Resultados dos Testes Automatizados no Backend

A suíte completa de testes do backend foi executada com o comando `npm.cmd test`, resultando em **113 testes passando (0 falhas) em 8 suítes**, mantendo 100% de compatibilidade regressiva.

### 2.1. Execução Específica da US-13 (`back-end/tests/us13_conferencia_totais.test.ts`)

```text
▶ US-13: Conferência de Totais da Folha (Spec v1.7)
  ✔ 1. Deve conferir em centavos a soma dos líquidos individuais contra o total da folha (Cenário de Sucesso) (465ms)
  ✔ 2. Deve detectar divergência de R$ 0,01 na soma dos líquidos e rejeitar a conferência (375ms)
  ✔ 3. Deve conferir com precisão matemática se Proventos menos Descontos é igual ao Líquido apurado (339ms)
  ✔ 4. Deve conferir os totais por filial (Matriz e Filial) contra o total geral da folha (268ms)
  ✔ 5. Deve conciliar rigorosamente o Relatório da Folha do Mês, Dados de Pagamento e soma dos Contracheques (313ms)
  ✔ 6. Deve conferir INSS, IRRF e FGTS dos relatórios contra a soma das verbas individuais (286ms)
  ✔ 7. Deve acusar DIVERGENTE e identificar o item caso ocorra discrepância de R$ 0,01 em verba de INSS (287ms)
  ✔ 8. Deve acusar DIVERGENTE e identificar o item caso ocorra discrepância de R$ 0,01 em verba de FGTS (305ms)
  ✔ 9. Qualquer divergência de R$ 0,01 deve bloquear o fechamento seguro da folha e apontar o item (322ms)
  ✔ 10. Qualquer divergência de R$ 0,01 deve bloquear a confirmação da conferência pelo RH (328ms)
  ✔ 11. Confirmação da conferência é restrita ao perfil RH; Diretoria e Admin são rejeitados (259ms)
  ✔ 12. Mesma pessoa que calculou tenta confirmar sem justificativa, havendo outro RH ativo: deve ser bloqueada (300ms)
  ✔ 13. Mesma pessoa com justificativa informa motivo válido: aprova, grava log e notifica Diretoria (293ms)
  ✔ 14. Analistas de RH diferentes dispensam justificativa para confirmar conferência (254ms)
  ✔ 15. Devolução da folha para ajuste com motivo reabre a competência e limpa conferência (287ms)
✔ US-13: Conferência de Totais da Folha (Spec v1.7) (4692ms)

TOTAL GERAL DA SUÍTE:
Suites: 8 pass, 8 total
Tests: 113 pass, 0 fail
```

---

## 3. Matriz dos 12 Cenários da Aplicação Demonstrativa (`qa-demo-us13`)

A aplicação demonstrativa isolada em `qa-demo-us13/` valida todos os cenários com banco SQLite in-memory, dados reais das filiais Matriz, Campinas e Santos e colaboradores Alice, Bernardo, Camila e Daniel.

| Cenário ID | Nome do Cenário | Regra | Comportamento Esperado | Resultado Obtido | Status |
|:---:|---|---|---|---|:---:|
| **#1** | Conferência em Centavos da Soma dos Líquidos vs Total | RN-59 | Soma dos líquidos em centavos (1.432.185¢) coincide com total da folha | Diferença: R$ 0,00 (0 centavos) | ✅ APROVADO |
| **#2** | Proventos menos Descontos contra Líquido | RN-59 | Proventos (R$ 16.700,00) - Descontos (R$ 2.378,15) == R$ 14.321,85 | Exatamente R$ 14.321,85. Divergência R$ 0,00 | ✅ APROVADO |
| **#3** | Totais por Filial vs Total Geral | RN-59 | Subtotais Matriz + Campinas + Santos == Total Geral | Soma filiais: R$ 14.321,85. Divergência R$ 0,00 | ✅ APROVADO |
| **#4** | Conciliação Tripla: Folha vs Pagamentos vs Contracheques | RN-57, RN-60, RN-73 | Folha == Dados de Pagamento == Contracheques | Todos apuram R$ 14.321,85 | ✅ APROVADO |
| **#5** | Verbas Individuais de INSS vs Total Descontado | RN-59 | Linhas de INSS somadas batem com total descontado (R$ 1.623,40) | Esperado R$ 1.623,40 / Calculado R$ 1.623,40 | ✅ APROVADO |
| **#6** | Verbas Individuais de IRRF vs Total Descontado | RN-59 | Retenções de IRRF somadas batem com total descontado (R$ 754,75) | Esperado R$ 754,75 / Calculado R$ 754,75 | ✅ APROVADO |
| **#7** | Encargos de FGTS da Memória vs Folha | RN-59 | Encargos individuais de 8% batem com o total (R$ 1.336,00) | Esperado R$ 1.336,00 / Calculado R$ 1.336,00 | ✅ APROVADO |
| **#8** | Detecção Precisa de Divergência de R$ 0,01 | RN-59 (Tolerância R$ 0,00) | Qualquer diferença de R$ 0,01 marca status DIVERGENTE e indica item | Status DIVERGENTE. Item apontado: "Verbas de INSS" | ✅ APROVADO |
| **#9** | Bloqueio Estrito do Fechamento da Folha | RN-59 (Critério 6) | Fechamento bloqueado perante divergência financeira | Fechamento bloqueado: `existem divergências na conferência` | ✅ APROVADO |
| **#10** | Controle de Acesso: Somente RH pode Confirmar | Tabela 4.1 (Critério 7) | Diretoria e Admin bloqueados com 403; RH autorizado | Diretoria bloqueada: true. Admin bloqueado: true. RH: true | ✅ APROVADO |
| **#11** | Bloqueio de Confirmação pelo Mesmo Analista sem Justificativa | RN-67 (Critério 8) | Bloqueio compulsório se o mesmo analista confirmar sem justificativa | Confirmação rejeitada exigindo justificativa | ✅ APROVADO |
| **#12** | Confirmação com Justificativa, Log e Alerta à Diretoria | RN-04, RN-67 (Critério 8) | Homologação com justificativa gravada em log e alerta na Diretoria | Status CONFERENCIA_CONFIRMADA, alerta ativo na Central | ✅ APROVADO |

---

## 4. Testes de Integração HTTP (`test-http.ts`)

A suíte HTTP automatizada valida as rotas de API e entrega dos artefatos web:

```text
[TEST-HTTP] Servidor de demonstração QA US-13 iniciado em http://127.0.0.1:3020
✔ [PASS] GET / -> 200 OK (HTML do portal)
✔ [PASS] GET /style.css -> 200 OK (CSS)
✔ [PASS] GET /app.js -> 200 OK (JavaScript)
✔ [PASS] GET /api/status -> 200 OK (Métricas 100% aprovado)
✔ [PASS] GET /api/scenarios/run-all -> 200 OK (12 cenários)
✔ [PASS] POST /api/scenarios/1/run -> 200 OK
✔ [PASS] GET /api/conferencia/detalhes -> 200 OK
✔ [PASS] POST /api/conferencia/simular-divergencia -> 200 OK (Divergência detectada)
✔ [PASS] POST /api/conferencia/restaurar -> 200 OK (Restaurado com sucesso)
✔ [PASS] POST /api/conferencia/confirmar (bloqueio sem justificativa) -> 400 OK
✔ [PASS] POST /api/conferencia/confirmar (com justificativa) -> 200 OK
✔ [PASS] GET /api/alertas -> 200 OK (Central de Alertas)
✔ [PASS] GET /api/logs -> 200 OK (Logs de auditoria)
✔ [PASS] GET /rota-inexistente-teste -> 404 OK

TODOS OS TESTES HTTP DA QA DEMO US-13 FORAM APROVADOS COM 100% DE SUCESSO!
```

---

## 5. Roteiro de Captura de Evidências Visuais para os Cards do Trello

Para coletar as capturas de tela exigidas no Trello, siga as etapas abaixo:

### Passo 1: Iniciar o Servidor Demonstrativo

No terminal PowerShell, execute:
```powershell
cd qa-demo-us13
npm.cmd start
```
O servidor estará ativo em: **`http://localhost:3016`** (ou porta indicada no console).

Abra no navegador Chrome / Edge: `http://localhost:3016`.

---

### Evidência 1: Dashboard de Métricas e Matriz dos 12 Cenários
- **Aba:** `Matriz de Cenários US-13 (12)`
- **O que capturar:**
  - Os 5 cartões de indicadores no topo:
    - *Cenários de Teste:* `12`
    - *Cenários Aprovados:* `12` (100% dos testes passando)
    - *Cenários Reprovados:* `0`
    - *Status da Conferência:* `APROVADO` (Tolerância: R$ 0,00)
    - *Total Líquido da Folha:* `R$ 14.321,85` (`1.432.185 centavos`)
  - Os cartões de cenários com badge verde `APROVADO` exibindo o comportamento esperado e obtido.
- **Card do Trello:** Card US-13 / Seção "Cenários Automatizados".

---

### Evidência 2: Tabela de Comparativo dos 8 Eixos Financeiros
- **Aba:** `Simulador dos 8 Eixos & Divergências`
- **O que capturar:**
  - Tabela com os 8 eixos demonstrando:
    1. Soma dos Líquidos vs Total Geral (Esp: R$ 14.321,85 / Calc: R$ 14.321,85 / Dif: R$ 0,00 / Status: `CONFERE`)
    2. Proventos - Descontos vs Líquido (Esp: R$ 14.321,85 / Calc: R$ 14.321,85 / Dif: R$ 0,00 / Status: `CONFERE`)
    3. Soma dos Totais por Filial vs Total Geral (Esp: R$ 14.321,85 / Calc: R$ 14.321,85 / Dif: R$ 0,00 / Status: `CONFERE`)
    4. Folha do Mês vs Dados de Pagamento (Esp: R$ 14.321,85 / Calc: R$ 14.321,85 / Dif: R$ 0,00 / Status: `CONFERE`)
    5. Folha do Mês vs Soma dos Contracheques (Esp: R$ 14.321,85 / Calc: R$ 14.321,85 / Dif: R$ 0,00 / Status: `CONFERE`)
    6. Verbas de INSS vs Total Descontado (Esp: R$ 1.623,40 / Calc: R$ 1.623,40 / Dif: R$ 0,00 / Status: `CONFERE`)
    7. Verbas de IRRF vs Total Descontado (Esp: R$ 754,75 / Calc: R$ 754,75 / Dif: R$ 0,00 / Status: `CONFERE`)
    8. Verbas de FGTS vs Encargos de FGTS (Esp: R$ 1.336,00 / Calc: R$ 1.336,00 / Dif: R$ 0,00 / Status: `CONFERE`)
- **Card do Trello:** Card US-13 / Seção "Tolerância Exata e Eixos Financeiros".

---

### Evidência 3: Demonstração de Bloqueio por Divergência de R$ 0,01
- **Ação no Simulador:**
  1. Clique no botão amarelo `⚠️ Induzir +R$ 0,01 no Líquido` ou `⚠️ Induzir +R$ 0,01 no INSS`.
  2. Observe o banner vermelho:  
     `Status da Folha: DIVERGENTE (Tolerância R$ 0,00 violada)`.
  3. Clique no botão vermelho `🔒 Testar Fechamento (Bloqueio RN-59)`.
  4. O alerta em vermelho destacará:  
     `BLOQUEIO HOMOLOGADO PELO BACKEND (RN-59 / US-13): O fechamento foi REJEITADO porque há divergência financeira ativa.`
- **O que capturar:** O banner de bloqueio com a identificação exata do item divergente.
- **Card do Trello:** Card US-13 / Seção "Bloqueio do Fechamento e Tolerância Zero".

---

### Evidência 4: Confirmação pelo Mesmo Analista, Justificativa e Notificação à Diretoria
- **Aba:** `Confirmação RH, Justificativa & Diretoria`
- **Ação:**
  1. No seletor de usuário, mantenha `Mariana Silva (RH que calculou a folha)`.
  2. Tente confirmar sem preencher a justificativa: observe a rejeição.
  3. Preencha a justificativa:  
     *"Plantão extraordinário de fechamento da folha: analista 2 ausente em treinamento externo homologado"*.
  4. Clique em `✍️ Confirmar Conferência da Folha`.
  5. Observe o banner verde de confirmação com `Notificou Diretoria: SIM`.
  6. No painel direito, veja o alerta gerado na *Central de Alertas & Notificações à Diretoria*:  
     `Notificação à Diretoria: Conferência pelo mesmo usuário (2026-10)` com o texto da justificativa.
- **O que capturar:** O formulário preenchido, o retorno verde de confirmação e o card de alerta na central da Diretoria.
- **Card do Trello:** Card US-13 / Seção "Segregação de Funções e Notificação à Diretoria (RN-67)".

---

### Evidência 5: Trilha de Auditoria Imutável (RNF-03)
- **Aba:** `Trilha de Auditoria (RNF-03)`
- **O que capturar:**
  - Tabela de logs contendo as ações:
    - `CONFIRMAR_CONFERENCIA_FOLHA`
    - `CRIAR_ALERTA_DIRETORIA_CONFERENCIA`
    - Registros com carimbo de data/hora, e-mail do usuário RH, perfil, entidade e JSON de auditoria.
- **Card do Trello:** Card US-13 / Seção "Auditoria e Rastreabilidade".

---

## 6. Comandos para Revalidação Rápida via Terminal

Para revalidar tudo a qualquer momento via terminal:

```powershell
# 1. Compilação TypeScript do Backend (0 erros)
cd back-end
npm.cmd run typecheck

# 2. Execução dos 113 testes do Backend (100% aprovados)
npm.cmd test

# 3. Compilação TypeScript do Servidor QA Demo (0 erros)
cd ..
node back-end/node_modules/typescript/bin/tsc --project qa-demo-us13/tsconfig.json --noEmit

# 4. Execução dos 12 cenários em lote
cd qa-demo-us13
npm.cmd run test:cenarios

# 5. Execução dos 14 testes HTTP da aplicação web
npm.cmd run test:http
```
