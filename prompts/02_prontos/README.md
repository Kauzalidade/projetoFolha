# Prompts Prontos — Sistema de RH e Folha de Pagamento

## Objetivo

Esta pasta reúne prompts estruturados para auxiliar o desenvolvimento do Sistema de RH e Folha de Pagamento com inteligência artificial.

Os prompts devem respeitar os requisitos definidos em `docs/spec.md`, as orientações do `AGENTS.md` e as tecnologias adotadas pela equipe.

## Prompts disponíveis

### P03 — Geração de Testes Automatizados

**Arquivo:** `P03-geracao-testes-automatizados.md`

**Versão:** 1.1

**Responsável pela elaboração e validação:** José Geremias

**Tecnologias previstas:** Node.js e TypeScript.

**Finalidade:** orientar uma IA na análise dos requisitos e na geração de testes automatizados para funcionalidades já implementadas.

O P03 contempla:

- Análise da especificação e do código existente.
- Identificação de funcionalidades que podem ser testadas.
- Planejamento de cenários normais, inválidos e casos de borda.
- Geração de testes compatíveis com a estrutura do projeto.
- Execução dos testes e apresentação de resultados verificáveis.
- Identificação de problemas e pendências.

## Como utilizar o P03

1. Abra o projeto no Antigravity IDE.
2. Leia o arquivo `P03-geracao-testes-automatizados.md`.
3. Envie o prompt principal juntamente com a instrução complementar de análise.
4. Revise o planejamento apresentado pela IA.
5. Autorize a criação dos testes somente após conferir o escopo.
6. Execute os testes no ambiente configurado.
7. Registre os resultados obtidos.

## Situação da validação

A versão 1.0 do P03 foi validada anteriormente em um ambiente Python, com 51 testes executados e aprovados.

A versão 1.1 foi adaptada para Node.js e TypeScript.

Em 24/10/2026, foi realizada uma nova análise no Antigravity IDE. O prompt identificou corretamente a documentação e a ausência de código TypeScript executável na branch `main`.

**Status atual:** análise e planejamento concluídos; execução funcional da versão 1.1 pendente.

A validação completa será realizada quando a implementação Node.js/TypeScript estiver disponível.

## Relatório de validação

O relatório da versão anterior está disponível em:

`prompts/01_testes/validacao-P03.md`

Os resultados da versão 1.0 não devem ser apresentados como evidência de execução da versão 1.1.

## Boas práticas

- Não inventar regras de negócio.
- Não alterar funcionalidades existentes apenas para fazer testes passarem.
- Não utilizar dados reais de colaboradores.
- Não afirmar que testes passaram sem execução verificável.
- Não realizar commits ou merges sem autorização da equipe.
- Registrar limitações e requisitos ainda não definidos.
