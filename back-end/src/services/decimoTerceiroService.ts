/**
 * decimoTerceiroService.ts - Cálculo do 13º Salário (RN-46, RN-48, Seção 5.5 e Seção 8).
 */

import { DatabaseSync } from 'node:sqlite';
import { Dec } from '../dec.js';
import { calcularINSS, calcularIRRF } from '../calculo.js';
import { registrarLog } from './logService.js';

export interface CalcularDecimoTerceiroDTO {
  colaboradorId: number;
  ano: number;
  parcela: 1 | 2;
  mesesTrabalhados?: number;
  mediaHorasExtras?: number | string;
}

export function calcularDecimoTerceiro(
  db: DatabaseSync,
  usuarioSolicitante: { id: number; email: string; perfil: string },
  dados: CalcularDecimoTerceiroDTO
): any {
  if (usuarioSolicitante.perfil !== 'RH') {
    throw new Error('Você não tem permissão para esta ação.');
  }

  const colab = db.prepare('SELECT id, nome, admissao, salario_base_centavos FROM colaboradores WHERE id = ?')
    .get(dados.colaboradorId) as any;
  if (!colab) throw new Error('Colaborador não encontrado.');

  // Apuração dos meses trabalhados no ano (RN-46: mês com >= 15 dias trabalhados conta 1 avo)
  let meses = dados.mesesTrabalhados;
  if (meses === undefined) {
    const dataAdmissao = new Date(colab.admissao);
    const anoAdmissao = dataAdmissao.getUTCFullYear();
    if (anoAdmissao < dados.ano) {
      meses = 12;
    } else if (anoAdmissao === dados.ano) {
      const mesAdmissao = dataAdmissao.getUTCMonth(); // 0 a 11
      const diaAdmissao = dataAdmissao.getUTCDate();
      // Se admitido até o dia 15, o mês de admissão conta; se posterior (ex: dia 20), não conta
      const mesesRestantes = 11 - mesAdmissao;
      meses = diaAdmissao <= 15 ? mesesRestantes + 1 : mesesRestantes;
    } else {
      meses = 0;
    }
  }

  if (meses <= 0) {
    throw new Error('Colaborador sem meses de direito a 13º salário neste ano.');
  }

  const salarioBaseDec = new Dec(BigInt(colab.salario_base_centavos));
  const mediaHEDec = dados.mediaHorasExtras ? Dec.fromMoeda(dados.mediaHorasExtras) : Dec.zero();
  const baseIntegral = salarioBaseDec.add(mediaHEDec);

  // Proporcionalidade: (baseIntegral / 12) * meses
  const valorProporcionalIntegralNum = (baseIntegral.toNumber() / 12) * meses;
  const valorProporcionalIntegralDec = Dec.fromMoeda(valorProporcionalIntegralNum);

  const agora = new Date().toISOString();

  if (dados.parcela === 1) {
    // 1ª parcela = 50% do valor integral proporcional, SEM DESCONTOS (RN-46)
    const valor1aParcelaNum = valorProporcionalIntegralDec.toNumber() * 0.5;
    const valor1aParcelaDec = Dec.fromMoeda(valor1aParcelaNum);

    const stmt = db.prepare(`
      INSERT INTO decimo_terceiro (
        colaborador_id, ano, meses_trabalhados, parcela, valor_bruto_centavos,
        inss_centavos, irrf_centavos, desconto_primeira_parcela_centavos, liquido_centavos, calculado_em
      ) VALUES (?, ?, ?, 1, ?, 0, 0, 0, ?, ?)
      ON CONFLICT(colaborador_id, ano, parcela) DO UPDATE SET
        valor_bruto_centavos = excluded.valor_bruto_centavos,
        liquido_centavos = excluded.liquido_centavos,
        calculado_em = excluded.calculado_em
    `);

    stmt.run(
      dados.colaboradorId,
      dados.ano,
      meses,
      Number(valor1aParcelaDec.centavos),
      Number(valor1aParcelaDec.centavos),
      agora
    );

    registrarLog(db, {
      usuarioId: usuarioSolicitante.id,
      usuarioEmail: usuarioSolicitante.email,
      usuarioPerfil: usuarioSolicitante.perfil,
      acao: 'CALCULAR_13_1A_PARCELA',
      entidade: 'DECIMO_TERCEIRO',
      detalhes: `1ª parcela do 13º calculada para ${colab.nome}: ${valor1aParcelaDec.toFormatado()} (sem descontos)`,
    });

    return {
      colaboradorId: dados.colaboradorId,
      ano: dados.ano,
      parcela: 1,
      mesesTrabalhados: meses,
      valorBruto: valor1aParcelaDec.toNumber(),
      inss: 0,
      irrf: 0,
      liquido: valor1aParcelaDec.toNumber(),
    };
  } else {
    // 2ª parcela = 13º integral menos 1ª parcela, com INSS e IRRF sobre o valor integral
    const parcela1 = db.prepare('SELECT valor_bruto_centavos FROM decimo_terceiro WHERE colaborador_id = ? AND ano = ? AND parcela = 1')
      .get(dados.colaboradorId, dados.ano) as any;

    const valorPago1aDec = parcela1 ? new Dec(BigInt(parcela1.valor_bruto_centavos)) : Dec.fromMoeda(valorProporcionalIntegralDec.toNumber() * 0.5);

    // INSS e IRRF calculados exclusivamente na fonte sobre o total do 13º
    const { inssTotal } = calcularINSS(valorProporcionalIntegralDec);
    const { irrfFinal } = calcularIRRF(valorProporcionalIntegralDec, inssTotal, 0);

    // Líquido 2ª parcela = Integral - 1ª parcela - INSS - IRRF
    const liquido2aParcela = valorProporcionalIntegralDec
      .sub(valorPago1aDec)
      .sub(inssTotal)
      .sub(irrfFinal);

    const stmt = db.prepare(`
      INSERT INTO decimo_terceiro (
        colaborador_id, ano, meses_trabalhados, parcela, valor_bruto_centavos,
        inss_centavos, irrf_centavos, desconto_primeira_parcela_centavos, liquido_centavos, calculado_em
      ) VALUES (?, ?, ?, 2, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(colaborador_id, ano, parcela) DO UPDATE SET
        valor_bruto_centavos = excluded.valor_bruto_centavos,
        inss_centavos = excluded.inss_centavos,
        irrf_centavos = excluded.irrf_centavos,
        desconto_primeira_parcela_centavos = excluded.desconto_primeira_parcela_centavos,
        liquido_centavos = excluded.liquido_centavos,
        calculado_em = excluded.calculado_em
    `);

    stmt.run(
      dados.colaboradorId,
      dados.ano,
      meses,
      Number(valorProporcionalIntegralDec.centavos),
      Number(inssTotal.centavos),
      Number(irrfFinal.centavos),
      Number(valorPago1aDec.centavos),
      Number(liquido2aParcela.centavos),
      agora
    );

    registrarLog(db, {
      usuarioId: usuarioSolicitante.id,
      usuarioEmail: usuarioSolicitante.email,
      usuarioPerfil: usuarioSolicitante.perfil,
      acao: 'CALCULAR_13_2A_PARCELA',
      entidade: 'DECIMO_TERCEIRO',
      detalhes: `2ª parcela do 13º calculada para ${colab.nome}: Integral=${valorProporcionalIntegralDec.toFormatado()}, Desc1ª=${valorPago1aDec.toFormatado()}, INSS=${inssTotal.toFormatado()}, Líquido=${liquido2aParcela.toFormatado()}`,
    });

    return {
      colaboradorId: dados.colaboradorId,
      ano: dados.ano,
      parcela: 2,
      mesesTrabalhados: meses,
      valorTotalDevido: valorProporcionalIntegralDec.toNumber(),
      descontoPrimeiraParcela: valorPago1aDec.toNumber(),
      inss: inssTotal.toNumber(),
      irrf: irrfFinal.toNumber(),
      liquido: liquido2aParcela.toNumber(),
    };
  }
}
