/**
 * proporcionalidade.test.ts - Testes automatizados complementares de proporcionalidade salarial.
 * 
 * Requisito: RN-20 (Proporcionalidade na admissão e desligamento, base de 30 avos).
 * Cenários Gherkin oficiais de docs/spec.md:
 * - Cenario: Admissao no meio do mes (Linhas 477-481 e Linha 321 - Exemplo L)
 * - Cenario: Desligamento no meio do mes (Linhas 686-690 e Linha 321 - Exemplo L)
 * - Cenario: Admissao e desligamento no mesmo mes (Linhas 512-517)
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { DatabaseSync } from 'node:sqlite';
import { SCHEMA_SQL } from '../src/db.js';
import { criarUsuario } from '../src/services/usuarioService.js';
import { criarFilial } from '../src/services/filialService.js';
import { criarColaborador } from '../src/services/colaboradorService.js';
import { inicializarFeriadosEParametros } from '../src/services/parametroFeriadoService.js';
import { abrirOuObterCompetencia } from '../src/services/competenciaService.js';
import { calcularFolhaColaborador } from '../src/services/folhaService.js';
import { limparTodasSessoes } from '../src/security.js';

describe('RN-20: Proporcionalidade Salarial na Admissão e Desligamento (Base 30 avos)', () => {
  let db: DatabaseSync;
  const adminUser = { id: 1, email: 'admin@empresa.com', perfil: 'ADMIN' };
  let rhUser: { id: number; email: string; perfil: string };
  let matrizId: number;

  // Setembro de 2026 possui exatamente 30 dias (2026-09-01 a 2026-09-30)
  const mesAnoCompetencia = '2026-09';
  let competenciaId: number;

  beforeEach(() => {
    limparTodasSessoes();
    db = new DatabaseSync(':memory:');
    db.exec(SCHEMA_SQL);
    inicializarFeriadosEParametros(db);

    const uRH = criarUsuario(db, adminUser, {
      nome: 'Analista de RH',
      email: 'rh@empresa.com',
      senha: 'SenhaForte123',
      perfil: 'RH',
    });
    rhUser = { id: uRH.id, email: uRH.email, perfil: 'RH' };

    const filial = criarFilial(db, rhUser, { nome: 'Matriz São Paulo', tipo: 'MATRIZ' });
    matrizId = filial.id;

    const comp = abrirOuObterCompetencia(db, rhUser, mesAnoCompetencia);
    competenciaId = comp.id;
  });

  it('Cenário 1: Admissão no dia 16 de um mês de 30 dias com salário de R$ 3.000,00 (15 dias)', () => {
    // 1. Cadastra colaborador admitido em 16/09/2026 com salário de R$ 3.000,00
    const colab = criarColaborador(db, rhUser, {
      filialId: matrizId,
      nome: 'Carla Dias Proporcional',
      cpf: '52998224725',
      nascimento: '1996-08-14',
      admissao: '2026-09-16',
      cargo: 'Atendente',
      setor: 'Atendimento',
      salarioBase: '3000.00',
      banco: '001',
      agencia: '1234',
      conta: '5678',
    });

    // 2. Executa o cálculo real da folha mensal
    const folha = calcularFolhaColaborador(db, rhUser, {
      colaboradorId: colab.id,
      competenciaId,
    });

    // 3. Validações da regra RN-20:
    // Dias trabalhados: 30 - 16 + 1 = 15 dias.
    // Salário proporcional esperado: (3.000,00 / 30) * 15 = R$ 1.500,00
    assert.strictEqual(folha.totalProventos, 1500.00, 'Total de proventos deve ser R$ 1.500,00');

    const verbaSalario = folha.memoria.find((v: any) => v.tipo === 'SALARIO_BASE');
    assert.ok(verbaSalario, 'Memória de cálculo deve conter verba SALARIO_BASE');
    assert.strictEqual(verbaSalario.descricao, 'Salário Proporcional', 'Descrição deve ser "Salário Proporcional"');
    assert.strictEqual(verbaSalario.valor.toNumber(), 1500.00, 'Valor da verba deve ser R$ 1.500,00');
    assert.strictEqual(verbaSalario.baseCalculo.toNumber(), 3000.00, 'Base de cálculo deve registrar o salário integral R$ 3.000,00');
    assert.ok(
      verbaSalario.regraAplicada.includes('15 dias'),
      `Regra aplicada deve indicar 15 dias trabalhados (obtido: "${verbaSalario.regraAplicada}")`
    );

    // INSS sobre R$ 1.500,00 (Faixa 1 a 7,5%): 1.500 * 0,075 = R$ 112,50
    assert.strictEqual(folha.inss, 112.50, 'INSS sobre R$ 1.500,00 deve ser R$ 112,50');
    assert.strictEqual(folha.irrf, 0.00, 'IRRF deve ser R$ 0,00 (faixa isenta)');
    assert.strictEqual(folha.liquido, 1387.50, 'Líquido deve ser 1.500,00 - 112,50 = R$ 1.387,50');
    assert.strictEqual(folha.fgts, 120.00, 'FGTS encargo empresa (8% de 1.500) deve ser R$ 120,00');

    // 4. Validação da persistência real no banco de dados
    const folhaBanco = db.prepare('SELECT * FROM folhas WHERE id = ?').get(folha.folhaId) as any;
    assert.ok(folhaBanco, 'Registro na tabela folhas deve existir');
    assert.strictEqual(folhaBanco.total_proventos_centavos, 150000, 'Proventos persistidos em centavos (150000)');
    assert.strictEqual(folhaBanco.liquido_centavos, 138750, 'Líquido persistido em centavos (138750)');
    assert.strictEqual(folhaBanco.fgts_centavos, 12000, 'FGTS persistido em centavos (12000)');
    assert.strictEqual(folhaBanco.status, 'CALCULADA', 'Status da folha deve ser CALCULADA');

    const verbaBanco = db.prepare('SELECT * FROM folha_verbas WHERE folha_id = ? AND tipo = ?')
      .get(folha.folhaId, 'SALARIO_BASE') as any;
    assert.ok(verbaBanco, 'Verba SALARIO_BASE deve estar persistida em folha_verbas');
    assert.strictEqual(verbaBanco.valor_centavos, 150000);
    assert.strictEqual(verbaBanco.arredondamento, 'HALF_UP_2_CASAS');
  });

  it('Cenário 2: Desligamento no dia 10 de um mês de 30 dias com salário de R$ 3.000,00 (10 dias)', () => {
    // 1. Cadastra colaborador admitido previamente e desligado em 10/09/2026
    const colab = criarColaborador(db, rhUser, {
      filialId: matrizId,
      nome: 'Elisa Rocha Desligada',
      cpf: '52998224725',
      nascimento: '1994-03-12',
      admissao: '2024-01-01',
      desligamento: '2026-09-10',
      cargo: 'Analista',
      setor: 'Financeiro',
      salarioBase: '3000.00',
      banco: '033',
      agencia: '1234',
      conta: '5678',
    });

    // 2. Executa o cálculo real da folha mensal
    const folha = calcularFolhaColaborador(db, rhUser, {
      colaboradorId: colab.id,
      competenciaId,
    });

    // 3. Validações da regra RN-20:
    // Dias trabalhados: 10 dias.
    // Salário proporcional esperado: (3.000,00 / 30) * 10 = R$ 1.000,00
    assert.strictEqual(folha.totalProventos, 1000.00, 'Total de proventos deve ser R$ 1.000,00');

    const verbaSalario = folha.memoria.find((v: any) => v.tipo === 'SALARIO_BASE');
    assert.ok(verbaSalario, 'Memória de cálculo deve conter verba SALARIO_BASE');
    assert.strictEqual(verbaSalario.descricao, 'Salário Proporcional');
    assert.strictEqual(verbaSalario.valor.toNumber(), 1000.00, 'Valor proporcional deve ser R$ 1.000,00');
    assert.strictEqual(verbaSalario.baseCalculo.toNumber(), 3000.00);
    assert.ok(
      verbaSalario.regraAplicada.includes('10 dias'),
      `Regra aplicada deve indicar 10 dias trabalhados (obtido: "${verbaSalario.regraAplicada}")`
    );

    // INSS sobre R$ 1.000,00 (Faixa 1 a 7,5%): 1.000 * 0,075 = R$ 75,00
    assert.strictEqual(folha.inss, 75.00, 'INSS sobre R$ 1.000,00 deve ser R$ 75,00');
    assert.strictEqual(folha.irrf, 0.00, 'IRRF deve ser R$ 0,00');
    assert.strictEqual(folha.liquido, 925.00, 'Líquido deve ser 1.000,00 - 75,00 = R$ 925,00');
    assert.strictEqual(folha.fgts, 80.00, 'FGTS encargo empresa (8% de 1.000) deve ser R$ 80,00');

    // 4. Validação da persistência real no banco de dados
    const folhaBanco = db.prepare('SELECT * FROM folhas WHERE id = ?').get(folha.folhaId) as any;
    assert.ok(folhaBanco);
    assert.strictEqual(folhaBanco.total_proventos_centavos, 100000);
    assert.strictEqual(folhaBanco.liquido_centavos, 92500);
    assert.strictEqual(folhaBanco.fgts_centavos, 8000);
  });

  it('Cenário 3: Admissão no dia 5 e desligamento no dia 20 do mesmo mês de 30 dias (16 dias)', () => {
    // 1. Cadastra colaborador admitido em 05/09/2026 e desligado em 20/09/2026
    const colab = criarColaborador(db, rhUser, {
      filialId: matrizId,
      nome: 'Colaborador Curto Periodo',
      cpf: '52998224725',
      nascimento: '1995-10-25',
      admissao: '2026-09-05',
      desligamento: '2026-09-20',
      cargo: 'Atendente',
      setor: 'Operações',
      salarioBase: '3000.00',
      banco: '104',
      agencia: '1234',
      conta: '5678',
    });

    // 2. Executa o cálculo real da folha mensal
    const folha = calcularFolhaColaborador(db, rhUser, {
      colaboradorId: colab.id,
      competenciaId,
    });

    // 3. Validações da regra RN-20:
    // Dias trabalhados: 20 - 5 + 1 = 16 dias.
    // Salário proporcional esperado: (3.000,00 / 30) * 16 = R$ 1.600,00
    assert.strictEqual(folha.totalProventos, 1600.00, 'Total de proventos deve ser R$ 1.600,00');

    const verbaSalario = folha.memoria.find((v: any) => v.tipo === 'SALARIO_BASE');
    assert.ok(verbaSalario, 'Memória de cálculo deve conter verba SALARIO_BASE');
    assert.strictEqual(verbaSalario.descricao, 'Salário Proporcional');
    assert.strictEqual(verbaSalario.valor.toNumber(), 1600.00, 'Valor proporcional deve ser R$ 1.600,00');
    assert.strictEqual(verbaSalario.baseCalculo.toNumber(), 3000.00);
    assert.ok(
      verbaSalario.regraAplicada.includes('16 dias'),
      `Regra aplicada deve indicar 16 dias trabalhados (obtido: "${verbaSalario.regraAplicada}")`
    );

    // INSS sobre R$ 1.600,00 (Faixa 1 a 7,5%): 1.600 * 0,075 = R$ 120,00
    assert.strictEqual(folha.inss, 120.00, 'INSS sobre R$ 1.600,00 deve ser R$ 120,00');
    assert.strictEqual(folha.irrf, 0.00, 'IRRF deve ser R$ 0,00');
    assert.strictEqual(folha.liquido, 1480.00, 'Líquido deve ser 1.600,00 - 120,00 = R$ 1.480,00');
    assert.strictEqual(folha.fgts, 128.00, 'FGTS encargo empresa (8% de 1.600) deve ser R$ 128,00');

    // 4. Validação da persistência real no banco de dados
    const folhaBanco = db.prepare('SELECT * FROM folhas WHERE id = ?').get(folha.folhaId) as any;
    assert.ok(folhaBanco);
    assert.strictEqual(folhaBanco.total_proventos_centavos, 160000);
    assert.strictEqual(folhaBanco.liquido_centavos, 148000);
    assert.strictEqual(folhaBanco.fgts_centavos, 12800);
  });
});

describe('Caracterização de Casos de Borda da RN-20 (Meses de 31, 28 e 29 dias - Pendência P-05)', () => {
  let db: DatabaseSync;
  const adminUser = { id: 1, email: 'admin@empresa.com', perfil: 'ADMIN' };
  let rhUser: { id: number; email: string; perfil: string };
  let matrizId: number;

  beforeEach(() => {
    limparTodasSessoes();
    db = new DatabaseSync(':memory:');
    db.exec(SCHEMA_SQL);
    inicializarFeriadosEParametros(db);

    const uRH = criarUsuario(db, adminUser, {
      nome: 'Analista de RH',
      email: 'rh@empresa.com',
      senha: 'SenhaForte123',
      perfil: 'RH',
    });
    rhUser = { id: uRH.id, email: uRH.email, perfil: 'RH' };

    const filial = criarFilial(db, rhUser, { nome: 'Matriz São Paulo', tipo: 'MATRIZ' });
    matrizId = filial.id;
  });

  it('Caracterização: Admissão em 31/10/2026 resulta em 0 dias trabalhados (R$ 0,00) na fórmula atual', () => {
    // Competência 2026-10 (outubro tem 31 dias)
    const comp = abrirOuObterCompetencia(db, rhUser, '2026-10');

    const colab = criarColaborador(db, rhUser, {
      filialId: matrizId,
      nome: 'Admitido Dia Trinta e Um',
      cpf: '52998224725',
      nascimento: '1992-04-10',
      admissao: '2026-10-31',
      cargo: 'Atendente',
      setor: 'Atendimento',
      salarioBase: '3000.00',
      banco: '001',
      agencia: '1234',
      conta: '5678',
    });

    const folha = calcularFolhaColaborador(db, rhUser, {
      colaboradorId: colab.id,
      competenciaId: comp.id,
    });

    // COMPORTAMENTO ATUAL CARACTERIZADO:
    // A fórmula (30 - diaAdm + 1) com diaAdm = 31 resulta em 30 - 31 + 1 = 0 dias.
    // O sistema apura R$ 0,00 de salário, deixando o dia efetivamente trabalhado sem remuneração.
    // Registrado em docs/perguntas-pendentes.md como P-05 para definição definitiva pelo RH.
    assert.strictEqual(folha.totalProventos, 0.00, 'Comportamento atual: totalProventos é R$ 0,00');
    assert.strictEqual(folha.liquido, 0.00, 'Comportamento atual: líquido é R$ 0,00');

    const verbaSalario = folha.memoria.find((v: any) => v.tipo === 'SALARIO_BASE');
    assert.ok(verbaSalario);
    assert.strictEqual(verbaSalario.valor.toNumber(), 0.00);
    assert.ok(
      verbaSalario.regraAplicada.includes('0 dias'),
      `Comportamento atual registra 0 dias trabalhados: "${verbaSalario.regraAplicada}"`
    );
  });

  it('Caracterização: Desligamento em 31/10/2026 resulta em 31 dias trabalhados (R$ 3.100,00), superando o salário integral', () => {
    const comp = abrirOuObterCompetencia(db, rhUser, '2026-10');

    const colab = criarColaborador(db, rhUser, {
      filialId: matrizId,
      nome: 'Desligado Dia Trinta e Um',
      cpf: '52998224725',
      nascimento: '1990-07-20',
      admissao: '2024-01-01',
      desligamento: '2026-10-31',
      cargo: 'Atendente',
      setor: 'Atendimento',
      salarioBase: '3000.00',
      banco: '001',
      agencia: '1234',
      conta: '5678',
    });

    const folha = calcularFolhaColaborador(db, rhUser, {
      colaboradorId: colab.id,
      competenciaId: comp.id,
    });

    // COMPORTAMENTO ATUAL CARACTERIZADO:
    // No desligamento, a fórmula usa diasTrabalhados = diaDesl = 31.
    // Multiplica (3.000 / 30) * 31 = R$ 3.100,00, superando o salário-base contratual integral (R$ 3.000,00).
    // Registrado em docs/perguntas-pendentes.md como P-05 para definição definitiva pelo RH.
    assert.strictEqual(folha.totalProventos, 3100.00, 'Comportamento atual: totalProventos é R$ 3.100,00');
    assert.strictEqual(folha.inss, 260.60, 'INSS sobre 3.100,00 é R$ 260,60');
    assert.strictEqual(folha.liquido, 2839.40, 'Líquido apurado sobre 3.100,00 é R$ 2.839,40');
    assert.strictEqual(folha.fgts, 248.00, 'FGTS sobre 3.100,00 é R$ 248,00');

    const verbaSalario = folha.memoria.find((v: any) => v.tipo === 'SALARIO_BASE');
    assert.ok(verbaSalario);
    assert.strictEqual(verbaSalario.valor.toNumber(), 3100.00);
    assert.ok(
      verbaSalario.regraAplicada.includes('31 dias'),
      `Comportamento atual registra 31 dias: "${verbaSalario.regraAplicada}"`
    );
  });

  it('Caracterização: Admissão no último dia de fevereiro comum (28/02/2026) resulta em 3 dias (R$ 300,00)', () => {
    // 2026 é ano comum: fevereiro tem 28 dias
    const comp = abrirOuObterCompetencia(db, rhUser, '2026-02');

    const colab = criarColaborador(db, rhUser, {
      filialId: matrizId,
      nome: 'Admitido Fim Fevereiro Comum',
      cpf: '52998224725',
      nascimento: '1993-02-15',
      admissao: '2026-02-28',
      cargo: 'Atendente',
      setor: 'Atendimento',
      salarioBase: '3000.00',
      banco: '001',
      agencia: '1234',
      conta: '5678',
    });

    const folha = calcularFolhaColaborador(db, rhUser, {
      colaboradorId: colab.id,
      competenciaId: comp.id,
    });

    // COMPORTAMENTO ATUAL CARACTERIZADO:
    // A fórmula (30 - diaAdm + 1) com diaAdm = 28 resulta em 30 - 28 + 1 = 3 dias.
    // O sistema apura (3.000 / 30) * 3 = R$ 300,00, embora apenas 1 dia tenha sido trabalhado no mês.
    // Registrado em docs/perguntas-pendentes.md como P-05 para definição definitiva pelo RH.
    assert.strictEqual(folha.totalProventos, 300.00, 'Comportamento atual: totalProventos é R$ 300,00 (3 dias)');
    assert.strictEqual(folha.inss, 22.50, 'INSS (7,5% de 300) é R$ 22,50');
    assert.strictEqual(folha.liquido, 277.50, 'Líquido é R$ 277,50');

    const verbaSalario = folha.memoria.find((v: any) => v.tipo === 'SALARIO_BASE');
    assert.ok(verbaSalario);
    assert.strictEqual(verbaSalario.valor.toNumber(), 300.00);
    assert.ok(
      verbaSalario.regraAplicada.includes('3 dias'),
      `Comportamento atual registra 3 dias: "${verbaSalario.regraAplicada}"`
    );
  });

  it('Caracterização: Admissão no último dia de fevereiro bissexto (29/02/2024) resulta em 2 dias (R$ 200,00)', () => {
    // 2024 foi ano bissexto: fevereiro teve 29 dias
    const comp = abrirOuObterCompetencia(db, rhUser, '2024-02');

    const colab = criarColaborador(db, rhUser, {
      filialId: matrizId,
      nome: 'Admitido Fim Fevereiro Bissexto',
      cpf: '52998224725',
      nascimento: '1993-02-15',
      admissao: '2024-02-29',
      cargo: 'Atendente',
      setor: 'Atendimento',
      salarioBase: '3000.00',
      banco: '001',
      agencia: '1234',
      conta: '5678',
    });

    const folha = calcularFolhaColaborador(db, rhUser, {
      colaboradorId: colab.id,
      competenciaId: comp.id,
    });

    // COMPORTAMENTO ATUAL CARACTERIZADO:
    // A fórmula (30 - diaAdm + 1) com diaAdm = 29 resulta em 30 - 29 + 1 = 2 dias.
    // O sistema apura (3.000 / 30) * 2 = R$ 200,00, embora apenas 1 dia tenha sido trabalhado no mês.
    // Registrado em docs/perguntas-pendentes.md como P-05 para definição definitiva pelo RH.
    assert.strictEqual(folha.totalProventos, 200.00, 'Comportamento atual: totalProventos é R$ 200,00 (2 dias)');
    assert.strictEqual(folha.inss, 15.00, 'INSS (7,5% de 200) é R$ 15,00');
    assert.strictEqual(folha.liquido, 185.00, 'Líquido é R$ 185,00');

    const verbaSalario = folha.memoria.find((v: any) => v.tipo === 'SALARIO_BASE');
    assert.ok(verbaSalario);
    assert.strictEqual(verbaSalario.valor.toNumber(), 200.00);
    assert.ok(
      verbaSalario.regraAplicada.includes('2 dias'),
      `Comportamento atual registra 2 dias: "${verbaSalario.regraAplicada}"`
    );
  });
});

