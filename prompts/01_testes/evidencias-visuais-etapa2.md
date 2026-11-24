# Evidências Visuais e Demonstração de QA — US-02 (Spec v1.7)

**Repositório:** `Kauzalidade/projetoFolha`  
**Branch:** `testes/demo-etapa2-v17`  
**História de Usuário:** US-02 — Lançamento de Eventos Mensais (Horas Extras, Faltas, Atestados, VT, VA e Bloqueios)  
**Versão da Especificação:** v1.7  
**Ambiente de Execução:** Servidor HTTP Node.js isolado (`qa-demo/server.ts`) com SQLite nativo em memória (`node:sqlite`)  
**Data da Revisão:** 14/11/2026  
**Status Consolidado:** 5 Critérios Aprovados, 3 Critérios Reprovados contra a Spec v1.7 (RN-65, RN-81, RN-66) e 5 Lacunas Não Contempladas mapeadas.  

---

## 1. Resumo Executivo da Demonstração

Este documento consolida a revisão final da suíte de demonstração visual de QA desenvolvida na pasta `qa-demo/` para validação formal dos critérios de aceite da **US-02 (Lançamento de Eventos Mensais)** do Sistema de RH e Folha de Pagamento.

A interface gráfica web ([http://localhost:3000/](http://localhost:3000/)) comunica-se em tempo real com as funções oficiais em `back-end/src/services/` sobre uma base de dados SQLite isolada em memória (`:memory:`), assegurando fidelidade com o código de produção sem impactar dados persistidos em disco.

### 1.1 Resolução do Problema Anterior ("Arquivo não encontrado")

Na faculdade, o acesso a `http://localhost:3000/` falhava por conta de caminhos relativos ao terminal (`process.cwd()`). O problema foi sanado com:
* Resolução estrita do diretório estático através de `fileURLToPath(import.meta.url)` e `path.resolve(__dirname, 'public')`;
* Rota raiz `/` configurada para servir `qa-demo/public/index.html` com `Content-Type: text/html; charset=utf-8`;
* Entrega íntegra de `style.css` e `app.js` verificada pelo script de teste automatizado [`qa-demo/test-http.ts`](file:///c:/Users/User/Desktop/projetoFolha-limpo/qa-demo/test-http.ts).

---

## 2. Matriz de Resultados dos Oito Cenários de Aceite (Spec v1.7)

Os testes foram executados diretamente no backend. Os cenários 6, 7 e 8 foram formalmente classificados como **REPROVADOS** perante os requisitos da especificação v1.7, visto que a execução do código atual não atende às regras estabelecidas:

| # | Cenário de Teste | Regra v1.7 | Comportamento Esperado (Spec v1.7) | Comportamento Real Obtido do Backend | Resultado |
| :-: | :--- | :---: | :--- | :--- | :-: |
| **1** | Lançamento de Horas Extras 50% e 100% | **RN-30** | 2h útil = R$ 30,00; 2h domingo = R$ 40,00 (Salário R$ 2.200,00 / 220h) | Backend calculou exatamente R$ 30,00 e R$ 40,00 e persistiu os eventos na folha | **APROVADO** |
| **2** | Registro de Faltas e Cálculo do DSR | **RN-33** | 1 falta = Desconto Falta R$ 100,00 + Perda DSR R$ 100,00 (Salário R$ 3.000,00) | Backend calculou R$ 100,00 de falta e R$ 100,00 de perda de 1 DSR semanal (total R$ 200,00) | **APROVADO** |
| **3** | Registro de Atestados e Proteção LGPD | **RN-33<br>RN-54<br>RNF-21** | Atestado válido não desconta salário/DSR. Perfil Diretoria bloqueado de ver saúde | Status `ATESTADO_REGISTRADO_SEM_DESCONTO`. Acesso da Diretoria negado e log gravado | **APROVADO** |
| **4** | Vale-Transporte (Menor 6% vs Custo) | **RN-50** | Desconto é o menor entre 6% do salário e o custo. Não optante tem desconto zero | Custo R$ 180 &rarr; R$ 132 (6%); Custo R$ 90 &rarr; R$ 90; Não optante &rarr; R$ 0,00 | **APROVADO** |
| **5** | Bloqueio de Competência Fechada | **RN-04** | Bloquear qualquer inclusão/alteração em competência com situação `FECHADA` | Operação rejeitada com a exceção: `"Esta competência está fechada. Para alterar, reabra informando a justificativa."` | **APROVADO** |
| **6** | Tentativa de Lançamento Duplicado | **RN-65** | Detectar possível duplicidade e solicitar confirmação, garantindo que reenvios ou duplo clique não gerem registros duplicados | **O backend não implementa a RN-65**: aceitou a inserção do 2º registro idêntico sem detectar duplicidade e sem solicitar confirmação | **REPROVADO** |
| **7** | Tentativa de Lançamento Durante Férias | **RN-81** | Rejeitar eventos incompatíveis com férias, afastamento ou desligamento | **O backend não implementa a RN-81**: o serviço `lancarHorasExtras` não cruza dados com a tabela `ferias` e persistiu 2h extras para colaboradora de férias | **REPROVADO** |
| **8** | Horas Extras Superiores a 2 Horas no Dia | **RN-66** | O sistema deve emitir aviso e solicitar confirmação, mas não bloquear automaticamente o lançamento | **O backend não implementa a RN-66**: aceitou diretamente 4h extras diárias sem emitir qualquer aviso e sem solicitar confirmação | **REPROVADO** |

---

## 3. Lacunas da US-02 Não Contempladas nos Oito Cenários

Além dos 8 cenários executados pela interface, a análise da especificação v1.7 revela critérios e eventos do ciclo da **US-02** que ainda não possuem suporte completo ou cobertura de testes no backend:

| ID | Tema / Critério | Regra | Diagnóstico Técnico no Código Atual | Impacto na Folha de Pagamento |
| :---: | :--- | :---: | :--- | :--- |
| **LAC-01** | **Atrasos e Saídas Antecipadas** | US-02 / CLT art. 58 | O schema SQLite e os serviços de evento da Etapa 2 tratam exclusivamente faltas integrais (`FALTA_INJUSTIFICADA`). Não há cálculo para descontos fracionados em minutos ou frações de horas. | Impossibilidade de apurar pontualidade com precisão; qualquer atraso parcial precisa ser ignorado ou transformado artificialmente em dia inteiro de falta. |
| **LAC-02** | **Afastamentos Temporários e Previdenciários** | RN-34 / Pendência P-03 | Afastamentos por doença (>15 dias pelo INSS), acidente, maternidade ou paternidade não possuem rotina de lançamento no `eventoService.ts` nem regra de suspensão salarial automática após o 15º dia. | Risco de pagar salário integral em períodos cobertos pelo INSS ou de calcular encargos indevidos durante a suspensão contratual. |
| **LAC-03** | **Vale-Alimentação (VA)** | RN-51 | Embora o tipo `VALE_ALIMENTACAO` exista no `CHECK` da tabela `eventos` no schema, inexiste qualquer função `lancarValeAlimentacao` no `eventoService.ts` (apenas o VT foi implementado). | O benefício de alimentação (valor mensal fixo com coparticipação padrão de 0%) não pode ser lançado via serviços oficiais. |
| **LAC-04** | **Rastreabilidade Completa de Eventos** | US-02 / RNF-03 | A US-02 determina que "Evento fica salvo com usuário e data". A tabela `eventos` grava `criado_por_usuario_id` e `criado_em`, mas os métodos `lancarHorasExtras`, `lancarFaltaInjustificada` e `lancarValeTransporte` NÃO gravam logs na tabela `logs_auditoria` (apenas atestados geram log). | Dificuldade de auditoria para identificar histórico de lançamentos e alterações em conformidade com o RNF-03. |
| **LAC-05** | **Validação de Vínculo Contratual Ativo** | RN-12 / RN-15 | Os serviços de lançamento consultam apenas se o colaborador existe (`SELECT id ... WHERE id = ?`), mas não validam se `situacao = 'ATIVO'`, nem se a data do evento ocorre após o desligamento ou antes da admissão. | Possibilidade de lançar horas extras, faltas ou benefícios para colaboradores já inativados ou desligados da empresa. |

---

## 4. Detalhamento dos Cenários e Roteiro para Capturas de Tela (Trello / Professor)

Utilize as orientações abaixo para capturar as telas de evidência para o Trello:

---

### Print 1 — Visão Geral do Dashboard e Indicadores da US-02
* **Objetivo:** Comprovar a interface em execução local ([http://localhost:3000/](http://localhost:3000/)), ambiente SQLite isolado em memória (`:memory:`) e o placar oficial de **5 Aprovados e 3 Reprovados**.
* **Elementos a enquadrar:**
  * Topbar: badges `QA EVIDENCE — US-02`, `SQLite :memory: (Isolado)` e branch `testes/demo-etapa2-v17`.
  * Cards de KPI: 8 Cenários, 5 Aprovados (verde), 3 Reprovados (vermelho) e Status "PRONTO".
  * Barra de ações com os botões e abas de filtro ("Todos", "Aprovados", "Reprovados").
* **Legenda sugerida para o Trello:**
  > *"Dashboard de demonstração de QA da US-02 (Spec v1.7) operando em ambiente isolado SQLite in-memory. Validação de 8 cenários com rigor técnico: 5 critérios aprovados e 3 reprovados."*

---

### Print 2 — Critério 1: Horas Extras de 50% e 100% (RN-30)
* **Objetivo:** Evidenciar o cálculo da sobrejornada em dia útil e em domingo/feriado.
* **Cálculo Base:**
  * Colaboradora: Ana Souza (Salário R$ 2.200,00 | 220h | R$ 10,00/h).
  * 2h Dia Útil (50%): \(2 \times 10,00 \times 1,5 = \text{R\$}~30,00\).
  * 2h Domingo (100%): \(2 \times 10,00 \times 2,0 = \text{R\$}~40,00\).
* **Elementos a enquadrar:** Card #1 com badge `✔ APROVADO`, comparativo esperado vs obtido e JSON de retorno.
* **Legenda sugerida para o Trello:**
  > *"Critério 1 APROVADO: Cálculo de horas extras a 50% (R$ 30,00) e 100% (R$ 40,00) validado conforme RN-30."*

---

### Print 3 — Critério 2: Falta Injustificada e Perda do DSR (RN-33)
* **Objetivo:** Comprovar o débito da falta e a perda de 1 DSR semanal correspondente.
* **Cálculo Base:**
  * Colaborador: Bruno Santos (Salário R$ 3.000,00 | R$ 100,00/dia).
  * Desconto falta: \(\frac{3.000}{30} \times 1 = \text{R\$}~100,00\).
  * Desconto DSR: \(\frac{3.000}{30} \times 1 = \text{R\$}~100,00\).
* **Elementos a enquadrar:** Card #2 com badge `✔ APROVADO` e valores destacados.
* **Legenda sugerida para o Trello:**
  > *"Critério 2 APROVADO: Falta injustificada debitando R$ 100,00 de salário e R$ 100,00 de DSR conforme a RN-33."*

---

### Print 4 — Critério 3: Atestado Médico e Proteção LGPD (RN-33 / RN-54)
* **Objetivo:** Comprovar ausência de descontos salariais e bloqueio de acesso a dados de saúde para o perfil Diretoria.
* **Elementos a enquadrar:** Card #3 com badge `✔ APROVADO`, `ATESTADO_REGISTRADO_SEM_DESCONTO` e confirmação do bloqueio LGPD com log gravado.
* **Legenda sugerida para o Trello:**
  > *"Critério 3 APROVADO: Atestado registrado sem descontos e barreira LGPD de dados de saúde validada contra a Diretoria."*

---

### Print 5 — Critério 4: Vale-Transporte (RN-50)
* **Objetivo:** Comprovar a regra do menor entre 6% do salário e o custo informado nos 3 casos de teste.
* **Elementos a enquadrar:** Card #4 com badge `✔ APROVADO` exibindo os casos R$ 132,00 (teto 6%), R$ 90,00 (limitado ao custo) e R$ 0,00 (não optante).
* **Legenda sugerida para o Trello:**
  > *"Critério 4 APROVADO: Vale-Transporte aplicando o menor valor entre 6% e o custo (RN-50)."*

---

### Print 6 — Critério 5: Bloqueio de Competência Fechada (RN-04)
* **Objetivo:** Comprovar a trava que impede lançamentos em competência encerrada (`2026-09`).
* **Elementos a enquadrar:** Card #5 com badge `✔ APROVADO` e mensagem da exceção capturada.
* **Legenda sugerida para o Trello:**
  > *"Critério 5 APROVADO: Bloqueio de competência fechada ativo (RN-04), garantindo imutabilidade da folha."*

---

### Print 7 — Cenários Reprovados: RN-65, RN-81 e RN-66
* **Objetivo:** Demonstrar a integridade técnica da avaliação de QA, evidenciando as não conformidades encontradas na execução real do backend.
* **Elementos a enquadrar:** Cards #6, #7 e #8 com badges vermelhas `✖ REPROVADO`:
  * **Card 6 (RN-65):** Inserção de evento duplicado sem detecção nem solicitação de confirmação;
  * **Card 7 (RN-81):** Falta de rejeição de eventos de jornada durante gozo de férias ativas;
  * **Card 8 (RN-66):** Ausência de emissão de aviso e confirmação para sobrejornada superior a 2h diárias.
* **Legenda sugerida para o Trello:**
  > *"Auditoria de QA — Cenários Reprovados na v1.7: O backend não implementa a confirmação de duplicidade (RN-65), a rejeição em férias (RN-81) e o aviso de limite diário de horas extras (RN-66)."*

---

### Print 8 — Lacunas da US-02 e Tabela ao Vivo do SQLite
* **Objetivo:** Apresentar as 5 lacunas conceituais mapeadas da US-02 e a persistência real dos dados no banco in-memory.
* **Elementos a enquadrar:** Seção de Lacunas da US-02 (LAC-01 a LAC-05) e tabela `eventos` com IDs e valores gravados.
* **Legenda sugerida para o Trello:**
  > *"Mapeamento de lacunas da US-02 e listagem em tempo real dos eventos persistidos no SQLite isolado."*

---

## 5. Instruções para Executar e Testar Localmente

Para iniciar o servidor localmente:

```powershell
# A partir da raiz do repositório
cmd /c "npx --prefix back-end tsx qa-demo/server.ts"
```

Acesse [http://localhost:3000/](http://localhost:3000/) no navegador.
