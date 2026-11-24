# Evidências Visuais e Demonstração de QA — US-12 (Spec v1.7)

**Repositório:** `projetoFolha`  
**Branch:** `feat/us-12-gestao-usuarios`  
**História de Usuário:** US-12 — Gestão de Usuários e Perfis  
**Versão da Especificação:** v1.7 (`docs/spec.md`)  
**Regras de Negócio e Requisitos Centrais:** Seção 4 (Tabela 4.1), RN-12, RN-15, RNF-01, RNF-02, RNF-03, RNF-19  
**Ambiente de Execução da Demonstração:** Servidor HTTP Node.js dedicado (`qa-demo-us12/server.ts`) com SQLite nativo em memória (`node:sqlite`)  
**Data da Homologação:** 17/11/2026  
**Status Consolidado:** ✅ **12 Critérios de Aceite Aprovados (100% Conforme)** contra a Spec v1.7; Zero Reprovações.

---

## 1. Resumo Executivo da Demonstração

Este documento consolida as evidências técnicas e visuais de Garantia da Qualidade (QA) da **US-12 — Gestão de Usuários e Perfis**, pertencente à **Etapa 1** do Sistema de RH e Folha de Pagamento.

A implementação atende com rigor técnico absoluto à Especificação de Requisitos v1.7 (`docs/spec.md`) e às diretrizes em `back-end/AGENTS.md`. Para assegurar a auditabilidade independente sem poluir o banco de produção nem interferir em branches paralelas (ex.: `feat/us-10-verbas-avulsas`), foi criado o portal web interativo em **`qa-demo-us12/`**, operando em `http://localhost:3012/` com base SQLite isolada em memória (`:memory:`).

### Destaques da Implementação Técnica:
1. **Controle de Acesso Baseado em Perfis no Backend (RBAC - Seção 4 / Tabela 4.1):** As permissões são aplicadas e validadas diretamente nos serviços e rotas HTTP do backend, impedindo que requisições contornem a interface:
   - **ADMIN:** Exclusividade na criação, inativação, redefinição de senha e consulta de logs; bloqueio imperativo e registro de tentativa em log caso tente acessar dados da folha ou de colaboradores.
   - **DIRETORIA:** Consulta autorizada de relatórios, folhas e logs; bloqueio estrito em alterações cadastrais, lançamentos de eventos e fechamento da folha.
   - **RH:** Operação completa de cadastro de pessoal, eventos e cálculo da folha; bloqueio no acesso a logs de auditoria e na gestão de usuários.
2. **Criptografia e Histórico das Últimas 3 Senhas (RNF-01 / US-12):** Senhas armazenadas com algoritmo de derivação de chave criptográfica `scrypt` com salt aleatório individual de 16 bytes. Tabela dedicada `historico_senhas` armazena os hashes históricos, impedindo estritamente a reutilização de qualquer uma das últimas 3 senhas. Senhas em texto puro e hashes nunca são expostos.
3. **Segundo Fator de Autenticação (2FA - US-12):** Login em duas etapas reais: 1ª etapa valida e-mail/senha e emite um desafio temporário criptográfico (5 minutos de validade); o código numérico de 6 dígitos é despachado via canal out-of-band simulado; 2ª etapa valida o código via `timingSafeEqual` e emite a sessão de 30 minutos.
4. **Bloqueio por Tentativas (RNF-19):** Após 5 tentativas consecutivas de senha incorreta, o acesso ao e-mail é temporariamente bloqueado por 15 minutos, rejeitando até mesmo a senha correta durante a vigência do bloqueio.
5. **Encerramento Imediato de Sessões Existentes (US-12):** A redefinição de senha ou a inativação de um usuário invalida e encerra na hora todas as sessões ativas do colaborador no sistema.

---

## 2. Matriz de Resultados dos 12 Cenários de Aceite (Spec v1.7)

Todos os 12 critérios foram auditados e aprovados invocando diretamente os serviços do backend sobre fixtures SQLite em memória:

| # | Cenário de Aceite | Requisito / Regra | Comportamento Esperado (Spec v1.7) | Comportamento Efetivamente Observado no Backend | Status |
| :-: | :--- | :---: | :--- | :--- | :-: |
| **1** | Cadastro de Usuário Válido | **Seção 4<br>US-12** | ADMIN cadastra usuário com nome, e-mail válido, perfil autorizado e senha de pelo menos 10 caracteres alfanuméricos. | Usuário gravado na tabela `usuarios` com perfil RH/Diretoria/Admin, ativo=1 e histórico inicial em `historico_senhas`. | ✅ **APROVADO** |
| **2** | Validação de Formato e Unicidade de E-mail | **RN-15<br>US-12** | Rejeição imediata de e-mails sem `@`, sem domínio ou já cadastrados com mensagens explicativas. | Backend bloqueou e-mail malformado com *"Informe um e-mail válido."* e e-mail repetido com *"Já existe um usuário cadastrado com este e-mail."*. | ✅ **APROVADO** |
| **3** | Inativação Lógica e Revogação de Sessão | **RN-12<br>US-12** | Inativação sem exclusão física do banco (`ativo = 0`), revogação imediata de sessões ativas e bloqueio de novos logins. | Registro físico mantido no SQLite com `ativo = 0`, sessões encerradas no `security.ts` e novo login rejeitado com *"E-mail ou senha inválidos."*. | ✅ **APROVADO** |
| **4** | Redefinição de Senha e Invalidação de Sessões | **RNF-01<br>US-12** | Redefinição segura encerra todas as sessões existentes do usuário e atualiza a credencial. | Todas as sessões ativas do usuário são invalidadas (`validarSessao` retorna `null`), e login com senha antiga é rejeitado. | ✅ **APROVADO** |
| **5** | Histórico das Últimas 3 Senhas | **US-12** | Bloqueio de reutilização de senhas contidas no histórico das 3 últimas trocas; liberação após saída da janela. | Backend rejeitou reutilização da senha atual e das 2 anteriores com *"A nova senha não pode ser igual às últimas 3 senhas utilizadas."*; aprovou reuso após 4ª troca. | ✅ **APROVADO** |
| **6** | Hash de Senha com Salt (scrypt) | **RNF-01<br>US-12** | Senhas armazenadas com hash derivado via `scrypt` e salt aleatório de 16 bytes. Texto puro nunca é armazenado. | Hashes gerados no padrão `salt(32 hex):key(128 hex)`. Chaves derivadas idênticas para a mesma senha diferem devido aos salts aleatórios. | ✅ **APROVADO** |
| **7** | Segundo Fator de Autenticação (2FA) | **US-12** | 1ª etapa gera desafio e código out-of-band sem liberar sessão; 2ª etapa valida código de 6 dígitos e libera sessão ativa. | 1ª etapa emitiu `desafioToken`; código incorreto foi barrado; código correto homologou a sessão e emitiu token oficial de 30 min. | ✅ **APROVADO** |
| **8** | Bloqueio por 5 Tentativas (RNF-19) | **RNF-19<br>US-12** | 5 falhas consecutivas disparam bloqueio temporário de 15 minutos; tentativas subsequentes são barradas. | 4 falhas mantiveram a conta liberada; 5ª falha acionou bloqueio de 15 min; tentativa com senha correta foi negada durante o bloqueio. | ✅ **APROVADO** |
| **9** | Expiração de Sessão após 30 Minutos | **RNF-01<br>US-12** | Sessão inativa por mais de 30 minutos expira e é invalidada automaticamente. | Sessão com inatividade de 31 minutos foi descartada pelo backend; chamadas subsequentes retornaram `null` (HTTP 401). | ✅ **APROVADO** |
| **10** | Matriz de Permissões no Backend | **Seção 4<br>Tab. 4.1** | RH opera folha; Diretoria apenas consulta; Admin gerencia usuários e logs, sem ver dados da folha nem colaboradores. | Backend autorizou RH na folha e barrou na gestão de usuários; autorizou Diretoria em relatórios e barrou em alterações; barrou Admin na folha. | ✅ **APROVADO** |
| **11** | Auditoria Imutável de Operações | **RNF-03<br>US-12** | Criação, inativação e redefinição de senha são registradas no Log de Auditoria imutável (quem, quando, o quê). | Logs gravados com ações `CRIAR_USUARIO`, `REDEFINIR_SENHA` e `INATIVAR_USUARIO`. Triggers SQLite impedem UPDATE e DELETE nos logs. | ✅ **APROVADO** |
| **12** | Rejeição Direta de Requisições Não Autorizadas | **Seção 4<br>RNF-02** | Endpoints HTTP rejeitam requisições sem token (401) ou com perfil incompatível (403). | Requisições HTTP sem token retornaram 401; RH tentando acessar `/api/usuarios` retornou 403; Admin tentando calcular folha retornou 403. | ✅ **APROVADO** |

---

## 3. Arquivos Criados e Modificados

### Arquivos Modificados no Núcleo do Sistema:
- [`back-end/src/db.ts`](file:///c:/Users/User/Desktop/projetoFolha-limpo/back-end/src/db.ts): Inclusão da coluna `segundo_fator_ativo` na tabela `usuarios`, criação da tabela `historico_senhas` (para proteção das 3 últimas senhas) e da tabela `desafios_2fa` (para persistência de desafios temporários de autenticação).
- [`back-end/src/security.ts`](file:///c:/Users/User/Desktop/projetoFolha-limpo/back-end/src/security.ts): Implementação de `invalidarSessoesUsuario()`, `contarSessoesAtivasUsuario()`, utilitários criptográficos para código numérico de 6 dígitos do 2FA (`gerarCodigoNumerico2FA`, `gerarHashCodigo2FA`, `verificarCodigo2FA`) e buffer out-of-band simulado para homologação.
- [`back-end/src/services/usuarioService.ts`](file:///c:/Users/User/Desktop/projetoFolha-limpo/back-end/src/services/usuarioService.ts): Enriquecimento de `criarUsuario` (histórico de senha e flag 2FA), implementação completa de `redefinirSenha` (validação de histórico das 3 senhas e encerramento de sessões), `confirmarSegundoFator`, `configurarSegundoFator` e `listarUsuarios`.
- [`back-end/src/server.ts`](file:///c:/Users/User/Desktop/projetoFolha-limpo/back-end/src/server.ts): Adição das rotas `/api/usuarios` (GET/POST), `/api/usuarios/:id/inativar`, `/api/usuarios/:id/redefinir-senha`, `/api/usuarios/:id/2fa`, `/api/auth/2fa/confirmar` e blindagem das rotas de folha contra acesso do perfil ADMIN com registro de log.
- [`back-end/src/services/relatoriosService.ts`](file:///c:/Users/User/Desktop/projetoFolha-limpo/back-end/src/services/relatoriosService.ts): Registro de log imutável `ACESSO_NEGADO_FOLHA` quando perfil ADMIN tenta abrir relatórios da folha.

### Novos Arquivos de Teste e Demonstração:
- [`back-end/tests/us12_gestao_usuarios.test.ts`](file:///c:/Users/User/Desktop/projetoFolha-limpo/back-end/tests/us12_gestao_usuarios.test.ts): Suíte com 12 cenários automatizados cobrindo exaustivamente todos os critérios de aceite da US-12.
- [`qa-demo-us12/package.json`](file:///c:/Users/User/Desktop/projetoFolha-limpo/qa-demo-us12/package.json): Metadados do projeto demonstrativo isolado.
- [`qa-demo-us12/tsconfig.json`](file:///c:/Users/User/Desktop/projetoFolha-limpo/qa-demo-us12/tsconfig.json): Configuração TypeScript Node16 independente.
- [`qa-demo-us12/fixtures.ts`](file:///c:/Users/User/Desktop/projetoFolha-limpo/qa-demo-us12/fixtures.ts): Inicialização do SQLite isolado em memória (`:memory:`) com sementes limpas.
- [`qa-demo-us12/server.ts`](file:///c:/Users/User/Desktop/projetoFolha-limpo/qa-demo-us12/server.ts): Servidor HTTP demonstrativo em Node.js nativo (porta 3012).
- [`qa-demo-us12/test-cenarios.ts`](file:///c:/Users/User/Desktop/projetoFolha-limpo/qa-demo-us12/test-cenarios.ts): Script de execução e validação dos 12 cenários via terminal.
- [`qa-demo-us12/test-http.ts`](file:///c:/Users/User/Desktop/projetoFolha-limpo/qa-demo-us12/test-http.ts): Script de auditoria automatizada de rotas e códigos HTTP.
- [`qa-demo-us12/public/index.html`](file:///c:/Users/User/Desktop/projetoFolha-limpo/qa-demo-us12/public/index.html): Painel visual interativo com abas de cenários, simulador, segurança, matriz de permissões e logs.
- [`qa-demo-us12/public/style.css`](file:///c:/Users/User/Desktop/projetoFolha-limpo/qa-demo-us12/public/style.css): Folha de estilo dark-mode com componentes acessíveis e responsivos.
- [`qa-demo-us12/public/app.js`](file:///c:/Users/User/Desktop/projetoFolha-limpo/qa-demo-us12/public/app.js): Lógica cliente com invocação assíncrona dos endpoints reais.
- [`prompts/01_testes/evidencias-visuais-us12.md`](file:///c:/Users/User/Desktop/projetoFolha-limpo/prompts/01_testes/evidencias-visuais-us12.md): Este documento oficial de evidências para o Trello.

---

## 4. Como Executar a Demonstração e os Testes

### 1. Iniciar o Portal Demonstrativo Visual da US-12
No terminal raiz do projeto, execute:
```bash
npx tsx qa-demo-us12/server.ts
```
*(No Windows PowerShell com restrição de política de execução, utilize `npx.cmd tsx qa-demo-us12/server.ts`)*

Acesse no navegador:
**`http://localhost:3012/`**

### 2. Executar a Validação dos 12 Cenários via Terminal
```bash
npx.cmd tsx qa-demo-us12/test-cenarios.ts
```
Resultado: **12 Cenários Aprovados, 0 Reprovados (100% CONFORME)**.

### 3. Executar o Teste Automatizado de Rotas HTTP
```bash
npx.cmd tsx qa-demo-us12/test-http.ts
```
Resultado: **Todas as rotas HTTP e endpoints da QA Demo US-12 passaram com 100% de sucesso**.

### 4. Executar a Suíte Completa de Testes do Projeto
```bash
cd back-end
npm.cmd test
```
Resultado consolidado: **110 testes aprovados em 8 suítes (0 falhas)**, cobrindo Etapas 1, 2, 3, 4, v1.7, Proporcionalidade e a nova suíte US-12.

### 5. Compilação TypeScript do Backend
```bash
cd back-end
npm.cmd run typecheck
```
Resultado: Transpilação limpa sem nenhum erro ou aviso (`tsc --noEmit`).

---

## 5. Roteiro de Captura de Evidências Visuais para o Trello

Utilize o roteiro abaixo para capturar os prints e anexar no cartão da US-12 no Trello:

### 📸 Print 1 — Painel Geral de Indicadores e KPIs da US-12
* **Objetivo:** Comprovar a homologação completa da US-12 com 100% de conformidade no SQLite isolado.
* **O que enquadrar:**
  * Topbar: Badges `QA EVIDENCE • US-12`, `SQLite :memory: (Isolado)` e branch `feat/us-12-gestao-usuarios`.
  * Cards de KPI: 12 Cenários Avaliados, 12 Critérios Aprovados, 0 Reprovados, 0 Não Executados e Status **100% CONFORME**.
  * Barra de Ações Rápidas com botões *"▶ Executar Todos os Cenários"* e abas de filtro.
* **Legenda sugerida para o Trello:**
  > *"Dashboard de demonstração de QA da US-12 (Spec v1.7) em SQLite isolado in-memory: 12 cenários avaliados e 12 critérios aprovados com 100% de conformidade técnica."*

---

### 📸 Print 2 — Cenários de Aceite Individuais (Cards 1 a 6)
* **Objetivo:** Evidenciar o detalhamento dos cenários de cadastro, validação de e-mail, inativação sem exclusão física, redefinição de senha e histórico de 3 senhas.
* **O que enquadrar:**
  * Cards #1, #2, #3, #4, #5 e #6 com badge verde `✔ APROVADO`.
  * Destaque para as caixas *"Comportamento Esperado"* e *"Observado no Backend SQLite"*.
* **Legenda sugerida para o Trello:**
  > *"Critérios 1 a 6 APROVADOS: Cadastro com validação de e-mail, inativação lógica com encerramento de sessões, hash scrypt com salt e bloqueio de reutilização das últimas 3 senhas."*

---

### 📸 Print 3 — Cenários de Segurança Avançada (Cards 7 a 12)
* **Objetivo:** Evidenciar a homologação do 2FA, bloqueio temporário de 15 minutos, expiração de 30 minutos, matriz RBAC e auditoria.
* **O que enquadrar:**
  * Cards #7, #8, #9, #10, #11 e #12 com badge `✔ APROVADO`.
  * Detalhes técnicos evidenciando o bloqueio por tentativas (RNF-19) e o trigger de imutabilidade dos logs (RNF-03).
* **Legenda sugerida para o Trello:**
  > *"Critérios 7 a 12 APROVADOS: Segundo fator (2FA) em duas etapas, bloqueio após 5 erros por 15min, expiração de sessão em 30min e auditoria imutável."*

---

### 📸 Print 4 — Simulador Interativo de Usuários
* **Objetivo:** Demonstrar a interface funcional de gestão de usuários conectada ao SQLite isolado.
* **O que enquadrar:**
  * Aba *"Simulador de Usuários"*.
  * Painel esquerdo: Formulário de cadastro preenchido com nome, e-mail, perfil e checkbox de 2FA.
  * Painel direito: Tabela de usuários exibindo IDs, perfis com cores distintas, badges de status (*Ativo*/*Inativo*), 2FA e botões de ação (*Inativar*, *Trocar Senha*, *Alternar 2FA*).
* **Legenda sugerida para o Trello:**
  > *"Simulador de Gestão de Usuários da US-12: Cadastro de usuários com perfis restritos, controle de sessões ativas e ativação de segundo fator em tempo real."*

---

### 📸 Print 5 — Painel de Segurança: Segundo Fator (2FA) e Canal Out-of-band
* **Objetivo:** Comprovar o fluxo de dois fatores sem exposição de códigos em respostas públicas.
* **O que enquadrar:**
  * Seção *"Demonstração do Segundo Fator (2FA)"*.
  * 1ª etapa com desafio emitido.
  * Caixa de Notificação *"CANAL OUT-OF-BAND SIMULADO (E-mail Corporativo / SMS)"* exibindo o código numérico de 6 dígitos recebido.
  * 2ª etapa com código validado e banner verde de confirmação emitindo a sessão oficial de 30 minutos.
* **Legenda sugerida para o Trello:**
  > *"Homologação do Segundo Fator (2FA): Desafio criptográfico na 1ª etapa, entrega out-of-band simulada de código numérico de 6 dígitos e validação com emissão de sessão de 30 minutos."*

---

### 📸 Print 6 — Painel de Segurança: Bloqueio por 5 Tentativas (RNF-19) e Histórico de Senhas
* **Objetivo:** Evidenciar o bloqueio de 15 minutos e a proteção contra reutilização de credenciais.
* **O que enquadrar:**
  * Visualizador do contador de falhas com os 5 pontos vermelhos preenchidos (*5 / 5*) e aviso de conta temporariamente bloqueada por 15 minutos.
  * Tabela inferior de *"Histórico das Últimas Senhas"* exibindo as posições (*Senha Atual*, *1ª e 2ª Anteriores*) com badges vermelhos *"✖ Reutilização Bloqueada"* e hashes protegidos (*••••••••*).
* **Legenda sugerida para o Trello:**
  > *"Proteção e Bloqueio: Bloqueio de 15 minutos acionado após 5 erros seguidos (RNF-19) e proteção das últimas 3 senhas armazenadas com hash scrypt e salt."*

---

### 📸 Print 7 — Matriz de Perfis e Permissões em Tempo Real (Tabela 4.1)
* **Objetivo:** Comprovar que o controle de acesso é aplicado no backend em tempo real.
* **O que enquadrar:**
  * Aba *"Matriz de Permissões"*.
  * Tabela comparando as ações para os perfis RH, Diretoria e Admin com badges verdes `✔ PERMITIDO` e vermelhos `✖ BLOQUEADO (403)`.
  * Destacar que o Admin tem acesso a usuários e logs, mas está estritamente bloqueado de consultar a folha ou colaboradores.
* **Legenda sugerida para o Trello:**
  > *"Matriz de Permissões auditada no Backend (Tabela 4.1): Permissões avaliadas com regras reais do sistema, garantindo isolamento estrito entre RH, Diretoria e Administrador."*

---

### 📸 Print 8 — Trilha Imutável do Log de Auditoria (RNF-03)
* **Objetivo:** Comprovar a rastreabilidade das operações administrativas.
* **O que enquadrar:**
  * Aba *"Log de Auditoria Imutável"*.
  * Tabela de logs exibindo ações `CRIAR_USUARIO`, `REDEFINIR_SENHA`, `INATIVAR_USUARIO` e `ACESSO_NEGADO_FOLHA` com data/hora, perfil e detalhes.
* **Legenda sugerida para o Trello:**
  > *"Auditoria Imutável (RNF-03): Operações administrativas e tentativas de acesso não autorizado registradas no SQLite com proteção contra alteração e exclusão."*

---

### 📸 Print 9 — Suíte Completa de Testes no Terminal
* **Objetivo:** Comprovar a integridade geral do projeto e ausência total de regressões.
* **O que enquadrar:**
  * Terminal executando `npm.cmd test` na pasta `back-end`, evidenciando `ℹ pass 110`, `ℹ fail 0` em 8 suítes independentes.
* **Legenda sugerida para o Trello:**
  > *"Validação Automatizada: 110 testes aprovados em 8 suítes com 0 falhas, incluindo os 12 testes dedicados da US-12 e compatibilidade plena com a Spec v1.7."*

---

## 6. Limitações Técnicas, LGPD e Esclarecimentos Normativos

1. **Esclarecimento sobre a menção à "US-19":**
   - Na especificação técnica oficial consolidada (`docs/spec.md`), as histórias de usuário são numeradas de **US-01 a US-12**. A referência à "US-19" diz respeito à Seção 19 (*Histórico de Versões*) e ao requisito não funcional **RNF-19** (*política de senha de no mínimo 10 caracteres alfanuméricos e bloqueio de 15 minutos após 5 erros*). Todas as exigências do RNF-19 foram integralmente atendidas e testadas.
2. **Segundo Fator (2FA) e Ausência de Infraestrutura Externa:**
   - Como o sistema não possui gateway externo contratado de SMS ou servidor SMTP de produção configurado na v1, a entrega do código de segundo fator é operada através de um canal *out-of-band* simulado (`despacharCodigo2FAOutbox`), viabilizando a inspeção visual na demonstração sem comprometer a segurança da API pública (que nunca retorna o código ou segredo no payload JSON).
3. **Imutabilidade e Triggers SQLite (RNF-03):**
   - A tabela `logs_auditoria` possui triggers nativos no SQLite (`impede_update_log` e `impede_delete_log`) que abortam qualquer tentativa manual ou programática de edição ou exclusão de registros.
