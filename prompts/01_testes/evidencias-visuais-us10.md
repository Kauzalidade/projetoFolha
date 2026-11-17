# Evidências Visuais e Demonstração de QA — US-10 (Spec v1.7)

**Repositório:** `projetoFolha`  
**Branch:** `feat/us-10-verbas-avulsas`  
**História de Usuário:** US-10 — Registro de Proventos e Descontos Manuais (Verbas Avulsas)  
**Versão da Especificação:** v1.7 (`docs/spec.md`)  
**Regras de Negócio Centrais:** RN-24, RN-25, RN-26, RN-27 e Tabela 7.4  
**Ambiente de Execução da Demonstração:** Servidor HTTP Node.js dedicado (`qa-demo-us10/server.ts`) com SQLite nativo em memória (`node:sqlite`)  
**Data da Homologação:** 17/11/2026  
**Status Consolidado:** ✅ **10 Critérios de Aceite Aprovados (100% Conforme)** contra a Spec v1.7; Zero Reprovações.

---

## 1. Resumo Executivo da Demonstração

Este documento apresenta as evidências de Garantia da Qualidade (QA) da **US-10 — Registro de Proventos e Descontos Manuais (Verbas Avulsas)**, implementada e auditada no Sistema de RH e Folha de Pagamento.

Para viabilizar uma validação visual independente, sem poluir a demonstração anterior da US-02 (`qa-demo/`) nem modificar dados do banco de produção, foi criada a aplicação web interativa em **`qa-demo-us10/`**. 

A demonstração opera em `http://localhost:3000/` e interage em tempo real com as regras oficiais de negócio em `back-end/src/services/` (`eventoService.ts` e `folhaService.ts`), processando operações sobre uma base SQLite isolada em memória (`:memory:`).

### Destaques da Implementação:
1. **Conformidade Estrita com a Tabela 7.4:** Desacoplamento pleno das bases de INSS, IRRF e FGTS. Cada verba manual onera exclusivamente os tributos em que foi explicitamente assinalada pelo analista de RH.
2. **Discriminação na Memória de Cálculo (RN-02 / RN-25):** Proventos e descontos avulsos mantêm suas descrições personalizadas (ex.: *"Adicional de Insalubridade 20%"*, *"Pensão Alimentícia Judicial"*, *"Empréstimo Consignado Caixa"*), figurando individualmente na memória e no contracheque.
3. **Travas de Segurança:** Validações de descrição não vazia, valor positivo (> 0) e bloqueio imperativo caso a competência esteja nas situações `FECHADA` ou `CALCULADA`.
4. **Isolamento de Acesso:** Permissão restrita ao perfil `RH`. Perfis `DIRETORIA` e `ADMIN` são bloqueados com respostas explicativas.

---

## 2. Matriz de Resultados dos 10 Cenários de Aceite (Spec v1.7)

Todos os 10 cenários foram executados invocando diretamente as funções do backend sobre fixtures controladas no SQLite:

| # | Cenário de Aceite | Regra de Referência | Comportamento Esperado (Spec v1.7) | Comportamento Efetivamente Observado no Backend | Status |
| :-: | :--- | :---: | :--- | :--- | :-: |
| **1** | Cadastro de Provento Manual | **RN-25<br>Seção 2 / 5.3** | Provento registrado com descrição, valor positivo (> 0) e marcações tributárias. | Evento gravado com `tipo = 'VERBA_AVULSA_PROVENTO'`, valor R$ 500,00 e descrição informada. | ✅ **APROVADO** |
| **2** | Cadastro de Desconto Manual | **RN-25<br>Seção 2 / 5.3** | Desconto cadastrado com descrição personalizada e valor positivo. | Evento gravado com `tipo = 'VERBA_AVULSA_DESCONTO'`, valor R$ 350,00 e descrição preservada. | ✅ **APROVADO** |
| **3** | Incidência Exclusiva em INSS | **RN-26<br>Tab. 7.4** | Salário R$ 3.000 + Verba R$ 500: Base INSS sobe para R$ 3.500,00; Bases de IRRF e FGTS mantêm-se em R$ 3.000,00. | Backend apurou Base INSS: R$ 3.500,00; Rend. IRRF: R$ 3.000,00; Base FGTS: R$ 3.000,00. | ✅ **APROVADO** |
| **4** | Incidência Exclusiva em IRRF | **RN-26<br>Tab. 7.4** | Salário R$ 2.200 + Verba R$ 600: Rend. IRRF sobe para R$ 2.800,00; Bases de INSS e FGTS mantêm-se em R$ 2.200,00. | Backend apurou Rend. IRRF: R$ 2.800,00; Base INSS: R$ 2.200,00; Base FGTS: R$ 2.200,00. | ✅ **APROVADO** |
| **5** | Incidência Exclusiva em FGTS | **RN-24<br>RN-26** | Salário R$ 2.200 + Verba R$ 400: Base FGTS sobe para R$ 2.600,00 (FGTS = R$ 208,00); INSS e IRRF inalterados. | Backend apurou Base FGTS: R$ 2.600,00 gerando encargo de R$ 208,00 (8%), mantendo INSS e IRRF em R$ 2.200,00. | ✅ **APROVADO** |
| **6** | Verba Sem Incidência Tributária | **RN-25<br>RN-26** | Verba de R$ 300,00 sem incidências soma ao total de proventos (R$ 3.300,00) sem onerar nenhuma base tributária. | Backend somou R$ 300,00 aos proventos (Total R$ 3.300,00) mantendo bases INSS, IRRF e FGTS em R$ 3.000,00. | ✅ **APROVADO** |
| **7** | Validação de Entradas Inválidas | **RN-25<br>Seção 5.3** | Bloqueio de descrição vazia, valor zero e valor negativo com mensagens explicativas. | Backend rejeitou as 3 tentativas com as mensagens: *"Informe a descrição..."* e *"Informe um valor maior que zero..."*. | ✅ **APROVADO** |
| **8** | Bloqueio de Competência Não Aberta | **RN-25<br>Tab. 7.5** | Bloqueio em competências nas situações `FECHADA` ou `CALCULADA`. | Operações bloqueadas: *"Esta competência está fechada..."* e *"Lançamentos de verbas avulsas são permitidos exclusivamente em competência aberta"*. | ✅ **APROVADO** |
| **9** | Controle de Acesso por Perfil | **Tab. 4.1<br>RN-10** | Apenas perfil `RH` autorizado; perfis `DIRETORIA` e `ADMIN` bloqueados. | Requisições de Diretoria e Admin bloqueadas com *"Você não tem permissão para esta ação"*; Perfil RH autorizado. | ✅ **APROVADO** |
| **10**| Persistência e Memória de Cálculo | **RN-02<br>RN-25** | Verbas avulsas persistidas no SQLite e discriminadas individualmente na memória com descrições originais. | Insalubridade (PROVENTO R$ 400,00) e Consignado (DESCONTO R$ 250,00) discriminados na tabela `folha_verbas`. | ✅ **APROVADO** |

---

## 3. Arquitetura da Aplicação de Demonstração (`qa-demo-us10/`)

A aplicação foi estruturada de forma modular, reutilizando o padrão visual profissional (dark theme, KPIs responsivos e tabelas dinâmicas):

```text
qa-demo-us10/
├── fixtures.ts            # Carga de dados in-memory: usuários (RH, Admin, Diretoria), filial, colaboradores e competências
├── server.ts              # Servidor HTTP Node.js com rotas de API e executor dos 10 cenários reais
├── test-cenarios.ts       # Validador de linha de comando para execução automatizada dos 10 cenários
├── test-http.ts           # Teste de integração HTTP cobrindo rotas, assets e status codes
├── tsconfig.json          # Configuração TypeScript estrita com ES2022 e Node16
├── package.json           # Declaração type: module para interoperabilidade ESM
└── public/
    ├── index.html         # Interface completa com painel de KPIs, cards, formulário, memória e tabela ao vivo
    ├── style.css          # Estilização com design system (Inter, JetBrains Mono, badges e grids)
    └── app.js             # Lógica reativa do frontend (execução individual, filtros, formulário e atualização em tempo real)
```

---

## 4. Análise de Limitações e Proposta sobre Exclusão de Eventos

### 4.1 Diagnóstico Legal e Normativo
- Conforme exigido nas diretrizes da US-10, foi feita a checagem rigorosa na especificação técnica v1.7 (`docs/spec.md`).
- **Constatação:** A especificação **não autoriza a exclusão física de eventos** de competência após o lançamento.
- **Fundamentação:** Em folha de pagamento e auditoria fiscal (RNF-03 e RN-71), registros contábeis devem ser imutáveis para evitar passivos trabalhistas e fraudes. Excluir fisicamente uma verba romperia a trilha de rastreabilidade.
- **Decisão Técnica:** A exclusão física automática **não foi implementada**.

### 4.2 Proposta Formal para Próxima Versão (Spec v1.8)
1. **Lançamento de Estorno Compensatório:** O analista lança uma verba avulsa de natureza oposta (ex.: se lançou R$ 500 de bônus indevido, lança R$ 500 de desconto compensatório com observação explicativa).
2. **Cancelamento Lógico (Soft Delete):** Adicionar campos `cancelado_em` e `justificativa_cancelamento` na tabela `eventos`, registrando o autor no log de auditoria e desconsiderando o evento no cálculo do `folhaService.ts`.

---

## 5. Instruções para Executar e Testar Localmente

### 5.1 Iniciar o Servidor Demonstrativo
Na raiz do repositório, execute no terminal Windows PowerShell:

```powershell
cmd /c "npx --prefix back-end tsx qa-demo-us10/server.ts"
```

Abra o navegador no endereço:  
👉 **`http://localhost:3000/`**

### 5.2 Executar os Testes Automatizados da Demonstração
Para validar os 10 cenários via linha de comando:

```powershell
cmd /c "npx --prefix back-end tsx qa-demo-us10/test-cenarios.ts"
```

Para validar a integridade das rotas HTTP e endpoints da demonstração:

```powershell
cmd /c "npx --prefix back-end tsx qa-demo-us10/test-http.ts"
```

Para executar toda a suíte de testes do projeto (108 testes):

```powershell
cd back-end; npm test
```

---

## 6. Roteiro de Capturas de Tela para o Trello

A interface foi projetada para permitir capturas de tela nítidas e enquadradas para cada evidência solicitada no Trello:

---

### 📸 Print 1 — Visão Geral e Painel de Indicadores (v1.7)
* **Objetivo:** Comprovar a cobertura total da US-10 com 100% de conformidade no banco SQLite isolado.
* **O que enquadrar:**
  * Topbar: Badges `QA EVIDENCE • US-10`, `SQLite :memory: (Isolado)` e branch `feat/us-10-verbas-avulsas`.
  * Cards de KPI: 10 Cenários Avaliados, 10 Critérios Aprovados, 0 Reprovados, 0 Não Executados e Status **100% CONFORME**.
  * Barra de Ações Rápidas com botões *"▶ Executar Todos os Cenários"* e abas de filtro *"Todos (10)"*, *"Aprovados (10)"*.
* **Legenda sugerida para o Trello:**
  > *"Dashboard de demonstração de QA da US-10 (Spec v1.7) operando em ambiente isolado SQLite in-memory: 10 cenários avaliados e 10 critérios aprovados com 100% de conformidade técnica."*

---

### 📸 Print 2 — Provento e Desconto Manual (RN-25)
* **Objetivo:** Evidenciar o registro de provento avulso e desconto manual com descrições preservadas e valores positivos.
* **O que enquadrar:**
  * **Card #1:** *"Cadastro de Provento Manual com Descrição e Valor"* com badge `✔ APROVADO`, detalhando a gravação do Bônus de R$ 500,00 e o JSON de retorno.
  * **Card #2:** *"Cadastro de Desconto Manual com Descrição Individualizada"* com badge `✔ APROVADO`, detalhando a Pensão Alimentícia Judicial de R$ 350,00.
* **Legenda sugerida para o Trello:**
  > *"Critérios 1 e 2 APROVADOS: Lançamento de provento avulso e desconto manual com descrição individualizada e valores positivos conforme RN-25."*

---

### 📸 Print 3 — Desacoplamento das Bases Tributárias (Tabela 7.4)
* **Objetivo:** Demonstrar que as bases de INSS, IRRF e FGTS são independentes e respeitam cada marcação individual.
* **O que enquadrar:**
  * **Card #3:** Incidência exclusiva em INSS (Base INSS = R$ 3.500,00; IRRF e FGTS = R$ 3.000,00).
  * **Card #4:** Incidência exclusiva em IRRF (Rendimento IRRF = R$ 2.800,00; INSS e FGTS = R$ 2.200,00).
  * **Card #5:** Incidência exclusiva em FGTS (Base FGTS = R$ 2.600,00 gerando encargo de R$ 208,00; INSS e IRRF = R$ 2.200,00).
* **Legenda sugerida para o Trello:**
  > *"Critérios 3, 4 e 5 APROVADOS: Desacoplamento das bases tributárias validado conforme a Tabela 7.4. Cada marcação de incidência afeta estritamente o respectivo tributo."*

---

### 📸 Print 4 — Validações de Entrada e Bloqueio de Competência
* **Objetivo:** Comprovar as travas de integridade de dados e respeito ao ciclo de vida da competência.
* **O que enquadrar:**
  * **Card #7:** *"Rejeição de Descrição Vazia e Valores Inválidos"* com as mensagens de bloqueio capturadas.
  * **Card #8:** *"Bloqueio de Lançamento em Competência Calculada ou Fechada"* exibindo a rejeição para competências que não estão em situação `ABERTA`.
* **Legenda sugerida para o Trello:**
  > *"Critérios 7 e 8 APROVADOS: Validações de campo obrigatório e bloqueio rigoroso em competências fechadas ou calculadas conforme RN-25 e Tabela 7.5."*

---

### 📸 Print 5 — Simulador Interativo e Memória de Cálculo em Tempo Real
* **Objetivo:** Demonstrar a interação do usuário ao registrar uma verba e auditar a memória de cálculo gerada pelo backend.
* **O que enquadrar:**
  * Seção *"Simulador Interativo de Verbas Avulsas e Memória de Cálculo"*.
  * Painel esquerdo: Formulário preenchido (Colaborador, Tipo, Descrição, Valor R$ e checkboxes de incidência).
  * Painel direito: Cards de bases apuradas (Base INSS, Rend. Trib. IRRF, Base FGTS), faixa de totais financeiros e tabela discriminada com o provento avulso inserido.
* **Legenda sugerida para o Trello:**
  > *"Simulador Interativo da US-10: Lançamento de verba avulsa manual com reflexo imediato nas bases tributárias e discriminação na memória de cálculo oficial (RN-02)."*

---

### 📸 Print 6 — Tabela ao Vivo do SQLite com Badges de Incidência
* **Objetivo:** Comprovar a persistência física das marcações tributárias na tabela `eventos` do SQLite.
* **O que enquadrar:**
  * Seção *"Eventos de Verbas Avulsas no SQLite (:memory:)"*.
  * Tabela com colunas ID, Colaborador, Competência, Natureza, Descrição, Valor R$ e badges coloridos: `INSS: SIM`, `IRRF: SIM`, `FGTS: SIM` (ou `NÃO`).
* **Legenda sugerida para o Trello:**
  > *"Persistência real no SQLite: Tabela de eventos gravando proventos e descontos manuais com integridade de dados e sinalizadores de incidência rastreáveis."*

---

### 📸 Print 7 — Suíte Completa de Testes Automatizados no Terminal
* **Objetivo:** Comprovar a ausência de regressões em todo o projeto.
* **O que enquadrar:**
  * Terminal executando `npm test` na pasta `back-end`, evidenciando `ℹ pass 108`, `ℹ fail 0`, incluindo os 10 testes específicos da US-10.
* **Legenda sugerida para o Trello:**
  > *"Validação Técnica: Suíte completa com 108 testes automatizados aprovados (0 falhas) em ~6,9 segundos, garantindo conformidade com a Spec v1.7."*
