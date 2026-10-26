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

## 📋 Modelo para Futuros Registros

Para cada nova adição ou atualização aprovada pelo usuário, registre uma nova entrada seguindo o formato:

```markdown
### [DD/MM/AAAA] - [Título da Alteração]
- **Categoria:** [Linguagem e framework | Banco de dados | Estrutura técnica | Visual das telas | Testes automatizados]
- **O que foi adicionado/alterado:** [Descrição detalhada da mudança]
- **Por quê (Justificativa):** [Motivo técnico ou requisito de negócio que justificou a mudança]
- **Aprovado por:** [Nome do usuário / Responsável]
```
