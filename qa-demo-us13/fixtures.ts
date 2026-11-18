/**
 * fixtures.ts - Carga de dados fictícios para ambiente isolado de demonstração da US-13.
 * 
 * Cria banco SQLite em memória (:memory:) isolado, com empresa correspondente bancária,
 * matriz e filiais, analistas de RH, diretoria, colaboradores e competência calculada.
 */

import { DatabaseSync } from 'node:sqlite';
import { SCHEMA_SQL } from '../back-end/src/db.js';
import { criarUsuario } from '../back-end/src/services/usuarioService.js';
import { criarFilial } from '../back-end/src/services/filialService.js';
import { criarColaborador } from '../back-end/src/services/colaboradorService.js';
import { inicializarFeriadosEParametros } from '../back-end/src/services/parametroFeriadoService.js';
import { abrirOuObterCompetencia } from '../back-end/src/services/competenciaService.js';
import { calcularFolhaColaborador } from '../back-end/src/services/folhaService.js';
import { limparTodasSessoes } from '../back-end/src/security.js';

export interface FixtureContext {
  db: DatabaseSync;
  adminUser: { id: number; email: string; perfil: string };
  rhUser1: { id: number; email: string; perfil: string; nome: string };
  rhUser2: { id: number; email: string; perfil: string; nome: string };
  diretoriaUser: { id: number; email: string; perfil: string; nome: string };
  filiais: {
    matriz: { id: number; nome: string };
    campinas: { id: number; nome: string };
    santos: { id: number; nome: string };
  };
  colaboradores: {
    alice: any;
    bernardo: any;
    camila: any;
    daniel: any;
  };
  competencia: any;
}

export function carregarFixtures(): FixtureContext {
  limparTodasSessoes();
  const db = new DatabaseSync(':memory:');
  db.exec(SCHEMA_SQL);
  inicializarFeriadosEParametros(db);

  // 1. Usuários do sistema
  const adminUser = { id: 1, email: 'admin@empresa.com', perfil: 'ADMIN' };

  const uRH1 = criarUsuario(db, adminUser, {
    nome: 'Mariana Silva (Analista RH 1)',
    email: 'mariana.rh@empresa.com',
    senha: 'SenhaForte123',
    perfil: 'RH',
  });
  const rhUser1 = { id: uRH1.id, email: uRH1.email, perfil: 'RH', nome: uRH1.nome };

  const uRH2 = criarUsuario(db, adminUser, {
    nome: 'Carlos Eduardo (Analista RH 2)',
    email: 'carlos.rh@empresa.com',
    senha: 'SenhaForte123',
    perfil: 'RH',
  });
  const rhUser2 = { id: uRH2.id, email: uRH2.email, perfil: 'RH', nome: uRH2.nome };

  const uDir = criarUsuario(db, adminUser, {
    nome: 'Dr. Roberto Mendes (Diretoria)',
    email: 'diretoria@empresa.com',
    senha: 'SenhaDiretoria123',
    perfil: 'DIRETORIA',
  });
  const diretoriaUser = { id: uDir.id, email: uDir.email, perfil: 'DIRETORIA', nome: uDir.nome };

  // 2. Filiais (1 Matriz e 2 Filiais conforme especificação v1.7)
  const fMatriz = criarFilial(db, rhUser1, {
    nome: 'Matriz São Paulo',
    tipo: 'MATRIZ',
  });

  const fCampinas = criarFilial(db, rhUser1, {
    nome: 'Filial Campinas',
    tipo: 'FILIAL',
  });

  const fSantos = criarFilial(db, rhUser1, {
    nome: 'Filial Santos',
    tipo: 'FILIAL',
  });

  // 3. Colaboradores
  const alice = criarColaborador(db, rhUser1, {
    filialId: fMatriz.id,
    nome: 'Alice Ferreira',
    cpf: '11144477735',
    nascimento: '1992-05-10',
    admissao: '2022-03-01',
    cargo: 'Analista de Operações',
    setor: 'Operações',
    salarioBase: '4000.00',
    banco: '001',
    agencia: '1111',
    conta: '22222',
  });

  const bernardo = criarColaborador(db, rhUser1, {
    filialId: fMatriz.id,
    nome: 'Bernardo Costa',
    cpf: '22255588846',
    nascimento: '1988-11-20',
    admissao: '2021-08-15',
    cargo: 'Coordenador Operacional',
    setor: 'Operações',
    salarioBase: '7000.00',
    banco: '237',
    agencia: '3333',
    conta: '44444',
  });

  const camila = criarColaborador(db, rhUser1, {
    filialId: fCampinas.id,
    nome: 'Camila Rocha',
    cpf: '33366699957',
    nascimento: '1995-02-14',
    admissao: '2023-01-10',
    cargo: 'Atendente de Correspondente',
    setor: 'Atendimento',
    salarioBase: '2500.00',
    banco: '341',
    agencia: '5555',
    conta: '66666',
  });

  const daniel = criarColaborador(db, rhUser1, {
    filialId: fSantos.id,
    nome: 'Daniel Lima',
    cpf: '52998224725',
    nascimento: '1990-09-08',
    admissao: '2022-11-01',
    cargo: 'Operador de Caixa',
    setor: 'Atendimento',
    salarioBase: '3200.00',
    banco: '104',
    agencia: '7777',
    conta: '88888',
  });

  // 4. Competência 2026-10 aberta e calculada por rhUser1
  const comp = abrirOuObterCompetencia(db, rhUser1, '2026-10');
  calcularFolhaColaborador(db, rhUser1, { colaboradorId: alice.id, competenciaId: comp.id });
  calcularFolhaColaborador(db, rhUser1, { colaboradorId: bernardo.id, competenciaId: comp.id });
  calcularFolhaColaborador(db, rhUser1, { colaboradorId: camila.id, competenciaId: comp.id });
  calcularFolhaColaborador(db, rhUser1, { colaboradorId: daniel.id, competenciaId: comp.id });

  return {
    db,
    adminUser,
    rhUser1,
    rhUser2,
    diretoriaUser,
    filiais: {
      matriz: fMatriz,
      campinas: fCampinas,
      santos: fSantos,
    },
    colaboradores: {
      alice,
      bernardo,
      camila,
      daniel,
    },
    competencia: comp,
  };
}
