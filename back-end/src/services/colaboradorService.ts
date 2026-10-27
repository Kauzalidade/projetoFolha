/**
 * colaboradorService.ts - Gerenciamento de Colaboradores (RN-07 a RN-16, Seção 4 e Seção 14.6).
 */

import { DatabaseSync } from 'node:sqlite';
import { validarCPF, limparCPF, formatarCPF } from '../cpf.js';
import { Dec } from '../dec.js';
import { registrarLog } from './logService.js';

export interface DependenteDTO {
  nome: string;
  nascimento: string;
  parentesco: string;
}

export interface CriarColaboradorDTO {
  filialId: number;
  nome: string;
  cpf: string;
  nascimento: string;
  admissao: string;
  desligamento?: string | null;
  cargo: string;
  setor: string;
  salarioBase: number | string; // Aceita number ou string formatada
  jornadaHorasMensais?: number;
  banco: string;
  agencia: string;
  conta: string;
  dependentes?: DependenteDTO[];
  [campoExtra: string]: any; // Para detecção de dados proibidos
}

const CAMPOS_PROIBIDOS_LGPD = [
  'religiao', 'religião',
  'orientacao_sexual', 'orientação_sexual', 'sexualidade',
  'raca', 'raça', 'etnia', 'raca_etnia',
  'dados_geneticos', 'dados_genéticos', 'genetica',
  'biometria', 'dados_biometricos', 'dados_biométricos'
];

export function criarColaborador(
  db: DatabaseSync,
  usuarioSolicitante: { id: number; email: string; perfil: string },
  dados: CriarColaboradorDTO
): any {
  // Somente perfil RH pode cadastrar colaborador (Seção 4)
  if (usuarioSolicitante.perfil !== 'RH') {
    throw new Error('Você não tem permissão para esta ação.');
  }

  // RN-14: Validação estrita de dados proibidos pela LGPD
  for (const chave of Object.keys(dados)) {
    const chaveNormalizada = chave.toLowerCase().replace(/[-_\s]/g, '_');
    if (CAMPOS_PROIBIDOS_LGPD.includes(chaveNormalizada)) {
      throw new Error('O cadastro não permite campos de religião, orientação sexual, raça, dados genéticos ou biomédicos.');
    }
  }

  // RN-10 e RN-15: Validação de campos obrigatórios
  if (!dados.nome || dados.nome.trim().length < 3) {
    throw new Error('Informe o nome do colaborador (mínimo 3 caracteres).');
  }

  const cpfLimpo = limparCPF(dados.cpf);
  if (!validarCPF(cpfLimpo)) {
    throw new Error('CPF inválido. Confira os 11 dígitos.');
  }

  // RN-11: CPF único
  const buscaCPF = db.prepare('SELECT id FROM colaboradores WHERE cpf = ?');
  if (buscaCPF.get(cpfLimpo)) {
    throw new Error('Já existe um colaborador com este CPF.');
  }

  if (!dados.nascimento) throw new Error('Informe a data de nascimento.');
  if (!dados.admissao) throw new Error('Informe a data de admissão.');
  if (!dados.cargo || !dados.cargo.trim()) throw new Error('Informe o cargo.');
  if (!dados.setor || !dados.setor.trim()) throw new Error('Informe o setor.');
  if (!dados.banco || !dados.banco.trim()) throw new Error('Informe o banco.');
  if (!dados.agencia || !dados.agencia.trim()) throw new Error('Informe a agência.');
  if (!dados.conta || !dados.conta.trim()) throw new Error('Informe a conta.');

  // RN-15: Agência e conta só com números
  if (!/^\d+$/.test(dados.agencia.trim())) {
    throw new Error('Informe a agência apenas com números.');
  }
  if (!/^\d+$/.test(dados.conta.trim())) {
    throw new Error('Informe a conta apenas com números.');
  }

  // RN-15: Salário-base maior que zero
  const salarioDec = typeof dados.salarioBase === 'number'
    ? Dec.fromMoeda(dados.salarioBase)
    : Dec.fromMoeda(String(dados.salarioBase));

  if (!salarioDec.isPositive()) {
    throw new Error('Informe um salário-base maior que zero.');
  }

  // RN-15: Data de desligamento não anterior à admissão
  if (dados.desligamento) {
    if (new Date(dados.desligamento) < new Date(dados.admissao)) {
      throw new Error('Data de desligamento não pode ser anterior à admissão.');
    }
  }

  // Validação da filial
  const filial = db.prepare('SELECT id FROM filiais WHERE id = ? AND ativa = 1').get(dados.filialId);
  if (!filial) {
    throw new Error('Filial inválida ou inativa.');
  }

  const agora = new Date().toISOString();
  const jornada = dados.jornadaHorasMensais || 220;

  const insertStmt = db.prepare(`
    INSERT INTO colaboradores (
      filial_id, nome, cpf, nascimento, admissao, desligamento,
      cargo, setor, salario_base_centavos, jornada_horas_mensais,
      banco, agencia, conta, situacao, criado_em, atualizado_em
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ATIVO', ?, ?)
  `);

  const res = insertStmt.run(
    dados.filialId,
    dados.nome.trim(),
    cpfLimpo,
    dados.nascimento,
    dados.admissao,
    dados.desligamento ?? null,
    dados.cargo.trim(),
    dados.setor.trim(),
    Number(salarioDec.centavos),
    jornada,
    dados.banco.trim(),
    dados.agencia.trim(),
    dados.conta.trim(),
    agora,
    agora
  );

  const colaboradorId = Number(res.lastInsertRowid);

  // Cadastra dependentes (RN-16)
  if (dados.dependentes && dados.dependentes.length > 0) {
    const depStmt = db.prepare(`
      INSERT INTO dependentes (colaborador_id, nome, nascimento, parentesco)
      VALUES (?, ?, ?, ?)
    `);
    for (const dep of dados.dependentes) {
      depStmt.run(colaboradorId, dep.nome.trim(), dep.nascimento, dep.parentesco.trim());
    }
  }

  // Registra criação no Log de Auditoria
  registrarLog(db, {
    usuarioId: usuarioSolicitante.id,
    usuarioEmail: usuarioSolicitante.email,
    usuarioPerfil: usuarioSolicitante.perfil,
    acao: 'CRIAR_COLABORADOR',
    entidade: 'COLABORADOR',
    registroId: colaboradorId,
    detalhes: `Colaborador ${dados.nome.trim()} (CPF ${formatarCPF(cpfLimpo)}) cadastrado com salário ${salarioDec.toFormatado()}`,
    valorNovo: JSON.stringify({ nome: dados.nome.trim(), cpf: cpfLimpo, cargo: dados.cargo }),
  });

  return {
    id: colaboradorId,
    filialId: dados.filialId,
    nome: dados.nome.trim(),
    cpf: formatarCPF(cpfLimpo),
    cargo: dados.cargo.trim(),
    setor: dados.setor.trim(),
    salarioBase: salarioDec.toNumber(),
    situacao: 'ATIVO',
  };
}

export function inativarColaborador(
  db: DatabaseSync,
  usuarioSolicitante: { id: number; email: string; perfil: string },
  colaboradorId: number
): void {
  // Somente RH inativa colaborador (Seção 4)
  if (usuarioSolicitante.perfil !== 'RH') {
    throw new Error('Você não tem permissão para esta ação.');
  }

  const colaborador = db.prepare('SELECT id, nome, situacao FROM colaboradores WHERE id = ?').get(colaboradorId) as any;
  if (!colaborador) {
    throw new Error('Colaborador não encontrado.');
  }

  const agora = new Date().toISOString();
  // RN-12: Colaborador não é excluído, apenas inativado
  const updateStmt = db.prepare('UPDATE colaboradores SET situacao = ?, atualizado_em = ? WHERE id = ?');
  updateStmt.run('INATIVO', agora, colaboradorId);

  // RN-07: Registra histórico de alteração de situação
  const histStmt = db.prepare(`
    INSERT INTO historico_colaborador (colaborador_id, campo, valor_anterior, valor_novo, data_hora, usuario_id)
    VALUES (?, 'situacao', ?, 'INATIVO', ?, ?)
  `);
  histStmt.run(colaboradorId, colaborador.situacao, agora, usuarioSolicitante.id);

  registrarLog(db, {
    usuarioId: usuarioSolicitante.id,
    usuarioEmail: usuarioSolicitante.email,
    usuarioPerfil: usuarioSolicitante.perfil,
    acao: 'INATIVAR_COLABORADOR',
    entidade: 'COLABORADOR',
    registroId: colaboradorId,
    detalhes: `Colaborador ID ${colaboradorId} (${colaborador.nome}) inativado`,
    valorAnterior: colaborador.situacao,
    valorNovo: 'INATIVO',
  });
}

export function atualizarColaborador(
  db: DatabaseSync,
  usuarioSolicitante: { id: number; email: string; perfil: string },
  colaboradorId: number,
  alteracoes: {
    salarioBase?: number | string;
    cargo?: string;
    setor?: string;
    filialId?: number;
  }
): void {
  if (usuarioSolicitante.perfil !== 'RH') {
    throw new Error('Você não tem permissão para esta ação.');
  }

  const atual = db.prepare('SELECT * FROM colaboradores WHERE id = ?').get(colaboradorId) as any;
  if (!atual) {
    throw new Error('Colaborador não encontrado.');
  }

  const agora = new Date().toISOString();
  const histStmt = db.prepare(`
    INSERT INTO historico_colaborador (colaborador_id, campo, valor_anterior, valor_novo, data_hora, usuario_id)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  if (alteracoes.salarioBase !== undefined) {
    const novoSalario = typeof alteracoes.salarioBase === 'number'
      ? Dec.fromMoeda(alteracoes.salarioBase)
      : Dec.fromMoeda(String(alteracoes.salarioBase));

    if (!novoSalario.isPositive()) {
      throw new Error('Informe um salário-base maior que zero.');
    }

    const salarioAntigoDec = new Dec(BigInt(atual.salario_base_centavos));
    if (salarioAntigoDec.centavos !== novoSalario.centavos) {
      db.prepare('UPDATE colaboradores SET salario_base_centavos = ?, atualizado_em = ? WHERE id = ?')
        .run(Number(novoSalario.centavos), agora, colaboradorId);
      histStmt.run(colaboradorId, 'salario_base', salarioAntigoDec.toString(), novoSalario.toString(), agora, usuarioSolicitante.id);
    }
  }

  if (alteracoes.cargo && alteracoes.cargo.trim() !== atual.cargo) {
    db.prepare('UPDATE colaboradores SET cargo = ?, atualizado_em = ? WHERE id = ?')
      .run(alteracoes.cargo.trim(), agora, colaboradorId);
    histStmt.run(colaboradorId, 'cargo', atual.cargo, alteracoes.cargo.trim(), agora, usuarioSolicitante.id);
  }

  if (alteracoes.setor && alteracoes.setor.trim() !== atual.setor) {
    db.prepare('UPDATE colaboradores SET setor = ?, atualizado_em = ? WHERE id = ?')
      .run(alteracoes.setor.trim(), agora, colaboradorId);
    histStmt.run(colaboradorId, 'setor', atual.setor, alteracoes.setor.trim(), agora, usuarioSolicitante.id);
  }

  if (alteracoes.filialId && alteracoes.filialId !== atual.filial_id) {
    // RN-13: Pertence a uma filial por vez; transferência registra data e histórico
    db.prepare('UPDATE colaboradores SET filial_id = ?, atualizado_em = ? WHERE id = ?')
      .run(alteracoes.filialId, agora, colaboradorId);
    histStmt.run(colaboradorId, 'filial_id', String(atual.filial_id), String(alteracoes.filialId), agora, usuarioSolicitante.id);
  }
}

export function consultarColaborador(
  db: DatabaseSync,
  usuarioSolicitante: { perfil: string },
  colaboradorId: number
): any {
  // Cenário: Admin não vê dados de colaboradores/folha
  if (usuarioSolicitante.perfil === 'ADMIN') {
    throw new Error('Você não tem permissão para acessar os dados deste colaborador.');
  }

  const colaborador = db.prepare(`
    SELECT c.*, f.nome as filial_nome
    FROM colaboradores c
    JOIN filiais f ON f.id = c.filial_id
    WHERE c.id = ?
  `).get(colaboradorId) as any;

  if (!colaborador) return null;

  const dependentes = db.prepare('SELECT id, nome, nascimento, parentesco FROM dependentes WHERE colaborador_id = ?')
    .all(colaboradorId);

  const historico = db.prepare('SELECT * FROM historico_colaborador WHERE colaborador_id = ? ORDER BY id DESC')
    .all(colaboradorId);

  return {
    ...colaborador,
    salarioBase: new Dec(BigInt(colaborador.salario_base_centavos)).toNumber(),
    dependentes,
    historico,
  };
}
