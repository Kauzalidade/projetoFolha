# Relatório de Evidências Técnicas — US-10: Registro de Proventos e Descontos Manuais (Verbas Avulsas)

**Projeto:** Sistema de RH e Folha de Pagamento  
**Especificação:** v1.7 (`docs/spec.md`)  
**História de Usuário:** US-10 — Registro de Proventos e Descontos Manuais  
**Regras de Negócio Relacionadas:** RN-25, RN-26, RN-27 e Tabela 7.4  
**Branch:** `feat/us-10-verbas-avulsas`  
**Data:** 17/11/2026  
**Responsável Técnico:** Antigravity / GTI 2º Período  
**Status da US-10:** ✅ Concluída com Sucesso (108/108 testes automatizados aprovados)

---

## 1. Contexto e Objetivos

A história de usuário **US-10** tem como objetivo permitir ao analista de Recursos Humanos lançar proventos e descontos manuais (verbas avulsas) na folha de pagamento para contemplar situações e adicionais que não são calculados de forma automática nesta versão do sistema (conforme Seção 2 da especificação: adicional noturno, insalubridade, periculosidade, comissões, pensão alimentícia, empréstimo consignado, assistência médica, adiantamentos, etc.).

### Critérios Essenciais Atendidos:
1. **Campos Obrigatórios e Validações:** Descrição obrigatória não vazia, valor estritamente positivo (maior que zero), natureza (`PROVENTO` ou `DESCONTO`), e três marcações booleanas independentes de incidência (`incide_inss`, `incide_irrf`, `incide_fgts`).
2. **Ciclo de Vida da Competência (RN-25 e Tabela 7.5):** Lançamento permitido exclusivamente em competência com situação `ABERTA`. Bloqueio com erro explicativo caso a competência esteja `FECHADA` ou `CALCULADA`.
3. **Independência das Bases Tributárias (RN-26 e Tabela 7.4):** A apuração de cada tributo (INSS, IRRF e FGTS) respeita estritamente suas próprias marcações de incidência na verba avulsa, sem presumir igualdade entre as bases tributárias.
4. **Discriminação na Memória de Cálculo (RN-02 e RN-25):** Cada provento e desconto manual figura individualmente na memória de cálculo e no contracheque, preservando seu nome descritivo (ex.: *"Pensão Alimentícia"*, *"Empréstimo Consignado"*, *"Adicional de Insalubridade 20%"*), sua base de cálculo e a regra legal aplicada.
5. **Integração na Interface Web:** Formulário de lançamento interativo e tabela de conferência de verbas avulsas na aba *Eventos*, e painel modal de *Memória de Cálculo Detalhada* na aba *Folha de Pagamento*.

---

## 2. Matriz de Rastreabilidade e Critérios de Aceite

| ID Critério | Descrição do Requisito | Regra / Seção | Status | Evidência / Teste |
|:---|:---|:---:|:---:|:---|
| **CR-10.1** | Descrição obrigatória e valor maior que zero | RN-25 | ✅ Aprovado | Cenário 6 (`us10_verbas_avulsas.test.ts`) |
| **CR-10.2** | Três marcações independentes de incidência (INSS, IRRF, FGTS) | RN-25 / Tab 7.4 | ✅ Aprovado | Cenários 1, 2, 3 e 4 |
| **CR-10.3** | Lançamento restrito a competências com status `ABERTA` | RN-25 / Tab 7.5 | ✅ Aprovado | Cenário 7 |
| **CR-10.4** | Provento com incidência isolada de INSS afeta apenas base do INSS | RN-26 / Tab 7.4 | ✅ Aprovado | Cenário 1 |
| **CR-10.5** | Provento com incidência isolada de IRRF afeta apenas base do IRRF | RN-26 / Tab 7.4 | ✅ Aprovado | Cenário 2 |
| **CR-10.6** | Provento com incidência isolada de FGTS afeta apenas base do FGTS (encargo) | RN-24, RN-26 | ✅ Aprovado | Cenário 3 |
| **CR-10.7** | Provento sem incidências soma ao bruto sem onerar tributos | RN-25, RN-26 | ✅ Aprovado | Cenário 4 |
| **CR-10.8** | Descontos manuais exibidos com descrição própria na memória | RN-02, RN-25 | ✅ Aprovado | Cenários 5 e 10 |
| **CR-10.9** | Controle de acesso: apenas perfil `RH` pode lançar verbas avulsas | Tabela 4.1 | ✅ Aprovado | Cenário 8 |
| **CR-10.10**| Persistência e integridade das marcações no banco SQLite | Modelo 2.1 | ✅ Aprovado | Cenário 9 |
| **CR-10.11**| Preservação e não regressão de toda a suíte pré-existente (Etapas 1 a 4) | Arquitetura | ✅ Aprovado | 98 testes anteriores passaram sem alteração |

---

## 3. Comandos Executados e Resultados Técnicos

### 3.1. Verificação de Tipagem TypeScript

```powershell
cd back-end
npx tsc --noEmit
```
**Resultado:** Código de retorno `0`. Zero avisos ou erros de compilação TypeScript em modo estrito (`strict: true`).

### 3.2. Execução da Suíte Completa de Testes Automatizados

```powershell
cd back-end
npm test
```

**Resultado Consolidado:**
```text
> rh-folha-backend@1.0.0 test
> tsx --test tests/*.test.ts

▶ ETAPA 1: Login, Perfis, Filiais, Colaboradores, Parâmetros e Feriados (17 testes) ... ✔ (4212ms)
▶ ETAPA 2: Lançamento de Eventos (Horas Extras, Faltas, Atestados, VT, VA e Verbas Avulsas) (16 testes) ... ✔ (3475ms)
▶ ETAPA 3: Cálculo da Folha, Memória de Cálculo e Fechamento Seguro (10 testes) ... ✔ (1502ms)
▶ ETAPA 4: Férias, 13º Salário, Documentos, Alertas, Contracheque e Relatórios (18 testes) ... ✔ (4392ms)
▶ ETAPA v1.7: Requisitos e Critérios de Aceite Avançados (RN-59 a RN-85) (30 testes) ... ✔ (6036ms)
▶ RN-20: Proporcionalidade Salarial na Admissão e Desligamento (Base 30 avos) (3 testes) ... ✔ (570ms)
▶ Caracterização de Casos de Borda da RN-20 (Meses de 31, 28 e 29 dias - Pendência P-05) (4 testes) ... ✔ (567ms)
▶ US-10: Registro de Proventos e Descontos Manuais (Verbas Avulsas - RN-25 a RN-27) (10 testes) ... ✔ (2154ms)

ℹ tests 108
ℹ suites 8
ℹ pass 108
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 6811.2111
```

---

## 4. Análise de Limitações e Proposta: Exclusão/Estorno de Eventos

### 4.1. Diagnóstico da Especificação (Spec v1.7)
Em consonância com as instruções da tarefa, foi efetuada uma checagem rigorosa na especificação técnica (`docs/spec.md`) sobre a exclusão de eventos/verbas avulsas.
- **Constatação:** A especificação v1.7 **não prevê nem autoriza a exclusão física de eventos** de competência. A Seção 2.1 e Seção 5.3 tratam apenas da criação e inclusão de eventos na competência aberta.
- **Motivação Regulatória:** A legislação trabalhista e as normas de governança e auditoria (RNF-03, RN-71) determinam a imutabilidade dos registros operacionais para prevenir fraudes contábeis e fiscais.
- **Diretriz Adotada:** Em estrito cumprimento aos requisitos, **nenhum mecanismo de exclusão física ou automática foi implementado**.

### 4.2. Proposta Técnica de Melhoria para Próxima Versão (Spec v1.8)
Recomenda-se apresentar ao Product Owner e à Diretoria a seguinte proposta formal:
1. **Lançamento de Contrapartida (Estorno Contábil):** Para anular uma verba avulsa incorreta, o RH realiza um novo lançamento de natureza oposta (ex.: se foi lançado um provento indevido de R$ 500,00, lança-se um desconto compensatório de R$ 500,00 com observação de estorno).
2. **Cancelamento Lógico (Soft-Delete com Justificativa):** Adicionar um campo `cancelado_em` e `motivo_cancelamento` na tabela `eventos`. O evento cancelado permanece no banco de dados e é gravado no log de auditoria (`logs_auditoria`), deixando de ser somado pelo `folhaService.ts`.

---

## 5. Roteiro Passo a Passo para Coleta de Prints no Trello

Para coletar as evidências visuais solicitadas pelo Trello, siga o procedimento abaixo executando o servidor web real do sistema.

### 5.1. Inicialização do Servidor da Aplicação
No terminal do Windows PowerShell:
```powershell
cd c:\Users\User\Desktop\projetoFolha-limpo\back-end
npx.cmd tsx src/server.ts
```
O servidor iniciará em `http://localhost:3000`.

Abra o navegador no endereço `http://localhost:3000` e faça login com perfil de RH:
- **E-mail:** `rh@empresa.com`
- **Senha:** `rh123456`

---

### 5.2. Guia de Captura de Imagens para os Cards do Trello

#### 📸 Print 1: Formulário de Lançamento de Verba Avulsa
- **Onde Navegar:** Clique na aba **"Lançamento de Eventos (Etapa 2)"**.
- **Ação:** No card roxo **"Lançar Verba Avulsa (Proventos e Descontos Manuais — US-10 / RN-25)"**:
  - Selecione o Colaborador (ex.: *Ana Souza*).
  - Competência: selecione uma competência aberta (ex.: *10/2026* ou *11/2026*).
  - Descrição: digite `Adicional de Insalubridade 20%`.
  - Tipo / Natureza: selecione `➕ PROVENTO`.
  - Valor: digite `400.00`.
  - Marque os checkboxes de incidência: `[X] Incide INSS`, `[X] Incide IRRF` e `[X] Incide FGTS`.
- **Enquadramento do Print:** Capture o formulário preenchido com destaque para os checkboxes independentes de incidência.

#### 📸 Print 2: Provento Registrado com suas Incidências
- **Ação:** Clique no botão azul **"Lançar Verba Avulsa"**. Aguarde o aviso de sucesso.
- **Onde Navegar:** Veja a tabela abaixo do formulário intitulada **"Verbas Avulsas Cadastradas na Competência Selecionada"**.
- **Enquadramento do Print:** Capture a linha inserida exibindo:
  - Descrição: *Adicional de Insalubridade 20%*
  - Natureza: *➕ PROVENTO*
  - Valor: *R$ 400,00*
  - Incidências com badges coloridos: `INSS: SIM`, `IRRF: SIM`, `FGTS: SIM`.

#### 📸 Print 3: Desconto Manual Registrado
- **Ação:** No mesmo formulário de verbas avulsas:
  - Selecione o colaborador.
  - Descrição: digite `Pensão Alimentícia Judicial`.
  - Tipo / Natureza: selecione `➖ DESCONTO`.
  - Valor: digite `350.00`.
  - Desmarque as incidências (ou mantenha apenas dedução de IRRF conforme determinação).
  - Clique em **"Lançar Verba Avulsa"**.
- **Enquadramento do Print:** Capture a tabela de verbas listando o provento e o desconto manual lado a lado, comprovando a personalização da descrição.

#### 📸 Print 4: Bloqueio de Competência Fechada / Calculada
- **Ação:** 
  1. Vá até a aba **"Folha de Pagamento (Etapa 3)"**, selecione a competência e execute o cálculo e fechamento, ou selecione uma competência já fechada no seletor da aba de eventos.
  2. Tente submeter o formulário de lançamento de verba avulsa.
- **Enquadramento do Print:** Capture a notificação em vermelho (toast / alerta) exibindo a mensagem de bloqueio:
  `"Não é permitido lançar verbas avulsas em competência fechada ou calculada. Situação atual: FECHADA/CALCULADA."`

#### 📸 Print 5: Memória de Cálculo com Verbas Discriminadas
- **Ação:**
  1. Acesse a aba **"Folha de Pagamento (Etapa 3)"**.
  2. Clique em **"Calcular Folha Desta Competência"**.
  3. Na tabela **"Folha Analítica da Competência"**, localize o colaborador e clique no botão azul **"📋 Memória"**.
- **Enquadramento do Print:** Capture o card detalhado que se abre abaixo (**"📋 Memória de Cálculo Detalhada por Verba (RN-02)"**), demonstrando:
  - Linha do provento avulso (*Adicional de Insalubridade 20%*) com a base e valor.
  - Linha do desconto manual (*Pensão Alimentícia Judicial*) discriminado com seu valor.
  - Verbas oficiais (Salário-base, INSS, IRRF, FGTS Encargo).
  - Totais de proventos, descontos, líquido e FGTS encargo consistentes.

#### 📸 Print 6: Resultado dos Testes Automatizados no Terminal
- **Ação:** No terminal, execute:
  ```powershell
  cd back-end; npx tsx --test tests/us10_verbas_avulsas.test.ts
  ```
- **Enquadramento do Print:** Capture o terminal demonstrando todos os 10 testes específicos da US-10 aprovados com 100% de sucesso.

---

## 6. Arquivos Modificados e Criados

| Arquivo | Natureza | Descrição das Modificações |
|:---|:---:|:---|
| `back-end/src/services/eventoService.ts` | Modificado | Validações de descrição, valor positivo, competência aberta e função `listarEventos`. |
| `back-end/src/services/folhaService.ts` | Modificado | Decoplamento das bases tributárias de INSS, IRRF e FGTS para respeitar incidências individuais da Tabela 7.4; inserção individualizada de proventos e descontos manuais na memória de cálculo com descrição própria. |
| `back-end/src/server.ts` | Modificado | Rotas `/api/eventos` e `/api/folha/memoria`; interface web completa com formulário de verbas avulsas, tabela de acompanhamento e modal interativo de memória de cálculo detalhada. |
| `back-end/tests/us10_verbas_avulsas.test.ts` | Novo | Suíte com 10 cenários automatizados cobrindo exaustivamente todas as exigências da US-10. |
| `prompts/01_testes/evidencias-us10.md` | Novo | Relatório técnico e guia visual de evidências para o Trello. |
