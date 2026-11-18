/**
 * fixtures.ts - Carga de dados fictícios para ambiente isolado de testes e demonstração QA da US-12.
 * 
 * Utiliza o SQLite nativo em memória (:memory:) garantindo isolamento total
 * do banco principal do projeto e de outros ambientes.
 */

import { DatabaseSync } from 'node:sqlite';
import { SCHEMA_SQL } from '../back-end/src/db.js';
import { criarUsuario } from '../back-end/src/services/usuarioService.js';
import { criarFilial } from '../back-end/src/services/filialService.js';
import { criarColaborador } from '../back-end/src/services/colaboradorService.js';
import { inicializarFeriadosEParametros } from '../back-end/src/services/parametroFeriadoService.js';
import { abrirOuObterCompetencia } from '../back-end/src/services/competenciaService.js';
import { limparTodasSessoes, gerarHashSenha } from '../back-end/src/security.js';

export interface FixtureContext {
  db: DatabaseSync;
  adminUser: { id: number; email: string; perfil: string };
  rhUser: { id: number; email: string; perfil: string };
  diretoriaUser: { id: number; email: string; perfil: string };
  filialMatriz: { id: number; nome: string };
  colaboradorDemo: any;
  competenciaAberta: any;
}

export function carregarFixtures(): FixtureContext {
  limparTodasSessoes();
  const db = new DatabaseSync(':memory:');
  db.exec(SCHEMA_SQL);
  inicializarFeriadosEParametros(db);

  const agora = new Date().toISOString();

  // 1. Usuário Administrador Master do Sistema
  const adminHash = gerarHashSenha('AdminMaster123');
  const resAdmin = db.prepare(`
    INSERT INTO usuarios (nome, email, senha_hash, perfil, ativo, segundo_fator_ativo, criado_em, atualizado_em)
    VALUES ('Admin Master', 'admin@empresa.com', ?, 'ADMIN', 1, 0, ?, ?)
  `).run(adminHash, agora, agora);
  const adminId = Number(resAdmin.lastInsertRowid);

  db.prepare(`
    INSERT INTO historico_senhas (usuario_id, senha_hash, criado_em)
    VALUES (?, ?, ?)
  `).run(adminId, adminHash, agora);

  const adminUser = { id: adminId, email: 'admin@empresa.com', perfil: 'ADMIN' };

  // 2. Usuário Analista de RH
  const uRH = criarUsuario(db, adminUser, {
    nome: 'Marina Souza (Analista RH)',
    email: 'rh@empresa.com',
    senha: 'SenhaForte123',
    perfil: 'RH',
    segundoFatorAtivo: false,
  });
  const rhUser = { id: uRH.id, email: uRH.email, perfil: 'RH' };

  // 3. Usuário Diretoria Executiva
  const uDir = criarUsuario(db, adminUser, {
    nome: 'Carlos Drummond (Diretoria)',
    email: 'diretor@empresa.com',
    senha: 'Diretoria2026',
    perfil: 'DIRETORIA',
    segundoFatorAtivo: false,
  });
  const diretoriaUser = { id: uDir.id, email: uDir.email, perfil: 'DIRETORIA' };

  // 4. Filial Matriz
  const filialMatriz = criarFilial(db, rhUser, {
    nome: 'Matriz São Paulo',
    tipo: 'MATRIZ',
  });

  // 5. Colaborador demo para testes de permissão
  const colab = criarColaborador(db, rhUser, {
    filialId: filialMatriz.id,
    nome: 'Ana Souza',
    cpf: '52998224725',
    nascimento: '1995-04-10',
    admissao: '2023-03-10',
    cargo: 'Atendente de Operações',
    setor: 'Atendimento',
    salarioBase: '2200.00',
    banco: '001',
    agencia: '1234',
    conta: '56789',
  });

  // 6. Competência Aberta 2026-10
  const compAberta = abrirOuObterCompetencia(db, rhUser, '2026-10');

  return {
    db,
    adminUser,
    rhUser,
    diretoriaUser,
    filialMatriz,
    colaboradorDemo: colab,
    competenciaAberta: compAberta,
  };
}

if (process.argv[1] && (process.argv[1].endsWith('fixtures.ts') || process.argv[1].endsWith('fixtures.js'))) {
  const ctx = carregarFixtures();
  console.log('[fixtures-us12] Sucesso! Banco isolado em memória inicializado.');
  console.log('[fixtures-us12] Usuários carregados:', ctx.adminUser.email, '|', ctx.rhUser.email, '|', ctx.diretoriaUser.email);
}
