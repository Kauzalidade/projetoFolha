/**
 * parametroFeriadoService.ts - Gerenciamento de Parâmetros com Vigência e Feriados (RN-01, RN-35, Seção 6).
 */

import { DatabaseSync } from 'node:sqlite';
import { registrarLog } from './logService.js';

export const FERIADOS_NACIONAIS_2026 = [
  { data: '2026-01-01', descricao: 'Confraternização Universal' },
  { data: '2026-04-03', descricao: 'Sexta-feira Santa' },
  { data: '2026-04-21', descricao: 'Tiradentes' },
  { data: '2026-05-01', descricao: 'Dia do Trabalhador' },
  { data: '2026-09-07', descricao: 'Independência do Brasil' },
  { data: '2026-10-12', descricao: 'Nossa Senhora Aparecida' },
  { data: '2026-11-02', descricao: 'Finados' },
  { data: '2026-11-15', descricao: 'Proclamação da República' },
  { data: '2026-11-20', descricao: 'Dia da Consciência Negra' },
  { data: '2026-12-25', descricao: 'Natal' },
];

export const PARAMETROS_INICIAIS_2026 = [
  { nome: 'salario_minimo', valor: '1621.00', data_inicio: '2026-01-01', data_fim: '2026-12-31' },
  { nome: 'inss_teto', valor: '8475.55', data_inicio: '2026-01-01', data_fim: '2026-12-31' },
  { nome: 'inss_contribuicao_maxima', valor: '988.09', data_inicio: '2026-01-01', data_fim: '2026-12-31' },
  { nome: 'irrf_deducao_dependente', valor: '189.59', data_inicio: '2026-01-01', data_fim: '2026-12-31' },
  { nome: 'irrf_desconto_simplificado', valor: '607.20', data_inicio: '2026-01-01', data_fim: '2026-12-31' },
  { nome: 'fgts_aliquota', valor: '0.08', data_inicio: '2026-01-01', data_fim: '2026-12-31' },
  { nome: 'divisor_mensal_horas', valor: '220', data_inicio: '2026-01-01', data_fim: '2026-12-31' },
  { nome: 'adicional_hora_extra_util', valor: '0.50', data_inicio: '2026-01-01', data_fim: '2026-12-31' },
  { nome: 'adicional_hora_extra_domingo', valor: '1.00', data_inicio: '2026-01-01', data_fim: '2026-12-31' },
];

/**
 * Carga inicial automática dos 10 feriados nacionais e parâmetros de 2026 (RN-35 e Seção 6).
 */
export function inicializarFeriadosEParametros(db: DatabaseSync): void {
  // Carga dos 10 feriados nacionais de 2026
  const stmtFeriado = db.prepare('INSERT OR IGNORE INTO feriados (data, descricao, tipo) VALUES (?, ?, ?)');
  for (const f of FERIADOS_NACIONAIS_2026) {
    stmtFeriado.run(f.data, f.descricao, 'NACIONAL');
  }

  // Carga dos parâmetros de 2026
  const stmtParam = db.prepare(`
    INSERT OR IGNORE INTO parametros (nome, valor, data_inicio, data_fim, versao, criado_em)
    VALUES (?, ?, ?, ?, '1.0', ?)
  `);
  const agora = new Date().toISOString();
  for (const p of PARAMETROS_INICIAIS_2026) {
    stmtParam.run(p.nome, p.valor, p.data_inicio, p.data_fim, agora);
  }
}

export function cadastrarParametro(
  db: DatabaseSync,
  usuarioSolicitante: { id: number; email: string; perfil: string },
  dados: { nome: string; valor: string; dataInicio?: string; dataFim?: string; versao?: string }
): void {
  // Somente RH cadastra parâmetros (Seção 4)
  if (usuarioSolicitante.perfil !== 'RH') {
    throw new Error('Você não tem permissão para esta ação.');
  }

  if (!dados.nome || !dados.nome.trim()) {
    throw new Error('Informe o nome do parâmetro.');
  }
  if (!dados.valor || !dados.valor.trim()) {
    throw new Error('Informe o valor do parâmetro.');
  }
  // Cenário: Parâmetro sem vigência
  if (!dados.dataInicio || !dados.dataInicio.trim()) {
    throw new Error('Informe o campo de vigência (data de início).');
  }

  const dataFim = dados.dataFim || '2099-12-31';
  const agora = new Date().toISOString();

  db.prepare(`
    INSERT INTO parametros (nome, valor, data_inicio, data_fim, versao, criado_em)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(dados.nome.trim(), dados.valor.trim(), dados.dataInicio.trim(), dataFim.trim(), dados.versao || '1.0', agora);

  registrarLog(db, {
    usuarioId: usuarioSolicitante.id,
    usuarioEmail: usuarioSolicitante.email,
    usuarioPerfil: usuarioSolicitante.perfil,
    acao: 'CADASTRAR_PARAMETRO',
    entidade: 'PARAMETRO',
    detalhes: `Parâmetro ${dados.nome} cadastrado com vigência a partir de ${dados.dataInicio}`,
    valorNovo: JSON.stringify(dados),
  });
}

export function cadastrarFeriado(
  db: DatabaseSync,
  usuarioSolicitante: { id: number; email: string; perfil: string },
  dados: { data: string; descricao: string; tipo?: 'NACIONAL' | 'ESTADUAL' | 'MUNICIPAL' }
): void {
  if (usuarioSolicitante.perfil !== 'RH') {
    throw new Error('Você não tem permissão para esta ação.');
  }

  if (!dados.data || !dados.descricao) {
    throw new Error('Informe a data e a descrição do feriado.');
  }

  const tipo = dados.tipo || 'MUNICIPAL';
  db.prepare('INSERT INTO feriados (data, descricao, tipo) VALUES (?, ?, ?)')
    .run(dados.data.trim(), dados.descricao.trim(), tipo);

  registrarLog(db, {
    usuarioId: usuarioSolicitante.id,
    usuarioEmail: usuarioSolicitante.email,
    usuarioPerfil: usuarioSolicitante.perfil,
    acao: 'CADASTRAR_FERIADO',
    entidade: 'FERIADO',
    detalhes: `Feriado ${dados.descricao} em ${dados.data} (${tipo}) cadastrado`,
  });
}

export function listarFeriados(db: DatabaseSync): any[] {
  return db.prepare('SELECT id, data, descricao, tipo FROM feriados ORDER BY data ASC').all();
}

export function obterParametroVigente(db: DatabaseSync, nome: string, dataCompetencia: string): string | null {
  const stmt = db.prepare(`
    SELECT valor FROM parametros
    WHERE nome = ? AND data_inicio <= ? AND data_fim >= ?
    ORDER BY id DESC LIMIT 1
  `);
  const res = stmt.get(nome, dataCompetencia, dataCompetencia) as any;
  return res ? res.valor : null;
}
