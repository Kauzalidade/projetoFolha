/**
 * feriasService.ts - Gerenciamento e Cálculo de Férias (RN-40 a RN-49, Seções 5.5, 7.2 e 8).
 */

import { DatabaseSync } from 'node:sqlite';
import { Dec } from '../dec.js';
import { calcularINSS, calcularIRRF } from '../calculo.js';
import { registrarLog } from './logService.js';

export interface SolicitarFeriasDTO {
  colaboradorId: number;
  dataInicio: string; // AAAA-MM-DD
  diasGozo: number;
  diasAbono?: number;
  fracionamentoPeriodos?: number[]; // Ex: [14, 8, 8] ou [10, 10, 10]
  mediaHorasExtras?: number | string; // RN-48
  justificativa?: string; // Tabela 7.2
  periodoConcessivoFim?: string; // Período concessivo específico ou vencido
}

export function solicitarFerias(
  db: DatabaseSync,
  usuarioSolicitante: { id: number; email: string; perfil: string },
  dados: SolicitarFeriasDTO
): any {
  if (usuarioSolicitante.perfil !== 'RH') {
    throw new Error('Você não tem permissão para esta ação.');
  }

  const colab = db.prepare('SELECT id, nome, admissao, salario_base_centavos FROM colaboradores WHERE id = ?')
    .get(dados.colaboradorId) as any;
  if (!colab) throw new Error('Colaborador não encontrado.');

  // RN-40 / RN-45: Pedido de férias antes de completar o aquisitivo é rejeitado
  const dataAdmissao = new Date(colab.admissao);
  const dataInicioFerias = new Date(dados.dataInicio);
  const diffMeses = (dataInicioFerias.getFullYear() - dataAdmissao.getFullYear()) * 12 +
    (dataInicioFerias.getMonth() - dataAdmissao.getMonth());

  if (diffMeses < 12) {
    throw new Error('O período aquisitivo ainda não foi completado.');
  }

  // Apuração do período aquisitivo e concessivo corrente (Tabela 7.2)
  const anosCompletos = Math.max(1, Math.floor(diffMeses / 12));
  const inicioAquisitivo = new Date(dataAdmissao);
  inicioAquisitivo.setFullYear(inicioAquisitivo.getFullYear() + (anosCompletos - 1));
  const fimAquisitivo = new Date(inicioAquisitivo);
  fimAquisitivo.setFullYear(fimAquisitivo.getFullYear() + 1);
  const fimConcessivo = new Date(fimAquisitivo);
  fimConcessivo.setFullYear(fimConcessivo.getFullYear() + 1);

  const dataFimConcessivoEfetivo = dados.periodoConcessivoFim ? new Date(dados.periodoConcessivoFim) : fimConcessivo;
  const isConcessivoVencido = dataInicioFerias > dataFimConcessivoEfetivo;

  if (isConcessivoVencido && (!dados.justificativa || !dados.justificativa.trim())) {
    throw new Error('Período concessivo vencido. Aprovação de férias vencidas exige justificativa.');
  }

  // RN-42: Fracionamento de férias
  if (dados.fracionamentoPeriodos && dados.fracionamentoPeriodos.length > 0) {
    if (dados.fracionamentoPeriodos.length > 3) {
      throw new Error('O fracionamento de férias permite no máximo 3 períodos.');
    }
    const temAoMenos14 = dados.fracionamentoPeriodos.some((d) => d >= 14);
    const todosAoMenos5 = dados.fracionamentoPeriodos.every((d) => d >= 5);

    if (!temAoMenos14 || !todosAoMenos5) {
      throw new Error('Fracionamento inválido: um período deve ter no mínimo 14 dias e os demais no mínimo 5 dias.');
    }
  }

  // RN-47: Início das férias não pode começar nos 2 dias que antecedem feriado ou descanso semanal
  // Sábado (6) e Domingo (0) são descanso semanal. Sexta (5) ou Sábado (6) antes de feriado ou repouso semanal é vedado.
  const diaSemana = dataInicioFerias.getUTCDay();
  // Se início for sábado (6), é véspera imediata de descanso semanal (domingo)
  if (diaSemana === 6) {
    throw new Error('Início das férias não pode começar nos 2 dias que antecedem feriado ou descanso semanal.');
  }

  // Verifica feriados nos 2 dias seguintes
  const d1 = new Date(dataInicioFerias);
  d1.setUTCDate(d1.getUTCDate() + 1);
  const d2 = new Date(dataInicioFerias);
  d2.setUTCDate(d2.getUTCDate() + 2);

  const isoD1 = d1.toISOString().slice(0, 10);
  const isoD2 = d2.toISOString().slice(0, 10);

  const feriadoProximo = db.prepare('SELECT data, descricao FROM feriados WHERE data IN (?, ?)').get(isoD1, isoD2) as any;
  if (feriadoProximo) {
    throw new Error(`Início das férias não pode começar nos 2 dias que antecedem feriado ou descanso semanal (Feriado: ${feriadoProximo.descricao} em ${feriadoProximo.data}).`);
  }

  // RN-47: Data limite de pagamento: até 2 dias antes do início
  const dataPagamento = new Date(dataInicioFerias);
  dataPagamento.setUTCDate(dataPagamento.getUTCDate() - 2);
  const dataLimitePagamentoStr = dataPagamento.toISOString().slice(0, 10);

  // RN-44: Consulta faltas injustificadas para apurar dias de direito
  const faltasTotal = (db.prepare(`
    SELECT coalesce(sum(quantidade), 0) as total FROM eventos
    WHERE colaborador_id = ? AND tipo = 'FALTA_INJUSTIFICADA'
  `).get(dados.colaboradorId) as any).total;

  let diasDireito = 30;
  if (faltasTotal > 32) diasDireito = 0;
  else if (faltasTotal >= 24) diasDireito = 12;
  else if (faltasTotal >= 15) diasDireito = 18;
  else if (faltasTotal >= 6) diasDireito = 24;

  const diasAbono = dados.diasAbono || 0;
  const diasGozo = dados.diasGozo;

  if (diasGozo + diasAbono > diasDireito) {
    throw new Error(`Total de dias solicitados (${diasGozo + diasAbono}) excede o direito adquirido (${diasDireito} dias).`);
  }

  // Remuneração base = salário-base + média de horas extras/DSR (RN-41, RN-48)
  const salarioBaseDec = new Dec(BigInt(colab.salario_base_centavos));
  const mediaHEDec = dados.mediaHorasExtras ? Dec.fromMoeda(dados.mediaHorasExtras) : Dec.zero();
  const remuneracaoBase = salarioBaseDec.add(mediaHEDec);

  // Valor das férias gozadas = (remuneraçãoBase / 30) * diasGozo
  const valorDiaNum = remuneracaoBase.toNumber() / 30;
  const valorFeriasGozadasDec = Dec.fromMoeda(valorDiaNum * diasGozo);
  const valorTercoGozadoDec = Dec.fromMoeda(valorFeriasGozadasDec.toNumber() / 3);

  // Abono pecuniário (RN-43): diasAbono x valorDia + 1/3 sobre o abono
  let valorAbonoDec = Dec.zero();
  let valorTercoAbonoDec = Dec.zero();
  if (diasAbono > 0) {
    valorAbonoDec = Dec.fromMoeda(valorDiaNum * diasAbono);
    valorTercoAbonoDec = Dec.fromMoeda(valorAbonoDec.toNumber() / 3);
  }

  // Incidências: INSS e IRRF incidem APENAS sobre férias gozadas + 1/3 (RN-43)
  // O abono pecuniário é ISENTO de INSS e IRRF
  const baseTributavelFerias = valorFeriasGozadasDec.add(valorTercoGozadoDec);
  const { inssTotal } = calcularINSS(baseTributavelFerias);
  const { irrfFinal } = calcularIRRF(baseTributavelFerias, inssTotal, 0);

  const totalBruto = valorFeriasGozadasDec
    .add(valorTercoGozadoDec)
    .add(valorAbonoDec)
    .add(valorTercoAbonoDec);

  const totalDescontos = inssTotal.add(irrfFinal);
  const liquidoFerias = totalBruto.sub(totalDescontos);

  const dataFimGozo = new Date(dataInicioFerias);
  dataFimGozo.setUTCDate(dataFimGozo.getUTCDate() + diasGozo - 1);

  const agora = new Date().toISOString();
  const stmt = db.prepare(`
    INSERT INTO ferias (
      colaborador_id, periodo_aquisitivo_inicio, periodo_aquisitivo_fim, periodo_concessivo_fim,
      dias_direito, dias_gozo, dias_abono, data_inicio, data_fim, data_limite_pagamento,
      valor_ferias_centavos, valor_terco_centavos, valor_abono_centavos, valor_terco_abono_centavos,
      inss_centavos, irrf_centavos, liquido_centavos, situacao, justificativa, criado_em
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'APROVADA', ?, ?)
  `);

  const res = stmt.run(
    dados.colaboradorId,
    inicioAquisitivo.toISOString().slice(0, 10),
    fimAquisitivo.toISOString().slice(0, 10),
    dataFimConcessivoEfetivo.toISOString().slice(0, 10),
    diasDireito,
    diasGozo,
    diasAbono,
    dados.dataInicio,
    dataFimGozo.toISOString().slice(0, 10),
    dataLimitePagamentoStr,
    Number(valorFeriasGozadasDec.centavos),
    Number(valorTercoGozadoDec.centavos),
    Number(valorAbonoDec.centavos),
    Number(valorTercoAbonoDec.centavos),
    Number(inssTotal.centavos),
    Number(irrfFinal.centavos),
    Number(liquidoFerias.centavos),
    dados.justificativa ?? null,
    agora
  );

  registrarLog(db, {
    usuarioId: usuarioSolicitante.id,
    usuarioEmail: usuarioSolicitante.email,
    usuarioPerfil: usuarioSolicitante.perfil,
    acao: 'APROVAR_FERIAS',
    entidade: 'FERIAS',
    registroId: Number(res.lastInsertRowid),
    detalhes: `Férias aprovadas para ${colab.nome}: ${diasGozo} dias de gozo, ${diasAbono} dias de abono. Líquido: ${liquidoFerias.toFormatado()}`,
  });

  return {
    id: Number(res.lastInsertRowid),
    diasDireito,
    diasGozo,
    diasAbono,
    dataInicio: dados.dataInicio,
    dataFim: dataFimGozo.toISOString().slice(0, 10),
    dataLimitePagamento: dataLimitePagamentoStr,
    baseRemuneracao: remuneracaoBase.toNumber(),
    valorFerias: valorFeriasGozadasDec.toNumber(),
    valorTerco: valorTercoGozadoDec.toNumber(),
    valorAbonoTotal: valorAbonoDec.add(valorTercoAbonoDec).toNumber(),
    inss: inssTotal.toNumber(),
    irrf: irrfFinal.toNumber(),
    totalBruto: totalBruto.toNumber(),
    liquido: liquidoFerias.toNumber(),
  };
}

export function listarFerias(
  db: DatabaseSync,
  usuarioSolicitante: { perfil: string },
  filtros?: { colaboradorId?: number; filialId?: number; situacao?: string }
): any[] {
  if (usuarioSolicitante.perfil !== 'RH' && usuarioSolicitante.perfil !== 'DIRETORIA') {
    throw new Error('Você não tem permissão para esta ação.');
  }

  let sql = `
    SELECT f.*, c.nome as colaborador_nome, fil.nome as filial_nome
    FROM ferias f
    JOIN colaboradores c ON c.id = f.colaborador_id
    JOIN filiais fil ON fil.id = c.filial_id
    WHERE 1=1
  `;
  const params: any[] = [];

  if (filtros?.colaboradorId) {
    sql += ' AND f.colaborador_id = ?';
    params.push(filtros.colaboradorId);
  }
  if (filtros?.filialId) {
    sql += ' AND c.filial_id = ?';
    params.push(filtros.filialId);
  }
  if (filtros?.situacao) {
    sql += ' AND f.situacao = ?';
    params.push(filtros.situacao);
  }

  sql += ' ORDER BY f.id DESC';

  const rows = db.prepare(sql).all(...params) as any[];
  return rows.map((r) => ({
    id: r.id,
    colaborador: r.colaborador_nome,
    filial: r.filial_nome,
    periodoAquisitivoInicio: r.periodo_aquisitivo_inicio,
    periodoAquisitivoFim: r.periodo_aquisitivo_fim,
    periodoConcessivoFim: r.periodo_concessivo_fim,
    diasDireito: r.dias_direito,
    diasGozo: r.dias_gozo,
    diasAbono: r.dias_abono,
    dataInicio: r.data_inicio,
    dataFim: r.data_fim,
    dataLimitePagamento: r.data_limite_pagamento,
    valorFerias: new Dec(BigInt(r.valor_ferias_centavos)).toNumber(),
    valorTerco: new Dec(BigInt(r.valor_terco_centavos)).toNumber(),
    valorAbonoTotal: new Dec(BigInt(r.valor_abono_centavos + r.valor_terco_abono_centavos)).toNumber(),
    inss: new Dec(BigInt(r.inss_centavos)).toNumber(),
    irrf: new Dec(BigInt(r.irrf_centavos)).toNumber(),
    liquido: new Dec(BigInt(r.liquido_centavos)).toNumber(),
    situacao: r.situacao,
    justificativa: r.justificativa,
  }));
}
