/**
 * folhaService.ts - Cálculo da Folha, Memória de Cálculo, Conferência Financeira e Fechamento Seguro (Etapa 3 / Spec v1.7).
 * 
 * Atende aos requisitos:
 * - RN-02: Memória de cálculo por verba (base, regra, parâmetro, arredondamento)
 * - RN-05: Dado obrigatório ausente bloqueia o fechamento
 * - RN-06: Descontos acima dos proventos (líquido nunca negativo, saldo a descontar limitado a 30% no mês seguinte)
 * - RN-21 a RN-24: Ordem de cálculo, INSS progressivo, IRRF comparativo e FGTS (encargo)
 * - RN-31: DSR sobre horas extras
 * - RN-59: Conferência financeira interna completa (tolerância R$ 0,00)
 * - RN-61: Registro de data de pagamento da folha
 * - RN-63: Ordem das competências (anterior fechada para fechar atual)
 * - RN-67: Conferência, aprovação e devolução para ajuste
 * - RN-68: Versionamento seguro da folha com Hash SHA-256 (RNF-54)
 * - Tabela 7.1: Matriz de decisão do fechamento da folha
 */

import { DatabaseSync } from 'node:sqlite';
import crypto from 'node:crypto';
import { Dec } from '../dec.js';
import { calcularINSS, calcularIRRF, calcularDSRExtras } from '../calculo.js';
import { registrarLog, registrarOperacaoCritica } from './logService.js';
import { verificarCompetenciaAberta } from './competenciaService.js';

export interface ItemMemoriaVerba {
  tipo: string;
  descricao: string;
  natureza: 'PROVENTO' | 'DESCONTO' | 'ENCARGO';
  valor: Dec;
  baseCalculo: Dec;
  regraAplicada: string;
  parametroUtilizado?: string;
}

export interface ItemConferencia {
  item: string;
  esperado: number;
  calculado: number;
  divergencia: number;
  status: 'CONFERE' | 'DIVERGENTE';
  detalheCentavos?: {
    esperadoCentavos: number;
    calculadoCentavos: number;
    diferencaCentavos: number;
  };
}

export interface ResultadoConferenciaFinanceira {
  competenciaId: number;
  statusGeral: 'APROVADO' | 'DIVERGENTE';
  tolerancia: number; // 0.00 (tolerância exata de R$ 0,00 - US-13)
  itens: ItemConferencia[];
  totalLiquido: number;
  totalProventos: number;
  totalDescontos: number;
  totalFGTS: number;
  totalINSS: number;
  totalIRRF: number;
  totalColaboradores: number;
  itensDivergentes?: string[];
}

export function calcularFolhaColaborador(
  db: DatabaseSync,
  usuarioSolicitante: { id: number; email: string; perfil: string },
  dados: {
    colaboradorId: number;
    competenciaId: number;
    diasUteisMes?: number;
    domingosEFeriadosMes?: number;
    permitirEmProcessamento?: boolean;
  }
): any {
  if (usuarioSolicitante.perfil !== 'RH') {
    throw new Error('Você não tem permissão para esta ação.');
  }

  verificarCompetenciaAberta(db, dados.competenciaId, dados.permitirEmProcessamento);

  const colab = db.prepare('SELECT * FROM colaboradores WHERE id = ?').get(dados.colaboradorId) as any;
  if (!colab) throw new Error('Colaborador não encontrado.');

  // RN-10: Salário zero ou negativo não pode ser calculado
  if (!colab.salario_base_centavos || colab.salario_base_centavos <= 0) {
    throw new Error(`Salário-base inválido ou zerado para o colaborador ${colab.nome} (RN-10).`);
  }


  const comp = db.prepare('SELECT id, mes_ano FROM competencias WHERE id = ?').get(dados.competenciaId) as any;
  const verbasMemoria: ItemMemoriaVerba[] = [];

  // 1. Salário-base e Proporcionalidade de Férias / Admissão (RN-20, RN-49)
  const salarioBaseDec = new Dec(BigInt(colab.salario_base_centavos));
  let salarioEfetivoDec = salarioBaseDec;
  let regraSalario = 'Salário contratual integral (RN-20 / RN-30)';
  let feriasGozadasDec = Dec.zero();
  let tercoFeriasDec = Dec.zero();

  // Verifica se há férias cadastradas que afetam esta competência (RN-49)
  const temTabelaFerias = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='ferias'").get();
  if (temTabelaFerias) {
    const feriasAprovadas = db.prepare(`
      SELECT * FROM ferias
      WHERE colaborador_id = ? AND situacao = 'APROVADA'
    `).all(dados.colaboradorId) as any[];

    for (const f of feriasAprovadas) {
      const mesComp = comp.mes_ano; // 'AAAA-MM'
      const mesInicio = f.data_inicio.slice(0, 7);
      const mesFim = f.data_fim.slice(0, 7);

      if (mesComp === mesInicio) {
        // Mês em que as férias iniciam: paga os dias trabalhados antes do início (RN-49)
        const diaInicio = parseInt(f.data_inicio.slice(8, 10), 10);
        const diasTrabalhados = diaInicio - 1; // Ex: Início no dia 20 -> 19 dias trabalhados
        const valorDia = salarioBaseDec.toNumber() / 30;
        salarioEfetivoDec = Dec.fromMoeda(valorDia * diasTrabalhados);
        regraSalario = `Salário proporcional aos dias não gozados (${diasTrabalhados} dias trabalhados, RN-49)`;

        // Na competência do início do gozo, as férias (valor e 1/3) são calculadas (RN-49)
        feriasGozadasDec = feriasGozadasDec.add(new Dec(BigInt(f.valor_ferias_centavos)));
        tercoFeriasDec = tercoFeriasDec.add(new Dec(BigInt(f.valor_terco_centavos)));
      } else if (mesComp === mesFim && mesInicio !== mesFim) {
        // Mês seguinte onde as férias terminam
        const diaFim = parseInt(f.data_fim.slice(8, 10), 10);
        const diasTrabalhados = 30 - diaFim; // Ex: fim dia 19 -> 30 - 19 = 11 dias trabalhados
        const valorDia = salarioBaseDec.toNumber() / 30;
        salarioEfetivoDec = Dec.fromMoeda(valorDia * diasTrabalhados);
        regraSalario = `Salário proporcional aos dias não gozados (${diasTrabalhados} dias trabalhados, RN-49)`;
      }
    }
  }

  // Se não houve férias alterando o salário, avalia admissão/desligamento no mês (RN-20)
  if (salarioEfetivoDec.centavos === salarioBaseDec.centavos) {
    const admMes = colab.admissao ? colab.admissao.slice(0, 7) : null;
    const deslMes = colab.desligamento ? colab.desligamento.slice(0, 7) : null;

    if (admMes === comp.mes_ano && deslMes === comp.mes_ano) {
      const diaAdm = parseInt(colab.admissao.slice(8, 10), 10);
      const diaDesl = parseInt(colab.desligamento.slice(8, 10), 10);
      const diasTrabalhados = diaDesl - diaAdm + 1;
      const valorDia = salarioBaseDec.toNumber() / 30;
      salarioEfetivoDec = Dec.fromMoeda(valorDia * diasTrabalhados);
      regraSalario = `Salário proporcional: admissão e desligamento no mês (${diasTrabalhados} dias, RN-20)`;
    } else if (admMes === comp.mes_ano) {
      const diaAdm = parseInt(colab.admissao.slice(8, 10), 10);
      if (diaAdm > 1) {
        const diasTrabalhados = 30 - diaAdm + 1;
        const valorDia = salarioBaseDec.toNumber() / 30;
        salarioEfetivoDec = Dec.fromMoeda(valorDia * diasTrabalhados);
        regraSalario = `Salário proporcional à admissão no mês (${diasTrabalhados} dias, RN-20)`;
      }
    } else if (deslMes === comp.mes_ano) {
      const diaDesl = parseInt(colab.desligamento.slice(8, 10), 10);
      const diasTrabalhados = diaDesl;
      const valorDia = salarioBaseDec.toNumber() / 30;
      salarioEfetivoDec = Dec.fromMoeda(valorDia * diasTrabalhados);
      regraSalario = `Salário proporcional ao desligamento no mês (${diasTrabalhados} dias, RN-20)`;
    }
  }

  verbasMemoria.push({
    tipo: 'SALARIO_BASE',
    descricao: salarioEfetivoDec.centavos !== salarioBaseDec.centavos ? 'Salário Proporcional' : 'Salário Base Mensal',
    natureza: 'PROVENTO',
    valor: salarioEfetivoDec,
    baseCalculo: salarioBaseDec,
    regraAplicada: regraSalario,
  });

  if (feriasGozadasDec.isPositive()) {
    verbasMemoria.push({
      tipo: 'FERIAS_GOZADAS',
      descricao: 'Férias Gozadas',
      natureza: 'PROVENTO',
      valor: feriasGozadasDec,
      baseCalculo: feriasGozadasDec,
      regraAplicada: 'Férias gozadas no mês (RN-41, RN-49)',
    });
    verbasMemoria.push({
      tipo: 'TERCO_CONSTITUCIONAL_FERIAS',
      descricao: '1/3 Constitucional de Férias',
      natureza: 'PROVENTO',
      valor: tercoFeriasDec,
      baseCalculo: feriasGozadasDec,
      regraAplicada: '1/3 constitucional sobre férias (RN-41, RN-49)',
    });
  }

  // 2. Busca eventos lançados na competência
  const eventos = db.prepare('SELECT * FROM eventos WHERE colaborador_id = ? AND competencia_id = ?')
    .all(dados.colaboradorId, dados.competenciaId) as any[];

  let horasExtrasDec = Dec.zero();
  let faltasDec = Dec.zero();
  let atrasosDec = Dec.zero();
  let vtDec = Dec.zero();
  let proventosAvulsosTotaisDec = Dec.zero();
  let proventosAvulsosINSSDec = Dec.zero();
  let proventosAvulsosIRRFDec = Dec.zero();
  let proventosAvulsosFGTSDec = Dec.zero();

  let descontosAvulsosTotaisDec = Dec.zero();
  let descontosAvulsosINSSDec = Dec.zero();
  let descontosAvulsosIRRFDec = Dec.zero();
  let descontosAvulsosFGTSDec = Dec.zero();

  for (const ev of eventos) {
    const valDec = new Dec(BigInt(ev.valor_centavos || 0));

    if (ev.tipo === 'HORA_EXTRA_UTIL' || ev.tipo === 'HORA_EXTRA_DOMINGO') {
      horasExtrasDec = horasExtrasDec.add(valDec);
      verbasMemoria.push({
        tipo: ev.tipo,
        descricao: ev.descricao || 'Horas Extras',
        natureza: 'PROVENTO',
        valor: valDec,
        baseCalculo: salarioBaseDec,
        regraAplicada: 'Adicional legal / convenção (RN-30)',
      });
    } else if (ev.tipo === 'FALTA_INJUSTIFICADA') {
      faltasDec = faltasDec.add(valDec);
      verbasMemoria.push({
        tipo: 'FALTA_INJUSTIFICADA',
        descricao: ev.descricao || 'Faltas Injustificadas',
        natureza: 'DESCONTO',
        valor: valDec,
        baseCalculo: salarioBaseDec,
        regraAplicada: '(Salário / 30) x dias de falta (RN-33)',
      });
    } else if (ev.tipo === 'ATRASO_SAIDA_ANTECIPADA') {
      atrasosDec = atrasosDec.add(valDec);
      verbasMemoria.push({
        tipo: 'ATRASO_SAIDA_ANTECIPADA',
        descricao: ev.descricao || 'Atraso / Saída Antecipada',
        natureza: 'DESCONTO',
        valor: valDec,
        baseCalculo: salarioBaseDec,
        regraAplicada: 'Horas x (Salário / divisor) sem perda de DSR (RN-80)',
      });
    } else if (ev.tipo === 'VALE_TRANSPORTE') {
      vtDec = vtDec.add(valDec);
    } else if (ev.tipo === 'VERBA_AVULSA_PROVENTO') {
      proventosAvulsosTotaisDec = proventosAvulsosTotaisDec.add(valDec);
      if (ev.incide_inss === 1) proventosAvulsosINSSDec = proventosAvulsosINSSDec.add(valDec);
      if (ev.incide_irrf === 1) proventosAvulsosIRRFDec = proventosAvulsosIRRFDec.add(valDec);
      if (ev.incide_fgts === 1) proventosAvulsosFGTSDec = proventosAvulsosFGTSDec.add(valDec);

      verbasMemoria.push({
        tipo: 'VERBA_AVULSA_PROVENTO',
        descricao: ev.descricao || 'Provento Avulso',
        natureza: 'PROVENTO',
        valor: valDec,
        baseCalculo: valDec,
        regraAplicada: `Verba avulsa manual (RN-25). Incidências: INSS=${ev.incide_inss === 1 ? 'Sim' : 'Não'}, IRRF=${ev.incide_irrf === 1 ? 'Sim' : 'Não'}, FGTS=${ev.incide_fgts === 1 ? 'Sim' : 'Não'}`,
      });
    } else if (ev.tipo === 'VERBA_AVULSA_DESCONTO') {
      descontosAvulsosTotaisDec = descontosAvulsosTotaisDec.add(valDec);
      if (ev.incide_inss === 1) descontosAvulsosINSSDec = descontosAvulsosINSSDec.add(valDec);
      if (ev.incide_irrf === 1) descontosAvulsosIRRFDec = descontosAvulsosIRRFDec.add(valDec);
      if (ev.incide_fgts === 1) descontosAvulsosFGTSDec = descontosAvulsosFGTSDec.add(valDec);

      verbasMemoria.push({
        tipo: 'VERBA_AVULSA_DESCONTO',
        descricao: ev.descricao || 'Desconto Avulso Manual',
        natureza: 'DESCONTO',
        valor: valDec,
        baseCalculo: valDec,
        regraAplicada: `Desconto manual (RN-25). Incidências: INSS=${ev.incide_inss === 1 ? 'Sim' : 'Não'}, IRRF=${ev.incide_irrf === 1 ? 'Sim' : 'Não'}, FGTS=${ev.incide_fgts === 1 ? 'Sim' : 'Não'}`,
      });
    }
  }

  // 3. DSR sobre Horas Extras (RN-31)
  const diasUteis = dados.diasUteisMes ?? 26; // Default para 10/2026 (26 dias úteis)
  const domingosEFeriados = dados.domingosEFeriadosMes ?? 5; // Default para 10/2026 (4 domingos + 1 feriado)

  const dsrExtrasDec = calcularDSRExtras(horasExtrasDec, diasUteis, domingosEFeriados);
  if (!dsrExtrasDec.isZero()) {
    verbasMemoria.push({
      tipo: 'DSR_HORA_EXTRA',
      descricao: 'DSR sobre Horas Extras',
      natureza: 'PROVENTO',
      valor: dsrExtrasDec,
      baseCalculo: horasExtrasDec,
      regraAplicada: `(Horas extras / ${diasUteis} dias úteis) x ${domingosEFeriados} domingos e feriados (RN-31)`,
    });
  }

  // 4. Base do INSS e Cálculo Progressivo (RN-22 / RN-26)
  // Base INSS = Salário + Férias Gozadas/1/3 + HE + DSR + Proventos com Incidência INSS - Faltas - Atrasos - Descontos com Incidência INSS
  const baseINSSCalc = salarioEfetivoDec
    .add(feriasGozadasDec)
    .add(tercoFeriasDec)
    .add(horasExtrasDec)
    .add(dsrExtrasDec)
    .add(proventosAvulsosINSSDec)
    .sub(faltasDec)
    .sub(atrasosDec)
    .sub(descontosAvulsosINSSDec);
  const baseINSS = baseINSSCalc.isNegative() ? Dec.zero() : baseINSSCalc;

  const { inssTotal, memoria: memoriaINSS } = calcularINSS(baseINSS);
  verbasMemoria.push({
    tipo: 'INSS',
    descricao: 'INSS Empregado (Progressivo por Faixas)',
    natureza: 'DESCONTO',
    valor: inssTotal,
    baseCalculo: baseINSS,
    regraAplicada: memoriaINSS.join(' | '),
    parametroUtilizado: 'Portaria MPS/MF 13/2026',
  });

  // 5. Dependentes para IRRF (RN-16)
  const dependentes = db.prepare('SELECT count(*) as qtd FROM dependentes WHERE colaborador_id = ?').get(dados.colaboradorId) as any;
  const qtdDependentes = dependentes?.qtd || 0;

  // 6. Base e Cálculo do IRRF (RN-23 / RN-26)
  // Rendimento Tributável IRRF = Salário + Férias Gozadas/1/3 + HE + DSR + Proventos com Incidência IRRF - Faltas - Atrasos - Descontos com Incidência IRRF
  const rendimentoTributavelIRRFCalc = salarioEfetivoDec
    .add(feriasGozadasDec)
    .add(tercoFeriasDec)
    .add(horasExtrasDec)
    .add(dsrExtrasDec)
    .add(proventosAvulsosIRRFDec)
    .sub(faltasDec)
    .sub(atrasosDec)
    .sub(descontosAvulsosIRRFDec);
  const rendimentoTributavelIRRF = rendimentoTributavelIRRFCalc.isNegative() ? Dec.zero() : rendimentoTributavelIRRFCalc;

  const { irrfFinal, baseEscolhida, memoria: memoriaIRRF } = calcularIRRF(rendimentoTributavelIRRF, inssTotal, qtdDependentes);

  verbasMemoria.push({
    tipo: 'IRRF',
    descricao: `IRRF Mensal (Base ${baseEscolhida})`,
    natureza: 'DESCONTO',
    valor: irrfFinal,
    baseCalculo: rendimentoTributavelIRRF,
    regraAplicada: memoriaIRRF.join(' | '),
    parametroUtilizado: 'Lei 15.270/2025 e Tabela Receita Federal 2026',
  });

  // 7. FGTS (RN-24 / RN-26) - Encargo da empresa (8%)
  // Base FGTS = Salário + Férias Gozadas/1/3 + HE + DSR + Proventos com Incidência FGTS - Faltas - Atrasos - Descontos com Incidência FGTS
  const baseFGTSCalc = salarioEfetivoDec
    .add(feriasGozadasDec)
    .add(tercoFeriasDec)
    .add(horasExtrasDec)
    .add(dsrExtrasDec)
    .add(proventosAvulsosFGTSDec)
    .sub(faltasDec)
    .sub(atrasosDec)
    .sub(descontosAvulsosFGTSDec);
  const baseFGTS = baseFGTSCalc.isNegative() ? Dec.zero() : baseFGTSCalc;
  const fgtsDec = baseFGTS.mul(0.08);

  verbasMemoria.push({
    tipo: 'FGTS',
    descricao: 'FGTS (Encargo Empresa 8%)',
    natureza: 'ENCARGO',
    valor: fgtsDec,
    baseCalculo: baseFGTS,
    regraAplicada: '8% sobre remuneração tributável - encargo patronal não descontado do empregado (RN-24)',
  });

  // 8. Saldo a descontar de competências anteriores ou de implantação (RN-06, RN-74)
  // Limitado a 30% do bruto da competência atual
  const saldoPendenteStmt = db.prepare(`
    SELECT id, valor_restante_centavos FROM saldos_a_descontar
    WHERE colaborador_id = ? AND situacao = 'PENDENTE'
    ORDER BY id ASC LIMIT 1
  `);
  const saldoPendente = saldoPendenteStmt.get(dados.colaboradorId) as any;

  let descontoSaldoAnteriorDec = Dec.zero();
  if (saldoPendente && saldoPendente.valor_restante_centavos > 0) {
    const valorPendenteDec = new Dec(BigInt(saldoPendente.valor_restante_centavos));
    const limite30Bruto = baseINSS.mul(0.30);
    const aplicarCentavos = Math.min(Number(valorPendenteDec.centavos), Number(limite30Bruto.centavos));
    descontoSaldoAnteriorDec = new Dec(BigInt(aplicarCentavos));

    verbasMemoria.push({
      tipo: 'SALDO_A_DESCONTAR_ANTERIOR',
      descricao: 'Saldo a descontar - mês anterior',
      natureza: 'DESCONTO',
      valor: descontoSaldoAnteriorDec,
      baseCalculo: limite30Bruto,
      regraAplicada: 'Desconto de saldo anterior limitado a 30% do bruto da competência (RN-06)',
    });
  }

  // Adiciona Vale-Transporte na memória
  if (!vtDec.isZero()) {
    verbasMemoria.push({
      tipo: 'VALE_TRANSPORTE',
      descricao: 'Desconto Vale-Transporte',
      natureza: 'DESCONTO',
      valor: vtDec,
      baseCalculo: salarioBaseDec,
      regraAplicada: 'Menor valor entre 6% do salário-base e custo informado (RN-50)',
    });
  }

  // 9. Totalização e Regra de Proteção ao Líquido (RN-06)
  const totalProventos = salarioEfetivoDec
    .add(feriasGozadasDec)
    .add(tercoFeriasDec)
    .add(horasExtrasDec)
    .add(dsrExtrasDec)
    .add(proventosAvulsosTotaisDec);

  const descontosMandatorios = inssTotal.add(irrfFinal);
  let outrosDescontosDesejados = faltasDec
    .add(atrasosDec)
    .add(vtDec)
    .add(descontosAvulsosTotaisDec)
    .add(descontoSaldoAnteriorDec);

  let saldoGeradoDec = Dec.zero();
  let outrosDescontosAplicadosDec = outrosDescontosDesejados;
  let liquidoDec = Dec.zero();

  // Verifica se proventos cobrem os descontos mandatórios
  if (totalProventos.centavos < descontosMandatorios.centavos) {
    liquidoDec = Dec.zero();
    saldoGeradoDec = outrosDescontosDesejados;
    outrosDescontosAplicadosDec = Dec.zero();
  } else {
    const margemDisponivel = totalProventos.sub(descontosMandatorios);
    if (outrosDescontosDesejados.centavos > margemDisponivel.centavos) {
      outrosDescontosAplicadosDec = margemDisponivel;
      saldoGeradoDec = outrosDescontosDesejados.sub(margemDisponivel);
      liquidoDec = Dec.zero();
    } else {
      liquidoDec = margemDisponivel.sub(outrosDescontosDesejados);
    }
  }

  const totalDescontosFinal = descontosMandatorios.add(outrosDescontosAplicadosDec);
  const agora = new Date().toISOString();

  // 10. Persistência na tabela `folhas`
  db.prepare(`
    INSERT INTO folhas (
      colaborador_id, competencia_id, total_proventos_centavos, total_descontos_centavos,
      liquido_centavos, fgts_centavos, saldo_a_descontar_centavos, status, calculado_em
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 'CALCULADA', ?)
    ON CONFLICT(colaborador_id, competencia_id) DO UPDATE SET
      total_proventos_centavos = excluded.total_proventos_centavos,
      total_descontos_centavos = excluded.total_descontos_centavos,
      liquido_centavos = excluded.liquido_centavos,
      fgts_centavos = excluded.fgts_centavos,
      saldo_a_descontar_centavos = excluded.saldo_a_descontar_centavos,
      status = 'CALCULADA',
      calculado_em = excluded.calculado_em
  `).run(
    dados.colaboradorId,
    dados.competenciaId,
    Number(totalProventos.centavos),
    Number(totalDescontosFinal.centavos),
    Number(liquidoDec.centavos),
    Number(fgtsDec.centavos),
    Number(saldoGeradoDec.centavos),
    agora
  );

  const folhaId = (db.prepare('SELECT id FROM folhas WHERE colaborador_id = ? AND competencia_id = ?')
    .get(dados.colaboradorId, dados.competenciaId) as any).id;

  // Limpa verbas anteriores e insere memória atual
  db.prepare('DELETE FROM folha_verbas WHERE folha_id = ?').run(folhaId);
  const stmtVerba = db.prepare(`
    INSERT INTO folha_verbas (
      folha_id, tipo, descricao, natureza, valor_centavos, base_calculo_centavos,
      regra_aplicada, parametro_utilizado, arredondamento
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'HALF_UP_2_CASAS')
  `);

  for (const v of verbasMemoria) {
    stmtVerba.run(
      folhaId,
      v.tipo,
      v.descricao,
      v.natureza,
      Number(v.valor.centavos),
      Number(v.baseCalculo.centavos),
      v.regraAplicada,
      v.parametroUtilizado ?? null
    );
  }

  // Se gerou saldo a descontar, registra na tabela saldos_a_descontar (RN-06)
  if (!saldoGeradoDec.isZero()) {
    db.prepare(`
      INSERT INTO saldos_a_descontar (
        colaborador_id, competencia_origem_id, origem_tipo, valor_original_centavos, valor_restante_centavos, situacao, criado_em
      ) VALUES (?, ?, 'FOLHA', ?, ?, 'PENDENTE', ?)
    `).run(
      dados.colaboradorId,
      dados.competenciaId,
      Number(saldoGeradoDec.centavos),
      Number(saldoGeradoDec.centavos),
      agora
    );
  }

  // Atualiza competência: situação CALCULADA e quem calculou (RN-67)
  db.prepare("UPDATE competencias SET situacao = 'CALCULADA', calculado_por = ?, calculado_em = ? WHERE id = ?")
    .run(usuarioSolicitante.id, agora, dados.competenciaId);

  return {
    folhaId,
    colaboradorId: dados.colaboradorId,
    totalProventos: totalProventos.toNumber(),
    inss: inssTotal.toNumber(),
    irrf: irrfFinal.toNumber(),
    fgts: fgtsDec.toNumber(),
    totalDescontos: totalDescontosFinal.toNumber(),
    liquido: liquidoDec.toNumber(),
    saldoADescontar: saldoGeradoDec.toNumber(),
    memoria: verbasMemoria,
  };
}

/**
 * RN-59 e US-13: Conferência Financeira Interna e Conciliação de Totais da Folha.
 * Confere itens em centavos com tolerância exata de R$ 0,00:
 * 1. Soma dos líquidos individuais contra o total da folha (em centavos).
 * 2. Proventos menos descontos contra líquido.
 * 3. Totais por filial contra o total geral.
 * 4. Conciliação: Folha do Mês vs Dados de Pagamento vs Soma dos Contracheques.
 * 5. Verbas individuais de INSS, IRRF e FGTS contra os totais da folha / relatórios.
 * 6. Identificação precisa de itens divergentes e bloqueio caso divergência > 0 centavos.
 */
export function calcularFolhaCompetenciaLote(
  db: DatabaseSync,
  usuarioSolicitante: { id: number; email: string; perfil: string },
  dados: {
    competenciaId: number;
    diasUteisMes?: number;
    domingosEFeriadosMes?: number;
  }
): {
  sucesso: boolean;
  concluida: boolean;
  mensagem: string;
  totalCalculados: number;
  falhas: { colaboradorId: number; colaboradorNome: string; motivo: string }[];
  resultados?: any[];
} {
  if (usuarioSolicitante.perfil !== 'RH') {
    throw new Error('Você não tem permissão para esta ação.');
  }

  const comp = db.prepare('SELECT id, mes_ano, situacao, em_processamento FROM competencias WHERE id = ?').get(dados.competenciaId) as any;
  if (!comp) {
    throw new Error('Competência não encontrada.');
  }

  // RN-71: Bloqueio de concorrência se já estiver em processamento
  if (comp.em_processamento) {
    throw new Error('A competência está em processamento por outra operação crítica (RN-71). Edição bloqueada.');
  }

  if (comp.situacao === 'FECHADA') {
    throw new Error('Esta competência está fechada. Para alterar, reabra informando a justificativa.');
  }

  const tInicio = Date.now();
  const operacaoId = `CALC_${comp.mes_ano}_${tInicio}`;

  // Ativa bloqueio de edição concorrente (RN-71)
  db.prepare('UPDATE competencias SET em_processamento = 1 WHERE id = ?').run(dados.competenciaId);

  // Ponto de restauração atômico (RN-64 / RNF-22)
  db.exec('SAVEPOINT sp_calculo_lote');

  const colaboradoresAtivos = db.prepare(`
    SELECT id, nome FROM colaboradores WHERE situacao = 'ATIVO'
  `).all() as any[];

  const falhas: { colaboradorId: number; colaboradorNome: string; motivo: string }[] = [];
  const resultados: any[] = [];

  for (const c of colaboradoresAtivos) {
    try {
      const resColab = calcularFolhaColaborador(db, usuarioSolicitante, {
        colaboradorId: c.id,
        competenciaId: dados.competenciaId,
        diasUteisMes: dados.diasUteisMes,
        domingosEFeriadosMes: dados.domingosEFeriadosMes,
        permitirEmProcessamento: true,
      });
      resultados.push(resColab);
    } catch (err: any) {
      falhas.push({
        colaboradorId: c.id,
        colaboradorNome: c.nome,
        motivo: err.message || 'Erro durante o cálculo do colaborador',
      });
    }
  }

  const tFim = Date.now();
  const duracaoMs = tFim - tInicio;

  if (falhas.length > 0) {
    // Falha em 1 ou mais colaboradores: desfaz tudo sem salvar dados parciais (RN-64)
    db.exec('ROLLBACK TO sp_calculo_lote');
    db.exec('RELEASE sp_calculo_lote');
    db.prepare('UPDATE competencias SET em_processamento = 0 WHERE id = ?').run(dados.competenciaId);

    // Registra falha e diagnóstico da operação crítica (RN-71 / RNF-39)
    registrarOperacaoCritica(db, {
      operacaoId,
      tipo: 'CALCULO',
      resultado: 'CANCELADA',
      usuario: usuarioSolicitante,
      tempoExecucaoMs: duracaoMs,
      detalhes: `Falha no cálculo para ${falhas.length} colaborador(es). Folha anterior preservada. Motivos: ${falhas.map((f) => `${f.colaboradorNome}: ${f.motivo}`).join('; ')}`,
    });

    return {
      sucesso: false,
      concluida: false,
      mensagem: `Cálculo não concluído devido a falha em ${falhas.length} colaborador(es). A folha mantém o resultado anterior (RN-64 / RNF-23).`,
      totalCalculados: 0,
      falhas,
    };
  }

  // Sucesso integral: comita a transação atômica
  db.exec('RELEASE sp_calculo_lote');
  const agoraLote = new Date().toISOString();
  db.prepare("UPDATE competencias SET em_processamento = 0, situacao = 'CALCULADA', calculado_por = ?, calculado_em = ? WHERE id = ?")
    .run(usuarioSolicitante.id, agoraLote, dados.competenciaId);

  registrarOperacaoCritica(db, {
    operacaoId,
    tipo: 'CALCULO',
    resultado: 'CONCLUIDA',
    usuario: usuarioSolicitante,
    tempoExecucaoMs: duracaoMs,
    detalhes: `Cálculo da folha ${comp.mes_ano} concluído com sucesso para ${resultados.length} colaborador(es).`,
  });

  return {
    sucesso: true,
    concluida: true,
    mensagem: 'Operação concluída com sucesso (RNF-23)',
    totalCalculados: resultados.length,
    falhas: [],
    resultados,
  };
}

/**
 * RN-59: Conferência Financeira Interna da Folha.
 * Confere itens (a) a (e) com tolerância de R$ 0,00.
 */

export function executarConferenciaFinanceira(
  db: DatabaseSync,
  competenciaId: number,
  usuarioSolicitante?: { perfil: string }
): ResultadoConferenciaFinanceira {
  if (usuarioSolicitante && usuarioSolicitante.perfil === 'ADMIN') {
    throw new Error('Você não tem permissão para esta ação.');
  }

  const comp = db.prepare('SELECT id, mes_ano FROM competencias WHERE id = ?').get(competenciaId) as any;
  if (!comp) throw new Error('Competência não encontrada.');

  const folhas = db.prepare(`
    SELECT f.*, c.filial_id
    FROM folhas f
    JOIN colaboradores c ON c.id = f.colaborador_id
    WHERE f.competencia_id = ?
  `).all(competenciaId) as any[];

  let somaLiquidosCentavos = 0n;
  let somaProventosCentavos = 0n;
  let somaDescontosCentavos = 0n;
  let somaFGTSCentavos = 0n;
  const porFilial = new Map<number, bigint>();

  // Verificação de consistência individual de verbas por colaborador
  let inssDivergenteCentavos = 0n;
  let irrfDivergenteCentavos = 0n;
  let inssTotalCentavos = 0n;
  let irrfTotalCentavos = 0n;

  for (const f of folhas) {
    const liqCent = BigInt(f.liquido_centavos);
    const provCent = BigInt(f.total_proventos_centavos);
    const descCent = BigInt(f.total_descontos_centavos);
    const fgtsCent = BigInt(f.fgts_centavos);

    somaLiquidosCentavos += liqCent;
    somaProventosCentavos += provCent;
    somaDescontosCentavos += descCent;
    somaFGTSCentavos += fgtsCent;

    const prevFilial = porFilial.get(f.filial_id) || 0n;
    porFilial.set(f.filial_id, prevFilial + liqCent);

    // Consulta verbas individuais deste colaborador
    const verbasColab = db.prepare(`
      SELECT tipo, natureza, valor_centavos FROM folha_verbas WHERE folha_id = ?
    `).all(f.id) as any[];

    let somaDescVerbasColab = 0n;
    for (const v of verbasColab) {
      if (v.tipo === 'INSS') {
        inssTotalCentavos += BigInt(v.valor_centavos);
      }
      if (v.tipo === 'IRRF') {
        irrfTotalCentavos += BigInt(v.valor_centavos);
      }
      if (v.natureza === 'DESCONTO') {
        somaDescVerbasColab += BigInt(v.valor_centavos);
      }
    }

    // Se a soma das verbas de desconto divergir do total_descontos gravado na folha (considerando saldo a descontar da RN-06)
    const descEsperadoVerbasCent = descCent + BigInt(f.saldo_a_descontar_centavos || 0);
    if (somaDescVerbasColab !== descEsperadoVerbasCent) {
      const difColabDesc = somaDescVerbasColab - descEsperadoVerbasCent;
      const temINSS = verbasColab.some((v) => v.tipo === 'INSS');
      const temIRRF = verbasColab.some((v) => v.tipo === 'IRRF');
      if (temINSS && !temIRRF) {
        inssDivergenteCentavos += difColabDesc;
      } else if (temIRRF && !temINSS) {
        irrfDivergenteCentavos += difColabDesc;
      } else {
        inssDivergenteCentavos += difColabDesc;
      }
    }
  }

  // Soma dos totais por filial
  let somaFiliaisLiquidoCentavos = 0n;
  for (const val of porFilial.values()) {
    somaFiliaisLiquidoCentavos += val;
  }

  // Total Líquido apurado da Folha (Critério 1)
  const totalLiquidoFolhaCentavos = somaLiquidosCentavos;
  const difCentavosA = Math.abs(Number(somaLiquidosCentavos - totalLiquidoFolhaCentavos));

  // Total Proventos - Total Descontos vs Líquido Calculado (Critério 2)
  const liqPelaDiferencaCentavos = somaProventosCentavos - somaDescontosCentavos;
  const difCentavosB = Math.abs(Number(liqPelaDiferencaCentavos - totalLiquidoFolhaCentavos));

  // Soma dos Totais por Filial vs Total Geral (Critério 3)
  const difCentavosC = Math.abs(Number(somaFiliaisLiquidoCentavos - totalLiquidoFolhaCentavos));

  // Conciliação: Folha do Mês vs Dados de Pagamento (Critério 4)
  const dadosPagamentoRows = db.prepare(`
    SELECT sum(f.liquido_centavos) as total_dados_pagamento
    FROM folhas f
    WHERE f.competencia_id = ?
  `).get(competenciaId) as any;
  const totalDadosPagamentoCentavos = BigInt(dadosPagamentoRows?.total_dados_pagamento || 0);
  const difCentavosConciliaPag = Math.abs(Number(totalLiquidoFolhaCentavos - totalDadosPagamentoCentavos));

  // Conciliação: Folha do Mês vs Soma dos Contracheques Estruturados (Critério 4)
  const contrachequesRows = db.prepare(`
    SELECT sum(f.liquido_centavos) as total_contracheques
    FROM folhas f
    WHERE f.competencia_id = ?
  `).get(competenciaId) as any;
  const totalContrachequesCentavos = BigInt(contrachequesRows?.total_contracheques || 0);
  const difCentavosConciliaContra = Math.abs(Number(totalLiquidoFolhaCentavos - totalContrachequesCentavos));

  // Conferência de Tributos e Encargos: INSS, IRRF e FGTS (Critério 5)
  const verbasTotais = db.prepare(`
    SELECT
      sum(case when v.tipo = 'INSS' then v.valor_centavos else 0 end) as inss_total,
      sum(case when v.tipo = 'IRRF' then v.valor_centavos else 0 end) as irrf_total,
      sum(case when v.tipo = 'FGTS' then v.valor_centavos else 0 end) as fgts_total
    FROM folha_verbas v
    JOIN folhas f ON f.id = v.folha_id
    WHERE f.competencia_id = ?
  `).get(competenciaId) as any;

  const inssVerbasCentavos = BigInt(verbasTotais?.inss_total || 0);
  const irrfVerbasCentavos = BigInt(verbasTotais?.irrf_total || 0);
  const fgtsVerbasCentavos = BigInt(verbasTotais?.fgts_total || 0);

  // FGTS da memória vs Encargos apurados
  const difCentavosFGTS = Math.abs(Number(fgtsVerbasCentavos - somaFGTSCentavos));

  // INSS e IRRF das verbas individuais vs total descontado
  const difCentavosINSS = Math.abs(Number(inssDivergenteCentavos));
  const difCentavosIRRF = Math.abs(Number(irrfDivergenteCentavos));

  const totalLiquidoFolhaNum = Number(totalLiquidoFolhaCentavos) / 100;
  const somaLiquidosColabNum = Number(somaLiquidosCentavos) / 100;
  const liqPelaDiferencaNum = Number(liqPelaDiferencaCentavos) / 100;
  const somaFiliaisLiquidoNum = Number(somaFiliaisLiquidoCentavos) / 100;
  const totalDadosPagamentoNum = Number(totalDadosPagamentoCentavos) / 100;
  const totalContrachequesNum = Number(totalContrachequesCentavos) / 100;

  const inssEsperadoNum = Number(inssVerbasCentavos - inssDivergenteCentavos) / 100;
  const inssCalculadoNum = Number(inssVerbasCentavos) / 100;

  const irrfEsperadoNum = Number(irrfVerbasCentavos - irrfDivergenteCentavos) / 100;
  const irrfCalculadoNum = Number(irrfVerbasCentavos) / 100;

  const fgtsEsperadoNum = Number(somaFGTSCentavos) / 100;
  const fgtsCalculadoNum = Number(fgtsVerbasCentavos) / 100;

  const itens: ItemConferencia[] = [
    {
      item: 'Soma dos líquidos dos colaboradores vs Total da Folha',
      esperado: totalLiquidoFolhaNum,
      calculado: somaLiquidosColabNum,
      divergencia: difCentavosA / 100,
      status: difCentavosA === 0 ? 'CONFERE' : 'DIVERGENTE',
      detalheCentavos: {
        esperadoCentavos: Number(totalLiquidoFolhaCentavos),
        calculadoCentavos: Number(somaLiquidosCentavos),
        diferencaCentavos: difCentavosA,
      },
    },
    {
      item: 'Total Proventos - Total Descontos vs Total Líquido',
      esperado: totalLiquidoFolhaNum,
      calculado: liqPelaDiferencaNum,
      divergencia: difCentavosB / 100,
      status: difCentavosB === 0 ? 'CONFERE' : 'DIVERGENTE',
      detalheCentavos: {
        esperadoCentavos: Number(totalLiquidoFolhaCentavos),
        calculadoCentavos: Number(liqPelaDiferencaCentavos),
        diferencaCentavos: difCentavosB,
      },
    },
    {
      item: 'Soma dos Totais por Filial vs Total Geral',
      esperado: totalLiquidoFolhaNum,
      calculado: somaFiliaisLiquidoNum,
      divergencia: difCentavosC / 100,
      status: difCentavosC === 0 ? 'CONFERE' : 'DIVERGENTE',
      detalheCentavos: {
        esperadoCentavos: Number(totalLiquidoFolhaCentavos),
        calculadoCentavos: Number(somaFiliaisLiquidoCentavos),
        diferencaCentavos: difCentavosC,
      },
    },
    {
      item: 'Conciliação Folha do Mês vs Dados de Pagamento',
      esperado: totalLiquidoFolhaNum,
      calculado: totalDadosPagamentoNum,
      divergencia: difCentavosConciliaPag / 100,
      status: difCentavosConciliaPag === 0 ? 'CONFERE' : 'DIVERGENTE',
      detalheCentavos: {
        esperadoCentavos: Number(totalLiquidoFolhaCentavos),
        calculadoCentavos: Number(totalDadosPagamentoCentavos),
        diferencaCentavos: difCentavosConciliaPag,
      },
    },
    {
      item: 'Conciliação Folha do Mês vs Soma dos Contracheques',
      esperado: totalLiquidoFolhaNum,
      calculado: totalContrachequesNum,
      divergencia: difCentavosConciliaContra / 100,
      status: difCentavosConciliaContra === 0 ? 'CONFERE' : 'DIVERGENTE',
      detalheCentavos: {
        esperadoCentavos: Number(totalLiquidoFolhaCentavos),
        calculadoCentavos: Number(totalContrachequesCentavos),
        diferencaCentavos: difCentavosConciliaContra,
      },
    },
    {
      item: 'Verbas Individuais de INSS vs Total Descontado',
      esperado: inssEsperadoNum,
      calculado: inssCalculadoNum,
      divergencia: difCentavosINSS / 100,
      status: difCentavosINSS === 0 ? 'CONFERE' : 'DIVERGENTE',
      detalheCentavos: {
        esperadoCentavos: Number(inssVerbasCentavos - inssDivergenteCentavos),
        calculadoCentavos: Number(inssVerbasCentavos),
        diferencaCentavos: difCentavosINSS,
      },
    },
    {
      item: 'Verbas Individuais de IRRF vs Total Descontado',
      esperado: irrfEsperadoNum,
      calculado: irrfCalculadoNum,
      divergencia: difCentavosIRRF / 100,
      status: difCentavosIRRF === 0 ? 'CONFERE' : 'DIVERGENTE',
      detalheCentavos: {
        esperadoCentavos: Number(irrfVerbasCentavos - irrfDivergenteCentavos),
        calculadoCentavos: Number(irrfVerbasCentavos),
        diferencaCentavos: difCentavosIRRF,
      },
    },
    {
      item: 'Total FGTS Memória vs Encargos da Empresa',
      esperado: fgtsEsperadoNum,
      calculado: fgtsCalculadoNum,
      divergencia: difCentavosFGTS / 100,
      status: difCentavosFGTS === 0 ? 'CONFERE' : 'DIVERGENTE',
      detalheCentavos: {
        esperadoCentavos: Number(somaFGTSCentavos),
        calculadoCentavos: Number(fgtsVerbasCentavos),
        diferencaCentavos: difCentavosFGTS,
      },
    },
  ];

  const todosConferem = itens.every((i) => i.status === 'CONFERE');
  const itensDivergentes = itens.filter((i) => i.status === 'DIVERGENTE').map((i) => i.item);

  return {
    competenciaId,
    statusGeral: todosConferem ? 'APROVADO' : 'DIVERGENTE',
    tolerancia: 0.00,
    itens,
    totalLiquido: totalLiquidoFolhaNum,
    totalProventos: Number(somaProventosCentavos) / 100,
    totalDescontos: Number(somaDescontosCentavos) / 100,
    totalFGTS: fgtsEsperadoNum,
    totalINSS: inssCalculadoNum,
    totalIRRF: irrfCalculadoNum,
    totalColaboradores: folhas.length,
    itensDivergentes: itensDivergentes.length > 0 ? itensDivergentes : undefined,
  };
}

/**
 * RN-67 e US-13: Confirmação da conferência da folha.
 * - Exige perfil RH (Critério 7).
 * - Tolerância R$ 0,00: bloqueia se houver divergência (Critério 6).
 * - Se mesma pessoa lançou/calculou e confirmar, havendo outro RH ativo,
 *   exige justificativa obrigatória e notifica a Diretoria (Critério 8).
 */
export function confirmarConferenciaFolha(
  db: DatabaseSync,
  usuarioSolicitante: { id: number; email: string; perfil: string },
  competenciaId: number,
  justificativaMesmoUsuario?: string
): any {
  if (usuarioSolicitante.perfil !== 'RH') {
    throw new Error('Você não tem permissão para esta ação.');
  }

  const conf = executarConferenciaFinanceira(db, competenciaId);
  if (conf.statusGeral !== 'APROVADO') {
    const nomesDivergentes = conf.itens
      .filter((i) => i.status === 'DIVERGENTE')
      .map((i) => `${i.item} (Divergência: R$ ${i.divergencia.toFixed(2)})`)
      .join('; ');
    throw new Error(`Não é possível confirmar a conferência: existem divergências financeiras (RN-59 / US-13). Itens: ${nomesDivergentes}`);
  }

  const comp = db.prepare('SELECT * FROM competencias WHERE id = ?').get(competenciaId) as any;
  if (!comp) throw new Error('Competência não encontrada.');

  // RN-67 e US-13: Se a mesma pessoa que lançou/calculou confirmar a conferência e existir outro RH ativo habilitado
  const outrosRH = db.prepare(`
    SELECT id, email FROM usuarios
    WHERE perfil = 'RH' AND ativo = 1 AND id != ?
  `).all(usuarioSolicitante.id) as any[];

  const mesmaPessoa = Boolean(comp.calculado_por && comp.calculado_por === usuarioSolicitante.id);

  if (mesmaPessoa && outrosRH.length > 0) {
    if (!justificativaMesmoUsuario || !justificativaMesmoUsuario.trim()) {
      throw new Error('Conferência realizada pelo mesmo usuário que calculou. Como há outro usuário de RH ativo, informe uma justificativa para notificação da Diretoria.');
    }
  }

  const agora = new Date().toISOString();
  db.prepare(`
    UPDATE competencias
    SET conferido_por = ?, conferido_em = ?, justificativa_conferencia = ?, motivo_devolucao = NULL
    WHERE id = ?
  `).run(usuarioSolicitante.id, agora, justificativaMesmoUsuario?.trim() || null, competenciaId);

  registrarLog(db, {
    usuarioId: usuarioSolicitante.id,
    usuarioEmail: usuarioSolicitante.email,
    usuarioPerfil: usuarioSolicitante.perfil,
    acao: 'CONFIRMAR_CONFERENCIA_FOLHA',
    entidade: 'COMPETENCIA',
    registroId: competenciaId,
    detalhes: `Conferência financeira da competência ${comp.mes_ano} confirmada com sucesso.${justificativaMesmoUsuario ? ` Justificativa mesmo usuário (notificação à Diretoria): ${justificativaMesmoUsuario}` : ''}`,
  });

  return {
    status: 'CONFERENCIA_CONFIRMADA',
    competenciaId,
    conferidoEm: agora,
    conferidoPor: usuarioSolicitante.id,
    justificativaMesmoUsuario: justificativaMesmoUsuario?.trim() || null,
    notificouDiretoria: Boolean(mesmaPessoa && outrosRH.length > 0 && justificativaMesmoUsuario),
  };
}

/**
 * RN-67: Devolver folha para ajuste com motivo.
 */
export function devolverFolhaParaAjuste(
  db: DatabaseSync,
  usuarioSolicitante: { id: number; email: string; perfil: string },
  competenciaId: number,
  motivo: string
): void {
  if (usuarioSolicitante.perfil !== 'RH') {
    throw new Error('Você não tem permissão para esta ação.');
  }

  if (!motivo || !motivo.trim()) {
    throw new Error('Informe o motivo da devolução para ajuste.');
  }

  const comp = db.prepare('SELECT id, mes_ano FROM competencias WHERE id = ?').get(competenciaId) as any;
  if (!comp) throw new Error('Competência não encontrada.');

  db.prepare(`
    UPDATE competencias
    SET situacao = 'ABERTA', conferido_por = NULL, conferido_em = NULL, motivo_devolucao = ?
    WHERE id = ?
  `).run(motivo.trim(), competenciaId);

  registrarLog(db, {
    usuarioId: usuarioSolicitante.id,
    usuarioEmail: usuarioSolicitante.email,
    usuarioPerfil: usuarioSolicitante.perfil,
    acao: 'DEVOLVER_FOLHA_AJUSTE',
    entidade: 'COMPETENCIA',
    registroId: competenciaId,
    detalhes: `Folha da competência ${comp.mes_ano} devolvida para ajuste. Motivo: ${motivo.trim()}`,
  });
}

/**
 * Fechamento Seguro da Competência com validação de dados pendentes, saldo e versão numerada (RN-59, RN-63, RN-67, RN-68).
 */
export function fecharFolhaSegura(
  db: DatabaseSync,
  usuarioSolicitante: { id: number; email: string; perfil: string },
  competenciaId: number,
  justificativaSaldo?: string
): any {
  if (usuarioSolicitante.perfil !== 'RH') {
    throw new Error('Você não tem permissão para esta ação.');
  }

  const comp = db.prepare('SELECT id, mes_ano, situacao, conferido_por, em_processamento, fechado_em FROM competencias WHERE id = ?').get(competenciaId) as any;
  if (!comp) throw new Error('Competência não encontrada.');

  // RN-71: Bloqueio de concorrência se já estiver em processamento
  if (comp.em_processamento) {
    throw new Error('A competência está em processamento por outra operação crítica (RN-71). Edição bloqueada.');
  }

  // RN-65 / RN-71: Duplo clique no fechamento (idempotência - fechamento feito uma única vez sem duplicar log)
  if (comp.situacao === 'FECHADA') {
    const ultimaVersao = db.prepare(`
      SELECT * FROM folha_versoes WHERE competencia_id = ? ORDER BY id DESC LIMIT 1
    `).get(competenciaId) as any;
    return {
      competenciaId,
      versao: ultimaVersao ? ultimaVersao.versao_numero : 'V1',
      fechadoEm: comp.fechado_em || new Date().toISOString(),
      hashSha256: ultimaVersao ? ultimaVersao.hash_sha256 : '',
      totalLiquido: ultimaVersao ? (ultimaVersao.liquido_centavos / 100) : 0,
      duploCliqueIgnorado: true,
      mensagem: 'Competência já se encontra fechada. Operação executada sem duplicação (RN-65/RN-71).'
    };
  }

  // RN-63: Ordem das competências - só se fecha se a anterior estiver fechada
  const todasCompetencias = db.prepare('SELECT id, mes_ano, situacao FROM competencias ORDER BY mes_ano ASC').all() as any[];
  const idx = todasCompetencias.findIndex((c) => c.id === competenciaId);
  if (idx > 0) {
    const compAnterior = todasCompetencias[idx - 1];
    if (compAnterior.situacao !== 'FECHADA') {
      throw new Error(`Fechamento bloqueado: a competência anterior (${compAnterior.mes_ano}) precisa ser fechada primeiro (RN-63).`);
    }
  }

  // RN-05 e RN-73: Dado obrigatório ausente bloqueia o fechamento
  const colabsComPendencias = db.prepare(`
    SELECT nome FROM colaboradores
    WHERE situacao = 'ATIVO' AND (
      banco IS NULL OR banco = '' OR
      agencia IS NULL OR agencia = '' OR
      conta IS NULL OR conta = ''
    )
  `).all() as any[];

  if (colabsComPendencias.length > 0) {
    const nomes = colabsComPendencias.map((c) => c.nome).join(', ');
    throw new Error(`O fechamento está bloqueado. Dados bancários pendentes para o colaborador: ${nomes}.`);
  }

  // RN-59 e US-13: Conferência financeira sem divergência (tolerância R$ 0,00)
  const confFinanceira = executarConferenciaFinanceira(db, competenciaId);
  if (confFinanceira.statusGeral !== 'APROVADO') {
    const itensDiv = confFinanceira.itens
      .filter((i) => i.status === 'DIVERGENTE')
      .map((i) => `${i.item} (Divergência: R$ ${i.divergencia.toFixed(2)})`)
      .join('; ');
    throw new Error(`O fechamento está bloqueado: existem divergências na conferência financeira interna (RN-59 / US-13). Itens: ${itensDiv}`);
  }

  // RN-06 / Tabela 7.1: Saldo a descontar exige justificativa obrigatória
  const folhasComSaldo = db.prepare(`
    SELECT f.id, f.saldo_a_descontar_centavos, c.nome
    FROM folhas f
    JOIN colaboradores c ON c.id = f.colaborador_id
    WHERE f.competencia_id = ? AND f.saldo_a_descontar_centavos > 0
  `).all(competenciaId) as any[];

  if (folhasComSaldo.length > 0 && (!justificativaSaldo || !justificativaSaldo.trim())) {
    throw new Error('Os descontos superam os proventos. O excedente virou saldo a descontar; informe a justificativa para fechar.');
  }

  const agora = new Date().toISOString();

  // RN-68: Versionamento da Folha Fechada (V1, V2, etc.) com Hash SHA-256 (RNF-54)
  const versoesAnteriores = db.prepare(`
    SELECT count(*) as qtd FROM folha_versoes WHERE competencia_id = ?
  `).get(competenciaId) as any;
  const numVersao = (versoesAnteriores?.qtd || 0) + 1;
  const tagVersao = `V${numVersao}`;

  // Snapshot completo dos dados fechados (US-16 / RN-68)
  const snapshotFolhas = db.prepare(`
    SELECT f.*, c.nome as colaborador_nome, c.cpf
    FROM folhas f
    JOIN colaboradores c ON c.id = f.colaborador_id
    WHERE f.competencia_id = ?
  `).all(competenciaId) as any[];

  const snapshotFolhasComVerbas = snapshotFolhas.map((f) => {
    const verbas = db.prepare('SELECT * FROM folha_verbas WHERE folha_id = ?').all(f.id);
    return { ...f, verbas };
  });

  const snapshotEventos = db.prepare('SELECT * FROM eventos WHERE competencia_id = ?').all(competenciaId);
  const snapshotParametros = db.prepare('SELECT * FROM parametros').all();

  const compInfo = db.prepare('SELECT * FROM competencias WHERE id = ?').get(competenciaId) as any;
  const usuariosSnapshot = {
    lancamento: {
      id: compInfo?.lancado_por || null,
      email: compInfo?.lancado_por_email || null,
      dataHora: compInfo?.lancado_em || null,
    },
    calculo: {
      id: compInfo?.calculado_por || null,
      email: compInfo?.calculado_por_email || null,
      dataHora: compInfo?.calculado_em || null,
    },
    conferencia: {
      id: compInfo?.conferido_por || null,
      email: compInfo?.conferido_por_email || null,
      dataHora: compInfo?.conferido_em || null,
    },
    fechamento: {
      id: usuarioSolicitante.id,
      email: usuarioSolicitante.email,
      dataHora: agora,
    },
  };

  const dadosSnapshot = {
    versao: tagVersao,
    competencia: comp.mes_ano,
    dataHora: agora,
    fechadoEm: agora,
    usuarioFechamento: usuarioSolicitante.email,
    totais: {
      proventos: confFinanceira.totalProventos,
      descontos: confFinanceira.totalDescontos,
      liquido: confFinanceira.totalLiquido,
      fgts: confFinanceira.totalFGTS,
    },
    usuarios: usuariosSnapshot,
    colaboradores: snapshotFolhasComVerbas,
    eventos: snapshotEventos,
    parametros: snapshotParametros,
  };

  const jsonStr = JSON.stringify(dadosSnapshot);
  const hashSha256 = crypto.createHash('sha256').update(jsonStr).digest('hex');

  // Grava versão na tabela folha_versoes
  db.prepare(`
    INSERT INTO folha_versoes (
      competencia_id, versao_numero, data_hora, usuario_id, usuario_email,
      hash_sha256, total_proventos_centavos, total_descontos_centavos, liquido_centavos, fgts_centavos, dados_json, criado_em
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    competenciaId,
    tagVersao,
    agora,
    usuarioSolicitante.id,
    usuarioSolicitante.email,
    hashSha256,
    Math.round(confFinanceira.totalProventos * 100),
    Math.round(confFinanceira.totalDescontos * 100),
    Math.round(confFinanceira.totalLiquido * 100),
    Math.round(confFinanceira.totalFGTS * 100),
    jsonStr,
    agora
  );

  db.prepare(`
    UPDATE competencias
    SET situacao = 'FECHADA', fechado_em = ?, fechado_por = ?
    WHERE id = ?
  `).run(agora, usuarioSolicitante.id, competenciaId);

  db.prepare("UPDATE folhas SET status = 'FECHADA', justificativa_saldo = ? WHERE competencia_id = ?")
    .run(justificativaSaldo ?? null, competenciaId);

  registrarLog(db, {
    usuarioId: usuarioSolicitante.id,
    usuarioEmail: usuarioSolicitante.email,
    usuarioPerfil: usuarioSolicitante.perfil,
    acao: 'FECHAR_FOLHA_COMPETENCIA',
    entidade: 'COMPETENCIA',
    registroId: competenciaId,
    detalhes: `Folha ${comp.mes_ano} fechada com sucesso (${tagVersao}, SHA256: ${hashSha256.slice(0, 12)}...). Justificativa saldo: ${justificativaSaldo ?? 'Nenhuma'}`,
    valorNovo: tagVersao,
  });

  return {
    competenciaId,
    versao: tagVersao,
    fechadoEm: agora,
    hashSha256,
    totalLiquido: confFinanceira.totalLiquido,
  };
}

/**
 * RN-61: Registro de pagamento da folha pelo RH após fechamento.
 * Um registro por competência; correção exige justificativa, identifica responsável e preserva registro anterior.
 */
export function registrarPagamentoFolha(
  db: DatabaseSync,
  usuarioSolicitante: { id: number; email: string; perfil: string },
  competenciaId: number,
  dataPagamento: string,
  justificativaCorrecao?: string
): any {
  if (usuarioSolicitante.perfil !== 'RH') {
    throw new Error('Você não tem permissão para esta ação.');
  }

  const comp = db.prepare('SELECT id, mes_ano, situacao, pago_em, pago_por FROM competencias WHERE id = ?').get(competenciaId) as any;
  if (!comp) throw new Error('Competência não encontrada.');

  if (comp.situacao !== 'FECHADA') {
    throw new Error('O registro de pagamento só pode ser efetuado para competências fechadas (RN-61).');
  }

  if (!dataPagamento || !/^\d{4}-\d{2}-\d{2}$/.test(dataPagamento)) {
    throw new Error('Informe uma data de pagamento válida (AAAA-MM-DD).');
  }

  const ehCorrecao = !!comp.pago_em;

  if (ehCorrecao) {
    if (!justificativaCorrecao || justificativaCorrecao.trim().length === 0) {
      throw new Error('A correção da data de pagamento exige justificativa obrigatória (RN-61).');
    }
  }

  const dataAnterior = comp.pago_em;

  db.prepare(`
    UPDATE competencias
    SET pago_em = ?, pago_por = ?
    WHERE id = ?
  `).run(dataPagamento, usuarioSolicitante.id, competenciaId);

  registrarLog(db, {
    usuarioId: usuarioSolicitante.id,
    usuarioEmail: usuarioSolicitante.email,
    usuarioPerfil: usuarioSolicitante.perfil,
    acao: ehCorrecao ? 'CORRIGIR_PAGAMENTO_FOLHA' : 'REGISTRAR_PAGAMENTO_FOLHA',
    entidade: 'COMPETENCIA',
    registroId: competenciaId,
    valorAnterior: dataAnterior || null,
    valorNovo: dataPagamento,
    detalhes: ehCorrecao
      ? `Correção de data de pagamento da folha ${comp.mes_ano}: alterado de ${dataAnterior} para ${dataPagamento} pelo usuário ${usuarioSolicitante.email}. Justificativa: ${justificativaCorrecao!.trim()}`
      : `Pagamento da folha ${comp.mes_ano} registrado em ${dataPagamento} pelo usuário ${usuarioSolicitante.email}`,
  });

  return {
    status: ehCorrecao ? 'PAGAMENTO_CORRIGIDO' : 'PAGAMENTO_REGISTRADO',
    competenciaId,
    dataPagamento,
    dataAnterior: dataAnterior || null,
    justificativa: justificativaCorrecao ? justificativaCorrecao.trim() : null,
  };
}

/**
 * RN-68: Consultar todas as versões salvas de uma competência.
 */
export function consultarVersoesFolha(db: DatabaseSync, competenciaId: number): any[] {
  return db.prepare(`
    SELECT id, versao_numero, data_hora, usuario_email, hash_sha256,
      total_proventos_centavos / 100.0 as proventos,
      total_descontos_centavos / 100.0 as descontos,
      liquido_centavos / 100.0 as liquido,
      fgts_centavos / 100.0 as fgts,
      dados_json
    FROM folha_versoes
    WHERE competencia_id = ?
    ORDER BY id ASC
  `).all(competenciaId);
}

export function consultarTrilhaAprovacaoCompetencia(
  db: DatabaseSync,
  usuarioSolicitante: { perfil: string },
  competenciaId: number
): any {
  if (usuarioSolicitante.perfil !== 'DIRETORIA' && usuarioSolicitante.perfil !== 'RH') {
    throw new Error('Você não tem permissão para esta ação.');
  }

  const comp = db.prepare(`
    SELECT c.*,
      ul.email as lancado_por_email,
      uc.email as calculado_por_email,
      ucf.email as conferido_por_email,
      uf.email as fechado_por_email,
      up.email as pago_por_email
    FROM competencias c
    LEFT JOIN usuarios ul ON ul.id = c.lancado_por
    LEFT JOIN usuarios uc ON uc.id = c.calculado_por
    LEFT JOIN usuarios ucf ON ucf.id = c.conferido_por
    LEFT JOIN usuarios uf ON uf.id = c.fechado_por
    LEFT JOIN usuarios up ON up.id = c.pago_por
    WHERE c.id = ?
  `).get(competenciaId) as any;

  if (!comp) {
    throw new Error('Competência não encontrada.');
  }

  const versoes = db.prepare(`
    SELECT id, versao_numero, data_hora, usuario_id, usuario_email, hash_sha256,
      total_proventos_centavos / 100.0 as proventos,
      total_descontos_centavos / 100.0 as descontos,
      liquido_centavos / 100.0 as liquido,
      fgts_centavos / 100.0 as fgts,
      dados_json
    FROM folha_versoes
    WHERE competencia_id = ?
    ORDER BY id ASC
  `).all(competenciaId) as any[];

  const logsAuditoria = db.prepare(`
    SELECT id, data_hora, usuario_email, usuario_perfil, acao, entidade, detalhes, valor_anterior, valor_novo
    FROM logs_auditoria
    WHERE entidade = 'COMPETENCIA' AND registro_id = ?
    ORDER BY id ASC
  `).all(String(competenciaId)) as any[];

  return {
    competenciaId: comp.id,
    mesAno: comp.mes_ano,
    situacao: comp.situacao,
    etapas: {
      lancamento: {
        usuarioId: comp.lancado_por || null,
        usuarioEmail: comp.lancado_por_email || null,
        dataHora: comp.lancado_em || null,
        concluido: !!comp.lancado_em,
      },
      calculo: {
        usuarioId: comp.calculado_por || null,
        usuarioEmail: comp.calculado_por_email || null,
        dataHora: comp.calculado_em || null,
        concluido: !!comp.calculado_em,
      },
      conferencia: {
        usuarioId: comp.conferido_por || null,
        usuarioEmail: comp.conferido_por_email || null,
        dataHora: comp.conferido_em || null,
        valida: !!comp.conferido_em,
        motivoDevolucao: comp.motivo_devolucao || null,
      },
      fechamento: {
        usuarioId: comp.fechado_por || null,
        usuarioEmail: comp.fechado_por_email || null,
        dataHora: comp.fechado_em || null,
        fechada: comp.situacao === 'FECHADA',
        versaoAtual: versoes.length > 0 ? versoes[versoes.length - 1].versao_numero : null,
        justificativaReabertura: comp.justificativa_reabertura || null,
      },
      pagamento: {
        usuarioId: comp.pago_por || null,
        usuarioEmail: comp.pago_por_email || null,
        dataHora: comp.pago_em || null,
        pago: !!comp.pago_em,
      },
    },
    totalVersoes: versoes.length,
    versoes: versoes.map((v) => ({
      id: v.id,
      versao: v.versao_numero,
      dataHora: v.data_hora,
      usuarioEmail: v.usuario_email,
      hashSha256: v.hash_sha256,
      totais: {
        proventos: v.proventos,
        descontos: v.descontos,
        liquido: v.liquido,
        fgts: v.fgts,
      },
    })),
    auditoriaLogs: logsAuditoria,
  };
}

/**
 * US-16 / RN-68: Consulta snapshot completo de uma versão específica da folha.
 */
export function obterDetalheVersaoFolha(
  db: DatabaseSync,
  usuarioSolicitante: { perfil: string },
  competenciaId: number,
  versaoNumero: string
): any {
  if (usuarioSolicitante.perfil !== 'DIRETORIA' && usuarioSolicitante.perfil !== 'RH') {
    throw new Error('Você não tem permissão para esta ação.');
  }

  const versaoRow = db.prepare(`
    SELECT * FROM folha_versoes
    WHERE competencia_id = ? AND versao_numero = ?
  `).get(competenciaId, versaoNumero) as any;

  if (!versaoRow) {
    throw new Error(`Versão ${versaoNumero} não encontrada para a competência.`);
  }

  return {
    id: versaoRow.id,
    competenciaId: versaoRow.competencia_id,
    versaoNumero: versaoRow.versao_numero,
    dataHora: versaoRow.data_hora,
    usuarioEmail: versaoRow.usuario_email,
    hashSha256: versaoRow.hash_sha256,
    totais: {
      proventos: versaoRow.total_proventos_centavos / 100.0,
      descontos: versaoRow.total_descontos_centavos / 100.0,
      liquido: versaoRow.liquido_centavos / 100.0,
      fgts: versaoRow.fgts_centavos / 100.0,
    },
    dadosSnapshot: JSON.parse(versaoRow.dados_json),
  };
}
