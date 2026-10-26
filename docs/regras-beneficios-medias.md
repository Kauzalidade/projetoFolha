# Regras de benefícios e médias variáveis — RN-48, RN-50 e RN-51

Este documento operacionaliza, sem substituir, a Especificação de Requisitos v1.3 (`docs/spec.md`). A regra de negócio é a que consta na especificação/PDF; onde ela não define uma fórmula ou comportamento, este documento registra a lacuna em vez de inventar uma decisão.

## 1. RN-50 — Vale-transporte (VT)

### Regra normativa

- O VT só é concedido/descontado para colaborador que tenha optado pelo benefício.
- O RH informa o custo mensal do VT do colaborador.
- O desconto do colaborador é o menor entre 6% do salário-base e o custo mensal informado pelo RH.

### Fórmula

`descontoVT = min(salarioBase × 0,06, custoMensalVT)`

Se o colaborador não optou pelo VT, o desconto de VT é R$ 0,00.

### Exemplos de referência do PDF (seção 8, exemplo F)

| Salário-base | Custo mensal informado | Desconto esperado |
|---:|---:|---:|
| R$ 2.000,00 | R$ 180,00 | R$ 120,00 |
| R$ 2.000,00 | R$ 90,00 | R$ 90,00 |

### Memória de cálculo

Registrar, no mínimo, a regra RN-50, o salário-base utilizado, os 6%, o custo mensal informado, o valor calculado e o arredondamento aplicado. A verba deve identificar a competência e o colaborador. Os valores monetários devem usar representação decimal exata; aplicar o arredondamento RN-03 (duas casas, meio para cima, por verba antes da soma).

### Testes de aceitação derivados da regra

- Optante, salário-base R$ 2.000,00 e custo R$ 180,00: desconto R$ 120,00.
- Optante, salário-base R$ 2.000,00 e custo R$ 90,00: desconto R$ 90,00.
- Não optante: desconto de VT R$ 0,00.
- Custo exatamente igual a 6% do salário-base: desconto igual a esse valor, sem diferença de arredondamento.
- A competência fechada deve continuar obedecendo à regra geral de bloqueio de alterações (RN-04/RN-08).

Os dois primeiros casos são exemplos expressos do PDF; os demais verificam diretamente a regra, sem introduzir percentuais novos.

## 2. RN-51 — Vale-alimentação (VA)

### Regra normativa

- O valor do VA é mensal e fixo por colaborador, definido por parâmetro.
- A coparticipação padrão do colaborador é 0% e pode ser configurada.
- A tabela de incidência da especificação (seção 7.4) classifica o VT e o VA fornecidos pela empresa como sem incidência em INSS, IRRF e FGTS.

### Tratamento no sistema

- Manter o valor mensal do VA como parâmetro, sem fixá-lo no código.
- Representar a coparticipação padrão como 0% e permitir configuração pelo RH, respeitando a regra geral de parametrização (RN-01).
- Registrar competência, colaborador, valor de benefício aplicado, configuração de coparticipação usada e versão/vigência do parâmetro na memória de cálculo/auditoria.
- Não calcular incidência de INSS, IRRF ou FGTS sobre o VA fornecido pela empresa, conforme a tabela 7.4 da especificação.

### Lacuna que não deve ser decidida pelo código

A especificação informa que a coparticipação é configurável, mas não define se a configuração é percentual ou valor fixo, qual base deve receber o percentual, nem como o eventual desconto de VA se relaciona com a ordem/limitação de descontos da RN-06. Portanto, não se deve presumir uma dessas opções. Antes de implementar coparticipação diferente de 0%, o responsável de negócio deve confirmar a forma de configuração e o tratamento do desconto; até lá, o comportamento fiel ao padrão adotado é coparticipação de 0%.

### Testes de aceitação derivados da regra

- Com o parâmetro mensal de VA cadastrado e coparticipação padrão, aplicar o valor mensal definido e coparticipação de R$ 0,00.
- Alterar o parâmetro para uma nova vigência: competências anteriores continuam usando o parâmetro vigente nelas (RN-01).
- Confirmar que o VA fornecido pela empresa não compõe as bases de INSS, IRRF ou FGTS, conforme a tabela 7.4.
- Para coparticipação diferente de 0%, exigir decisão documentada sobre tipo de valor/base e limites de desconto antes de fixar resultado numérico esperado.

Estes testes não definem um valor monetário para VA nem uma fórmula de coparticipação que o PDF não especifica.

## 3. RN-48 — Fórmula das médias de horas extras e DSR

### Períodos e fórmula normativa

A média mensal das horas extras **e do DSR sobre essas horas extras** é a soma dos valores pagos no período de referência dividida por 12:

- **Férias:** período aquisitivo correspondente.
- **13º salário:** ano de referência.

`mediaMensalVariaveis = (somaHorasExtrasPagas + somaDSRPagoSobreHorasExtras) / 12`

Não somar apenas as horas extras e omitir o DSR correspondente. Considerar os valores efetivamente pagos no período, conforme a redação da RN-48.

### Aplicação da média

- **Férias:** `baseFerias = salarioBaseAplicavel + mediaMensalVariaveis`. Calcular o adicional constitucional de 1/3 sobre essa remuneração, incluindo a média.
- **13º:** incluir a média mensal de variáveis na base de cálculo do 13º, observando também as regras de elegibilidade e parcelas da RN-46.
- Aplicar o arredondamento RN-03 a cada verba calculada antes de totalizar. Usar decimal exato para cálculos monetários.
- A memória deve informar período consultado, soma de horas extras pagas, soma do DSR correspondente, divisor 12, média encontrada, salário-base, fórmula aplicada, arredondamento e parâmetros/versões relevantes.

### Exemplo expresso no PDF (seção 8, exemplo K)

Salário-base de R$ 2.200,00 e total de horas extras mais DSR pagos no período de R$ 1.800,00:

| Etapa | Cálculo | Resultado esperado |
|---|---|---:|
| Média mensal | R$ 1.800,00 ÷ 12 | R$ 150,00 |
| Base de férias/13º | R$ 2.200,00 + R$ 150,00 | R$ 2.350,00 |
| 1/3 de férias | R$ 2.350,00 ÷ 3, arredondado por verba | R$ 783,33 |
| Total de férias (30 dias) | R$ 2.350,00 + R$ 783,33 | R$ 3.133,33 |
| 1ª parcela do 13º (12/12, conforme exemplo) | 50% de R$ 2.350,00 | R$ 1.175,00 |
| 2ª parcela do 13º, após INSS do exemplo | R$ 2.350,00 − R$ 1.175,00 − R$ 187,19 | R$ 987,81 |

O PDF especifica INSS de R$ 187,19 e IRRF de R$ 0,00 para o exemplo da segunda parcela.

### Testes de aceitação

- **Exemplo K:** soma paga de variáveis de R$ 1.800,00 gera média de R$ 150,00; base de férias/13º de R$ 2.350,00; férias com 1/3 totalizam R$ 3.133,33.
- **1ª parcela do 13º:** no exemplo com 12 meses, média de R$ 150,00 e salário-base R$ 2.200,00, resultado de R$ 1.175,00 sem descontos (RN-46).
- **2ª parcela do 13º:** para o mesmo exemplo, INSS R$ 187,19, IRRF R$ 0,00 e parcela de R$ 987,81.
- **DSR incluído:** garantir que a soma de entrada contem horas extras pagas e o DSR pago sobre elas, evitando omissão ou duplicação.
- **Separação de períodos:** férias usam o período aquisitivo; 13º usa o ano de referência.
- **Precisão:** validar arredondamento de cada verba conforme RN-03 e tolerância de até R$ 0,01 prevista na especificação.

### Ponto de atenção sobre proporcionalidade

A RN-48 fixa a divisão por 12; a RN-46 também define o 13º proporcional por meses com pelo menos 15 dias trabalhados e descreve a primeira parcela como contendo a média proporcional. A forma exata de ajustar a média em casos de ano incompleto não está detalhada além dessas regras. Não alterar o divisor ou criar uma fórmula alternativa sem decisão formal do responsável pela especificação.

## 4. Critérios transversais de implementação

1. Valores monetários devem usar decimal exato, nunca aritmética binária de ponto flutuante.
2. Arredondar cada verba para duas casas, meio para cima, antes da soma (RN-03).
3. Parâmetros devem ter vigência e o cálculo deve selecionar o valor válido para a competência (RN-01).
4. A memória de cálculo deve permitir reconstituir a base, a fórmula, os valores de origem, o parâmetro usado e o arredondamento (RN-02).
5. Benefícios e médias precisam de testes automatizados unitários e de integração antes de serem considerados prontos.
6. A documentação não comprova implementação. Na revisão da branch `main` feita para esta alteração, não havia árvore `back-end/src/` nem `back-end/tests/` visível; por isso, esta entrega documenta e especifica os comportamentos e testes, mas não declara os cálculos implementados ou executados.

## Referência

- PDF fornecido: *Especificação de Requisitos — Sistema de RH e Folha de Pagamento*, v1.3, seções 5.5 (RN-48), 5.6 (RN-50/RN-51), 7.4, 8 (exemplos F e K), 10 (cenários Gherkin) e 15.
- Versão consolidada no repositório: [`docs/spec.md`](./spec.md).
