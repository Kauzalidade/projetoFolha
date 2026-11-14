/**
 * relatoriosService.ts - Emissão de Contracheques e Relatórios da Folha (RN-55, RN-57, Seção 13, US-08, US-09).
 */

import { DatabaseSync } from 'node:sqlite';
import { Dec } from '../dec.js';
import { registrarLog } from './logService.js';
import { limparCPF, formatarCPF } from '../cpf.js';
import { executarConferenciaFinanceira } from './folhaService.js';

function escapeXML(str: string): string {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function sanitizarTextoPDF(str: string): string {
  return str
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\x20-\x7E]/g, ' ')
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)');
}

function montarPDF(linhas: { texto: string; negrito?: boolean; tamanho?: number; dy?: number }[]): Buffer {
  let stream = 'BT\n';
  let y = 800;
  for (const l of linhas) {
    const font = l.negrito ? '/F2' : '/F1';
    const size = l.tamanho || 10;
    const dy = l.dy || 14;
    y -= dy;
    if (y < 40) y = 40;
    const txt = sanitizarTextoPDF(l.texto);
    stream += `${font} ${size} Tf\n50 ${y} Td\n(${txt}) Tj\n-50 -${y} Td\n`;
  }
  stream += 'ET';

  const streamBytes = Buffer.from(stream, 'utf-8');
  const streamLen = streamBytes.length;

  let body = '%PDF-1.4\n';
  const offsets: number[] = [];
  function add(content: string) {
    offsets.push(Buffer.byteLength(body, 'utf-8'));
    body += content + '\n';
  }

  add('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj');
  add('2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj');
  add('3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> >>\nendobj');
  add(`4 0 obj\n<< /Length ${streamLen} >>\nstream\n${stream}\nendstream\nendobj`);
  add('5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj');
  add('6 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>\nendobj');

  const startxref = Buffer.byteLength(body, 'utf-8');
  let xref = 'xref\n0 7\n0000000000 65535 f \n';
  for (let i = 0; i < 6; i++) {
    xref += String(offsets[i]).padStart(10, '0') + ' 00000 n \n';
  }
  const trailer = `trailer\n<< /Size 7 /Root 1 0 R >>\nstartxref\n${startxref}\n%%EOF\n`;

  return Buffer.from(body + xref + trailer, 'binary');
}

export function gerarContrachequeEstruturado(
  db: DatabaseSync,
  usuarioSolicitante: { perfil: string },
  colaboradorId: number,
  competenciaId: number
): any {
  if (usuarioSolicitante.perfil !== 'RH' && usuarioSolicitante.perfil !== 'DIRETORIA') {
    throw new Error('Você não tem permissão para esta ação.');
  }

  const folha = db.prepare('SELECT * FROM folhas WHERE colaborador_id = ? AND competencia_id = ?')
    .get(colaboradorId, competenciaId) as any;
  if (!folha) throw new Error('Folha de pagamento não encontrada para o colaborador nesta competência.');

  const colab = db.prepare(`
    SELECT c.*, f.nome as filial_nome
    FROM colaboradores c
    JOIN filiais f ON f.id = c.filial_id
    WHERE c.id = ?
  `).get(colaboradorId) as any;

  const comp = db.prepare('SELECT id, mes_ano, situacao FROM competencias WHERE id = ?').get(competenciaId) as any;
  const versaoRow = comp && comp.situacao === 'FECHADA'
    ? (db.prepare('SELECT versao_numero, hash_sha256 FROM folha_versoes WHERE competencia_id = ? ORDER BY id DESC LIMIT 1').get(competenciaId) as any)
    : null;
  const versao = versaoRow ? versaoRow.versao_numero : (comp?.situacao === 'FECHADA' ? 'V1' : 'Prévia');

  const verbas = db.prepare('SELECT * FROM folha_verbas WHERE folha_id = ?').all(folha.id) as any[];

  return {
    cabecalho: {
      empresa: 'Correspondente Bancário S.A.',
      filial: colab.filial_nome,
      competencia: comp.mes_ano,
      situacao: comp.situacao,
      versao,
      hashSha256: versaoRow?.hash_sha256 || null,
      dataGeracao: new Date().toISOString(),
    },
    colaborador: {
      nome: colab.nome,
      cpf: colab.cpf,
      cargo: colab.cargo,
      admissao: colab.admissao,
      banco: colab.banco,
      agencia: colab.agencia,
      conta: colab.conta,
    },
    verbas: verbas.map((v) => ({
      descricao: v.descricao,
      natureza: v.natureza,
      provento: v.natureza === 'PROVENTO' ? new Dec(BigInt(v.valor_centavos)).toNumber() : 0,
      desconto: v.natureza === 'DESCONTO' ? new Dec(BigInt(v.valor_centavos)).toNumber() : 0,
      baseCalculo: new Dec(BigInt(v.base_calculo_centavos)).toNumber(),
      memoriaResumida: v.regra_aplicada,
    })),
    totais: {
      totalProventos: new Dec(BigInt(folha.total_proventos_centavos)).toNumber(),
      totalDescontos: new Dec(BigInt(folha.total_descontos_centavos)).toNumber(),
      liquido: new Dec(BigInt(folha.liquido_centavos)).toNumber(),
      fgtsEmpresa: new Dec(BigInt(folha.fgts_centavos)).toNumber(),
    },
  };
}

export function gerarContrachequePDF(
  db: DatabaseSync,
  usuarioSolicitante: { email: string; perfil: string },
  colaboradorId: number,
  competenciaId: number
): Buffer {
  if (usuarioSolicitante.perfil !== 'RH' && usuarioSolicitante.perfil !== 'DIRETORIA') {
    throw new Error('Você não tem permissão para esta ação.');
  }

  const dados = gerarContrachequeEstruturado(db, usuarioSolicitante, colaboradorId, competenciaId);

  const linhasPDF: { texto: string; negrito?: boolean; tamanho?: number; dy?: number }[] = [
    { texto: 'CORRESPONDENTE BANCARIO S.A. - DEMONSTRATIVO DE PAGAMENTO', negrito: true, tamanho: 14, dy: 10 },
    { texto: `Filial: ${dados.cabecalho.filial} | Competência: ${dados.cabecalho.competencia} | Versão: ${dados.cabecalho.versao}`, tamanho: 10, dy: 16 },
    { texto: `Colaborador: ${dados.colaborador.nome} | CPF: ${dados.colaborador.cpf}`, negrito: true, tamanho: 11, dy: 16 },
    { texto: `Cargo: ${dados.colaborador.cargo} | Admissão: ${dados.colaborador.admissao} | Banco: ${dados.colaborador.banco} Ag: ${dados.colaborador.agencia} Conta: ${dados.colaborador.conta}`, tamanho: 9, dy: 14 },
    { texto: '------------------------------------------------------------------------------------------------------------------------', tamanho: 8, dy: 12 },
    { texto: 'VERBAS E EVENTOS DA FOLHA (MEMORIA RESUMIDA)', negrito: true, tamanho: 10, dy: 14 },
  ];

  for (const v of dados.verbas) {
    const provStr = v.provento > 0 ? `+ R$ ${v.provento.toFixed(2)}` : '';
    const descStr = v.desconto > 0 ? `- R$ ${v.desconto.toFixed(2)}` : '';
    const valStr = provStr || descStr;
    linhasPDF.push({
      texto: `* ${v.descricao} [${v.natureza}]: ${valStr} | Base: R$ ${v.baseCalculo.toFixed(2)}`,
      negrito: false,
      tamanho: 9,
      dy: 12,
    });
    if (v.memoriaResumida) {
      linhasPDF.push({
        texto: `    Regra/Memória: ${v.memoriaResumida}`,
        negrito: false,
        tamanho: 8,
        dy: 10,
      });
    }
  }

  linhasPDF.push(
    { texto: '------------------------------------------------------------------------------------------------------------------------', tamanho: 8, dy: 14 },
    { texto: `TOTAIS: Proventos: R$ ${dados.totais.totalProventos.toFixed(2)} | Descontos: R$ ${dados.totais.totalDescontos.toFixed(2)}`, negrito: true, tamanho: 10, dy: 14 },
    { texto: `VALOR LIQUIDO A RECEBER: R$ ${dados.totais.liquido.toFixed(2)}`, negrito: true, tamanho: 12, dy: 16 },
    { texto: `FGTS do Mês (Encargo Empresa 8%): R$ ${dados.totais.fgtsEmpresa.toFixed(2)}`, tamanho: 9, dy: 14 },
    { texto: `Emitido por: ${usuarioSolicitante.email} (${usuarioSolicitante.perfil}) em ${dados.cabecalho.dataGeracao}`, tamanho: 8, dy: 20 }
  );

  if (dados.cabecalho.hashSha256) {
    linhasPDF.push({
      texto: `Hash SHA-256 da Folha Fechada (RN-68): ${dados.cabecalho.hashSha256}`,
      tamanho: 7,
      dy: 10,
    });
  }

  registrarLog(db, {
    usuarioId: (usuarioSolicitante as any).id || 1,
    usuarioEmail: usuarioSolicitante.email,
    usuarioPerfil: usuarioSolicitante.perfil,
    acao: 'GERAR_CONTRACHEQUE_PDF',
    entidade: 'CONTRACHEQUE',
    registroId: colaboradorId,
    detalhes: `Contracheque em PDF emitido para ${dados.colaborador.nome} (${dados.colaborador.cpf}) - Competência ${dados.cabecalho.competencia} (${dados.cabecalho.versao})`,
  });

  return montarPDF(linhasPDF);
}

export function gerarRelatorioFolhaMes(
  db: DatabaseSync,
  usuarioSolicitante: { perfil: string },
  competenciaId: number,
  filialId?: number
): any {
  if (usuarioSolicitante.perfil !== 'RH' && usuarioSolicitante.perfil !== 'DIRETORIA') {
    throw new Error('Você não tem permissão para esta ação.');
  }

  let sql = `
    SELECT f.*, c.nome as colaborador_nome, fil.nome as filial_nome
    FROM folhas f
    JOIN colaboradores c ON c.id = f.colaborador_id
    JOIN filiais fil ON fil.id = c.filial_id
    WHERE f.competencia_id = ?
  `;
  const params: any[] = [competenciaId];
  if (filialId) {
    sql += ' AND c.filial_id = ?';
    params.push(filialId);
  }

  const comp = db.prepare('SELECT mes_ano, situacao FROM competencias WHERE id = ?').get(competenciaId) as any;
  const versaoRow = comp && comp.situacao === 'FECHADA'
    ? (db.prepare('SELECT versao_numero, hash_sha256 FROM folha_versoes WHERE competencia_id = ? ORDER BY id DESC LIMIT 1').get(competenciaId) as any)
    : null;
  const versao = versaoRow ? versaoRow.versao_numero : (comp?.situacao === 'FECHADA' ? 'V1' : null);

  const folhas = db.prepare(sql).all(...params) as any[];

  let somaProventos = Dec.zero();
  let somaDescontos = Dec.zero();
  let somaLiquido = Dec.zero();
  let somaFGTS = Dec.zero();

  const linhas = folhas.map((f) => {
    const provDec = new Dec(BigInt(f.total_proventos_centavos));
    const descDec = new Dec(BigInt(f.total_descontos_centavos));
    const liqDec = new Dec(BigInt(f.liquido_centavos));
    const fgtsDec = new Dec(BigInt(f.fgts_centavos));

    somaProventos = somaProventos.add(provDec);
    somaDescontos = somaDescontos.add(descDec);
    somaLiquido = somaLiquido.add(liqDec);
    somaFGTS = somaFGTS.add(fgtsDec);

    return {
      colaborador: f.colaborador_nome,
      filial: f.filial_nome,
      proventos: provDec.toNumber(),
      descontos: descDec.toNumber(),
      liquido: liqDec.toNumber(),
      fgts: fgtsDec.toNumber(),
    };
  });

  return {
    titulo: comp && comp.situacao === 'FECHADA' ? `Relatório da Folha do Mês (${versao})` : 'Relatório da Folha do Mês',
    competencia: comp ? comp.mes_ano : String(competenciaId),
    competenciaId,
    situacao: comp ? comp.situacao : 'ABERTA',
    versao,
    hashSha256: versaoRow?.hash_sha256 || null,
    totalColaboradores: linhas.length,
    linhas,
    totaisGerais: {
      proventos: somaProventos.toNumber(),
      descontos: somaDescontos.toNumber(),
      liquido: somaLiquido.toNumber(),
      fgts: somaFGTS.toNumber(),
    },
  };
}

export function gerarRelatorioFerias(
  db: DatabaseSync,
  usuarioSolicitante: { perfil: string },
  filtros?: { filialId?: number; situacao?: string }
): any {
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
  if (filtros?.filialId) {
    sql += ' AND c.filial_id = ?';
    params.push(filtros.filialId);
  }
  if (filtros?.situacao) {
    sql += ' AND f.situacao = ?';
    params.push(filtros.situacao);
  }

  const rows = db.prepare(sql).all(...params) as any[];
  const linhas = rows.map((r) => ({
    colaborador: r.colaborador_nome,
    filial: r.filial_nome,
    inicioAquisitivo: r.periodo_aquisitivo_inicio,
    fimConcessivo: r.periodo_concessivo_fim,
    diasDireito: r.dias_direito,
    diasGozo: r.dias_gozo,
    diasAbono: r.dias_abono,
    situacao: r.situacao,
    dataInicio: r.data_inicio,
    dataLimitePagamento: r.data_limite_pagamento,
    liquido: new Dec(BigInt(r.liquido_centavos)).toNumber(),
  }));

  return {
    titulo: 'Relatório de Férias',
    totalRegistros: linhas.length,
    linhas,
  };
}

export function gerarRelatorioHorasExtras(
  db: DatabaseSync,
  usuarioSolicitante: { perfil: string },
  competenciaId: number,
  filialId?: number
): any {
  if (usuarioSolicitante.perfil !== 'RH' && usuarioSolicitante.perfil !== 'DIRETORIA') {
    throw new Error('Você não tem permissão para esta ação.');
  }

  let sql = `
    SELECT c.nome as colaborador_nome, fil.nome as filial_nome,
      sum(case when e.tipo = 'HORA_EXTRA_UTIL' then e.quantidade else 0 end) as horas_uteis,
      sum(case when e.tipo = 'HORA_EXTRA_DOMINGO' then e.quantidade else 0 end) as horas_domingo,
      sum(case when e.tipo in ('HORA_EXTRA_UTIL', 'HORA_EXTRA_DOMINGO') then e.valor_centavos else 0 end) as valor_total_centavos
    FROM eventos e
    JOIN colaboradores c ON c.id = e.colaborador_id
    JOIN filiais fil ON fil.id = c.filial_id
    WHERE e.competencia_id = ? AND e.tipo in ('HORA_EXTRA_UTIL', 'HORA_EXTRA_DOMINGO')
  `;
  const params: any[] = [competenciaId];
  if (filialId) {
    sql += ' AND c.filial_id = ?';
    params.push(filialId);
  }
  sql += ' GROUP BY c.id, c.nome, fil.nome';

  const rows = db.prepare(sql).all(...params) as any[];
  const linhas = rows.map((r) => ({
    colaborador: r.colaborador_nome,
    filial: r.filial_nome,
    horasDiaUtil: r.horas_uteis || 0,
    horasDomingoFeriado: r.horas_domingo || 0,
    valorTotal: new Dec(BigInt(r.valor_total_centavos || 0)).toNumber(),
  }));

  return {
    titulo: 'Relatório de Horas Extras do Mês',
    competenciaId,
    totalColaboradores: linhas.length,
    linhas,
  };
}

export function gerarRelatorioColaboradores(
  db: DatabaseSync,
  usuarioSolicitante: { perfil: string },
  filtros?: { filialId?: number; situacao?: string }
): any {
  if (usuarioSolicitante.perfil !== 'RH' && usuarioSolicitante.perfil !== 'DIRETORIA') {
    throw new Error('Você não tem permissão para esta ação.');
  }

  let sql = `
    SELECT c.nome, c.cpf, c.cargo, c.setor, fil.nome as filial_nome, c.admissao, c.salario_base_centavos, c.situacao
    FROM colaboradores c
    JOIN filiais fil ON fil.id = c.filial_id
    WHERE 1=1
  `;
  const params: any[] = [];
  if (filtros?.filialId) {
    sql += ' AND c.filial_id = ?';
    params.push(filtros.filialId);
  }
  if (filtros?.situacao) {
    sql += ' AND c.situacao = ?';
    params.push(filtros.situacao);
  }

  const rows = db.prepare(sql).all(...params) as any[];
  const linhas = rows.map((r) => ({
    nome: r.nome,
    cpf: r.cpf,
    cargo: r.cargo,
    setor: r.setor,
    filial: r.filial_nome,
    admissao: r.admissao,
    salarioBase: new Dec(BigInt(r.salario_base_centavos)).toNumber(),
    situacao: r.situacao,
  }));

  return {
    titulo: 'Relatório de Colaboradores',
    totalColaboradores: linhas.length,
    linhas,
  };
}

export function gerarRelatorioDocumentosExames(
  db: DatabaseSync,
  usuarioSolicitante: { perfil: string },
  prazoDias: number = 30
): any {
  if (usuarioSolicitante.perfil !== 'RH' && usuarioSolicitante.perfil !== 'DIRETORIA') {
    throw new Error('Você não tem permissão para esta ação.');
  }

  const hoje = new Date();
  const linhas: any[] = [];

  const docs = db.prepare(`
    SELECT d.tipo, d.nome_arquivo, d.data_validade, c.nome as colaborador_nome, fil.nome as filial_nome
    FROM documentos_colaborador d
    JOIN colaboradores c ON c.id = d.colaborador_id
    JOIN filiais fil ON fil.id = c.filial_id
    WHERE d.data_validade IS NOT NULL
  `).all() as any[];

  for (const doc of docs) {
    const diff = Math.ceil((new Date(doc.data_validade).getTime() - hoje.getTime()) / (1000 * 60 * 60 * 24));
    if (diff <= prazoDias) {
      linhas.push({
        colaborador: doc.colaborador_nome,
        filial: doc.filial_nome,
        categoria: 'Documento',
        item: `${doc.tipo} (${doc.nome_arquivo})`,
        dataValidade: doc.data_validade,
        diasRestantes: diff,
      });
    }
  }

  const exames = db.prepare(`
    SELECT e.tipo, e.data_proximo_vencimento, c.nome as colaborador_nome, fil.nome as filial_nome
    FROM exames_ocupacionais e
    JOIN colaboradores c ON c.id = e.colaborador_id
    JOIN filiais fil ON fil.id = c.filial_id
  `).all() as any[];

  for (const ex of exames) {
    const diff = Math.ceil((new Date(ex.data_proximo_vencimento).getTime() - hoje.getTime()) / (1000 * 60 * 60 * 24));
    if (diff <= prazoDias) {
      linhas.push({
        colaborador: ex.colaborador_nome,
        filial: ex.filial_nome,
        categoria: 'Exame Ocupacional',
        item: ex.tipo,
        dataValidade: ex.data_proximo_vencimento,
        diasRestantes: diff,
      });
    }
  }

  return {
    titulo: 'Relatório de Documentos e Exames a Vencer',
    prazoDias,
    totalItens: linhas.length,
    linhas,
  };
}

export function gerarRelatorioDadosPagamento(
  db: DatabaseSync,
  usuarioSolicitante: { perfil: string },
  competenciaId: number,
  filialId?: number,
  options?: { exigirFechada?: boolean }
): any {
  if (usuarioSolicitante.perfil !== 'RH' && usuarioSolicitante.perfil !== 'DIRETORIA') {
    throw new Error('Você não tem permissão para esta ação.');
  }

  const comp = db.prepare('SELECT id, mes_ano, situacao FROM competencias WHERE id = ?').get(competenciaId) as any;
  if (!comp) throw new Error('Competência não encontrada.');

  // RN-60: Relatório Dados de pagamento só para competência fechada
  if (options?.exigirFechada && comp.situacao !== 'FECHADA') {
    throw new Error('O relatório Dados de Pagamento só pode ser gerado para competências fechadas (RN-60).');
  }

  let sql = `
    SELECT c.nome as colaborador_nome, c.cpf, c.banco, c.agencia, c.conta,
      f.liquido_centavos, fil.nome as filial_nome, comp.mes_ano
    FROM folhas f
    JOIN colaboradores c ON c.id = f.colaborador_id
    JOIN filiais fil ON fil.id = c.filial_id
    JOIN competencias comp ON comp.id = f.competencia_id
    WHERE f.competencia_id = ?
  `;
  const params: any[] = [competenciaId];
  if (filialId) {
    sql += ' AND c.filial_id = ?';
    params.push(filialId);
  }

  const rows = db.prepare(sql).all(...params) as any[];
  let somaLiquido = Dec.zero();

  const linhas = rows.map((r) => {
    const liqDec = new Dec(BigInt(r.liquido_centavos));
    somaLiquido = somaLiquido.add(liqDec);
    return {
      colaborador: r.colaborador_nome,
      cpf: r.cpf,
      filial: r.filial_nome,
      competencia: r.mes_ano,
      banco: r.banco,
      agencia: r.agencia,
      conta: r.conta,
      liquido: liqDec.toNumber(),
    };
  });

  return {
    titulo: 'Relatório de Dados de Pagamento (RN-57/RN-60)',
    competenciaId,
    competencia: comp.mes_ano,
    situacao: comp.situacao,
    totalColaboradores: linhas.length,
    linhas,
    totalLiquido: somaLiquido.toNumber(),
  };
}

/**
 * RN-73 e Seção 13: Relatório de Conferência da Folha.
 * Lista todos os itens da conferência matemática e todas as pendências críticas com colaborador e item.
 */
export function gerarRelatorioConferencia(
  db: DatabaseSync,
  usuarioSolicitante: { perfil: string },
  competenciaId: number
): any {
  if (usuarioSolicitante.perfil !== 'RH' && usuarioSolicitante.perfil !== 'DIRETORIA' && usuarioSolicitante.perfil !== 'ADMIN') {
    throw new Error('Você não tem permissão para esta ação.');
  }

  const comp = db.prepare('SELECT id, mes_ano, situacao, criado_em, calculado_por, conferido_por, conferido_em, fechado_por, fechado_em FROM competencias WHERE id = ?').get(competenciaId) as any;
  if (!comp) throw new Error('Competência não encontrada.');

  const confFinanceira = executarConferenciaFinanceira(db, competenciaId);

  // Lista de pendências críticas antes do fechamento (RN-73)
  const pendencias: { colaborador?: string; item: string; gravidade: 'BLOQUEANTE' | 'AVISO' }[] = [];

  // 1. Dados bancários obrigatórios ausentes (banco, agência, conta e titular - RN-05 e RN-73)
  const colabsComPendencias = db.prepare(`
    SELECT nome FROM colaboradores
    WHERE situacao = 'ATIVO' AND (
      banco IS NULL OR banco = '' OR
      agencia IS NULL OR agencia = '' OR
      conta IS NULL OR conta = ''
    )
  `).all() as any[];

  for (const c of colabsComPendencias) {
    pendencias.push({
      colaborador: c.nome,
      item: 'Dados bancários obrigatórios ausentes (banco, agência ou conta)',
      gravidade: 'BLOQUEANTE',
    });
  }

  // 2. Divergências da conferência financeira (RN-59)
  if (confFinanceira.statusGeral !== 'APROVADO') {
    for (const it of confFinanceira.itens) {
      if (it.status === 'DIVERGENTE') {
        pendencias.push({
          item: `Divergência financeira interna: ${it.item} (Esperado: R$ ${it.esperado.toFixed(2)}, Calculado: R$ ${it.calculado.toFixed(2)})`,
          gravidade: 'BLOQUEANTE',
        });
      }
    }
  }

  // 3. Competência anterior aberta (RN-63)
  const todasCompetencias = db.prepare('SELECT id, mes_ano, situacao FROM competencias ORDER BY mes_ano ASC').all() as any[];
  const idx = todasCompetencias.findIndex((c) => c.id === competenciaId);
  if (idx > 0) {
    const compAnterior = todasCompetencias[idx - 1];
    if (compAnterior.situacao !== 'FECHADA') {
      pendencias.push({
        item: `Competência anterior (${compAnterior.mes_ano}) não está fechada (RN-63)`,
        gravidade: 'BLOQUEANTE',
      });
    }
  }

  // 4. Saldo a descontar sem justificativa (RN-06)
  const folhasComSaldo = db.prepare(`
    SELECT f.id, f.saldo_a_descontar_centavos, f.justificativa_saldo, c.nome
    FROM folhas f
    JOIN colaboradores c ON c.id = f.colaborador_id
    WHERE f.competencia_id = ? AND f.saldo_a_descontar_centavos > 0
  `).all(competenciaId) as any[];

  for (const f of folhasComSaldo) {
    if (!f.justificativa_saldo || !f.justificativa_saldo.trim()) {
      pendencias.push({
        colaborador: f.nome,
        item: `Saldo a descontar pendente (R$ ${(f.saldo_a_descontar_centavos / 100).toFixed(2)}) sem justificativa obrigatória registrada`,
        gravidade: 'BLOQUEANTE',
      });
    }
  }

  // 5. Conferência não confirmada (RN-67)
  if (!comp.conferido_em) {
    pendencias.push({
      item: 'Conferência interna não confirmada pelo RH (RN-67)',
      gravidade: 'BLOQUEANTE',
    });
  }

  return {
    titulo: 'Relatório de Conferência da Folha (RN-73)',
    competencia: comp.mes_ano,
    competenciaId,
    situacao: comp.situacao,
    conferenciaFinanceira: confFinanceira,
    pendencias,
    totalPendencias: pendencias.length,
    aptoParaFechamento: pendencias.length === 0,
    trilha: {
      calculadoPor: comp.calculado_por,
      conferidoPor: comp.conferido_por,
      conferidoEm: comp.conferido_em,
      fechadoPor: comp.fechado_por,
      fechadoEm: comp.fechado_em,
    },
  };
}

export function gerarRelatorioConferenciaPDF(
  db: DatabaseSync,
  usuarioSolicitante: { id?: number; email: string; perfil: string },
  competenciaId: number
): Buffer {
  const dados = gerarRelatorioConferencia(db, usuarioSolicitante, competenciaId);

  const linhasPDF: { texto: string; negrito?: boolean; tamanho?: number; dy?: number }[] = [
    { texto: 'CORRESPONDENTE BANCARIO S.A. - RELATORIO DE CONFERENCIA DA FOLHA (RN-73)', negrito: true, tamanho: 12, dy: 10 },
    { texto: `Competencia: ${dados.competencia} | Situacao: ${dados.situacao} | Data: ${new Date().toISOString()}`, tamanho: 9, dy: 14 },
    { texto: `Emitido por: ${usuarioSolicitante.email} (${usuarioSolicitante.perfil}) | Status Fechamento: ${dados.aptoParaFechamento ? 'LIBERADO' : 'BLOQUEADO'}`, tamanho: 9, dy: 12 },
    { texto: '------------------------------------------------------------------------------------------------------------------------', tamanho: 8, dy: 12 },
    { texto: '1. ITENS DA CONFERENCIA FINANCEIRA INTERNA (RN-59 - TOLERANCIA R$ 0,00):', negrito: true, tamanho: 9, dy: 14 },
  ];

  for (const it of dados.conferenciaFinanceira.itens) {
    linhasPDF.push({
      texto: `* [${it.status}] ${it.item} - Esperado: R$ ${it.esperado.toFixed(2)} | Calculado: R$ ${it.calculado.toFixed(2)} | Dif: R$ ${it.divergencia.toFixed(2)}`,
      tamanho: 8,
      dy: 10,
    });
  }

  linhasPDF.push({ texto: '------------------------------------------------------------------------------------------------------------------------', tamanho: 8, dy: 14 });
  linhasPDF.push({ texto: `2. PENDENCIAS CRITICAS ANTES DO FECHAMENTO (TOTAL: ${dados.totalPendencias}):`, negrito: true, tamanho: 9, dy: 14 });

  if (dados.pendencias.length === 0) {
    linhasPDF.push({ texto: 'Nenhuma pendencia critica encontrada. Competencia apta para fechamento seguro.', tamanho: 8, dy: 12 });
  } else {
    for (const p of dados.pendencias) {
      const colabTxt = p.colaborador ? `[Colaborador: ${p.colaborador}] ` : '';
      linhasPDF.push({
        texto: `* [${p.gravidade}] ${colabTxt}${p.item}`,
        tamanho: 8,
        dy: 10,
      });
    }
  }

  linhasPDF.push({ texto: '------------------------------------------------------------------------------------------------------------------------', tamanho: 8, dy: 14 });
  linhasPDF.push({ texto: '3. TRILHA DE RESPONSABILIDADE E APROVACAO (RN-04 / RN-67):', negrito: true, tamanho: 9, dy: 14 });
  linhasPDF.push({ texto: `Calculado por ID: ${dados.trilha.calculadoPor || 'Nao registrado'}`, tamanho: 8, dy: 10 });
  linhasPDF.push({ texto: `Conferido por ID: ${dados.trilha.conferidoPor || 'Nao registrado'} | Data: ${dados.trilha.conferidoEm || 'Pendente'}`, tamanho: 8, dy: 10 });
  linhasPDF.push({ texto: `Fechado por ID: ${dados.trilha.fechadoPor || 'Nao registrado'} | Data: ${dados.trilha.fechadoEm || 'Nao fechada'}`, tamanho: 8, dy: 10 });

  return montarPDF(linhasPDF);
}

export function gerarRelatorioLogs(
  db: DatabaseSync,
  usuarioSolicitante: { email: string; perfil: string },
  filtros?: { periodoInicio?: string; periodoFim?: string; usuarioEmail?: string }
): any {
  // Apenas perfil DIRETORIA ou ADMIN pode visualizar logs (Seção 13, RNF-03)
  if (usuarioSolicitante.perfil !== 'DIRETORIA' && usuarioSolicitante.perfil !== 'ADMIN') {
    throw new Error('Você não tem permissão para esta ação.');
  }

  let sql = 'SELECT * FROM logs_auditoria WHERE 1=1';
  const params: any[] = [];
  if (filtros?.periodoInicio) {
    sql += ' AND data_hora >= ?';
    params.push(filtros.periodoInicio);
  }
  if (filtros?.periodoFim) {
    sql += ' AND data_hora <= ?';
    params.push(filtros.periodoFim);
  }
  if (filtros?.usuarioEmail) {
    sql += ' AND usuario_email = ?';
    params.push(filtros.usuarioEmail);
  }
  sql += ' ORDER BY id DESC';

  const rows = db.prepare(sql).all(...params) as any[];
  const linhas = rows.map((r) => ({
    id: r.id,
    dataHora: r.data_hora,
    usuario: r.usuario_email,
    perfil: r.usuario_perfil,
    acao: r.acao,
    entidade: r.entidade,
    detalhes: r.detalhes,
  }));

  return {
    titulo: 'Relatório de Logs de Auditoria',
    totalRegistros: linhas.length,
    linhas,
  };
}

export function exportarRelatorioExcel(
  relatorio: any,
  options?: { titulo?: string; formato?: 'XML' | 'CSV' }
): Buffer {
  const formato = options?.formato || 'XML';
  const tituloRel = options?.titulo || relatorio.titulo || 'Relatório';

  if (formato === 'CSV') {
    let csv = '\uFEFF';
    csv += `"${tituloRel}"\r\n\r\n`;
    if (relatorio.linhas && relatorio.linhas.length > 0) {
      const chaves = Object.keys(relatorio.linhas[0]);
      csv += chaves.join(';') + '\r\n';
      for (const linha of relatorio.linhas) {
        const valores = chaves.map((k) => {
          const val = linha[k];
          if (typeof val === 'number') return val.toFixed(2).replace('.', ',');
          return `"${String(val ?? '').replace(/"/g, '""')}"`;
        });
        csv += valores.join(';') + '\r\n';
      }
      if (relatorio.totaisGerais) {
        csv += '\r\nTotais Gerais;\r\n';
        for (const [k, v] of Object.entries(relatorio.totaisGerais)) {
          csv += `${k};${typeof v === 'number' ? v.toFixed(2).replace('.', ',') : v}\r\n`;
        }
      }
    }
    return Buffer.from(csv, 'utf-8');
  }

  // Padrão XML Spreadsheet 2003 nativo para Microsoft Excel
  let xml = '<?xml version="1.0" encoding="UTF-8"?>\r\n';
  xml += '<?mso-application progid="Excel.Sheet"?>\r\n';
  xml += '<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"\r\n';
  xml += ' xmlns:o="urn:schemas-microsoft-com:office:office"\r\n';
  xml += ' xmlns:x="urn:schemas-microsoft-com:office:excel"\r\n';
  xml += ' xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"\r\n';
  xml += ' xmlns:html="http://www.w3.org/TR/REC-html40">\r\n';
  xml += ` <Worksheet ss:Name="Relatorio">\r\n  <Table>\r\n`;
  xml += `   <Row><Cell><Data ss:Type="String">${escapeXML(tituloRel)}</Data></Cell></Row>\r\n`;

  if (relatorio.linhas && relatorio.linhas.length > 0) {
    const chaves = Object.keys(relatorio.linhas[0]);
    xml += '   <Row>\r\n';
    for (const c of chaves) {
      xml += `    <Cell><Data ss:Type="String">${escapeXML(c)}</Data></Cell>\r\n`;
    }
    xml += '   </Row>\r\n';

    for (const linha of relatorio.linhas) {
      xml += '   <Row>\r\n';
      for (const c of chaves) {
        const val = linha[c];
        const isNum = typeof val === 'number';
        const type = isNum ? 'Number' : 'String';
        const displayVal = isNum ? val.toFixed(2) : escapeXML(String(val ?? ''));
        xml += `    <Cell><Data ss:Type="${type}">${displayVal}</Data></Cell>\r\n`;
      }
      xml += '   </Row>\r\n';
    }

    if (relatorio.totaisGerais) {
      xml += '   <Row><Cell><Data ss:Type="String">Totais Gerais</Data></Cell></Row>\r\n';
      for (const [k, v] of Object.entries(relatorio.totaisGerais)) {
        const isNum = typeof v === 'number';
        const type = isNum ? 'Number' : 'String';
        const displayVal = isNum ? (v as number).toFixed(2) : escapeXML(String(v ?? ''));
        xml += `   <Row><Cell><Data ss:Type="String">${escapeXML(k)}</Data></Cell><Cell><Data ss:Type="${type}">${displayVal}</Data></Cell></Row>\r\n`;
      }
    }
  }

  xml += '  </Table>\r\n </Worksheet>\r\n</Workbook>\r\n';
  return Buffer.from(xml, 'utf-8');
}

export function exportarRelatorioPDF(
  relatorio: any,
  options?: { titulo?: string; usuarioEmail?: string }
): Buffer {
  const titulo = options?.titulo || relatorio.titulo || 'Relatório Gerencial';
  const linhasPDF: { texto: string; negrito?: boolean; tamanho?: number; dy?: number }[] = [
    { texto: `CORRESPONDENTE BANCARIO S.A. - ${titulo.toUpperCase()}`, negrito: true, tamanho: 13, dy: 10 },
    { texto: `Data de Emissão: ${new Date().toISOString()} | Usuário: ${options?.usuarioEmail || 'sistema'}`, tamanho: 9, dy: 14 },
    { texto: '------------------------------------------------------------------------------------------------------------------------', tamanho: 8, dy: 12 },
  ];

  if (relatorio.linhas && relatorio.linhas.length > 0) {
    const chaves = Object.keys(relatorio.linhas[0]);
    linhasPDF.push({
      texto: chaves.map((c) => c.toUpperCase()).join(' | '),
      negrito: true,
      tamanho: 9,
      dy: 14,
    });
    linhasPDF.push({ texto: '- - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -', tamanho: 8, dy: 10 });

    for (const linha of relatorio.linhas) {
      const linhaStr = chaves.map((k) => {
        const val = linha[k];
        if (typeof val === 'number') return `R$ ${val.toFixed(2)}`;
        return String(val ?? '');
      }).join(' | ');

      linhasPDF.push({
        texto: linhaStr,
        tamanho: 8,
        dy: 12,
      });
    }

    if (relatorio.totaisGerais) {
      linhasPDF.push(
        { texto: '------------------------------------------------------------------------------------------------------------------------', tamanho: 8, dy: 14 },
        {
          texto: `TOTAIS GERAIS: Proventos: R$ ${relatorio.totaisGerais.proventos.toFixed(2)} | Descontos: R$ ${relatorio.totaisGerais.descontos.toFixed(2)} | Líquido: R$ ${relatorio.totaisGerais.liquido.toFixed(2)} | FGTS: R$ ${relatorio.totaisGerais.fgts.toFixed(2)}`,
          negrito: true,
          tamanho: 9,
          dy: 14,
        }
      );
    }
  }

  return montarPDF(linhasPDF);
}

/**
 * RN-76: Direitos do Titular (LGPD) - Ficha Completa do Colaborador em PDF por CPF.
 * Localiza todos os dados do colaborador pelo CPF e gera relatório estruturado em PDF:
 * cadastro, eventos, férias, histórico, documentos anexados e logs.
 */
export function gerarFichaColaboradorPDF(
  db: DatabaseSync,
  usuarioSolicitante: { id: number; email: string; perfil: string },
  cpfBusca: string
): Buffer {
  if (usuarioSolicitante.perfil !== 'RH') {
    throw new Error('Você não tem permissão para acessar a ficha completa do colaborador.');
  }

  const cpfLimpo = limparCPF(cpfBusca);
  const colab = db.prepare(`
    SELECT c.*, f.nome as filial_nome
    FROM colaboradores c
    JOIN filiais f ON f.id = c.filial_id
    WHERE c.cpf = ?
  `).get(cpfLimpo) as any;

  if (!colab) {
    throw new Error('Colaborador não encontrado com o CPF informado.');
  }

  const dependentes = db.prepare('SELECT * FROM dependentes WHERE colaborador_id = ?').all(colab.id) as any[];
  const historico = db.prepare('SELECT * FROM historico_colaborador WHERE colaborador_id = ? ORDER BY id DESC').all(colab.id) as any[];
  const ferias = db.prepare('SELECT * FROM ferias WHERE colaborador_id = ? ORDER BY id DESC').all(colab.id) as any[];
  const docs = db.prepare('SELECT * FROM documentos_colaborador WHERE colaborador_id = ?').all(colab.id) as any[];

  const salarioDec = new Dec(BigInt(colab.salario_base_centavos));

  const linhasPDF: { texto: string; negrito?: boolean; tamanho?: number; dy?: number }[] = [
    { texto: 'FICHA CADASTRAL COMPLETA DO COLABORADOR (LGPD - ART. 18 / RN-76)', negrito: true, tamanho: 13, dy: 10 },
    { texto: `Gerado por: ${usuarioSolicitante.email} em ${new Date().toISOString()}`, tamanho: 8, dy: 14 },
    { texto: '------------------------------------------------------------------------------------------------------------------------', tamanho: 8, dy: 12 },
    { texto: 'DADOS PESSOAIS E CONTRATUAIS', negrito: true, tamanho: 10, dy: 14 },
    { texto: `Nome: ${colab.nome} | CPF: ${formatarCPF(colab.cpf)} | Nascimento: ${colab.nascimento}`, tamanho: 9, dy: 12 },
    { texto: `Filial: ${colab.filial_nome} | Cargo: ${colab.cargo} | Setor: ${colab.setor}`, tamanho: 9, dy: 12 },
    { texto: `Admissão: ${colab.admissao} | Desligamento: ${colab.desligamento || 'Não'} | Situação: ${colab.situacao}`, tamanho: 9, dy: 12 },
    { texto: `Salário Contratual: ${salarioDec.toFormatado()} | Jornada: ${colab.jornada_horas_mensais}h mensais`, tamanho: 9, dy: 12 },
    { texto: `Dados Bancários: Banco ${colab.banco} Agência ${colab.agencia} Conta ${colab.conta} | Titular: ${colab.titular_conta || colab.nome}`, tamanho: 9, dy: 12 },
    { texto: '------------------------------------------------------------------------------------------------------------------------', tamanho: 8, dy: 14 },
    { texto: `DEPENDENTES CADASTRADOS (${dependentes.length})`, negrito: true, tamanho: 10, dy: 14 },
  ];

  if (dependentes.length === 0) {
    linhasPDF.push({ texto: 'Nenhum dependente informado.', tamanho: 8, dy: 12 });
  } else {
    for (const d of dependentes) {
      linhasPDF.push({ texto: `* ${d.nome} - Nascimento: ${d.nascimento} - Parentesco: ${d.parentesco}`, tamanho: 8, dy: 10 });
    }
  }

  linhasPDF.push(
    { texto: '------------------------------------------------------------------------------------------------------------------------', tamanho: 8, dy: 14 },
    { texto: `HISTORICO DE ALTERACOES CADASTRADAS (${historico.length})`, negrito: true, tamanho: 10, dy: 14 }
  );

  if (historico.length === 0) {
    linhasPDF.push({ texto: 'Nenhum registro histórico anterior.', tamanho: 8, dy: 12 });
  } else {
    for (const h of historico.slice(0, 10)) {
      linhasPDF.push({ texto: `[${h.data_hora}] Campo ${h.campo}: de "${h.valor_anterior}" para "${h.valor_novo}"`, tamanho: 8, dy: 10 });
    }
  }

  linhasPDF.push(
    { texto: '------------------------------------------------------------------------------------------------------------------------', tamanho: 8, dy: 14 },
    { texto: `FERIAS E LICENCAS (${ferias.length})`, negrito: true, tamanho: 10, dy: 14 }
  );

  if (ferias.length === 0) {
    linhasPDF.push({ texto: 'Nenhuma concessão de férias registrada.', tamanho: 8, dy: 12 });
  } else {
    for (const f of ferias) {
      linhasPDF.push({ texto: `* Início: ${f.data_inicio} a ${f.data_fim} (${f.dias_gozo} dias gozo, ${f.dias_abono} abono) - Situação: ${f.situacao}`, tamanho: 8, dy: 10 });
    }
  }

  linhasPDF.push(
    { texto: '------------------------------------------------------------------------------------------------------------------------', tamanho: 8, dy: 14 },
    { texto: `DOCUMENTOS ANEXADOS (${docs.length})`, negrito: true, tamanho: 10, dy: 14 }
  );

  if (docs.length === 0) {
    linhasPDF.push({ texto: 'Nenhum documento anexado.', tamanho: 8, dy: 12 });
  } else {
    for (const doc of docs) {
      linhasPDF.push({ texto: `* ${doc.tipo}: ${doc.nome_arquivo} (Validade: ${doc.data_validade || 'Sem validade'})`, tamanho: 8, dy: 10 });
    }
  }

  registrarLog(db, {
    usuarioId: usuarioSolicitante.id,
    usuarioEmail: usuarioSolicitante.email,
    usuarioPerfil: usuarioSolicitante.perfil,
    acao: 'GERAR_FICHA_COLABORADOR_LGPD',
    entidade: 'COLABORADOR',
    registroId: colab.id,
    detalhes: `Ficha completa do colaborador CPF ${formatarCPF(colab.cpf)} gerada para cumprimento de direitos do titular (RN-76)`,
  });

  return montarPDF(linhasPDF);
}
