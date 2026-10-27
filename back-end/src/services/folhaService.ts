/**
 * folhaService.ts - Cálculo da Folha, Memória de Cálculo e Fechamento Seguro (Etapa 3).
 * 
 * Atende aos requisitos:
 * - RN-02: Memória de cálculo por verba (base, regra, parâmetro, arredondamento)
 * - RN-05: Dado obrigatório ausente bloqueia o fechamento
 * - RN-06: Descontos acima dos proventos (líquido nunca negativo, saldo a descontar limitado a 30% no mês seguinte)
 * - RN-21 a RN-24: Ordem de cálculo, INSS progressivo, IRRF comparativo e FGTS (encargo)
 * - RN-31: DSR sobre horas extras
 * - Tabela 7.1: Matriz de decisão do fechamento da folha
 */

import { DatabaseSync } from 'node:sqlite';
import { Dec } from '../dec.js';
import { calcularINSS, calcularIRRF, calcularDSRExtras } from '../calculo.js';
import { registrarLog } from './logService.js';
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

export function calcularFolhaColaborador(
  db: DatabaseSync,
  usuarioSolicitante: { id: number; email: string; perfil: string },
  dados: {
    colaboradorId: number;
    competenciaId: number;
    diasUteisMes?: number;
    domingosEFeriadosMes?: number;
  }
): any {
  if (usuarioSolicitante.perfil !== 'RH') {
    throw new Error('Você não tem permissão para esta ação.');
  }

  verificarCompetenciaAberta(db, dados.competenciaId);

  const colab = db.prepare('SELECT * FROM colaboradores WHERE id = ?').get(dados.colaboradorId) as any;
  if (!colab) throw new Error('Colaborador não encontrado.');

  const comp = db.prepare('SELECT id, mes_ano FROM competencias WHERE id = ?').get(dados.competenciaId) as any;
  const verbasMemoria: ItemMemoriaVerba[] = [];

  // 1. Salário-base
  const salarioBaseDec = new Dec(BigInt(colab.salario_base_centavos));
  verbasMemoria.push({
    tipo: 'SALARIO_BASE',
    descricao: 'Salário Base Mensal',
    natureza: 'PROVENTO',
    valor: salarioBaseDec,
    baseCalculo: salarioBaseDec,
    regraAplicada: 'Salário contratual integral (RN-20 / RN-30)',
  });

  // 2. Busca eventos lançados na competência
  const eventos = db.prepare('SELECT * FROM eventos WHERE colaborador_id = ? AND competencia_id = ?')
    .all(dados.colaboradorId, dados.competenciaId) as any[];

  let horasExtrasDec = Dec.zero();
  let faltasDec = Dec.zero();
  let vtDec = Dec.zero();
  let proventosAvulsosTributaveisDec = Dec.zero();
  let proventosAvulsosIsentosDec = Dec.zero();
  let descontosAvulsosDec = Dec.zero();

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
    } else if (ev.tipo === 'VALE_TRANSPORTE') {
      vtDec = vtDec.add(valDec);
    } else if (ev.tipo === 'VERBA_AVULSA_PROVENTO') {
      if (ev.incide_inss === 1) {
        proventosAvulsosTributaveisDec = proventosAvulsosTributaveisDec.add(valDec);
      } else {
        proventosAvulsosIsentosDec = proventosAvulsosIsentosDec.add(valDec);
      }
      verbasMemoria.push({
        tipo: 'VERBA_AVULSA_PROVENTO',
        descricao: ev.descricao || 'Provento Avulso',
        natureza: 'PROVENTO',
        valor: valDec,
        baseCalculo: valDec,
        regraAplicada: `Verba avulsa manual (RN-25). Incidências: INSS=${ev.incide_inss}, IRRF=${ev.incide_irrf}, FGTS=${ev.incide_fgts}`,
      });
    } else if (ev.tipo === 'VERBA_AVULSA_DESCONTO') {
      descontosAvulsosDec = descontosAvulsosDec.add(valDec);
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

  // 4. Base do INSS e Cálculo Progressivo (RN-22)
  // Base INSS = Salário + HE + DSR + Proventos Tributáveis - Faltas
  const baseINSS = salarioBaseDec
    .add(horasExtrasDec)
    .add(dsrExtrasDec)
    .add(proventosAvulsosTributaveisDec)
    .sub(faltasDec);

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

  // 6. Base e Cálculo do IRRF (RN-23)
  const rendimentoTributavelIRRF = baseINSS;
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

  // 7. FGTS (RN-24) - Encargo da empresa (8%)
  const fgtsDec = baseINSS.mul(0.08);
  verbasMemoria.push({
    tipo: 'FGTS',
    descricao: 'FGTS (Encargo Empresa 8%)',
    natureza: 'ENCARGO',
    valor: fgtsDec,
    baseCalculo: baseINSS,
    regraAplicada: '8% sobre remuneração tributável - encargo patronal não descontado do empregado (RN-24)',
  });

  // 8. Saldo a descontar de competências anteriores (RN-06)
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
    // Aplica o menor valor entre o saldo pendente e o limite de 30%
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

  // Adiciona Vale-Transporte e Descontos Avulsos na memória
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

  if (!descontosAvulsosDec.isZero()) {
    verbasMemoria.push({
      tipo: 'VERBA_AVULSA_DESCONTO',
      descricao: 'Desconto Avulso Manual',
      natureza: 'DESCONTO',
      valor: descontosAvulsosDec,
      baseCalculo: descontosAvulsosDec,
      regraAplicada: 'Verba avulsa manual lançada pelo RH (RN-25)',
    });
  }

  // 9. Totalização e Regra de Proteção ao Líquido (RN-06)
  const totalProventos = salarioBaseDec
    .add(horasExtrasDec)
    .add(dsrExtrasDec)
    .add(proventosAvulsosTributaveisDec)
    .add(proventosAvulsosIsentosDec);

  const descontosMandatorios = inssTotal.add(irrfFinal);
  let outrosDescontosDesejados = faltasDec
    .add(vtDec)
    .add(descontosAvulsosDec)
    .add(descontoSaldoAnteriorDec);

  let saldoGeradoDec = Dec.zero();
  let outrosDescontosAplicadosDec = outrosDescontosDesejados;
  let liquidoDec = Dec.zero();

  // Verifica se proventos cobrem os descontos mandatórios
  if (totalProventos.centavos < descontosMandatorios.centavos) {
    // Caso extremo: proventos não cobrem nem INSS+IRRF
    liquidoDec = Dec.zero();
    saldoGeradoDec = outrosDescontosDesejados;
    outrosDescontosAplicadosDec = Dec.zero();
  } else {
    const margemDisponivel = totalProventos.sub(descontosMandatorios);
    if (outrosDescontosDesejados.centavos > margemDisponivel.centavos) {
      // RN-06: Líquido nunca fica negativo, excedente vira saldo a descontar
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
        colaborador_id, competencia_origem_id, valor_original_centavos, valor_restante_centavos, situacao, criado_em
      ) VALUES (?, ?, ?, ?, 'PENDENTE', ?)
    `).run(
      dados.colaboradorId,
      dados.competenciaId,
      Number(saldoGeradoDec.centavos),
      Number(saldoGeradoDec.centavos),
      agora
    );
  }

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
 * Fechamento Seguro da Competência com validação de dados pendentes e saldo (Tabela 7.1).
 */
export function fecharFolhaSegura(
  db: DatabaseSync,
  usuarioSolicitante: { id: number; email: string; perfil: string },
  competenciaId: number,
  justificativaSaldo?: string
): void {
  if (usuarioSolicitante.perfil !== 'RH') {
    throw new Error('Você não tem permissão para esta ação.');
  }

  const comp = db.prepare('SELECT mes_ano, situacao FROM competencias WHERE id = ?').get(competenciaId) as any;
  if (!comp) throw new Error('Competência não encontrada.');

  // RN-05: Dado obrigatório ausente bloqueia o fechamento
  const colabsComPendencias = db.prepare(`
    SELECT nome FROM colaboradores
    WHERE situacao = 'ATIVO' AND (banco IS NULL OR banco = '' OR agencia IS NULL OR agencia = '' OR conta IS NULL OR conta = '')
  `).all() as any[];

  if (colabsComPendencias.length > 0) {
    const nomes = colabsComPendencias.map((c) => c.nome).join(', ');
    throw new Error(`O fechamento está bloqueado. Dados bancários pendentes para o colaborador: ${nomes}.`);
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
  db.prepare("UPDATE competencias SET situacao = 'FECHADA', fechado_em = ? WHERE id = ?")
    .run(agora, competenciaId);

  db.prepare("UPDATE folhas SET status = 'FECHADA', justificativa_saldo = ? WHERE competencia_id = ?")
    .run(justificativaSaldo ?? null, competenciaId);

  registrarLog(db, {
    usuarioId: usuarioSolicitante.id,
    usuarioEmail: usuarioSolicitante.email,
    usuarioPerfil: usuarioSolicitante.perfil,
    acao: 'FECHAR_FOLHA_COMPETENCIA',
    entidade: 'COMPETENCIA',
    registroId: competenciaId,
    detalhes: `Folha ${comp.mes_ano} fechada. Justificativa de saldo: ${justificativaSaldo ?? 'Nenhuma'}`,
  });
}
