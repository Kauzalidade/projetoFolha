/**
 * etapa4.test.ts - Testes automatizados da Etapa 4 (Férias, 13º, Documentos, Alertas, Contracheque e Relatórios).
 * 
 * Cobre todos os requisitos e cenários Gherkin da Seção 10 para a Etapa 4:
 * - Férias com 1/3 constitucional
 * - Pedido de férias antes do período aquisitivo (rejeitado)
 * - Fracionamento válido e inválido (mínimo 14 dias em um dos períodos)
 * - Abono pecuniário sem incidência de INSS/IRRF (10 dias = 1.000 + 1/3 = 1.333,33)
 * - Férias reduzidas por faltas (7 faltas -> 24 dias)
 * - Início das férias antes de feriado (rejeitado nos 2 dias anteriores)
 * - Data limite de pagamento (2 dias antes do início)
 * - Férias com INSS e IRRF (Exemplo J: base 4.000 -> INSS 368,60, Líquido 3.631,40)
 * - Reflexo das horas extras nas férias e no 13º (RN-48)
 * - Férias que cruzam dois meses (RN-49)
 * - Férias com concessivo vencido com e sem justificativa (Tabela 7.2)
 * - 13º salário 1ª parcela (sem descontos) e 2ª parcela (com INSS)
 * - 13º proporcional (admissão pós dia 15 não conta mês)
 * - Alerta de documento a vencer (RN-52)
 * - Alerta de exame ocupacional a vencer (RN-53)
 * - Alerta de férias com período concessivo a vencer (RN-45)
 * - Alerta de prazo de pagamento da folha (RN-58)
 * - Dados fora do prazo de guarda (LGPD - RN-56)
 * - Contracheque em PDF (RN-55 / US-09)
 * - Relatórios em Excel e PDF com valores idênticos à tela (US-08 / Seção 13)
 * - Relatório de Dados de Pagamento (RN-57)
 * - Relatório de Logs de Auditoria restrito à Diretoria e Admin (RNF-03)
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { DatabaseSync } from 'node:sqlite';
import { SCHEMA_SQL } from '../src/db.js';
import { criarUsuario } from '../src/services/usuarioService.js';
import { criarFilial } from '../src/services/filialService.js';
import { criarColaborador, inativarColaborador } from '../src/services/colaboradorService.js';
import { inicializarFeriadosEParametros } from '../src/services/parametroFeriadoService.js';
import { abrirOuObterCompetencia } from '../src/services/competenciaService.js';
import { lancarFaltaInjustificada } from '../src/services/eventoService.js';
import { calcularFolhaColaborador } from '../src/services/folhaService.js';
import { solicitarFerias, listarFerias } from '../src/services/feriasService.js';
import { calcularDecimoTerceiro } from '../src/services/decimoTerceiroService.js';
import {
  anexarDocumento,
  cadastrarExameOcupacional,
  consultarAlertas,
} from '../src/services/documentosAlertasService.js';
import {
  gerarContrachequeEstruturado,
  gerarContrachequePDF,
  gerarRelatorioFolhaMes,
  gerarRelatorioDadosPagamento,
  gerarRelatorioLogs,
  exportarRelatorioExcel,
  exportarRelatorioPDF,
} from '../src/services/relatoriosService.js';
import { limparTodasSessoes } from '../src/security.js';

describe('ETAPA 4: Férias, 13º Salário, Documentos, Alertas, Contracheque e Relatórios', () => {
  let db: DatabaseSync;
  const adminUser = { id: 1, email: 'admin@empresa.com', perfil: 'ADMIN' };
  let rhUser: { id: number; email: string; perfil: string };
  let diretorUser: { id: number; email: string; perfil: string };
  let matrizId: number;
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

    const uDir = criarUsuario(db, adminUser, {
      nome: 'Diretoria Geral',
      email: 'diretoria@empresa.com',
      senha: 'SenhaDiretoria123',
      perfil: 'DIRETORIA',
    });
    diretorUser = { id: uDir.id, email: uDir.email, perfil: 'DIRETORIA' };

    const filial = criarFilial(db, rhUser, { nome: 'Matriz São Paulo', tipo: 'MATRIZ' });
    matrizId = filial.id;

    const comp = abrirOuObterCompetencia(db, rhUser, '2026-10');
    competenciaId = comp.id;
  });

  // --- CENÁRIOS DE FÉRIAS ---

  it('Cenário: Férias com 1/3 constitucional (Salário R$ 3.000,00 e 30 dias)', () => {
    const colab = criarColaborador(db, rhUser, {
      filialId: matrizId,
      nome: 'Colaborador Férias',
      cpf: '52998224725',
      nascimento: '1990-01-01',
      admissao: '2023-01-01',
      cargo: 'Atendente',
      setor: 'Geral',
      salarioBase: '3000.00',
      banco: '001',
      agencia: '1234',
      conta: '5678',
    });

    const ferias = solicitarFerias(db, rhUser, {
      colaboradorId: colab.id,
      dataInicio: '2026-11-10',
      diasGozo: 30,
    });

    assert.strictEqual(ferias.valorFerias, 3000.00);
    assert.strictEqual(ferias.valorTerco, 1000.00);
    assert.strictEqual(ferias.totalBruto, 4000.00);
  });

  it('Cenário: Pedido de férias antes do período aquisitivo é rejeitado', () => {
    const colab = criarColaborador(db, rhUser, {
      filialId: matrizId,
      nome: 'Novo Contratado',
      cpf: '52998224725',
      nascimento: '1995-01-01',
      admissao: '2026-03-01',
      cargo: 'Atendente',
      setor: 'Geral',
      salarioBase: '2000.00',
      banco: '001',
      agencia: '1234',
      conta: '5678',
    });

    assert.throws(
      () =>
        solicitarFerias(db, rhUser, {
          colaboradorId: colab.id,
          dataInicio: '2026-11-10',
          diasGozo: 30,
        }),
      { message: 'O período aquisitivo ainda não foi completado.' }
    );
  });

  it('Cenário: Fracionamento de férias inválido (3 períodos de 10 dias é rejeitado)', () => {
    const colab = criarColaborador(db, rhUser, {
      filialId: matrizId,
      nome: 'Colaborador Fracionamento',
      cpf: '52998224725',
      nascimento: '1990-01-01',
      admissao: '2023-01-01',
      cargo: 'Atendente',
      setor: 'Geral',
      salarioBase: '2500.00',
      banco: '001',
      agencia: '1234',
      conta: '5678',
    });

    assert.throws(
      () =>
        solicitarFerias(db, rhUser, {
          colaboradorId: colab.id,
          dataInicio: '2026-11-10',
          diasGozo: 10,
          fracionamentoPeriodos: [10, 10, 10],
        }),
      /Fracionamento inválido: um período deve ter no mínimo 14 dias/
    );
  });

  it('Cenário: Fracionamento de férias válido (14, 8 e 8 dias)', () => {
    const colab = criarColaborador(db, rhUser, {
      filialId: matrizId,
      nome: 'Colaborador Frac Valido',
      cpf: '52998224725',
      nascimento: '1990-01-01',
      admissao: '2023-01-01',
      cargo: 'Atendente',
      setor: 'Geral',
      salarioBase: '2500.00',
      banco: '001',
      agencia: '1234',
      conta: '5678',
    });

    const res = solicitarFerias(db, rhUser, {
      colaboradorId: colab.id,
      dataInicio: '2026-11-10',
      diasGozo: 14,
      fracionamentoPeriodos: [14, 8, 8],
    });

    assert.strictEqual(res.diasGozo, 14);
  });

  it('Cenário: Abono pecuniário (venda de 10 dias sem incidência de INSS/IRRF)', () => {
    const colab = criarColaborador(db, rhUser, {
      filialId: matrizId,
      nome: 'Bruno Lima',
      cpf: '52998224725',
      nascimento: '1988-02-14',
      admissao: '2021-01-02',
      cargo: 'Gerente',
      setor: 'Operações',
      salarioBase: '3000.00',
      banco: '001',
      agencia: '1234',
      conta: '5678',
    });

    const res = solicitarFerias(db, rhUser, {
      colaboradorId: colab.id,
      dataInicio: '2026-11-10',
      diasGozo: 20,
      diasAbono: 10,
    });

    assert.strictEqual(res.valorAbonoTotal, 1333.33);
  });

  it('Cenário: Férias reduzidas por faltas (7 faltas no aquisitivo -> 24 dias)', () => {
    const colab = criarColaborador(db, rhUser, {
      filialId: matrizId,
      nome: 'Colaborador Faltoso',
      cpf: '52998224725',
      nascimento: '1992-06-10',
      admissao: '2023-01-01',
      cargo: 'Atendente',
      setor: 'Geral',
      salarioBase: '2000.00',
      banco: '001',
      agencia: '1234',
      conta: '5678',
    });

    lancarFaltaInjustificada(db, rhUser, {
      colaboradorId: colab.id,
      competenciaId,
      diasFalta: 7,
    });

    const res = solicitarFerias(db, rhUser, {
      colaboradorId: colab.id,
      dataInicio: '2026-11-10',
      diasGozo: 24,
    });

    assert.strictEqual(res.diasDireito, 24);
  });

  it('Cenário: Início das férias antes de feriado é rejeitado', () => {
    const colab = criarColaborador(db, rhUser, {
      filialId: matrizId,
      nome: 'Colaborador Feriado',
      cpf: '52998224725',
      nascimento: '1991-08-10',
      admissao: '2023-01-01',
      cargo: 'Atendente',
      setor: 'Geral',
      salarioBase: '2000.00',
      banco: '001',
      agencia: '1234',
      conta: '5678',
    });

    assert.throws(
      () =>
        solicitarFerias(db, rhUser, {
          colaboradorId: colab.id,
          dataInicio: '2026-09-05',
          diasGozo: 30,
        }),
      /não pode começar nos 2 dias que antecedem feriado ou descanso semanal/
    );
  });

  it('Cenário: Data limite de pagamento das férias (2 dias antes do início)', () => {
    const colab = criarColaborador(db, rhUser, {
      filialId: matrizId,
      nome: 'Colaborador Pagamento',
      cpf: '52998224725',
      nascimento: '1991-08-10',
      admissao: '2023-01-01',
      cargo: 'Atendente',
      setor: 'Geral',
      salarioBase: '2000.00',
      banco: '001',
      agencia: '1234',
      conta: '5678',
    });

    const res = solicitarFerias(db, rhUser, {
      colaboradorId: colab.id,
      dataInicio: '2026-11-10',
      diasGozo: 30,
    });

    assert.strictEqual(res.dataLimitePagamento, '2026-11-08');
  });

  it('Cenário: Férias com INSS e IRRF (Exemplo J: Base 4.000,00)', () => {
    const colab = criarColaborador(db, rhUser, {
      filialId: matrizId,
      nome: 'Colaborador Exemplo J',
      cpf: '52998224725',
      nascimento: '1991-08-10',
      admissao: '2023-01-01',
      cargo: 'Atendente',
      setor: 'Geral',
      salarioBase: '3000.00',
      banco: '001',
      agencia: '1234',
      conta: '5678',
    });

    const res = solicitarFerias(db, rhUser, {
      colaboradorId: colab.id,
      dataInicio: '2026-11-10',
      diasGozo: 30,
    });

    assert.strictEqual(res.totalBruto, 4000.00);
    assert.strictEqual(res.inss, 368.60);
    assert.strictEqual(res.irrf, 0.00);
    assert.strictEqual(res.liquido, 3631.40);
  });

  it('Cenário: Reflexo das horas extras nas férias (RN-48 / Exemplo K)', () => {
    const colab = criarColaborador(db, rhUser, {
      filialId: matrizId,
      nome: 'Colaborador Reflexo',
      cpf: '52998224725',
      nascimento: '1991-08-10',
      admissao: '2023-01-01',
      cargo: 'Atendente',
      setor: 'Geral',
      salarioBase: '2200.00',
      banco: '001',
      agencia: '1234',
      conta: '5678',
    });

    const res = solicitarFerias(db, rhUser, {
      colaboradorId: colab.id,
      dataInicio: '2026-11-10',
      diasGozo: 30,
      mediaHorasExtras: '150.00',
    });

    assert.strictEqual(res.baseRemuneracao, 2350.00);
    assert.strictEqual(res.valorTerco, 783.33);
    assert.strictEqual(res.totalBruto, 3133.33);
  });

  it('Cenário: Férias que cruzam dois meses (RN-49)', () => {
    // Admitido em 2023-01-01; Salário 3.000,00; Férias de 30 dias iniciando em 2024-06-20 (quinta-feira, mês de 30 dias)
    const colab = criarColaborador(db, rhUser, {
      filialId: matrizId,
      nome: 'Colaborador Cruzando Meses',
      cpf: '52998224725',
      nascimento: '1990-05-15',
      admissao: '2023-01-01',
      cargo: 'Atendente',
      setor: 'Atendimento',
      salarioBase: '3000.00',
      banco: '001',
      agencia: '1234',
      conta: '5678',
    });

    // Férias de 30 dias: de 2024-06-20 a 2024-07-19 (início no dia 20 de mês com 30 dias)
    solicitarFerias(db, rhUser, {
      colaboradorId: colab.id,
      dataInicio: '2024-06-20',
      diasGozo: 30,
    });

    // Competência do início do gozo: 2024-06
    const compJunho = abrirOuObterCompetencia(db, rhUser, '2024-06');
    const folhaJunho = calcularFolhaColaborador(db, rhUser, {
      colaboradorId: colab.id,
      competenciaId: compJunho.id,
    });

    // Salário proporcional a 19 dias trabalhados: (3.000 / 30) * 19 = 1.900,00
    const verbaSalarioJunho = folhaJunho.memoria.find((v: any) => v.tipo === 'SALARIO_BASE');
    assert.strictEqual(verbaSalarioJunho.valor.toNumber(), 1900.00);

    // Férias de 4.000,00 calculadas nesta competência (3.000 + 1.000)
    const verbaFerias = folhaJunho.memoria.find((v: any) => v.tipo === 'FERIAS_GOZADAS');
    const verbaTerco = folhaJunho.memoria.find((v: any) => v.tipo === 'TERCO_CONSTITUCIONAL_FERIAS');
    assert.strictEqual(verbaFerias.valor.toNumber(), 3000.00);
    assert.strictEqual(verbaTerco.valor.toNumber(), 1000.00);

    // Competência seguinte: 2024-07 (onde as férias terminam no dia 19)
    const compJulho = abrirOuObterCompetencia(db, rhUser, '2024-07');
    const folhaJulho = calcularFolhaColaborador(db, rhUser, {
      colaboradorId: colab.id,
      competenciaId: compJulho.id,
    });

    // Salário do mês seguinte: (3.000 / 30) * 11 dias trabalhados = 1.100,00
    const verbaSalarioJulho = folhaJulho.memoria.find((v: any) => v.tipo === 'SALARIO_BASE');
    assert.strictEqual(verbaSalarioJulho.valor.toNumber(), 1100.00);
  });

  it('Cenário: Férias com período concessivo vencido exige justificativa (Tabela 7.2)', () => {
    // Admitido em 2023-01-01 -> Aquisitivo vence em 2024-01-01 -> Concessivo vence em 2025-01-01
    // Pedido para 2026-11-10 está com o período concessivo vencido
    const colab = criarColaborador(db, rhUser, {
      filialId: matrizId,
      nome: 'Colaborador Concessivo Vencido',
      cpf: '52998224725',
      nascimento: '1990-01-01',
      admissao: '2023-01-01',
      cargo: 'Atendente',
      setor: 'Geral',
      salarioBase: '3000.00',
      banco: '001',
      agencia: '1234',
      conta: '5678',
    });

    // Sem justificativa: rejeita
    assert.throws(
      () =>
        solicitarFerias(db, rhUser, {
          colaboradorId: colab.id,
          dataInicio: '2026-11-10',
          diasGozo: 30,
          periodoConcessivoFim: '2026-01-01',
        }),
      /Período concessivo vencido. Aprovação de férias vencidas exige justificativa/
    );

    // Com justificativa: aceita e registra
    const ferias = solicitarFerias(db, rhUser, {
      colaboradorId: colab.id,
      dataInicio: '2026-11-10',
      diasGozo: 30,
      periodoConcessivoFim: '2026-01-01',
      justificativa: 'Acordo excepcional para continuidade de projeto crítico.',
    });

    assert.strictEqual(ferias.totalBruto, 4000.00);

    const lista = listarFerias(db, rhUser, { colaboradorId: colab.id });
    assert.strictEqual(lista[0].justificativa, 'Acordo excepcional para continuidade de projeto crítico.');
  });

  // --- CENÁRIOS DE 13º SALÁRIO ---

  it('Cenário: Primeira parcela do 13º (Salário R$ 3.000,00 -> R$ 1.500,00 sem descontos)', () => {
    const colab = criarColaborador(db, rhUser, {
      filialId: matrizId,
      nome: 'Colaborador 13',
      cpf: '52998224725',
      nascimento: '1991-08-10',
      admissao: '2023-01-01',
      cargo: 'Atendente',
      setor: 'Geral',
      salarioBase: '3000.00',
      banco: '001',
      agencia: '1234',
      conta: '5678',
    });

    const res13 = calcularDecimoTerceiro(db, rhUser, {
      colaboradorId: colab.id,
      ano: 2026,
      parcela: 1,
      mesesTrabalhados: 12,
    });

    assert.strictEqual(res13.valorBruto, 1500.00);
    assert.strictEqual(res13.inss, 0);
    assert.strictEqual(res13.irrf, 0);
    assert.strictEqual(res13.liquido, 1500.00);
  });

  it('Cenário: Segunda parcela do 13º com média de variáveis (Exemplo K)', () => {
    const colab = criarColaborador(db, rhUser, {
      filialId: matrizId,
      nome: 'Colaborador 13 K',
      cpf: '52998224725',
      nascimento: '1991-08-10',
      admissao: '2023-01-01',
      cargo: 'Atendente',
      setor: 'Geral',
      salarioBase: '2200.00',
      banco: '001',
      agencia: '1234',
      conta: '5678',
    });

    calcularDecimoTerceiro(db, rhUser, {
      colaboradorId: colab.id,
      ano: 2026,
      parcela: 1,
      mesesTrabalhados: 12,
      mediaHorasExtras: '150.00',
    });

    const res2 = calcularDecimoTerceiro(db, rhUser, {
      colaboradorId: colab.id,
      ano: 2026,
      parcela: 2,
      mesesTrabalhados: 12,
      mediaHorasExtras: '150.00',
    });

    assert.strictEqual(res2.valorTotalDevido, 2350.00);
    assert.strictEqual(res2.descontoPrimeiraParcela, 1175.00);
    assert.strictEqual(res2.inss, 187.19);
    assert.strictEqual(res2.irrf, 0.00);
    assert.strictEqual(res2.liquido, 987.81);
  });

  it('Cenário: 13º proporcional (Admissão em 20/08/2026 dão 4/12 -> R$ 1.000,00)', () => {
    const colab = criarColaborador(db, rhUser, {
      filialId: matrizId,
      nome: 'Iara Costa',
      cpf: '52998224725',
      nascimento: '1994-07-15',
      admissao: '2026-08-20',
      cargo: 'Atendente',
      setor: 'Geral',
      salarioBase: '3000.00',
      banco: '001',
      agencia: '1234',
      conta: '5678',
    });

    const res1 = calcularDecimoTerceiro(db, rhUser, {
      colaboradorId: colab.id,
      ano: 2026,
      parcela: 1,
    });

    assert.strictEqual(res1.mesesTrabalhados, 4);
    assert.strictEqual(res1.valorBruto, 500.00);
  });

  // --- CENÁRIOS DE DOCUMENTOS E ALERTAS ---

  it('Cenário: Alerta de documento a vencer (validade em 25 dias)', () => {
    const colab = criarColaborador(db, rhUser, {
      filialId: matrizId,
      nome: 'Colaborador Doc',
      cpf: '52998224725',
      nascimento: '1990-01-01',
      admissao: '2023-01-01',
      cargo: 'Atendente',
      setor: 'Geral',
      salarioBase: '2000.00',
      banco: '001',
      agencia: '1234',
      conta: '5678',
    });

    anexarDocumento(db, rhUser, {
      colaboradorId: colab.id,
      tipo: 'CNH',
      nomeArquivo: 'cnh_motorista.pdf',
      dataValidade: '2026-10-26',
    });

    const alertas = consultarAlertas(db, rhUser, '2026-10-01');
    const alertaDoc = alertas.find((a) => a.tipo === 'DOCUMENTO_VENCENDO');
    assert.ok(alertaDoc, 'Deve gerar alerta de documento vencendo');
    assert.strictEqual(alertaDoc.diasRestantes, 25);
  });

  it('Cenário: Alerta de exame ocupacional a vencer (RN-53)', () => {
    const colab = criarColaborador(db, rhUser, {
      filialId: matrizId,
      nome: 'Colaborador Exame',
      cpf: '52998224725',
      nascimento: '1990-01-01',
      admissao: '2023-01-01',
      cargo: 'Atendente',
      setor: 'Geral',
      salarioBase: '2000.00',
      banco: '001',
      agencia: '1234',
      conta: '5678',
    });

    // Exame feito há 11 meses e meio -> Vencimento em 15 dias em relação a 2026-10-01
    cadastrarExameOcupacional(db, rhUser, {
      colaboradorId: colab.id,
      tipo: 'Periódico Anual (PCMSO)',
      dataUltimoExame: '2025-10-16',
      periodicidadeMeses: 12,
    });

    const alertas = consultarAlertas(db, rhUser, '2026-10-01');
    const alertaExame = alertas.find((a) => a.tipo === 'EXAME_VENCENDO');
    assert.ok(alertaExame, 'Deve gerar alerta de exame ocupacional vencendo');
    assert.strictEqual(alertaExame.diasRestantes, 15);
  });

  it('Cenário: Alerta de férias com período concessivo a vencer (RN-45)', () => {
    // Admitido em 2024-11-20 -> Aquisitivo venceu em 2025-11-20 -> Concessivo vence em 2026-11-20
    // Em 2026-10-01 faltam 50 dias para o fim do concessivo (alerta nos 60 dias)
    criarColaborador(db, rhUser, {
      filialId: matrizId,
      nome: 'Colaborador Concessivo Próximo',
      cpf: '52998224725',
      nascimento: '1990-01-01',
      admissao: '2024-11-20',
      cargo: 'Atendente',
      setor: 'Geral',
      salarioBase: '2000.00',
      banco: '001',
      agencia: '1234',
      conta: '5678',
    });

    const alertas = consultarAlertas(db, rhUser, '2026-10-01');
    const alertaFerias = alertas.find((a) => a.tipo === 'FERIAS_CONCESSIVO');
    assert.ok(alertaFerias, 'Deve gerar alerta de concessivo de férias a vencer');
    assert.strictEqual(alertaFerias.diasRestantes, 50);
  });

  it('Cenário: Alerta de prazo de pagamento da folha (RN-58)', () => {
    // Competência 2026-10 ainda aberta
    const alertas = consultarAlertas(db, rhUser, '2026-10-01');
    const alertaPrazo = alertas.find((a) => a.tipo === 'PRAZO_PAGAMENTO_FOLHA');
    assert.ok(alertaPrazo, 'Deve alertar se competência não estiver fechada');
  });

  it('Cenário: Dados fora do prazo de guarda (colaborador desligado há mais de 5 anos - LGPD)', () => {
    const colab = criarColaborador(db, rhUser, {
      filialId: matrizId,
      nome: 'Ex Colaborador Antigo',
      cpf: '52998224725',
      nascimento: '1980-01-01',
      admissao: '2015-01-01',
      desligamento: '2020-05-01',
      cargo: 'Atendente',
      setor: 'Geral',
      salarioBase: '2000.00',
      banco: '001',
      agencia: '1234',
      conta: '5678',
    });

    inativarColaborador(db, rhUser, colab.id);

    const alertas = consultarAlertas(db, rhUser, '2026-10-27');
    const alertaLGPD = alertas.find((a) => a.tipo === 'DADOS_FORA_PRAZO_GUARDA');
    assert.ok(alertaLGPD, 'Deve sinalizar colaborador fora do prazo de guarda de 5 anos');
  });

  // --- CENÁRIOS DE CONTRACHEQUE E RELATÓRIOS ---

  it('Cenário: Contracheque em PDF (RN-55 / US-09)', () => {
    const colab = criarColaborador(db, rhUser, {
      filialId: matrizId,
      nome: 'Carlos Oliveira',
      cpf: '52998224725',
      nascimento: '1990-01-01',
      admissao: '2023-01-01',
      cargo: 'Atendente',
      setor: 'Geral',
      salarioBase: '3000.00',
      banco: '001',
      agencia: '1234',
      conta: '5678',
    });

    calcularFolhaColaborador(db, rhUser, { colaboradorId: colab.id, competenciaId });

    // Contracheque estruturado (tela)
    const contracheque = gerarContrachequeEstruturado(db, rhUser, colab.id, competenciaId);
    assert.strictEqual(contracheque.colaborador.nome, 'Carlos Oliveira');
    assert.strictEqual(contracheque.totais.liquido, 2751.40);

    // Contracheque em PDF (RN-55 / US-09)
    const pdfBuffer = gerarContrachequePDF(db, rhUser, colab.id, competenciaId);
    assert.ok(Buffer.isBuffer(pdfBuffer), 'O retorno deve ser um Buffer de PDF');
    assert.strictEqual(pdfBuffer.toString('utf-8', 0, 8), '%PDF-1.4', 'Deve iniciar com cabeçalho PDF-1.4');

    const pdfTexto = pdfBuffer.toString('binary');
    assert.ok(pdfTexto.includes('Carlos Oliveira'), 'PDF deve conter o nome do colaborador');
    assert.ok(pdfTexto.includes('DEMONSTRATIVO DE PAGAMENTO'), 'PDF deve conter título');
    assert.ok(pdfTexto.includes('2751.40'), 'PDF deve conter o valor líquido');
  });

  it('Cenário: Exportar relatorio em Excel e PDF (US-08 / Seção 13)', () => {
    const colab = criarColaborador(db, rhUser, {
      filialId: matrizId,
      nome: 'Colaborador Relatorio',
      cpf: '52998224725',
      nascimento: '1990-01-01',
      admissao: '2023-01-01',
      cargo: 'Atendente',
      setor: 'Geral',
      salarioBase: '3000.00',
      banco: '001',
      agencia: '1234',
      conta: '5678',
    });

    calcularFolhaColaborador(db, rhUser, { colaboradorId: colab.id, competenciaId });

    // Diretor consulta relatório na tela
    const relatorioTela = gerarRelatorioFolhaMes(db, diretorUser, competenciaId);
    assert.strictEqual(relatorioTela.totalColaboradores, 1);
    assert.strictEqual(relatorioTela.totaisGerais.proventos, 3000.00);
    assert.strictEqual(relatorioTela.totaisGerais.descontos, 248.60);
    assert.strictEqual(relatorioTela.totaisGerais.liquido, 2751.40);

    // Exportação em Excel (XML Spreadsheet 2003 nativo)
    const excelBuffer = exportarRelatorioExcel(relatorioTela);
    assert.ok(Buffer.isBuffer(excelBuffer));
    const excelStr = excelBuffer.toString('utf-8');
    assert.ok(excelStr.includes('<Workbook'), 'Arquivo Excel deve conter tag Workbook');
    assert.ok(excelStr.includes('Colaborador Relatorio'), 'Arquivo Excel deve conter nome do colaborador');
    assert.ok(excelStr.includes('3000.00'), 'Arquivo Excel deve conter proventos');
    assert.ok(excelStr.includes('2751.40'), 'Arquivo Excel deve conter líquido');

    // Exportação em Excel formato CSV
    const csvBuffer = exportarRelatorioExcel(relatorioTela, { formato: 'CSV' });
    const csvStr = csvBuffer.toString('utf-8');
    assert.ok(csvStr.includes('3000,00;248,60;2751,40;240,00'));
    assert.ok(csvStr.includes('Colaborador Relatorio'));

    // Exportação do relatório em PDF
    const relatorioPDF = exportarRelatorioPDF(relatorioTela, { usuarioEmail: diretorUser.email });
    assert.ok(Buffer.isBuffer(relatorioPDF));
    assert.strictEqual(relatorioPDF.toString('utf-8', 0, 8), '%PDF-1.4');
    assert.ok(relatorioPDF.toString('binary').includes('Colaborador Relatorio'));
  });

  it('Cenário: Relatório de Dados de Pagamento (RN-57)', () => {
    const colab = criarColaborador(db, rhUser, {
      filialId: matrizId,
      nome: 'Pagamento Teste',
      cpf: '52998224725',
      nascimento: '1990-01-01',
      admissao: '2023-01-01',
      cargo: 'Atendente',
      setor: 'Geral',
      salarioBase: '3000.00',
      banco: '033',
      agencia: '0001',
      conta: '987654',
    });

    calcularFolhaColaborador(db, rhUser, { colaboradorId: colab.id, competenciaId });

    const relatorio = gerarRelatorioDadosPagamento(db, diretorUser, competenciaId);
    assert.strictEqual(relatorio.totalColaboradores, 1);
    assert.strictEqual(relatorio.linhas[0].colaborador, 'Pagamento Teste');
    assert.strictEqual(relatorio.linhas[0].banco, '033');
    assert.strictEqual(relatorio.linhas[0].agencia, '0001');
    assert.strictEqual(relatorio.linhas[0].conta, '987654');
    assert.strictEqual(relatorio.linhas[0].liquido, 2751.40);
  });

  it('Cenário: Relatório de Logs de Auditoria é restrito à Diretoria e Admin (RNF-03 / Seção 13)', () => {
    // RH tenta consultar log -> bloqueado
    assert.throws(
      () => gerarRelatorioLogs(db, rhUser),
      /Você não tem permissão para esta ação/
    );

    // Diretoria consulta log -> sucesso
    const relatorioDir = gerarRelatorioLogs(db, diretorUser);
    assert.ok(Array.isArray(relatorioDir.linhas));
    assert.ok(relatorioDir.totalRegistros >= 1);
  });
});
