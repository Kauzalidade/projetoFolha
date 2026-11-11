/**
 * etapa_v1_7.test.ts - Testes automatizados das Regras e Critérios de Aceite da Especificação v1.7.
 * 
 * Cobre:
 * - RN-78: Salário mínimo vigente (rejeita cadastro e alteração abaixo de R$ 1.621,00)
 * - RN-74: Saldos iniciais da implantação (férias já gozadas, saldo a descontar e competência de início)
 * - RN-80: Atrasos e saídas antecipadas em horas sem perda de DSR
 * - RN-59: Conferência financeira interna completa (tolerância R$ 0,00)
 * - RN-67: Conferência, aprovação e devolução para ajuste
 * - RN-68: Versionamento de folha fechada (V1, V2...) com Hash SHA-256 (RNF-54)
 * - RN-63: Ordem de competências (bloqueia fechamento se anterior estiver aberta)
 * - RN-61: Registro de pagamento pelo RH
 * - RN-79: Férias vencidas pagas em dobro com justificativa
 * - RN-76: Ficha completa do colaborador em PDF por CPF (Direitos do Titular LGPD)
 * - RN-77: Registro e tratamento de incidentes de segurança
 * - RN-84: Alerta de prazos do 13º salário
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { DatabaseSync } from 'node:sqlite';
import { SCHEMA_SQL } from '../src/db.js';
import { criarUsuario } from '../src/services/usuarioService.js';
import { criarFilial } from '../src/services/filialService.js';
import {
  criarColaborador,
  atualizarColaborador,
  consultarColaborador,
} from '../src/services/colaboradorService.js';
import { inicializarFeriadosEParametros } from '../src/services/parametroFeriadoService.js';
import { abrirOuObterCompetencia } from '../src/services/competenciaService.js';
import {
  lancarHorasExtras,
  lancarAtrasoSaidaAntecipada,
} from '../src/services/eventoService.js';
import {
  calcularFolhaColaborador,
  executarConferenciaFinanceira,
  confirmarConferenciaFolha,
  devolverFolhaParaAjuste,
  fecharFolhaSegura,
  registrarPagamentoFolha,
  consultarVersoesFolha,
} from '../src/services/folhaService.js';
import { solicitarFerias, listarFerias } from '../src/services/feriasService.js';
import {
  consultarAlertas,
  registrarIncidenteSeguranca,
  atualizarIncidenteSeguranca,
  listarIncidentesSeguranca,
} from '../src/services/documentosAlertasService.js';
import { gerarFichaColaboradorPDF } from '../src/services/relatoriosService.js';
import { limparTodasSessoes } from '../src/security.js';

describe('ETAPA v1.7: Requisitos e Critérios de Aceite Avançados (RN-59 a RN-85)', () => {
  let db: DatabaseSync;
  const adminUser = { id: 1, email: 'admin@empresa.com', perfil: 'ADMIN' };
  let rhUser: { id: number; email: string; perfil: string };
  let outroRhUser: { id: number; email: string; perfil: string };
  let diretoriaUser: { id: number; email: string; perfil: string };
  let matrizId: number;

  beforeEach(() => {
    limparTodasSessoes();
    db = new DatabaseSync(':memory:');
    db.exec(SCHEMA_SQL);
    inicializarFeriadosEParametros(db);

    const uRH = criarUsuario(db, adminUser, {
      nome: 'Analista RH 1',
      email: 'rh1@empresa.com',
      senha: 'SenhaForte123',
      perfil: 'RH',
    });
    rhUser = { id: uRH.id, email: uRH.email, perfil: 'RH' };

    const uRH2 = criarUsuario(db, adminUser, {
      nome: 'Analista RH 2',
      email: 'rh2@empresa.com',
      senha: 'SenhaForte456',
      perfil: 'RH',
    });
    outroRhUser = { id: uRH2.id, email: uRH2.email, perfil: 'RH' };

    const uDir = criarUsuario(db, adminUser, {
      nome: 'Diretor Geral',
      email: 'diretor@empresa.com',
      senha: 'SenhaDiretoria123',
      perfil: 'DIRETORIA',
    });
    diretoriaUser = { id: uDir.id, email: uDir.email, perfil: 'DIRETORIA' };

    const filial = criarFilial(db, rhUser, { nome: 'Matriz São Paulo', tipo: 'MATRIZ' });
    matrizId = filial.id;
  });

  // --- RN-78: SALÁRIO MÍNIMO VIGENTE ---

  it('Cenário RN-78: Salário-base menor que o salário mínimo vigente (R$ 1.621,00) é rejeitado no cadastro', () => {
    assert.throws(
      () =>
        criarColaborador(db, rhUser, {
          filialId: matrizId,
          nome: 'Colaborador Abaixo Piso',
          cpf: '52998224725',
          nascimento: '1995-01-01',
          admissao: '2026-02-01',
          cargo: 'Auxiliar',
          setor: 'Operações',
          salarioBase: '1500.00', // Menor que 1621.00
          banco: '001',
          agencia: '1234',
          conta: '5678',
        }),
      /O salário-base não pode ser menor que o salário mínimo vigente \(R\$ 1621.00\)/
    );
  });

  it('Cenário RN-78: Alteração de salário para valor abaixo do salário mínimo é rejeitada', () => {
    const colab = criarColaborador(db, rhUser, {
      filialId: matrizId,
      nome: 'Colaborador Piso',
      cpf: '52998224725',
      nascimento: '1995-01-01',
      admissao: '2026-02-01',
      cargo: 'Auxiliar',
      setor: 'Operações',
      salarioBase: '1700.00',
      banco: '001',
      agencia: '1234',
      conta: '5678',
    });

    assert.throws(
      () => atualizarColaborador(db, rhUser, colab.id, { salarioBase: '1400.00' }),
      /O salário-base não pode ser menor que o salário mínimo vigente/
    );
  });

  // --- RN-74: SALDOS INICIAIS DA IMPLANTAÇÃO ---

  it('Cenário RN-74: Cadastro com saldos iniciais de férias e descontos da implantação', () => {
    const colab = criarColaborador(db, rhUser, {
      filialId: matrizId,
      nome: 'Colaborador Migrado',
      cpf: '52998224725',
      nascimento: '1990-03-15',
      admissao: '2022-01-10',
      cargo: 'Analista Sênior',
      setor: 'Financeiro',
      salarioBase: '4000.00',
      banco: '341',
      agencia: '0001',
      conta: '98765',
      titularConta: 'Colaborador Migrado',
      implantacaoFeriasGozadasDias: 15,
      implantacaoSaldoDescontar: '350.00',
      implantacaoCompetenciaInicio: '2026-10',
    });

    assert.strictEqual(colab.implantacaoFeriasGozadasDias, 15);
    assert.strictEqual(colab.implantacaoSaldoDescontar, 350.00);

    const consultado = consultarColaborador(db, rhUser, colab.id);
    assert.ok(consultado.historico.some((h: any) => h.campo === 'saldo_implantacao' && h.valor_novo === '350.00'));
    assert.ok(consultado.historico.some((h: any) => h.campo === 'ferias_gozadas_implantacao' && h.valor_novo === '15'));

    // Verifica que o saldo inicial entrou na tabela saldos_a_descontar
    const saldo = db.prepare('SELECT * FROM saldos_a_descontar WHERE colaborador_id = ?').get(colab.id) as any;
    assert.ok(saldo);
    assert.strictEqual(saldo.origem_tipo, 'IMPLANTACAO');
    assert.strictEqual(saldo.valor_original_centavos, 35000);
  });

  // --- RN-80: ATRASOS E SAÍDAS ANTECIPADAS ---

  it('Cenário RN-80: Atraso lançado em horas desconta valor da hora sem perda de DSR', () => {
    const comp = abrirOuObterCompetencia(db, rhUser, '2026-10');
    const colab = criarColaborador(db, rhUser, {
      filialId: matrizId,
      nome: 'Colaborador Atraso',
      cpf: '52998224725',
      nascimento: '1992-05-10',
      admissao: '2024-01-01',
      cargo: 'Atendente',
      setor: 'Atendimento',
      salarioBase: '2200.00', // 2200 / 220 = R$ 10,00 por hora
      banco: '001',
      agencia: '1234',
      conta: '5678',
    });

    const atraso = lancarAtrasoSaidaAntecipada(db, rhUser, {
      colaboradorId: colab.id,
      competenciaId: comp.id,
      quantidadeHoras: 3,
    });

    // 3h * 10,00 = R$ 30,00 de desconto
    assert.strictEqual(atraso.descontoAtraso, 30.00);
    assert.strictEqual(atraso.perdaDSR, 0); // RN-80: não gera perda de DSR
  });

  // --- RN-59: CONFERÊNCIA FINANCEIRA INTERNA ---

  it('Cenário RN-59: Conferência financeira interna aprova com tolerância R$ 0,00', () => {
    const comp = abrirOuObterCompetencia(db, rhUser, '2026-10');
    const colab = criarColaborador(db, rhUser, {
      filialId: matrizId,
      nome: 'Colaborador Conf',
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

    calcularFolhaColaborador(db, rhUser, { colaboradorId: colab.id, competenciaId: comp.id });

    const conferencia = executarConferenciaFinanceira(db, comp.id);
    assert.strictEqual(conferencia.statusGeral, 'APROVADO');
    assert.strictEqual(conferencia.totalLiquido, 2751.40);
    assert.strictEqual(conferencia.totalProventos, 3000.00);
    assert.strictEqual(conferencia.totalDescontos, 248.60);
    assert.ok(conferencia.itens.every((i) => i.status === 'CONFERE'));
  });

  // --- RN-67: CONFERÊNCIA, APROVAÇÃO E DEVOLUÇÃO PARA AJUSTE ---

  it('Cenário RN-67: Confirmação de conferência e devolução da folha para ajuste', () => {
    const comp = abrirOuObterCompetencia(db, rhUser, '2026-10');
    const colab = criarColaborador(db, rhUser, {
      filialId: matrizId,
      nome: 'Colaborador Ajuste',
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

    calcularFolhaColaborador(db, rhUser, { colaboradorId: colab.id, competenciaId: comp.id });

    // Outro usuário RH confirma a conferência
    const resConf = confirmarConferenciaFolha(db, outroRhUser, comp.id);
    assert.strictEqual(resConf.status, 'CONFERENCIA_CONFIRMADA');

    // Devolução para ajuste pelo RH
    devolverFolhaParaAjuste(db, rhUser, comp.id, 'Horas extras pendentes precisam ser recalculadas');
    const compAtual = db.prepare('SELECT situacao, motivo_devolucao FROM competencias WHERE id = ?').get(comp.id) as any;
    assert.strictEqual(compAtual.situacao, 'ABERTA');
    assert.strictEqual(compAtual.motivo_devolucao, 'Horas extras pendentes precisam ser recalculadas');
  });

  // --- RN-68: VERSÕES DA FOLHA FECHADA COM HASH SHA-256 ---

  it('Cenário RN-68: Fechamento gera versão V1 com hash SHA-256 e V2 após reabertura', () => {
    const comp = abrirOuObterCompetencia(db, rhUser, '2026-10');
    const colab = criarColaborador(db, rhUser, {
      filialId: matrizId,
      nome: 'Colaborador Versao',
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

    calcularFolhaColaborador(db, rhUser, { colaboradorId: colab.id, competenciaId: comp.id });

    // 1º Fechamento: V1
    const resV1 = fecharFolhaSegura(db, rhUser, comp.id);
    assert.strictEqual(resV1.versao, 'V1');
    assert.ok(resV1.hashSha256 && resV1.hashSha256.length === 64, 'Deve gerar hash SHA-256 de 64 caracteres');

    // Reabre e recalcula
    db.prepare("UPDATE competencias SET situacao = 'ABERTA' WHERE id = ?").run(comp.id);
    calcularFolhaColaborador(db, rhUser, { colaboradorId: colab.id, competenciaId: comp.id });

    // 2º Fechamento: V2
    const resV2 = fecharFolhaSegura(db, rhUser, comp.id);
    assert.strictEqual(resV2.versao, 'V2');

    // Consulta histórico de versões
    const versoes = consultarVersoesFolha(db, comp.id);
    assert.strictEqual(versoes.length, 2);
    assert.strictEqual(versoes[0].versao_numero, 'V1');
    assert.strictEqual(versoes[1].versao_numero, 'V2');
  });

  // --- RN-63: ORDEM DAS COMPETÊNCIAS ---

  it('Cenário RN-63: Fechamento de competência com anterior aberta é bloqueado', () => {
    const comp1 = abrirOuObterCompetencia(db, rhUser, '2026-09');
    const comp2 = abrirOuObterCompetencia(db, rhUser, '2026-10');

    const colab = criarColaborador(db, rhUser, {
      filialId: matrizId,
      nome: 'Colaborador Ordem',
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

    calcularFolhaColaborador(db, rhUser, { colaboradorId: colab.id, competenciaId: comp2.id });

    // Tentar fechar comp2 com comp1 aberta
    assert.throws(
      () => fecharFolhaSegura(db, rhUser, comp2.id),
      /a competência anterior \(2026-09\) precisa ser fechada primeiro/
    );
  });

  // --- RN-61: REGISTRO DE PAGAMENTO PELO RH ---

  it('Cenário RN-61: Registro de data de pagamento só é aceito para competência fechada', () => {
    const comp = abrirOuObterCompetencia(db, rhUser, '2026-10');
    const colab = criarColaborador(db, rhUser, {
      filialId: matrizId,
      nome: 'Colaborador Pag',
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

    calcularFolhaColaborador(db, rhUser, { colaboradorId: colab.id, competenciaId: comp.id });

    // Tentar registrar pagamento com folha ainda aberta deve falhar
    assert.throws(
      () => registrarPagamentoFolha(db, rhUser, comp.id, '2026-11-05'),
      /O registro de pagamento só pode ser efetuado para competências fechadas/
    );

    // Fecha a folha
    fecharFolhaSegura(db, rhUser, comp.id);

    // Agora registra pagamento
    const resPag = registrarPagamentoFolha(db, rhUser, comp.id, '2026-11-05');
    assert.strictEqual(resPag.status, 'PAGAMENTO_REGISTRADO');
  });

  // --- RN-79: FÉRIAS VENCIDAS PAGAS EM DOBRO ---

  it('Cenário RN-79: Férias com período concessivo vencido são calculadas em dobro', () => {
    const colab = criarColaborador(db, rhUser, {
      filialId: matrizId,
      nome: 'Colaborador Dobro',
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

    // Férias vencidas: período concessivo encerrou em 2025-01-01
    const res = solicitarFerias(db, rhUser, {
      colaboradorId: colab.id,
      dataInicio: '2026-11-10',
      diasGozo: 30,
      periodoConcessivoFim: '2025-01-01',
      justificativa: 'Férias vencidas aprovadas em caráter excepcional.',
      calcularEmDobro: true,
    });

    assert.strictEqual(res.emDobro, true);
    // Em dobro: 3.000 * 2 = 6.000,00 de férias + 2.000,00 de 1/3 = 8.000,00
    assert.strictEqual(res.valorFerias, 6000.00);
    assert.strictEqual(res.valorTerco, 2000.00);
    assert.strictEqual(res.totalBruto, 8000.00);
  });

  // --- RN-76: FICHA DO COLABORADOR EM PDF POR CPF (LGPD) ---

  it('Cenário RN-76: Geração da Ficha Completa do Colaborador em PDF por CPF', () => {
    const colab = criarColaborador(db, rhUser, {
      filialId: matrizId,
      nome: 'Mariana Duarte',
      cpf: '52998224725',
      nascimento: '1993-04-12',
      admissao: '2022-03-01',
      cargo: 'Supervisora',
      setor: 'Atendimento',
      salarioBase: '3500.00',
      banco: '237',
      agencia: '0001',
      conta: '12345',
      titularConta: 'Mariana Duarte',
      dependentes: [{ nome: 'Lucas Duarte', nascimento: '2018-05-10', parentesco: 'FILHO' }],
    });

    const pdfBuffer = gerarFichaColaboradorPDF(db, rhUser, '52998224725');
    assert.ok(Buffer.isBuffer(pdfBuffer));
    assert.strictEqual(pdfBuffer.toString('utf-8', 0, 8), '%PDF-1.4');

    const pdfStr = pdfBuffer.toString('binary');
    assert.ok(pdfStr.includes('Mariana Duarte'));
    assert.ok(pdfStr.includes('FICHA CADASTRAL COMPLETA'));
    assert.ok(pdfStr.includes('Lucas Duarte'));
  });

  // --- RN-77: REGISTRO E TRATAMENTO DE INCIDENTES DE SEGURANÇA ---

  it('Cenário RN-77: Registro e tratamento de incidentes de segurança com histórico', () => {
    // RH registra incidente
    const inc = registrarIncidenteSeguranca(db, rhUser, {
      descricao: 'Tentativa de phishing detectada em e-mail institucional.',
      dadosAfetados: 'Credenciais de acesso',
      pessoasAfetadas: '1 colaborador da matriz',
      providenciasIniciais: 'Senha alterada e máquina isolada.',
    });

    assert.ok(inc.id > 0);
    assert.strictEqual(inc.situacao, 'ABERTO');

    // Diretoria trata o incidente
    atualizarIncidenteSeguranca(db, diretoriaUser, inc.id, {
      providencias: 'Varredura concluída. Nenhum vazamento consumado.',
      situacao: 'ENCERRADO',
    });

    const lista = listarIncidentesSeguranca(db, diretoriaUser);
    const atualizado = lista.find((i) => i.id === inc.id);
    assert.strictEqual(atualizado.situacao, 'ENCERRADO');
    assert.ok(atualizado.providencias.includes('Varredura concluída'));
  });

  // --- RN-84: ALERTA DE PRAZOS DO 13º SALÁRIO ---

  it('Cenário RN-84: Central de alertas emite aviso 15 dias antes da 1ª e 2ª parcelas do 13º', () => {
    // Em 2026-11-18 faltam 12 dias para 30/11 (1ª parcela)
    const alertas = consultarAlertas(db, rhUser, '2026-11-18');
    const alerta13 = alertas.find((a) => a.tipo === 'DECIMO_TERCEIRO');
    assert.ok(alerta13, 'Deve gerar alerta de proximidade da parcela do 13º salário');
    assert.ok(alerta13.titulo.includes('1ª parcela'));
  });
});
