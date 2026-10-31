# Perguntas Pendentes e Hipóteses de Negócio

Este documento registra todas as pendências formais, hipóteses não confirmadas e dúvidas de negócio do **Sistema de RH e Folha de Pagamento**.

> **Regra de ouro:** Se faltar informação, **não inventem a regra**; anotem a dúvida neste arquivo e perguntem ao **GTI 4º período** ou ao cliente.

---

## 📌 1. Pendências Oficiais da Especificação (Seção 16)

| ID | Pendência | Responsável | Impede Início? | Status Atual | Detalhamento / Pergunta |
| :---: | :--- | :--- | :---: | :---: | :--- |
| **P-01** | **Convenção Coletiva de Trabalho (CCT)** | Grupo de RH | Não (usar padrões CLT) | Aberto | Qual o sindicato/CCT da categoria? Existem pisos salariais específicos, adicionais de horas extras diferenciados ou regras próprias para VT/VA? |
| **P-02** | **Conferência das tabelas e regras por contador** | Cliente / Contador | Não (necessária antes de produção) | Aberto | O contador do cliente validou os cálculos de 2026 (Portaria MPS/MF 13/2026 e Lei 15.270/2025 para IRRF com redução progressiva)? |
| **P-03** | **Tratamento de afastados na folha** | Grupo de RH | Não na 1ª versão | Aberto | Como tratar afastamento por INSS (>15 dias), licença maternidade e paternidade no cálculo do salário e nos encargos? |
| **P-04** | **Confirmação dos itens adotados [ADOTADO]** | Grupo de RH | Não (parâmetros configuráveis) | Aberto | Confirmar os padrões definidos pelo GTI 4º período (arredondamento, prazos de retenção LGPD, relatórios e layout de contracheque). |
| **P-05** | **Proporcionalidade em meses de 31, 28 e 29 dias (RN-20)** | Grupo de RH / GTI 4º período | Não (aguardando validação de regra definitiva) | Aberto | Como apurar os dias trabalhados e a remuneração proporcional na admissão e desligamento em meses com 31 dias e em fevereiro (28 ou 29 dias bissexto)? O código atual utiliza a fórmula fixa `(30 - diaAdm + 1)`, gerando: (1) Admissão em 31/10/2026 com salário R$ 3.000,00 resulta em 0 dias trabalhados (R$ 0,00), deixando o colaborador sem remuneração pelo dia trabalhado; (2) Desligamento em 31/10/2026 com salário R$ 3.000,00 resulta em 31 dias (R$ 3.100,00), superando o salário contratual integral; (3) Admissão no último dia de fevereiro (28/02 em ano comum ou 29/02 em ano bissexto) resulta em 3 ou 2 dias pagos para 1 dia trabalhado. A regra definitiva depende de validação formal pelo grupo de RH e pelos responsáveis técnicos (GTI 4º período). |

---

## 🔍 2. Hipóteses Consolidadas na Especificação v1.3 ([ADOTADO])

Todas as hipóteses abaixo foram formalizadas e adotadas pelo **GTI 4º período** na versão 1.3 da especificação, tornando-se regras operacionais ativas:

| Ref. | Tema | Decisão Oficial v1.3 ([ADOTADO]) | Regra Associada | Status na v1.3 |
| :--- | :--- | :--- | :--- | :---: |
| **H-01** | Reabertura de Competência | O RH reabre a competência por conta própria informando justificativa obrigatória. O sistema homologa imediatamente, grava evento destacado no Log de Auditoria imutável e notifica a Diretoria para fiscalização. | RN-04 | **Adotado** |
| **H-02** | Acesso a Dados de Saúde | Apenas o RH tem acesso a atestados e exames. A Diretoria **não** tem acesso a dados de saúde; cada consulta gera log. | RN-54 / Seção 4 | **Adotado** |
| **H-03** | Campos Mínimos e Validações | Nome (>=3 chars), CPF (11 dígitos e DV válidos), nascimento, admissão, cargo, setor, filial, salário-base (>0), jornada, dados bancários e dependentes IRRF. | RN-10, RN-15 | **Adotado** |
| **H-04** | Proporcionalidade de Mês Incompleto | Admissão ou demissão no mês calcula proporcional aos dias trabalhados na base de 30 avos: `(salario-base / 30) * dias`. | RN-20 | **Adotado** |
| **H-05** | Fracionamento de Férias | Permitido em até 3 períodos: um de no mínimo 14 dias e os demais com no mínimo 5 dias. | RN-42 | **Adotado** |
| **H-06** | Redução de Férias por Faltas | Faltas injustificadas reduzem o período aquisitivo conforme a tabela da CLT (art. 130), configurável via parâmetro. | RN-44 | **Adotado** |
| **H-07** | Plataforma de Acesso | Sistema projetado para computador/desktop; versão para celular fica para a 2ª versão. | RNF-06 | **Adotado** |

---

## ⚙️ 3. Padrões Adotados pelo GTI 4º Período ([ADOTADO])

Os itens abaixo foram configurados com base nas melhores práticas pelo grupo de requisitos, mas podem ser ajustados via parâmetros pelo cliente:

1. **Arredondamento (RN-03):** 2 casas decimais, arredondamento "metade para cima" (*half-up*), aplicado em cada verba antes de totalizar a folha.
2. **Vale-transporte (RN-50):** Opcional ao colaborador; desconto do menor valor entre 6% do salário-base e o custo informado pelo RH.
3. **Vale-alimentação (RN-51):** Valor mensal fixo por colaborador parametrizável, com coparticipação padrão de 0%.
4. **Contracheque (RN-55):** Emitido em PDF pelo RH (não haverá portal de autoatendimento para o colaborador na v1).
5. **Retenção LGPD (RN-56):** Preservação dos dados durante a vigência do contrato e por 5 anos após a rescisão; após isso, o sistema sugere anonimização com confirmação do RH.
6. **Relatórios (Seção 13):** Exportação disponível nos formatos PDF e Excel com carimbo de competência, filial, data e usuário responsável.

---

## 📝 4. Registro de Novas Dúvidas e Decisões

Ao encontrar uma nova dúvida durante o desenvolvimento, utilize a tabela abaixo para registrá-la:

| Data | Questão Encontrada | Responsável | Resposta / Decisão | Data da Resolução |
| :---: | :--- | :---: | :--- | :---: |
| 14/10/2026 | Divergência no número de colaboradores e filiais | GTI 4º | Confirmado pelo cliente: 15 colaboradores, 1 matriz + 2 filiais | 14/10/2026 |
| 31/10/2026 | Inconsistência na proporcionalidade em meses de 31, 28 e 29 dias (admissão em 31/10 resulta em R$ 0,00; desligamento em 31/10 resulta em R$ 3.100,00) | Grupo de RH e GTI 4º | Aberto — Registrado em P-05. Aguardando validação da regra definitiva | — |
| — | *(Adicione novas dúvidas aqui)* | — | — | — |
