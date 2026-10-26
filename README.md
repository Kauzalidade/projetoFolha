# projetoFolha | Sistema de RH e Folha de Pagamento

Sistema web acadêmico de RH e folha de pagamento para uma empresa **correspondente bancária** (15 colaboradores, 1 matriz + 2 filiais). O escopo prevê cálculos de **INSS** e **IRRF**, memória de cálculo por verba e controle de férias, 13º salário, documentos, alertas e relatórios.

> **Disciplina:** Spec-Driven Development com IA · Prof. Dr. Juan Apolinario
> **Especificação de referência:** v1.3 (21/10/2026), elaborada pelo GTI 4º período.
> **Equipe de desenvolvimento:** GTI 2º período.
> **Repositório:** [github.com/Kauzalidade/projetoFolha](https://github.com/Kauzalidade/projetoFolha)
> **Status geral:** em desenvolvimento acadêmico. Este README descreve o escopo e os requisitos; não significa que todas as funcionalidades já estejam implementadas.
> **Stack definida:** Node.js e TypeScript. **Banco de dados:** pendente de confirmação da equipe, pois o README anterior cita MySQL e o CHANGELOG registra PostgreSQL.
> **Regra de ouro:** se faltar informação, **não invente a regra**. Registre a dúvida e consulte o GTI 4º período.

---

## Sumário

- [Sobre o projeto](#sobre-o-projeto)
- [Objetivos](#objetivos)
- [Escopo da 1ª versão](#escopo-da-1ª-versão)
- [Etapas de construção](#etapas-de-construção)
- [Status de implementação verificado](#status-de-implementação-verificado)
- [Regras de negócio em destaque](#regras-de-negócio-em-destaque)
- [Parâmetros legais de 2026](#parâmetros-legais-de-2026)
- [Exemplos de cálculo para os testes](#exemplos-de-cálculo-para-os-testes)
- [Perfis e permissões](#perfis-e-permissões)
- [Telas da 1ª versão](#telas-da-1ª-versão)
- [Requisitos não funcionais](#requisitos-não-funcionais)
- [Stack e decisões técnicas](#stack-e-decisões-técnicas)
- [Como trabalhar neste repositório](#como-trabalhar-neste-repositório)
- [Equipe](#equipe)
- [Avisos importantes](#avisos-importantes)

---

## Sobre o projeto

Hoje a folha do cliente depende de planilhas e conferência manual. Em folha, um centavo errado vira reclamação e retrabalho, e é preciso explicar de onde saiu cada valor. Este sistema **calcula a folha** (salário, horas extras, DSR, férias, 13º, benefícios e descontos), com acesso restrito a RH e diretoria, backup diário e **memória de cálculo** para cada verba.

**Cliente:** grupo de RH (Vitor, Deyse, Alana Catiany de Morais, Marília e Thayane).

## Objetivos

| ID | Objetivo | Como medir |
|----|----------|-----------|
| OB-01 | Calcular a folha mensal com INSS e IRRF corretos | Resultados iguais aos exemplos de cálculo (tolerância de R$ 0,01) |
| OB-02 | Tornar cada valor explicável (memória de cálculo) | 100% dos valores com base, regra e parâmetro registrados |
| OB-03 | Controlar férias e 13º sem perder prazos | Alertas de férias a vencer; cálculo conforme RN-40 a RN-46 |
| OB-04 | Guardar documentos com alertas de vencimento | Alerta 30 dias antes (configurável) |
| OB-05 | Proteger dados pessoais conforme a LGPD | Acesso restrito, log de acessos, nenhum dado sensível desnecessário |
| OB-06 | Permitir que a regra mude sem reprogramar | Parâmetros legais com vigência, cadastráveis |

## Escopo da 1ª versão

**Dentro:**

- Login, perfis (RH, Diretoria, Admin), cadastro de filiais e colaboradores
- Parâmetros legais com vigência e calendário de feriados
- Lançamento de eventos: horas extras, faltas, atestados, VT, VA e verbas avulsas
- Cálculo da folha (INSS, IRRF, FGTS, DSR, reflexos) com memória de cálculo e fechamento
- Férias, 13º, documentos com alertas, contracheque em PDF e relatórios (PDF e Excel)

**Fora da 1ª versão:**

- Ponto eletrônico, banco de horas, rescisão, arquivo bancário, recrutamento, desempenho e treinamentos
- Portal do colaborador e integrações (eSocial, Microsoft 365, Google)
- Cálculo automático de adicional noturno, insalubridade, periculosidade, comissões, salário-família, pensão alimentícia, consignado e assistência médica. O RH registra esses casos como **verbas avulsas** (RN-25)

## Etapas de construção

Implementar **uma etapa por vez, nesta ordem**. Testes primeiro: a etapa só está pronta quando todos os testes dela passam.

| Etapa | O que construir | Pronto quando |
|-------|-----------------|---------------|
| 1 | Login, perfis, cadastro de filiais e colaboradores, parâmetros legais e feriados | Cadastra, edita, consulta e inativa; CPF duplicado é rejeitado |
| 2 | Lançamento de eventos (horas extras, faltas, atestados, VT, VA, verbas avulsas) | Cenários de horas extras e descontos passam; tela de lançamentos com verbas avulsas pronta **antes** da Etapa 3 |
| 3 | Cálculo da folha, memória de cálculo e fechamento | Folha calculada com memória; fechamento bloqueado nos casos da tabela 7.1 da especificação |
| 4 | Férias, 13º, documentos com alerta, contracheque e relatórios | Cenários de férias passam; relatórios exportam em PDF e Excel |

> A Etapa 3 só começa com a Etapa 2 **completa**, incluindo verbas avulsas.

## Status de implementação verificado

As etapas abaixo representam o plano da especificação. Na revisão documental da branch `main` em 26/10/2026, não foi possível confirmar, com evidências suficientes de código e testes, que essas etapas estejam concluídas. Por isso, o status é registrado como **não verificado na `main`**, e não como “não implementado”.

| Etapa | Escopo | Status na `main` |
|-------|--------|------------------|
| 1 | Login, perfis, filiais, colaboradores, parâmetros legais e feriados | Não verificado |
| 2 | Eventos: horas extras, faltas, atestados, VT, VA e verbas avulsas | Não verificado |
| 3 | Cálculo da folha, memória de cálculo e fechamento | Não verificado |
| 4 | Férias, 13º, documentos, contracheque e relatórios | Não verificado |

O status deve ser atualizado somente quando houver evidência verificável na branch de referência, como código, testes automatizados ou documentação de execução. A existência de código em outra branch não comprova, por si só, que a funcionalidade esteja integrada à `main`.

## Regras de negócio em destaque

A lista completa (RN-01 a RN-58) está na especificação v1.3. Estas são as mais importantes para a implementação:

- **RN-01 Parametrização:** nenhum valor legal ou percentual fixo no código. Cada parâmetro tem nome, valor, início e fim de vigência, e o cálculo usa o vigente na competência.
- **RN-02 Memória de cálculo:** cada valor registra base, regra aplicada, parâmetro (e versão) e arredondamento.
- **RN-03 Arredondamento:** 2 casas decimais, meio para cima, aplicado em cada verba antes de somar.
- **RN-04 / RN-08 Competência:** ciclo *aberta → calculada → fechada*. O RH reabre com justificativa obrigatória; o sistema grava evento destacado no log e notifica a Diretoria.
- **RN-06 Descontos acima dos proventos:** líquido nunca negativo; INSS e IRRF nunca são limitados; o excedente vira saldo a descontar (limite de 30% do bruto por mês).
- **RN-11 / RN-12 Cadastro:** CPF único e válido; colaborador nunca é excluído, apenas inativado.
- **RN-14 Dados proibidos:** sem campos de religião, orientação sexual, raça/etnia, dados genéticos ou biomédicos.
- **RN-22 / RN-23 INSS e IRRF:** INSS progressivo por faixa com teto; IRRF calcula base tradicional e simplificada e usa a que gerar menor imposto, aplicando depois a redução da Lei 15.270/2025.
- **RN-24 FGTS:** 8%, encargo da empresa (não desconta do colaborador).
- **RN-30 a RN-33 Horas extras, DSR e faltas:**
  - Valor da hora = salário-base / 220. Dia útil × 1,5; domingo e feriado × 2,0 (parâmetros).
  - **DSR (RN-31)** = (horas extras do mês / dias úteis do mês) × domingos e feriados do mês.
  - **Reflexos (RN-32 / RN-48):** média das horas extras (e do DSR delas) reflete em férias e 13º, dividida por 12.
  - Falta injustificada desconta (salário-base / 30) por dia, mais a perda do DSR.
- **RN-35 Feriados:** tabela cadastrável, com carga inicial dos 10 feriados nacionais de 2026.
- **RN-40 a RN-49 Férias e 13º:** período aquisitivo/concessivo, 1/3 constitucional, fracionamento em até 3 períodos (um de no mínimo 14 dias, os demais de no mínimo 5), abono pecuniário, redução por faltas, 13º em duas parcelas (até 30/11 e 20/12), regras de início e pagamento das férias.
- **RN-54 / RNF-03 Saúde e auditoria:** atestados e exames têm acesso restrito e log de cada consulta; logs são imutáveis.

## Parâmetros legais de 2026

Todos entram no sistema como **parâmetros com vigência** (nunca fixos no código). Os valores abaixo foram comparados com fontes oficiais consultadas em 26/10/2026; **o contador do cliente deve confirmar os parâmetros e a lógica de cálculo antes de qualquer uso real.** A conferência das tabelas não valida automaticamente todos os exemplos numéricos desta especificação.

**Fontes oficiais consultadas:**

- [Tabela de contribuição mensal do INSS](https://www.gov.br/inss/pt-br/direitos-e-deveres/inscricao-e-contribuicao/tabela-de-contribuicao-mensal)
- [Tabelas do Imposto de Renda 2026, Receita Federal](https://www.gov.br/receitafederal/pt-br/assuntos/meu-imposto-de-renda/tabelas/2026)
- [Decreto nº 12.797/2025, salário mínimo de 2026](https://www.planalto.gov.br/ccivil_03/_ato2023-2026/2025/decreto/d12797.htm)
- [Lei nº 15.270/2025](https://www.planalto.gov.br/ccivil_03/_ato2023-2026/2025/lei/l15270.htm)

| Parâmetro | Valor |
|-----------|-------|
| Salário mínimo | R$ 1.621,00 |
| Teto do INSS | R$ 8.475,55 (contribuição máxima R$ 988,09) |
| Dedução por dependente (IRRF) | R$ 189,59/mês |
| Desconto simplificado (IRRF) | R$ 607,20/mês |
| FGTS (encargo da empresa) | 8% |
| Divisor de horas mensais | 220 |

**INSS 2026 (progressivo por faixa):**

| Faixa | Salário de contribuição | Alíquota |
|-------|------------------------|----------|
| 1 | Até R$ 1.621,00 | 7,5% |
| 2 | R$ 1.621,01 a R$ 2.902,84 | 9% |
| 3 | R$ 2.902,85 a R$ 4.354,27 | 12% |
| 4 | R$ 4.354,28 até R$ 8.475,55 | 14% |

**IRRF 2026 (mensal):**

| Base de cálculo | Alíquota | Parcela a deduzir |
|-----------------|----------|-------------------|
| Até R$ 2.428,80 | Isento | - |
| R$ 2.428,81 a R$ 2.826,65 | 7,5% | R$ 182,16 |
| R$ 2.826,66 a R$ 3.751,05 | 15% | R$ 394,16 |
| R$ 3.751,06 a R$ 4.664,68 | 22,5% | R$ 675,49 |
| Acima de R$ 4.664,68 | 27,5% | R$ 908,73 |

**Redução (Lei 15.270/2025):** rendimento tributável até R$ 5.000,00 tem redução de até R$ 312,89 (zera o imposto). De R$ 5.000,01 a R$ 7.350,00: redução = R$ 978,62 − (0,133145 × rendimento mensal), nunca negativa nem maior que o imposto apurado. Acima de R$ 7.350,00: sem redução.

## Exemplos de cálculo para os testes

Os exemplos A a N da especificação (seção 8) e os cenários Gherkin (seção 10) devem virar **testes automatizados** (RNF-17). Tolerância: **R$ 0,01**.

| Caso | Entrada | Resultado esperado |
|------|---------|--------------------|
| A | Salário 3.000,00, sem dependentes | INSS 248,60 · IRRF 0,00 · líquido 2.751,40 |
| B | Salário 6.000,00, sem dependentes | INSS 641,51 · IRRF 385,10 · líquido 4.973,39 |
| C | Salário 10.000,00 | INSS limitado ao teto: 988,09 |
| D | Salário 2.200,00; 2 h extras em dia útil / em domingo | R$ 30,00 / R$ 40,00 |
| G | Competência 10/2026; salário 2.200,00; 10 h extras em dia útil | Horas extras 150,00 · DSR 28,85 · bruto 2.378,85 · INSS 189,78 · IRRF 0,00 · líquido 2.189,07 |
| H | Salário 5.500,00, 2 dependentes | INSS 571,51 · IRRF 101,78 · líquido 4.826,71 |
| J | Férias de 30 dias, salário 3.000,00 | Base 4.000,00 · INSS 368,60 · IRRF 0,00 · líquido 3.631,40 |
| K | Salário 2.200,00 + média de horas extras 150,00 | Férias 3.133,33 · 13º 1ª parcela 1.175,00 · 2ª parcela 987,81 |
| M | Exemplo G com 1 feriado municipal extra | DSR = 150,00 / 25 × 6 = 36,00 |

## Perfis e permissões

| Ação | RH | Diretoria | Admin |
|------|:--:|:---------:|:-----:|
| Cadastrar/editar colaborador e filial | Sim | Não | Não |
| Consultar dados cadastrais | Sim | Sim | Não |
| Lançar eventos e calcular folha | Sim | Não | Não |
| Conferir, fechar e aprovar folha | Sim | Não | Não |
| Reabrir competência fechada | Sim (com justificativa) | Não (é notificada) | Não |
| Consultar folha e relatórios | Sim | Sim | Não |
| Cadastrar parâmetros, feriados e verbas avulsas | Sim | Não | Não |
| Ver dados de saúde (atestados, exames) | Sim | Não | Não |
| Ver log de acessos e alterações | Não | Sim | Sim |
| Gerenciar usuários | Não | Não | Sim |

Colaboradores e gestores **não** acessam o sistema nesta versão.

## Telas da 1ª versão

Login · Lista de colaboradores · Ficha do colaborador · Lançamento de eventos · Folha do mês · Férias · Contracheque · Relatórios · Parâmetros e feriados (com aviso de validação do contador, RN-27) · Alertas

## Requisitos não funcionais

| Área | Requisito |
|------|-----------|
| Segurança | Login com e-mail e senha (hash); senha com 10+ caracteres, letras e números; sessão expira em 30 min; bloqueio de 15 min após 5 tentativas erradas |
| LGPD | Dados sensíveis e de saúde cifrados em repouso; HTTPS; retenção de 5 anos após o desligamento |
| Backup | Diário, com teste de restauração; RPO de 24 h e RTO de 4 h |
| Desempenho | Cálculo da folha em até 5 s; telas de consulta em até 2 s; contracheque e relatórios em até 10 s |
| Capacidade | Até 10 usuários simultâneos e 50 colaboradores |
| Disponibilidade | 99% em horário comercial |
| Usabilidade | Português do Brasil, valores em R$, datas em dd/mm/aaaa; erros indicam o campo; qualquer valor se explica em até 2 cliques |
| Anexos | PDF, JPG ou PNG de até 10 MB |
| Fuso | Horário de Brasília; logs guardados por 5 anos |
| Plataforma | Acesso por computador (celular fica para a 2ª versão) |

## Stack e decisões técnicas

A especificação define **o que** o sistema deve fazer. As decisões técnicas registradas no README e no CHANGELOG foram conciliadas abaixo. Quando há conflito explícito, a decisão fica pendente em vez de escolher uma opção sem aprovação.

| Decisão | Situação atual |
|---------|----------------|
| Linguagem e plataforma | **Node.js** com **TypeScript** |
| Framework (back-end e front-end) | A definir pela equipe |
| Banco de dados | **Pendente de confirmação:** README anterior indica MySQL; CHANGELOG de 23/10/2026 registra PostgreSQL com `DECIMAL(12,2)` |
| Estrutura técnica | CHANGELOG registra arquitetura em camadas (Controllers/Rotas, Services/Casos de Uso e Repositories/Modelagem) e APIs REST |
| Visual das telas | Interface web com prioridade para desktop, conforme a especificação |
| Testes automatizados | Node.js com TypeScript; framework ainda a definir; abordagem de testes antes do código (TDD) registrada no CHANGELOG |
| Gerenciador de pacotes, ORM e comandos | A definir pela equipe |

**Obrigatório:** valores monetários devem usar representação decimal exata, sem cálculos financeiros com `number` de ponto flutuante em TypeScript. O tipo e a sintaxe definitivos no banco dependem da confirmação entre MySQL e PostgreSQL. Parâmetros legais devem ficar em tabelas com datas de início e fim de vigência.

> **Instalação e execução:** os comandos serão documentados quando a equipe confirmar o gerenciador de pacotes, framework, ORM e estrutura executável do projeto.

## Como trabalhar neste repositório

1. **Leia a especificação v1.3** antes de qualquer código.
2. **Uma etapa por vez**, na ordem da seção [Etapas de construção](#etapas-de-construção).
3. **Testes primeiro:** derive os testes dos cenários Gherkin (seção 10) e dos exemplos (seção 8).
4. **Nada fixo no código:** valores legais vivem na tabela de parâmetros (RN-01).
5. **Regra que não está na especificação não entra no sistema.** Use a regra de ouro: anote a dúvida e pergunte ao GTI 4º período.
6. **Conferir o gerado:** compare o código com a especificação e liste comportamento fora da spec, valores fixos e regras sem teste.

### Trabalhando com agente de IA

Cole a especificação antes de cada prompt e use a regra comum: *"Não crie regra de negócio. Se faltar informação, marque como hipótese e liste como pergunta pendente."*

| # | Prompt | Finalidade |
|---|--------|-----------|
| 1 | Revisar a spec | Listar ambiguidades, regras sem exemplo, casos de borda e contradições |
| 2 | Gerar testes | Testes de horas extras (RN-30 a RN-33) com casos de borda, usando decimal |
| 3 | Modelar o banco | Tabelas, campos e chaves; valores legais em tabela de parâmetros |
| 4 | Implementar uma etapa | Ex.: apenas a Etapa 1, com testes primeiro |
| 5 | Conferir o gerado | Comparar código e especificação |

## Equipe

**GTI 4º período (especificação):**

| Nome | Função |
|------|--------|
| Severino Felipe | Líder e ponte com o 2º período |
| Antônio Fabrício | Regras de negócio e folha |
| José Roberto | Contato com o cliente (RH) e ata |
| Wesley Antônio | Testes e qualidade |

**GTI 2º período (desenvolvimento):**

| Nome | Função |
|------|--------|
| Jonas Kauã | Representante da turma e desenvolvedor |
| Carlos Pietro | Desenvolvedor |
| José Geremias | Desenvolvedor |
| Valdir Fonséca | Desenvolvedor |

**Cliente (grupo de RH):** Vitor (Diretor de RH), Deyse (Departamento Pessoal), Alana Catiany de Morais (Recrutamento e Seleção), Marília (Treinamento e Desenvolvimento) e Thayane (Gestão e Relatórios).

## Avisos importantes

- Os parâmetros legais de 2026 foram comparados com fontes oficiais em 26/10/2026, mas **precisam da validação de um contador antes do uso real**; essa conferência não garante, por si só, a correção de todos os exemplos de cálculo.
- Itens marcados como `[ADOTADO]` na especificação são decisões provisórias do grupo, configuráveis até o RH ou o contador pedir mudança.
- A convenção coletiva do cliente não foi informada: valem os padrões da CLT e a convenção entra como parâmetro cadastrável.
- Os dados de exemplo da especificação (seção 11) são **fictícios**.
- Cálculos da folha exigem revisão humana, de preferência com apoio contábil.

---

<sub>Baseado na Especificação de Requisitos v1.3 (21/10/2026) · Prof. Dr. Juan Apolinario · GTI 4º período → GTI 2º período. Documento consolidado para revisão em 26/10/2026.</sub>
