/**
 * etapa3.test.ts - Testes automatizados da Etapa 3 (Cálculo da Folha, Memória de Cálculo e Fechamento Seguro).
 * 
 * Valida com tolerância máxima de R$ 0,01:
 * - Exemplos numéricos da Seção 8 (A, B, C, G, H, I, M)
 * - Cenários Gherkin da Seção 10:
 *   - Cálculo normal com memória de cálculo
 *   - INSS no teto (R$ 10.000,00 -> R$ 988,09)
 *   - IRRF com redução Lei 15.270/2025 (R$ 6.000,00 -> R$ 385,10)
 *   - IRRF com dependentes (R$ 5.500,00, 2 dep -> R$ 101,78)
 *   - FGTS como encargo da empresa
 *   - DSR e folha completa com horas extras (Exemplo G e M)
 *   - Proteção ao líquido: descontos acima dos proventos, líquido 0,00 e saldo a descontar (RN-06)
 *   - Saldo a descontar na competência seguinte (limite de 30% do bruto)
 *   - Fechamento com dados pendentes e com saldo sem justificativa bloqueado (Tabela 7.1)
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
import {
  lancarHorasExtras,
  lancarVerbaAvulsa,
} from '../src/services/eventoService.js';
import {
  calcularFolhaColaborador,
  fecharFolhaSegura,
} from '../src/services/folhaService.js';
import { limparTodasSessoes } from '../src/security.js';

describe('ETAPA 3: Cálculo da Folha, Memória de Cálculo e Fechamento Seguro', () => {
  let db: DatabaseSync;
  const adminUser = { id: 1, email: 'admin@empresa.com', perfil: 'ADMIN' };
  let rhUser: { id: number; email: string; perfil: string };
  let matrizId: number;
  let competenciaId: number;
  const mesAno = '2026-10';

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

    const comp = abrirOuObterCompetencia(db, rhUser, mesAno);
    competenciaId = comp.id;
  });

  // --- CENÁRIOS E EXEMPLOS DA SEÇÃO 8 E SEÇÃO 10 ---

  it('Cenário: Cálculo normal com memória de cálculo (Exemplo A: Salário R$ 3.000,00 sem dependentes)', () => {
    const colab = criarColaborador(db, rhUser, {
      filialId: matrizId,
      nome: 'Colaborador A',
      cpf: '52998224725',
      nascimento: '1990-01-01',
      admissao: '2023-01-01',
      cargo: 'Atendente',
      setor: 'Atendimento',
      salarioBase: '3000.00',
      banco: '001',
      agencia: '1234',
      conta: '5678',
    });

    const folha = calcularFolhaColaborador(db, rhUser, {
      colaboradorId: colab.id,
      competenciaId,
    });

    // Resultados esperados: INSS 248,60 | IRRF 0,00 | Líquido 2.751,40
    assert.strictEqual(folha.inss, 248.60);
    assert.strictEqual(folha.irrf, 0.00);
    assert.strictEqual(folha.liquido, 2751.40);

    // Valida existência de memória de cálculo detalhada (RN-02)
    assert.ok(folha.memoria.length >= 4, 'Deve conter memória detalhada das verbas');
    const verbaINSS = folha.memoria.find((v: any) => v.tipo === 'INSS');
    assert.ok(verbaINSS, 'Memória deve ter verba de INSS');
    assert.strictEqual(verbaINSS.valor.toNumber(), 248.60);
    assert.ok(verbaINSS.regraAplicada.includes('Faixa 1'));
  });

  it('Cenário: INSS limitado ao teto (Exemplo C: Salário R$ 10.000,00)', () => {
    const colab = criarColaborador(db, rhUser, {
      filialId: matrizId,
      nome: 'Diretor Executivo',
      cpf: '52998224725',
      nascimento: '1985-05-10',
      admissao: '2020-01-01',
      cargo: 'Diretor',
      setor: 'Diretoria',
      salarioBase: '10000.00',
      banco: '341',
      agencia: '1234',
      conta: '9999',
    });

    const folha = calcularFolhaColaborador(db, rhUser, {
      colaboradorId: colab.id,
      competenciaId,
    });

    // INSS limitado ao teto de R$ 988,09
    assert.strictEqual(folha.inss, 988.09);
  });

  it('Cenário: IRRF com redução entre 5.000,01 e 7.350,00 (Exemplo B: Salário R$ 6.000,00 sem dependentes)', () => {
    const colab = criarColaborador(db, rhUser, {
      filialId: matrizId,
      nome: 'Especialista B',
      cpf: '52998224725',
      nascimento: '1992-03-20',
      admissao: '2021-06-01',
      cargo: 'Especialista',
      setor: 'TI',
      salarioBase: '6000.00',
      banco: '001',
      agencia: '1234',
      conta: '5678',
    });

    const folha = calcularFolhaColaborador(db, rhUser, {
      colaboradorId: colab.id,
      competenciaId,
    });

    // INSS = 641,51 (tolerância R$ 0,01)
    assert.ok(Math.abs(folha.inss - 641.51) <= 0.01, `INSS esperado 641.51, obteve ${folha.inss}`);

    // IRRF final com redução = 385,10
    assert.strictEqual(folha.irrf, 385.10);

    // Líquido = 4.973,39
    assert.strictEqual(folha.liquido, 4973.39);
  });

  it('Cenário: IRRF com dependentes (Exemplo H: Salário R$ 5.500,00 com 2 dependentes)', () => {
    const colab = criarColaborador(db, rhUser, {
      filialId: matrizId,
      nome: 'Hugo Pires',
      cpf: '52998224725',
      nascimento: '1989-12-05',
      admissao: '2020-05-12',
      cargo: 'Gerente',
      setor: 'Operações',
      salarioBase: '5500.00',
      banco: '237',
      agencia: '1234',
      conta: '5678',
      dependentes: [
        { nome: 'Filho 1', nascimento: '2015-02-10', parentesco: 'FILHO' },
        { nome: 'Filho 2', nascimento: '2018-08-25', parentesco: 'FILHO' },
      ],
    });

    const folha = calcularFolhaColaborador(db, rhUser, {
      colaboradorId: colab.id,
      competenciaId,
    });

    // INSS = 571,51 | IRRF = 101,78 | Líquido = 4.826,71
    assert.strictEqual(folha.inss, 571.51);
    assert.strictEqual(folha.irrf, 101.78);
    assert.strictEqual(folha.liquido, 4826.71);
  });

  it('Cenário: IRRF isento e FGTS como encargo (Exemplo I: Salário R$ 2.000,00)', () => {
    const colab = criarColaborador(db, rhUser, {
      filialId: matrizId,
      nome: 'Assistente I',
      cpf: '52998224725',
      nascimento: '1997-04-10',
      admissao: '2024-01-10',
      cargo: 'Assistente',
      setor: 'Geral',
      salarioBase: '2000.00',
      banco: '001',
      agencia: '1234',
      conta: '5678',
    });

    const folha = calcularFolhaColaborador(db, rhUser, {
      colaboradorId: colab.id,
      competenciaId,
    });

    // INSS = 155,69 | IRRF = 0,00 | Líquido = 1.844,31
    assert.strictEqual(folha.inss, 155.69);
    assert.strictEqual(folha.irrf, 0.00);
    assert.strictEqual(folha.liquido, 1844.31);

    // FGTS é encargo da empresa (8% de 2.000 = 160,00) e NÃO reduz o líquido
    assert.strictEqual(folha.fgts, 160.00);
    assert.strictEqual(folha.totalDescontos, 155.69); // Apenas o INSS descontado
  });

  it('Cenário: DSR e folha completa com horas extras (Exemplo G: Salário 2.200,00 + 10h extras úteis)', () => {
    const colab = criarColaborador(db, rhUser, {
      filialId: matrizId,
      nome: 'Operador G',
      cpf: '52998224725',
      nascimento: '1993-09-18',
      admissao: '2023-05-01',
      cargo: 'Operador',
      setor: 'Atendimento',
      salarioBase: '2200.00',
      banco: '001',
      agencia: '1234',
      conta: '5678',
    });

    // 10 horas extras em dia útil -> 10 * 15,00 = 150,00
    lancarHorasExtras(db, rhUser, {
      colaboradorId: colab.id,
      competenciaId,
      tipo: 'UTIL',
      quantidadeHoras: 10,
    });

    // Cálculo em 10/2026: 26 dias úteis e 5 domingos/feriados
    const folha = calcularFolhaColaborador(db, rhUser, {
      colaboradorId: colab.id,
      competenciaId,
      diasUteisMes: 26,
      domingosEFeriadosMes: 5,
    });

    // DSR = 150,00 / 26 * 5 = 28,85
    // Bruto = 2.200 + 150 + 28,85 = 2.378,85
    // INSS = 189,78 | IRRF = 0,00 | Líquido = 2.189,07
    assert.strictEqual(folha.totalProventos, 2378.85);
    assert.strictEqual(folha.inss, 189.78);
    assert.strictEqual(folha.irrf, 0.00);
    assert.strictEqual(folha.liquido, 2189.07);
  });

  it('Cenário: Feriado cadastrado altera o DSR (Exemplo M)', () => {
    const colab = criarColaborador(db, rhUser, {
      filialId: matrizId,
      nome: 'Operador M',
      cpf: '52998224725',
      nascimento: '1993-09-18',
      admissao: '2023-05-01',
      cargo: 'Operador',
      setor: 'Atendimento',
      salarioBase: '2200.00',
      banco: '001',
      agencia: '1234',
      conta: '5678',
    });

    lancarHorasExtras(db, rhUser, {
      colaboradorId: colab.id,
      competenciaId,
      tipo: 'UTIL',
      quantidadeHoras: 10,
    });

    // No exemplo M: feriado extra municipal altera para 25 dias úteis e 6 domingos/feriados
    // DSR = 150,00 / 25 * 6 = 36,00
    const folha = calcularFolhaColaborador(db, rhUser, {
      colaboradorId: colab.id,
      competenciaId,
      diasUteisMes: 25,
      domingosEFeriadosMes: 6,
    });

    // Bruto: 2.200 + 150 + 36 = 2.386,00
    assert.strictEqual(folha.totalProventos, 2386.00);
  });

  // --- CENÁRIOS DE PROTEÇÃO DO LÍQUIDO E SALDO A DESCONTAR (RN-06) ---

  it('Cenário: Descontos acima dos proventos deixam líquido em 0,00 e geram saldo a descontar', () => {
    const colab = criarColaborador(db, rhUser, {
      filialId: matrizId,
      nome: 'Colaborador Descontos',
      cpf: '52998224725',
      nascimento: '1995-01-01',
      admissao: '2023-01-01',
      cargo: 'Atendente',
      setor: 'Geral',
      salarioBase: '2000.00',
      banco: '001',
      agencia: '1234',
      conta: '5678',
    });

    // Desconto avulso de R$ 2.500,00
    lancarVerbaAvulsa(db, rhUser, {
      colaboradorId: colab.id,
      competenciaId,
      tipo: 'DESCONTO',
      descricao: 'Adiantamento Pessoal',
      valor: '2500.00',
      incideINSS: false,
      incideIRRF: false,
      incideFGTS: false,
    });

    const folha = calcularFolhaColaborador(db, rhUser, {
      colaboradorId: colab.id,
      competenciaId,
    });

    // Salário R$ 2.000,00, INSS R$ 155,69 -> sobra R$ 1.844,31 para descontos
    // Líquido nunca fica negativo (0,00)
    assert.strictEqual(folha.liquido, 0.00);
    assert.strictEqual(folha.totalDescontos, 2000.00); // 155,69 INSS + 1.844,31 desconto avulso aplicado

    // Saldo a descontar: 2.500 - 1.844,31 = 655,69
    assert.strictEqual(folha.saldoADescontar, 655.69);
  });

  it('Cenário: Fechar com saldo a descontar sem justificativa é bloqueado', () => {
    const colab = criarColaborador(db, rhUser, {
      filialId: matrizId,
      nome: 'Colaborador Bloqueio Saldo',
      cpf: '52998224725',
      nascimento: '1995-01-01',
      admissao: '2023-01-01',
      cargo: 'Atendente',
      setor: 'Geral',
      salarioBase: '2000.00',
      banco: '001',
      agencia: '1234',
      conta: '5678',
    });

    lancarVerbaAvulsa(db, rhUser, {
      colaboradorId: colab.id,
      competenciaId,
      tipo: 'DESCONTO',
      descricao: 'Adiantamento',
      valor: '2500.00',
      incideINSS: false,
      incideIRRF: false,
      incideFGTS: false,
    });

    calcularFolhaColaborador(db, rhUser, { colaboradorId: colab.id, competenciaId });

    // Tentar fechar sem justificativa deve ser rejeitado
    assert.throws(
      () => fecharFolhaSegura(db, rhUser, competenciaId, ''),
      { message: 'Os descontos superam os proventos. O excedente virou saldo a descontar; informe a justificativa para fechar.' }
    );

    // Fechar informando justificativa deve passar com sucesso
    assert.doesNotThrow(() =>
      fecharFolhaSegura(db, rhUser, competenciaId, 'Saldo excedente autorizado pelo RH')
    );
  });

  it('Cenário: Saldo a descontar na competência seguinte (limitado a 30% do bruto)', () => {
    const colab = criarColaborador(db, rhUser, {
      filialId: matrizId,
      nome: 'Colaborador Saldo Seguinte',
      cpf: '52998224725',
      nascimento: '1995-01-01',
      admissao: '2023-01-01',
      cargo: 'Atendente',
      setor: 'Geral',
      salarioBase: '2000.00',
      banco: '001',
      agencia: '1234',
      conta: '5678',
    });

    // Mês 1: gera saldo de 655,69
    lancarVerbaAvulsa(db, rhUser, {
      colaboradorId: colab.id,
      competenciaId,
      tipo: 'DESCONTO',
      descricao: 'Adiantamento',
      valor: '2500.00',
      incideINSS: false,
      incideIRRF: false,
      incideFGTS: false,
    });

    calcularFolhaColaborador(db, rhUser, { colaboradorId: colab.id, competenciaId });
    fecharFolhaSegura(db, rhUser, competenciaId, 'Justificativa mês 1');

    // Mês 2 (competência 2026-11)
    const comp2 = abrirOuObterCompetencia(db, rhUser, '2026-11');
    const folhaMes2 = calcularFolhaColaborador(db, rhUser, {
      colaboradorId: colab.id,
      competenciaId: comp2.id,
    });

    // Bruto de 2.000,00 com limite de 30% = R$ 600,00
    // Desconto do saldo anterior deve ser exatamente 600,00
    const verbaSaldoAnterior = folhaMes2.memoria.find((v: any) => v.tipo === 'SALDO_A_DESCONTAR_ANTERIOR');
    assert.ok(verbaSaldoAnterior, 'Deve existir verba de saldo a descontar anterior');
    assert.strictEqual(verbaSaldoAnterior.valor.toNumber(), 600.00);

    // O líquido no mês 2 será: 2.000 - 155,69 (INSS) - 600,00 = 1.244,31
    assert.strictEqual(folhaMes2.liquido, 1244.31);
  });
});
