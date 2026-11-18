/**
 * fixtures.ts - Carga de dados fictícios para ambiente isolado de testes e demonstração QA da US-10.
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
import { abrirOuObterCompetencia, fecharCompetencia } from '../back-end/src/services/competenciaService.js';
import { limparTodasSessoes } from '../back-end/src/security.js';

export interface FixtureContext {
  db: DatabaseSync;
  adminUser: { id: number; email: string; perfil: string };
  rhUser: { id: number; email: string; perfil: string };
  diretoriaUser: { id: number; email: string; perfil: string };
  filialMatriz: { id: number; nome: string };
  colaboradores: {
    ana: any;
    bruno: any;
    carla: any;
  };
  competencias: {
    aberta: any;
    fechada: any;
  };
}

export function carregarFixtures(): FixtureContext {
  limparTodasSessoes();
  const db = new DatabaseSync(':memory:');
  db.exec(SCHEMA_SQL);
  inicializarFeriadosEParametros(db);

  // 1. Usuários do sistema
  const adminUser = { id: 1, email: 'admin@empresa.com', perfil: 'ADMIN' };

  const uRH = criarUsuario(db, adminUser, {
    nome: 'Marina Souza (Analista RH)',
    email: 'rh@empresa.com',
    senha: 'SenhaForte123',
    perfil: 'RH',
  });
  const rhUser = { id: uRH.id, email: uRH.email, perfil: 'RH' };

  const uDir = criarUsuario(db, adminUser, {
    nome: 'Carlos Drummond (Diretoria)',
    email: 'diretor@empresa.com',
    senha: 'Diretoria2026',
    perfil: 'DIRETORIA',
  });
  const diretoriaUser = { id: uDir.id, email: uDir.email, perfil: 'DIRETORIA' };

  // 2. Filial
  const filialMatriz = criarFilial(db, rhUser, {
    nome: 'Matriz São Paulo',
    tipo: 'MATRIZ',
  });

  // 3. Colaboradores de teste (dados cadastrais padrão)
  // Ana Souza: R$ 2.200,00
  const ana = criarColaborador(db, rhUser, {
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

  // Bruno Santos: Salário R$ 3.000,00
  const bruno = criarColaborador(db, rhUser, {
    filialId: filialMatriz.id,
    nome: 'Bruno Santos',
    cpf: '01234567890',
    cpfValidoIgnorar: true,
    nascimento: '1990-01-01',
    admissao: '2022-01-01',
    cargo: 'Analista Financeiro Pleno',
    setor: 'Financeiro',
    salarioBase: '3000.00',
    banco: '001',
    agencia: '1111',
    conta: '2222',
  });

  // Carla Dias: Salário R$ 3.000,00
  const carla = criarColaborador(db, rhUser, {
    filialId: filialMatriz.id,
    nome: 'Carla Dias',
    cpf: '98765432100',
    cpfValidoIgnorar: true,
    nascimento: '1988-06-15',
    admissao: '2024-01-10',
    cargo: 'Supervisora de Operações',
    setor: 'Operações',
    salarioBase: '3000.00',
    banco: '237',
    agencia: '3333',
    conta: '44444',
  });

  // 4. Competências
  // Competência Aberta padrão: 2026-10
  const compAberta = abrirOuObterCompetencia(db, rhUser, '2026-10');

  // Competência Fechada padrão: 2026-09
  const compFechada = abrirOuObterCompetencia(db, rhUser, '2026-09');
  fecharCompetencia(db, rhUser, '2026-09');
  compFechada.situacao = 'FECHADA';

  return {
    db,
    adminUser,
    rhUser,
    diretoriaUser,
    filialMatriz,
    colaboradores: { ana, bruno, carla },
    competencias: {
      aberta: compAberta,
      fechada: compFechada,
    },
  };
}

if (process.argv[1] && (process.argv[1].endsWith('fixtures.ts') || process.argv[1].endsWith('fixtures.js'))) {
  const ctx = carregarFixtures();
  console.log('[fixtures-us10] Sucesso! Banco isolado em memória inicializado.');
  console.log('[fixtures-us10] Colaboradores carregados:', ctx.colaboradores.ana.nome, '|', ctx.colaboradores.bruno.nome, '|', ctx.colaboradores.carla.nome);
  console.log('[fixtures-us10] Competência aberta:', ctx.competencias.aberta.mes_ano, '| fechada:', ctx.competencias.fechada.mes_ano);
}
