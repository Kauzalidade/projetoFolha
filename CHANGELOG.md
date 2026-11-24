# 📜 Registro de Alterações e Decisões Técnicas (CHANGELOG)

Este documento registra o histórico de todas as alterações, atualizações e decisões arquiteturais do projeto, detalhando o que foi modificado e o **porquê (justificativa)** de cada escolha.

> **⚠️ REGRA OBRIGATÓRIA:**  
> **Toda e qualquer alteração, atualização ou adição ao projeto DEVE ser previamente perguntada e formalmente aprovada pelo usuário.**  
> Nenhuma funcionalidade, biblioteca ou decisão técnica pode ser introduzida sem consulta prévia.

---

## 🏛️ Pilares de Decisões Técnicas (Seção 15.3 da Especificação)

Todas as alterações técnicas do sistema devem ser categorizadas e justificadas dentro dos 5 pilares:

1. **Linguagem e framework**
2. **Banco de dados**
3. **Estrutura técnica (camadas, API, tabelas)**
4. **Visual das telas**
5. **Testes automatizados**

---

## 📅 Histórico de Decisões e Alterações

### [23/10/2026] - Sincronização com Especificação v1.3 e Definições Arquiteturais

| Categoria | O que foi alterado / decidido | Por quê (Justificativa técnica e de negócio) | Decidido por |
| :--- | :--- | :--- | :---: |
| **Linguagem e framework** | Node.js com TypeScript | Tipagem estática robusta para prevenir erros em cálculos financeiros, facilidade de manutenção e integração com bibliotecas de precisão decimal. | GTI 2º período (Kauã) |
| **Banco de dados** | PostgreSQL com colunas monetárias em `DECIMAL(12, 2)` | Atendimento à Regra de Ouro financeira (RN-03 e Seção 15.3), prevenindo imprecisões de ponto flutuante, além de integridade ACID e suporte a logs imutáveis. | GTI 2º período (Kauã) |
| **Estrutura técnica (camadas, API, tabelas)** | Arquitetura em camadas (Controllers/Rotas, Services/Casos de Uso, Repositories/Modelagem) e APIs REST | Separação clara de responsabilidades: o motor de cálculo da folha fica isolado e 100% testável antes da camada web/API. | GTI 2º período (Kauã) |
| **Visual das telas** | Interface web com foco prioritário em Desktop corporativo (RNF-06 e Seção 12) | O perfil dos operadores é o departamento pessoal e diretoria em computadores corporativos; layout focado em usabilidade com no máximo 2 cliques para explicar verbas (RNF-16). Versão mobile na 2ª versão. | GTI 2º período (Kauã) |
| **Testes automatizados** | Framework de testes unitários/integração com abordagem TDD (testes antes do código) | Exigência da especificação: 100% dos cenários Gherkin (Seção 10) e exemplos numéricos (Seção 8) devem ser validados com tolerância de até R$ 0,01. | GTI 2º período (Kauã) |
| **Documentação base** | Substituição de `especificacao-requisitos.md` por `docs/spec.md` (v1.3) | Adoção da especificação oficial consolidada v1.3 elaborada pelo GTI 4º período. | GTI 2º período (Kauã) |

---



### [26/10/2026] - Documentação operacional das regras RN-48, RN-50 e RN-51
- **Categoria:** Estrutura técnica (documentação e critérios de teste)
- **O que foi adicionado/alterado:** criado `docs/regras-beneficios-medias.md` com fórmulas, memória de cálculo, exemplos e testes de aceitação para média de horas extras/DSR (RN-48), vale-transporte (RN-50) e vale-alimentação (RN-51); README atualizado com resumo e link.
- **Por quê (Justificativa):** tornar os requisitos do PDF v1.3 rastreáveis para implementação e testes sem inventar comportamentos não especificados. A coparticipação do VA acima de 0% continua explicitamente pendente de definição quanto à base e forma de cálculo.
- **Aprovado por:** solicitação do usuário nesta conversa
- **Limite da entrega:** documentação e critérios de teste; não declara que o cálculo já esteja implementado nem que testes tenham sido executados.

---

### [27/10/2026] - Implementação e Validação Automatizada da Etapa 1 (TDD)
- **Categoria:** Testes automatizados / Estrutura técnica
- **O que foi adicionado/alterado:**
  - Configuração do runtime Node.js LTS v24 e TypeScript com test runner nativo (`node:test`, `tsx`).
  - Implementação de `src/dec.ts` (operações monetárias exatas em centavos com `BigInt`, sem ponto flutuante, RN-03).
  - Implementação de `src/cpf.ts` (validação com dígitos verificadores da Receita Federal e formatação, RN-11 e RN-15).
  - Implementação de `src/security.ts` (hash `scrypt` com salt, senha forte com 10+ caracteres, bloqueio de 15 min após 5 erros - RNF-19 e controle de sessão - RNF-01).
  - Implementação de `src/db.ts` (schema SQLite completo e triggers de imutabilidade de logs de auditoria - RNF-03).
  - Implementação dos serviços de domínio: `usuarioService.ts`, `filialService.ts`, `colaboradorService.ts` (regras RN-10 a RN-16, inativação lógica RN-12, histórico RN-07, LGPD RN-14) e `parametroFeriadoService.ts` (carga dos 10 feriados nacionais de 2026 - RN-35 e parâmetros legais com vigência - RN-01).
  - Implementação de `src/manage.ts` (comandos CLI `init-db`, `criar-usuario` e `seed-demo`).
  - Criação da suíte de testes `tests/etapa1.test.ts` com 17 testes automatizados cobrindo os cenários Gherkin da Seção 10.
- **Por quê (Justificativa):** Cumprir o critério de pronto da Etapa 1 da especificação v1.3 (*"Cadastra, edita, consulta e inativa; CPF duplicado é rejeitado; todos os testes passam"*).
- **Aprovado por:** Kauã (solicitação e autorização do usuário nesta conversa).

---

### [27/10/2026] - Implementação e Validação Automatizada da Etapa 2 (TDD)
- **Categoria:** Testes automatizados / Estrutura técnica
- **O que foi adicionado/alterado:**
  - Adição das tabelas `competencias` e `eventos` no SQLite em `src/db.ts`.
  - Implementação de `src/services/competenciaService.ts` com ciclo de vida da competência (*Aberta → Calculada → Fechada*), controle de permissões por perfil (Diretoria não fecha nem reabre folha) e reabertura com justificativa obrigatória homologada na hora com evento em destaque no log (RN-04, RN-08).
  - Implementação de `src/services/eventoService.ts` para horas extras (50%, 100% e adicionais de convenção como 120%, RN-30), faltas com desconto e perda de DSR (RN-33), atestados com anexo/período e controle estrito de dados de saúde (RN-33, RN-54, RNF-21), vale-transporte com teto de 6% (RN-50) e verbas avulsas com 3 incidências booleanas (RN-25).
  - Criação da suíte `tests/etapa2.test.ts` com 16 testes automatizados cobrindo os cenários Gherkin da Seção 10. Suíte completa acumula 33 testes aprovados.
- **Por quê (Justificativa):** Cumprir o critério de pronto da Etapa 2 da especificação v1.3 (*"Cenários de horas extras e descontos passam. A estrutura de lançamentos, com o campo de verbas avulsas (RN-25), precisa estar pronta antes do cálculo da Etapa 3"*).
- **Aprovado por:** Kauã (solicitação e autorização do usuário nesta conversa).

---

---

### [27/10/2026] - Implementação e Validação Automatizada da Etapa 3 (TDD)
- **Categoria:** Testes automatizados / Estrutura técnica
- **O que foi adicionado/alterado:**
  - Adição das tabelas `folhas`, `folha_verbas` (memória de cálculo detalhada) e `saldos_a_descontar` no SQLite em `src/db.ts`.
  - Implementação de `src/calculo.ts` com cálculo progressivo por faixas do INSS 2026, IRRF comparativo (Base Tradicional vs Simplificada com redução da Lei 15.270/2025) e fórmula do DSR sobre horas extras (RN-31).
  - Implementação de `src/services/folhaService.ts` com cálculo completo da remuneração, FGTS (8% encargo patronal), memória explicativa por verba (RN-02), proteção ao líquido (líquido nunca negativo com geração de saldo a descontar limitado a 30% no mês seguinte - RN-06) e fechamento seguro bloqueado por dados pendentes ou saldo sem justificativa (Tabela 7.1).
  - Criação da suíte `tests/etapa3.test.ts` com 10 testes cobrindo os exemplos numéricos da Seção 8 (A, B, C, G, H, I, M) e cenários Gherkin da Seção 10. Suíte completa acumula **43 testes aprovados com 100% de sucesso**.
- **Por quê (Justificativa):** Cumprir o critério de pronto da Etapa 3 da especificação v1.3 (*"Folha calculada com memória; fechamento bloqueado nos casos da tabela 7.1; tolerância de cálculo de até R$ 0,01"*).
- **Aprovado por:** Kauã (solicitação e autorização do usuário nesta conversa).

---

### [29/10/2026] - Implementação e Validação Automatizada da Etapa 4 (TDD)
- **Categoria:** Testes automatizados / Estrutura técnica
- **O que foi adicionado/alterado:**
  - Adição das tabelas `ferias`, `decimo_terceiro`, `documentos_colaborador` e `exames_ocupacionais` no schema SQLite (`src/db.ts`).
  - Implementação de `src/services/feriasService.ts` com controle de período aquisitivo e concessivo, fracionamento em até 3 períodos (RN-42), abono pecuniário isento de INSS/IRRF (RN-43), redução por faltas (RN-44), impedimento de início em véspera de feriado/descanso e data limite de pagamento (RN-47), cálculo de INSS e IRRF sobre férias gozadas + 1/3 (Exemplo J) e reflexo de médias de horas extras (RN-48, Exemplo K), além de exigência de justificativa para concessivo vencido (Tabela 7.2).
  - Atualização de `src/services/folhaService.ts` para tratar férias que cruzam dois meses (RN-49), com remuneração proporcional aos dias não gozados e lançamento das férias e 1/3 na competência de início de gozo, além de proporcionalidade de admissão/desligamento (RN-20).
  - Implementação de `src/services/decimoTerceiroService.ts` calculando 1ª parcela (50% sem descontos até 30/11) e 2ª parcela (integral deduzindo 1ª parcela e calculando INSS/IRRF exclusivos na fonte) conforme RN-46, proporcionalidade de meses com >= 15 dias trabalhados e reflexo de variáveis (RN-48).
  - Implementação de `src/services/documentosAlertasService.ts` com alertas centralizados de documentos a vencer em 30 dias (RN-52), exames ocupacionais periódicos (RN-53), prazo limite de pagamento da folha (RN-58), férias com concessivo a vencer em 60 dias (RN-45) e sinalização LGPD de dados fora do prazo de guarda de 5 anos (RN-56).
  - Implementação de `src/services/relatoriosService.ts` com geração e exportação de Contracheque em PDF (RN-55, US-09), Relatório da Folha do Mês (US-08), Relatório de Férias, Horas Extras, Colaboradores Ativos, Documentos/Exames a Vencer, Dados de Pagamento (RN-57) e Logs de Auditoria (restrito à Diretoria e Admin - RNF-03), suportando exportação em formato nativo Microsoft Excel (XML Spreadsheet 2003 e CSV UTF-8) e documentos PDF-1.4 padronizados.
  - Criação da suíte `tests/etapa4.test.ts` com 24 testes automatizados cobrindo integralmente todos os cenários Gherkin e numéricos da Etapa 4. A suíte completa do repositório acumula **67 testes automatizados aprovados com 100% de sucesso**.
- **Por quê (Justificativa):** Cumprir o critério de pronto da Etapa 4 da especificação v1.3 (*"Cenários de férias passam; relatórios exportam em PDF e Excel; todos os testes passam"*).
- **Aprovado por:** Kauã (solicitação e autorização do usuário nesta conversa).

---

### [18/11/2026] - Consolidação de Branches e Harmonização da Especificação Técnica v1.7
- **Categoria:** Estrutura técnica / Testes automatizados / Banco de dados
- **O que foi adicionado/alterado:**
  - Unificação completa das branches de desenvolvimento e consolidação da Especificação Técnica v1.7 (10/11/2026).
  - Implementação da US-10 (Registro de Proventos e Descontos Manuais / Verbas Avulsas - RN-25 a RN-27) com suíte `tests/us10_verbas_avulsas.test.ts` (10 testes).
  - Implementação da US-12 (Gestão de Usuários, Perfis, Políticas de Senha com histórico das últimas 3, Segundo Fator 2FA out-of-band e Bloqueio por Tentativas) com suíte `tests/us12_gestao_usuarios.test.ts` (12 testes).
  - Implementação da US-13 (Conferência de Totais da Folha em 5 Eixos, tolerância zero de R$ 0,00 e Fechamento Seguro com hash SHA-256) com suíte `tests/us13_conferencia_totais.test.ts` (15 testes).
  - Implementação de caracterização dos casos de borda da proporcionalidade (meses de 31, 28 e 29 dias - RN-20) com suíte `tests/proporcionalidade.test.ts` (4 testes) e `tests/etapa_v1_7.test.ts` (47 testes).
  - A suíte completa de testes automatizados foi expandida para **155 testes aprovados com 100% de sucesso**.
- **Por quê (Justificativa):** Consolidar todo o escopo acadêmico da especificação v1.7, garantindo rastreabilidade, imutabilidade de auditoria (RNF-03) e fechamento seguro com tolerância zero.
- **Aprovado por:** Kauã (solicitação e autorização do usuário nesta conversa).

---

### [24/11/2026] - Implementação do Portal Web Completo e Resolução de Inconsistências
- **Categoria:** Visual das telas / Estrutura técnica / Testes automatizados
- **O que foi adicionado/alterado:**
  - Implementação e integração completa da interface web corporativa em `front-end/index.html` consumindo diretamente os endpoints REST do servidor `back-end/src/server.ts`.
  - Resolução de dados `undefined` e `R$ NaN` na Folha do Mês através de projeção completa de cargos, colaboradores e salários estruturados em `relatoriosService.ts`.
  - Ativação das funções operacionais de cálculo e programação de Férias e 13º Salário com histórico dinâmico.
  - Correção da Central de Alertas com exibição das descrições detalhadas dos prazos legais.
  - Implementação e disponibilização para download real da Relação Bancária para Pagamento (PDF e Excel) e do Termo de Eliminação de Dados Pessoais (LGPD Art. 16 em PDF com hash SHA-256).
  - Limpeza e profissionalização dos termos visuais do portal, removendo identificadores técnicos internos (`Etapa X`, `US-xx`, `RN-xx`).
  - Harmonização da documentação (`README.md`, `AGENTS.md`, `CHANGELOG.md`), remoção de conteúdo duplicado, correção de links quebrados e exclusão do diretório órfão `back-end/back-end/`.
- **Por quê (Justificativa):** Garantir usabilidade de ponta a ponta para os perfis de RH e Diretoria, conformidade legal trabalhista e integridade documental do repositório.
- **Aprovado por:** Kauã (solicitação e autorização do usuário nesta conversa).


---

### [24/11/2026] - Otimização Estrutural: Remoção de Protótipos Redundantes e Arquivos Órfãos
- **Categoria:** Estrutura técnica
- **O que foi adicionado/alterado:**
  - Remoção de 50 arquivos redundantes e legados decorrentes de merges históricos, tornando o repositório enxuto e direto:
    - Exclusão dos 4 diretórios de demonstrações isoladas (`qa-demo/`, `qa-demo-us10/`, `qa-demo-us12/`, `qa-demo-us13/`), cujas regras e testes já estão unificados no backend e frontend oficiais.
    - Exclusão dos submódulos de protótipo de autenticação paralela (`back-end/authentication/` e `front-end/authentication/`).
    - Exclusão de 7 arquivos HTML de testes preliminares em `front-end/` (`testador-criterios.html`, `teste-auditoria-operacoes.html`, `teste-contracheque.html`, `teste-documentos-alertas.html`, `teste-fechamento.html`, `teste-ferias.html`, `teste-relatorios-diretoria.html`), integralmente absorvidos pelo portal `front-end/index.html`.
    - Exclusão do arquivo duplicado `Apresentacao_RH_projetoFolha.pdf` na raiz (preservada a via oficial em `docs/`).
  - Remoção da importação residual de script de autenticação em `front-end/index.html` e limpeza de rotas estáticas em `server.ts`.
- **Por quê (Justificativa):** Deixar o projeto limpo, enxuto, prático e sem código morto ou servidores duplicados, mantendo 100% da funcionalidade e integridade dos 155 testes automatizados.
- **Aprovado por:** Kauã (solicitação e autorização expressa do usuário nesta conversa).

---

### [24/11/2026] - Ativação do Cadastro de Parâmetros e Reabertura de Folha com Justificativa
- **Categoria:** Visual das telas / Estrutura técnica / Banco de dados
- **O que foi adicionado/alterado:**
  - **Reabertura de Folha (CLT / RN-04):** Implementado o modal de reabertura (`abrirModalReabertura()`) no botão "🔓 Reabrir", exigindo justificativa formal obrigatória, invalidando a conferência prévia e atualizando em tempo real o status para `ABERTA`, além de registrar o evento destacado na trilha de auditoria imutável. Ajustada rota `POST /api/competencias/reabrir` com suporte resiliente a `mesAno` e `competenciaId`.
  - **Novo Parâmetro Vigente (RN-01):** Implementado o modal (`abrirModalNovoParametro()`) no botão "+ Novo Parâmetro", persistindo `nome`, `valor`, `dataInicio`, `dataFim`, `fonte` e `versao` via `POST /api/parametros`. Adicionada tabela dinâmica em "Tabelas e Parâmetros Vigentes de 2026" com atualização automática via `GET /api/parametros` (`carregarParametrosCadastrados()`).
  - **Migração Dinâmica de Banco:** Adicionada migração `ALTER TABLE parametros ADD COLUMN fonte TEXT NULL` em `db.ts`, garantindo compatibilidade retroativa e integridade da coluna legal.
- **Por quê (Justificativa):** Permitir a governança completa da folha pelo perfil RH, sanando os botões sem manipulador de evento e garantindo conformidade com a CLT e trilha de auditoria contábil.
- **Aprovado por:** Kauã (solicitação e autorização expressa do usuário nesta conversa).

## 📋 Modelo para Futuros Registros

Para cada nova adição ou atualização aprovada pelo usuário, registre uma nova entrada seguindo o formato:

```markdown
### [DD/MM/AAAA] - [Título da Alteração]
- **Categoria:** [Linguagem e framework | Banco de dados | Estrutura técnica | Visual das telas | Testes automatizados]
- **O que foi adicionado/alterado:** [Descrição detalhada da mudança]
- **Por quê (Justificativa):** [Motivo técnico ou requisito de negócio que justificou a mudança]
- **Aprovado por:** [Nome do usuário / Responsável]
```
