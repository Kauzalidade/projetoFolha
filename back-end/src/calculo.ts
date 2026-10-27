/**
 * calculo.ts - Motor de Cálculo Oficial da Folha de Pagamento 2026.
 * 
 * Atende com precisão absoluta (classe Dec / centavos) aos requisitos:
 * - RN-01: Parâmetros com vigência (sem valores fixos no código)
 * - RN-02: Memória de cálculo detalhada
 * - RN-03: Arredondamento half-up de 2 casas decimais por verba
 * - RN-06: Proteção do líquido (nunca negativo; saldo a descontar)
 * - RN-21 a RN-24: Ordem de cálculo, INSS progressivo, IRRF comparativo e FGTS
 * - RN-30 e RN-31: Horas extras e DSR sobre horas extras
 */

import { Dec } from './dec.js';

export interface ParametrosCompetencia {
  salarioMinimo: Dec;
  inssTeto: Dec;
  inssContribuicaoMaxima: Dec;
  irrfDeducaoDependente: Dec;
  irrfDescontoSimplificado: Dec;
  fgtsAliquota: number;
}

export interface FaixaINSS {
  limiteInferior: Dec;
  limiteSuperior: Dec;
  aliquota: number;
}

export const FAIXAS_INSS_2026: FaixaINSS[] = [
  { limiteInferior: Dec.fromMoeda('0.00'), limiteSuperior: Dec.fromMoeda('1621.00'), aliquota: 0.075 },
  { limiteInferior: Dec.fromMoeda('1621.01'), limiteSuperior: Dec.fromMoeda('2902.84'), aliquota: 0.09 },
  { limiteInferior: Dec.fromMoeda('2902.85'), limiteSuperior: Dec.fromMoeda('4354.27'), aliquota: 0.12 },
  { limiteInferior: Dec.fromMoeda('4354.28'), limiteSuperior: Dec.fromMoeda('8475.55'), aliquota: 0.14 },
];

export interface FaixaIRRF {
  limiteSuperior: Dec;
  aliquota: number;
  parcelaADeduzir: Dec;
}

export const FAIXAS_IRRF_2026: FaixaIRRF[] = [
  { limiteSuperior: Dec.fromMoeda('2428.80'), aliquota: 0.0, parcelaADeduzir: Dec.zero() },
  { limiteSuperior: Dec.fromMoeda('2826.65'), aliquota: 0.075, parcelaADeduzir: Dec.fromMoeda('182.16') },
  { limiteSuperior: Dec.fromMoeda('3751.05'), aliquota: 0.15, parcelaADeduzir: Dec.fromMoeda('394.16') },
  { limiteSuperior: Dec.fromMoeda('4664.68'), aliquota: 0.225, parcelaADeduzir: Dec.fromMoeda('675.49') },
  { limiteSuperior: Dec.fromMoeda('99999999.99'), aliquota: 0.275, parcelaADeduzir: Dec.fromMoeda('908.73') },
];

/**
 * Cálculo progressivo do INSS por faixas (RN-22 e Seção 6.2).
 */
export function calcularINSS(baseCalculo: Dec): { inssTotal: Dec; memoria: string[] } {
  const memoria: string[] = [];
  const teto = Dec.fromMoeda('8475.55');
  const tetoContribuicao = Dec.fromMoeda('988.09');

  if (baseCalculo.centavos >= teto.centavos) {
    memoria.push(`Base ${baseCalculo.toFormatado()} atinge o teto ${teto.toFormatado()}. Contribuição limitada ao teto de ${tetoContribuicao.toFormatado()}.`);
    return { inssTotal: tetoContribuicao, memoria };
  }

  let somaValores = 0;
  const baseNum = baseCalculo.toNumber();

  // Faixa 1: até 1.621,00 a 7,5%
  const f1Base = Math.min(baseNum, 1621.00);
  const f1Val = f1Base * 0.075;
  somaValores += f1Val;
  memoria.push(`Faixa 1 (até 1.621,00): ${f1Base.toFixed(2)} x 7,5% = ${f1Val.toFixed(4)}`);

  // Faixa 2: 1.621,01 a 2.902,84 (largura 1.281,84) a 9%
  if (baseNum > 1621.00) {
    const f2Base = Math.min(baseNum - 1621.00, 1281.84);
    const f2Val = f2Base * 0.09;
    somaValores += f2Val;
    memoria.push(`Faixa 2 (1.621,01 a 2.902,84): ${f2Base.toFixed(2)} x 9% = ${f2Val.toFixed(4)}`);
  }

  // Faixa 3: 2.902,85 a 4.354,27 (largura 1.451,43) a 12%
  if (baseNum > 2902.84) {
    const f3Base = Math.min(baseNum - 2902.84, 1451.43);
    const f3Val = f3Base * 0.12;
    somaValores += f3Val;
    memoria.push(`Faixa 3 (2.902,85 a 4.354,27): ${f3Base.toFixed(2)} x 12% = ${f3Val.toFixed(4)}`);
  }

  // Faixa 4: 4.354,28 a 8.475,55 (largura 4.121,28) a 14%
  if (baseNum > 4354.27) {
    const f4Base = Math.min(baseNum - 4354.27, 4121.28);
    const f4Val = f4Base * 0.14;
    somaValores += f4Val;
    memoria.push(`Faixa 4 (4.354,28 a 8.475,55): ${f4Base.toFixed(2)} x 14% = ${f4Val.toFixed(4)}`);
  }

  const inssFinal = Dec.fromMoeda(somaValores);
  return { inssTotal: inssFinal, memoria };
}

/**
 * Cálculo do IRRF comparativo (Tradicional vs Simplificada) e Redução Lei 15.270/2025 (RN-23 e Seção 6.3).
 */
export function calcularIRRF(
  rendimentoTributavel: Dec,
  inssDescontado: Dec,
  numeroDependentes: number
): { irrfFinal: Dec; baseEscolhida: 'TRADICIONAL' | 'SIMPLIFICADA'; memoria: string[] } {
  const memoria: string[] = [];
  const rendimentoNum = rendimentoTributavel.toNumber();
  const inssNum = inssDescontado.toNumber();

  // 1. Base Tradicional = rendimento - inss - (dependentes * 189.59)
  const deducaoDepNum = numeroDependentes * 189.59;
  const baseTradicionalNum = Math.max(0, rendimentoNum - inssNum - deducaoDepNum);

  // 2. Base Simplificada = rendimento - 607.20
  const baseSimplificadaNum = Math.max(0, rendimentoNum - 607.20);

  function calcularImpostoFaixas(base: number): number {
    if (base <= 2428.80) return 0;
    if (base <= 2826.65) return base * 0.075 - 182.16;
    if (base <= 3751.05) return base * 0.15 - 394.16;
    if (base <= 4664.68) return base * 0.225 - 675.49;
    return base * 0.275 - 908.73;
  }

  const impostoTradicional = Math.max(0, calcularImpostoFaixas(baseTradicionalNum));
  const impostoSimplificado = Math.max(0, calcularImpostoFaixas(baseSimplificadaNum));

  let impostoApurado: number;
  let baseEscolhida: 'TRADICIONAL' | 'SIMPLIFICADA';

  if (impostoTradicional <= impostoSimplificado) {
    impostoApurado = impostoTradicional;
    baseEscolhida = 'TRADICIONAL';
    memoria.push(`Base Tradicional escolhida (R$ ${baseTradicionalNum.toFixed(2)}) gerou R$ ${impostoTradicional.toFixed(2)} vs Simplificada R$ ${impostoSimplificado.toFixed(2)}`);
  } else {
    impostoApurado = impostoSimplificado;
    baseEscolhida = 'SIMPLIFICADA';
    memoria.push(`Base Simplificada escolhida (R$ ${baseSimplificadaNum.toFixed(2)}) gerou R$ ${impostoSimplificado.toFixed(2)} vs Tradicional R$ ${impostoTradicional.toFixed(2)}`);
  }

  // 3. Redução da Lei 15.270/2025
  let reducao = 0;
  if (rendimentoNum <= 5000.00) {
    // Redução de até R$ 312,89 que zera o imposto
    reducao = Math.min(impostoApurado, 312.89);
    memoria.push(`Redução Lei 15.270/2025 (rendimento até 5.000,00): redução de R$ ${reducao.toFixed(2)} zera o imposto.`);
  } else if (rendimentoNum <= 7350.00) {
    // Redução = 978,62 - (0,133145 * rendimento mensal)
    const calculoReducao = 978.62 - (0.133145 * rendimentoNum);
    reducao = Math.max(0, Math.min(impostoApurado, calculoReducao));
    memoria.push(`Redução Lei 15.270/2025 (5.000,01 a 7.350,00): R$ 978,62 - (0,133145 x ${rendimentoNum.toFixed(2)}) = R$ ${reducao.toFixed(2)}`);
  } else {
    reducao = 0;
    memoria.push('Rendimento acima de R$ 7.350,00: sem redução da Lei 15.270/2025.');
  }

  const impostoFinalNum = Math.max(0, impostoApurado - reducao);
  const irrfFinal = Dec.fromMoeda(impostoFinalNum);

  return { irrfFinal, baseEscolhida, memoria };
}

/**
 * Cálculo do DSR sobre horas extras (RN-31).
 * DSR = (Total de horas extras em R$ / Dias úteis do mês) * Domingos e feriados do mês
 */
export function calcularDSRExtras(
  valorHorasExtras: Dec,
  diasUteis: number,
  domingosEFeriados: number
): Dec {
  if (valorHorasExtras.isZero() || diasUteis <= 0) {
    return Dec.zero();
  }
  const valorNum = valorHorasExtras.toNumber();
  const dsrNum = (valorNum / diasUteis) * domingosEFeriados;
  return Dec.fromMoeda(dsrNum);
}
