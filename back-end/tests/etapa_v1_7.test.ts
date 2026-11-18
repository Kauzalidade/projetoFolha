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
import { inicializarFeriadosEParametros, cadastrarParametro } from '../src/services/parametroFeriadoService.js';
import { abrirOuObterCompetencia, reabrirCompetencia } from '../src/services/competenciaService.js';
import { consultarLogs, registrarOperacaoCritica } from '../src/services/logService.js';
import {
  lancarHorasExtras,
  lancarAtrasoSaidaAntecipada,
} from '../src/services/eventoService.js';
import {
  calcularFolhaColaborador,
  calcularFolhaCompetenciaLote,
  executarConferenciaFinanceira,
  confirmarConferenciaFolha,
  devolverFolhaParaAjuste,
  fecharFolhaSegura,
  registrarPagamentoFolha,
  consultarVersoesFolha,
  consultarTrilhaAprovacaoCompetencia,
  obterDetalheVersaoFolha,
} from '../src/services/folhaService.js';
import { solicitarFerias, listarFerias } from '../src/services/feriasService.js';
import {
  consultarAlertas,
  registrarIncidenteSeguranca,
  atualizarIncidenteSeguranca,
  listarIncidentesSeguranca,
} from '../src/services/documentosAlertasService.js';
import {
  gerarContrachequeEstruturado,
  gerarContrachequePDF,
  gerarFichaColaboradorPDF,
  gerarRelatorioFolhaMes,
  gerarRelatorioDadosPagamento,
  gerarRelatorioConferencia,
  gerarRelatorioConferenciaPDF,
  exportarRelatorioPDF,
  exportarRelatorioExcel,
} from '../src/services/relatoriosService.js';
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
    assert.strictEqual(resPag.dataPagamento, '2026-11-05');

    // RN-61: Tentativa de correção sem justificativa deve ser rejeitada
    assert.throws(
      () => registrarPagamentoFolha(db, rhUser, comp.id, '2026-11-06'),
      /A correção da data de pagamento exige justificativa obrigatória/
    );
    assert.throws(
      () => registrarPagamentoFolha(db, rhUser, comp.id, '2026-11-06', '   '),
      /A correção da data de pagamento exige justificativa obrigatória/
    );

    // RN-61: Correção com justificativa válida é aceita e preserva valor anterior
    const resCorrigido = registrarPagamentoFolha(
      db,
      rhUser,
      comp.id,
      '2026-11-06',
      'Ajuste conforme comprovante bancário da compensação TED'
    );
    assert.strictEqual(resCorrigido.status, 'PAGAMENTO_CORRIGIDO');
    assert.strictEqual(resCorrigido.dataAnterior, '2026-11-05');
    assert.strictEqual(resCorrigido.dataPagamento, '2026-11-06');

    // Valida log imutável da correção
    const logs = consultarLogs(db, diretoriaUser, { entidade: 'COMPETENCIA', registroId: comp.id });
    const logCorrecao = logs.find((l: any) => l.acao === 'CORRIGIR_PAGAMENTO_FOLHA');
    assert.ok(logCorrecao, 'Deve gerar log imutável de correção com ação CORRIGIR_PAGAMENTO_FOLHA');
    assert.strictEqual(logCorrecao.valor_anterior, '2026-11-05');
    assert.strictEqual(logCorrecao.valor_novo, '2026-11-06');
    assert.ok(logCorrecao.detalhes.includes('comprovante bancário'));
  });

  it('Cenário US-14 / RN-58: Registro de pagamento encerra alerta de prazo da folha', () => {
    const compAlerta = abrirOuObterCompetencia(db, rhUser, '2026-09');
    const colab = criarColaborador(db, rhUser, {
      filialId: matrizId,
      nome: 'Colab Prazo',
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

    calcularFolhaColaborador(db, rhUser, { colaboradorId: colab.id, competenciaId: compAlerta.id });
    fecharFolhaSegura(db, rhUser, compAlerta.id);

    // Folha fechada mas sem pagamento registrado -> Alerta ativo
    const alertasAntes = consultarAlertas(db, rhUser, '2026-10-03');
    const alertaAntes = alertasAntes.find((a) => a.referenciaId === compAlerta.id && a.tipo === 'PRAZO_PAGAMENTO_FOLHA');
    assert.ok(alertaAntes, 'Deve exibir alerta de prazo enquanto não houver pagamento registrado');

    // RH registra a data do pagamento
    registrarPagamentoFolha(db, rhUser, compAlerta.id, '2026-10-05');

    // Agora o alerta de prazo deve sumir
    const alertasDepois = consultarAlertas(db, rhUser, '2026-10-03');
    const alertaDepois = alertasDepois.find((a) => a.referenciaId === compAlerta.id && a.tipo === 'PRAZO_PAGAMENTO_FOLHA');
    assert.strictEqual(alertaDepois, undefined, 'Registro de pagamento deve encerrar o alerta de prazo');
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

  // --- US-07 / RN-71 / RN-75: RASTREAMENTO, LOGS IMUTÁVEIS E OPERAÇÕES CRÍTICAS ---

  it('Cenário RN-75: Parâmetro legal cadastrado com fonte, vigência, responsável e log de auditoria', () => {
    cadastrarParametro(db, rhUser, {
      nome: 'auxilio_creche_convencao',
      valor: '450.00',
      dataInicio: '2026-01-01',
      dataFim: '2026-12-31',
      versao: '2.0',
      fonte: 'Convenção Coletiva 2026 Cláusula 18',
    });

    const paramBanco = db.prepare("SELECT * FROM parametros WHERE nome = 'auxilio_creche_convencao'").get() as any;
    assert.ok(paramBanco, 'Parâmetro deve ser gravado no banco');
    assert.strictEqual(paramBanco.fonte, 'Convenção Coletiva 2026 Cláusula 18');
    assert.strictEqual(paramBanco.data_inicio, '2026-01-01');

    const logs = consultarLogs(db, diretoriaUser, { entidade: 'PARAMETRO' });
    const logParam = logs.find((l) => l.detalhes?.includes('auxilio_creche_convencao'));
    assert.ok(logParam, 'Alteração do parâmetro deve ser registrada no log de auditoria');
    assert.ok(logParam.detalhes.includes('Convenção Coletiva 2026 Cláusula 18'));
    assert.ok(logParam.detalhes.includes(rhUser.email));
  });

  it('Cenário RN-71: Operações críticas registradas com identificador e resultado (concluída, cancelada ou pendente)', () => {
    // 1. Cálculo concluído com sucesso
    registrarOperacaoCritica(db, {
      operacaoId: 'OP-CALC-2026-10-001',
      tipo: 'CALCULO',
      competencia: '2026-10',
      usuario: rhUser,
      resultado: 'CONCLUIDA',
      tempoExecucaoMs: 1420,
      detalhes: 'Cálculo de 15 colaboradores finalizado sem inconsistências.',
    });

    // 2. Operação interrompida por falha que volta a ser cancelada (RN-71)
    registrarOperacaoCritica(db, {
      operacaoId: 'OP-CALC-2026-10-002',
      tipo: 'CALCULO',
      competencia: '2026-10',
      usuario: rhUser,
      resultado: 'CANCELADA',
      tempoExecucaoMs: 450,
      detalhes: 'Operação cancelada após interrupção. Folha revertida com integridade mantida.',
    });

    const logs = consultarLogs(db, diretoriaUser, { entidade: 'OPERACAO_CRITICA' });
    assert.ok(logs.length >= 2, 'Devem existir as operações críticas registradas');

    const opSucesso = logs.find((l) => l.registro_id === 'OP-CALC-2026-10-001');
    assert.ok(opSucesso);
    assert.strictEqual(opSucesso.valor_novo, 'CONCLUIDA');
    assert.ok(opSucesso.detalhes.includes('1420ms'));

    const opCancelada = logs.find((l) => l.registro_id === 'OP-CALC-2026-10-002');
    assert.ok(opCancelada);
    assert.strictEqual(opCancelada.valor_novo, 'CANCELADA');
  });

  it('Cenário US-07: Diretoria e Admin consultam log de auditoria, mas Admin não acessa dados da folha', () => {
    // Diretoria consulta logs
    const logsDiretoria = consultarLogs(db, diretoriaUser);
    assert.ok(logsDiretoria.length > 0, 'Diretoria deve conseguir consultar logs');

    // Admin consulta logs
    const logsAdmin = consultarLogs(db, adminUser);
    assert.ok(logsAdmin.length > 0, 'Admin deve conseguir consultar logs');

    // Colaborador de teste
    const colab = criarColaborador(db, rhUser, {
      filialId: matrizId,
      nome: 'Funcionario Sigiloso',
      cpf: '52998224725',
      nascimento: '1985-05-10',
      admissao: '2024-01-01',
      cargo: 'Tesoureiro',
      setor: 'Financeiro',
      salarioBase: '6000.00',
      banco: '001',
      agencia: '1234',
      conta: '5678',
    });

    // Admin NÃO pode consultar dados da folha/colaborador
    assert.throws(
      () => consultarColaborador(db, adminUser, colab.id),
      { message: 'Você não tem permissão para acessar os dados deste colaborador.' }
    );
  });

  // --- US-08: CONSULTA E EXPORTAÇÃO DE RELATÓRIOS CONFIÁVEIS PELA DIRETORIA ---

  it('Cenário US-08 / RN-68: Relatório Folha do Mês exibe os mesmos valores e versão quando fechada (V1)', () => {
    // 1. Cria colaborador e calcula folha
    const colab = criarColaborador(db, rhUser, {
      filialId: matrizId,
      nome: 'Diretoria Relatorio Colab',
      cpf: '52998224725',
      nascimento: '1988-04-12',
      admissao: '2023-01-01',
      cargo: 'Analista Financeiro',
      setor: 'Financeiro',
      salarioBase: '4000.00',
      banco: '237',
      agencia: '1234',
      conta: '56789',
    });

    const comp = abrirOuObterCompetencia(db, rhUser, '2026-05');
    calcularFolhaColaborador(db, rhUser, { colaboradorId: colab.id, competenciaId: comp.id });
    confirmarConferenciaFolha(db, rhUser, comp.id, 'Conferência confirmada pelo analista');
    fecharFolhaSegura(db, rhUser, comp.id);

    // 2. Diretoria gera o relatório da folha do mês
    const relFolha = gerarRelatorioFolhaMes(db, diretoriaUser, comp.id);
    assert.strictEqual(relFolha.situacao, 'FECHADA');
    assert.strictEqual(relFolha.versao, 'V1');
    assert.ok(relFolha.hashSha256, 'Deve conter hash SHA-256');
    assert.strictEqual(relFolha.totalColaboradores, 1);
    assert.strictEqual(relFolha.totaisGerais.proventos, 4000.00);

    // 3. Exporta para PDF e Excel
    const pdf = exportarRelatorioPDF(relFolha, { usuarioEmail: diretoriaUser.email });
    assert.ok(pdf.toString('utf-8', 0, 4) === '%PDF');

    const excel = exportarRelatorioExcel(relFolha);
    assert.ok(excel.toString('utf-8').includes('Relatório da Folha do Mês (V1)'));
  });

  it('Cenário US-08 / RN-60: Relatório Dados de Pagamento exige competência fechada e total igual à soma dos líquidos', () => {
    const compAberta = abrirOuObterCompetencia(db, rhUser, '2026-06');

    // Tentativa em competência aberta com validação ativada (RN-60)
    assert.throws(
      () => gerarRelatorioDadosPagamento(db, diretoriaUser, compAberta.id, undefined, { exigirFechada: true }),
      /O relatório Dados de Pagamento só pode ser gerado para competências fechadas/
    );

    // Competência fechada
    const colab = criarColaborador(db, rhUser, {
      filialId: matrizId,
      nome: 'Colab Pagamento Teste',
      cpf: '52998224725',
      nascimento: '1992-02-15',
      admissao: '2023-01-01',
      cargo: 'Assistente',
      setor: 'Operações',
      salarioBase: '3000.00',
      banco: '001',
      agencia: '4321',
      conta: '9876',
    });

    calcularFolhaColaborador(db, rhUser, { colaboradorId: colab.id, competenciaId: compAberta.id });
    confirmarConferenciaFolha(db, rhUser, compAberta.id, 'Conferência confirmada pelo analista');
    fecharFolhaSegura(db, rhUser, compAberta.id);

    const relPag = gerarRelatorioDadosPagamento(db, diretoriaUser, compAberta.id, undefined, { exigirFechada: true });
    assert.strictEqual(relPag.situacao, 'FECHADA');

    // Total do lote é exatamente igual à soma dos líquidos
    const somaLinhas = relPag.linhas.reduce((acc: number, l: any) => acc + l.liquido, 0);
    assert.strictEqual(relPag.totalLiquido, Math.round(somaLinhas * 100) / 100);
    assert.strictEqual(relPag.linhas[0].banco, '001');
    assert.strictEqual(relPag.linhas[0].agencia, '4321');
    assert.strictEqual(relPag.linhas[0].conta, '9876');
  });

  it('Cenário US-08 / RN-73: Relatório de Conferência em PDF lista pendências críticas com colaborador e item', () => {
    const compPend = abrirOuObterCompetencia(db, rhUser, '2026-07');

    // Cria colaborador e remove conta para gerar pendência bancária (RN-73)
    const colabSemConta = criarColaborador(db, rhUser, {
      filialId: matrizId,
      nome: 'Sem Conta Bancaria',
      cpf: '52998224725',
      nascimento: '1990-01-01',
      admissao: '2023-01-01',
      cargo: 'Operador',
      setor: 'Geral',
      salarioBase: '2500.00',
      banco: '001',
      agencia: '1234',
      conta: '5678',
    });
    db.prepare("UPDATE colaboradores SET conta = '' WHERE id = ?").run(colabSemConta.id);

    const relConf = gerarRelatorioConferencia(db, diretoriaUser, compPend.id);
    assert.strictEqual(relConf.aptoParaFechamento, false);
    assert.ok(relConf.totalPendencias > 0);

    const pendBanco = relConf.pendencias.find((p: any) => p.item.includes('banco'));
    assert.ok(pendBanco, 'Deve identificar dados bancários ausentes');
    assert.strictEqual(pendBanco.colaborador, 'Sem Conta Bancaria');

    // Emite PDF de conferência (RN-73)
    const pdfConf = gerarRelatorioConferenciaPDF(db, diretoriaUser, compPend.id);
    assert.ok(pdfConf.toString('utf-8', 0, 4) === '%PDF');
    assert.ok(pdfConf.length > 500);
  });

  it('Cenário US-08 / Tabela 4.1: Diretoria consulta relatórios, mas não pode fechar folha nem lançar eventos', () => {
    const comp = abrirOuObterCompetencia(db, rhUser, '2026-08');

    // Diretoria consulta folha
    const rel = gerarRelatorioFolhaMes(db, diretoriaUser, comp.id);
    assert.ok(rel.titulo.includes('Folha do Mês'));

    // Diretoria tentando fechar folha -> Bloqueio total
    assert.throws(
      () => fecharFolhaSegura(db, diretoriaUser, comp.id),
      /Você não tem permissão para esta ação/
    );
  });

  // --- US-09 / RN-55 / RN-68: GERAÇÃO DE CONTRACHEQUE EM PDF POR COLABORADOR E COMPETÊNCIA ---

  it('Cenário US-09 / RN-55: Contracheque em PDF apresenta proventos, descontos, líquido e memória resumida', () => {
    const comp = abrirOuObterCompetencia(db, rhUser, '2026-09');
    const colab = criarColaborador(db, rhUser, {
      filialId: matrizId,
      nome: 'Juliana Costa',
      cpf: '52998224725',
      nascimento: '1992-04-10',
      admissao: '2023-03-01',
      cargo: 'Analista Financeiro',
      setor: 'Controladoria',
      salarioBase: '4000.00',
      banco: '237',
      agencia: '1122',
      conta: '334456',
    });

    calcularFolhaColaborador(db, rhUser, { colaboradorId: colab.id, competenciaId: comp.id });

    // Contracheque estruturado com memória resumida (RN-55)
    const dados = gerarContrachequeEstruturado(db, rhUser, colab.id, comp.id);
    assert.strictEqual(dados.colaborador.nome, 'Juliana Costa');
    assert.strictEqual(dados.totais.totalProventos, 4000.00);
    assert.ok(dados.totais.totalDescontos > 0);
    assert.ok(dados.totais.liquido > 0);
    assert.strictEqual(dados.totais.liquido, dados.totais.totalProventos - dados.totais.totalDescontos);

    // Valida memória resumida em cada verba
    const inssVerba = dados.verbas.find((v: any) => v.descricao.includes('INSS'));
    assert.ok(inssVerba, 'Deve conter verba de desconto do INSS');
    assert.ok(inssVerba.memoriaResumida, 'Deve conter memória resumida com alíquotas e faixas');

    // Emissão do PDF (RN-55)
    const pdfBuf = gerarContrachequePDF(db, rhUser, colab.id, comp.id);
    assert.strictEqual(pdfBuf.toString('utf-8', 0, 8), '%PDF-1.4');

    const pdfTexto = pdfBuf.toString('binary');
    assert.ok(pdfTexto.includes('Juliana Costa'));
    assert.ok(pdfTexto.includes('DEMONSTRATIVO DE PAGAMENTO'));
    assert.ok(pdfTexto.includes('VALOR LIQUIDO A RECEBER'));
    assert.ok(pdfTexto.includes('Regra/Memoria:'));
  });

  it('Cenário US-09 / RN-68: Contracheque emitido a partir de folha fechada preserva valores e versão (V1/V2)', () => {
    const compFechada = abrirOuObterCompetencia(db, rhUser, '2026-10');
    const colab = criarColaborador(db, rhUser, {
      filialId: matrizId,
      nome: 'Roberto Firmino',
      cpf: '52998224725',
      nascimento: '1989-10-02',
      admissao: '2022-01-15',
      cargo: 'Gerente Operacional',
      setor: 'Operações',
      salarioBase: '7000.00',
      banco: '033',
      agencia: '0099',
      conta: '887765',
    });

    calcularFolhaColaborador(db, rhUser, { colaboradorId: colab.id, competenciaId: compFechada.id });
    confirmarConferenciaFolha(db, rhUser, compFechada.id, 'Conferência pré-fechamento OK');
    fecharFolhaSegura(db, rhUser, compFechada.id);

    const dados = gerarContrachequeEstruturado(db, rhUser, colab.id, compFechada.id);
    assert.strictEqual(dados.cabecalho.versao, 'V1', 'Contracheque de folha fechada deve exibir versão V1 (RN-68)');
    assert.ok(dados.cabecalho.hashSha256, 'Deve conter hash SHA-256 criptográfico da folha');

    const pdfBuf = gerarContrachequePDF(db, rhUser, colab.id, compFechada.id);
    const pdfTexto = pdfBuf.toString('binary');
    assert.ok(pdfTexto.includes('Versao: V1'), 'PDF deve indicar explicitamente a versão da folha fechada');
    assert.ok(pdfTexto.includes('Hash SHA-256'), 'PDF deve conter identificador criptográfico do fechamento');
  });

  it('Cenário US-09: Contracheque consulta dados da competência e não altera a folha (somente leitura)', () => {
    const comp = abrirOuObterCompetencia(db, rhUser, '2026-11');
    const colab = criarColaborador(db, rhUser, {
      filialId: matrizId,
      nome: 'Aline Barros',
      cpf: '52998224725',
      nascimento: '1995-07-20',
      admissao: '2024-05-10',
      cargo: 'Supervisora',
      setor: 'Atendimento',
      salarioBase: '3500.00',
      banco: '104',
      agencia: '0101',
      conta: '123456',
    });

    calcularFolhaColaborador(db, rhUser, { colaboradorId: colab.id, competenciaId: comp.id });

    // Snapshot antes de gerar contracheque
    const folhaAntes = db.prepare('SELECT * FROM folhas WHERE colaborador_id = ? AND competencia_id = ?').get(colab.id, comp.id) as any;
    const qtdVerbasAntes = (db.prepare('SELECT COUNT(*) as count FROM folha_verbas WHERE folha_id = ?').get(folhaAntes.id) as any).count;

    // Gera PDF e estruturado múltiplas vezes
    gerarContrachequeEstruturado(db, rhUser, colab.id, comp.id);
    gerarContrachequePDF(db, rhUser, colab.id, comp.id);
    gerarContrachequePDF(db, rhUser, colab.id, comp.id);

    // Valida que nada foi alterado na folha
    const folhaDepois = db.prepare('SELECT * FROM folhas WHERE colaborador_id = ? AND competencia_id = ?').get(colab.id, comp.id) as any;
    const qtdVerbasDepois = (db.prepare('SELECT COUNT(*) as count FROM folha_verbas WHERE folha_id = ?').get(folhaDepois.id) as any).count;

    assert.strictEqual(folhaAntes.liquido_centavos, folhaDepois.liquido_centavos);
    assert.strictEqual(folhaAntes.total_proventos_centavos, folhaDepois.total_proventos_centavos);
    assert.strictEqual(folhaAntes.total_descontos_centavos, folhaDepois.total_descontos_centavos);
    assert.strictEqual(qtdVerbasAntes, qtdVerbasDepois);
  });

  it('Cenário US-09 / Tabela 4.1: Acesso de RH e consulta da Diretoria; Admin é bloqueado', () => {
    const comp = abrirOuObterCompetencia(db, rhUser, '2026-12');
    const colab = criarColaborador(db, rhUser, {
      filialId: matrizId,
      nome: 'Patricia Leite',
      cpf: '52998224725',
      nascimento: '1991-12-12',
      admissao: '2023-08-01',
      cargo: 'Assistente',
      setor: 'Administrativo',
      salarioBase: '2400.00',
      banco: '341',
      agencia: '0222',
      conta: '998871',
    });

    calcularFolhaColaborador(db, rhUser, { colaboradorId: colab.id, competenciaId: comp.id });

    // RH acessa com sucesso
    const pdfRH = gerarContrachequePDF(db, rhUser, colab.id, comp.id);
    assert.ok(pdfRH.length > 500);

    // Diretoria consulta com sucesso (Tabela 4.1: Contracheques - Sim (consulta))
    const pdfDiretoria = gerarContrachequePDF(db, diretoriaUser, colab.id, comp.id);
    assert.ok(pdfDiretoria.length > 500);

    // Admin é bloqueado (Tabela 4.1: Contracheques - Não)
    assert.throws(
      () => gerarContrachequePDF(db, adminUser, colab.id, comp.id),
      /Você não tem permissão para esta ação/
    );
    assert.throws(
      () => gerarContrachequeEstruturado(db, adminUser, colab.id, comp.id),
      /Você não tem permissão para esta ação/
    );
  });

  // --- US-15 / RN-64, RN-65, RN-71, RNF-22 a RNF-25: OPERAÇÕES CONCLUÍDAS POR INTEIRO, ATOMICIDADE, ANTI-DUPLICIDADE E CONCORRÊNCIA ---

  it('Cenário US-15 / RN-64: Cálculo atômico da folha em lote desfaz tudo em caso de falha em colaborador e lista motivos', () => {
    const comp = abrirOuObterCompetencia(db, rhUser, '2027-01');
    const colab1 = criarColaborador(db, rhUser, {
      filialId: matrizId,
      nome: 'Colab Valido 1',
      cpf: '52998224725',
      nascimento: '1990-01-01',
      admissao: '2024-01-01',
      cargo: 'Analista',
      setor: 'TI',
      salarioBase: '3000.00',
      banco: '001',
      agencia: '1234',
      conta: '567890',
    });

    const colab2 = criarColaborador(db, rhUser, {
      filialId: matrizId,
      nome: 'Colab Valido 2',
      cpf: '01234567890',
      cpfValidoIgnorar: true,
      nascimento: '1992-02-02',
      admissao: '2024-01-01',
      cargo: 'Assistente',
      setor: 'TI',
      salarioBase: '2500.00',
      banco: '237',
      agencia: '4321',
      conta: '987654',
    });

    // Colaborador com salário-base zerado/corrompido no banco para forçar erro no cálculo
    const colabInvalido = criarColaborador(db, rhUser, {
      filialId: matrizId,
      nome: 'Colab Com Falha',
      cpf: '11122233344',
      cpfValidoIgnorar: true,
      nascimento: '1985-05-05',
      admissao: '2024-01-01',
      cargo: 'Operador',
      setor: 'Produção',
      salarioBase: '2000.00',
      banco: '341',
      agencia: '0001',
      conta: '112233',
    });
    db.prepare('UPDATE colaboradores SET salario_base_centavos = -100 WHERE id = ?').run(colabInvalido.id);

    // Executa cálculo em lote (RN-64)
    const resultado = calcularFolhaCompetenciaLote(db, rhUser, { competenciaId: comp.id });

    // Deve informar falha, não concluir e listar colaborador e motivo (RN-64 e RNF-23)
    assert.strictEqual(resultado.sucesso, false);
    assert.strictEqual(resultado.concluida, false);
    assert.ok(resultado.falhas.length > 0, 'Deve listar as falhas encontradas');
    assert.ok(resultado.falhas.some((f) => f.colaboradorNome === 'Colab Com Falha'));
    assert.ok(resultado.mensagem.includes('A folha mantém o resultado anterior'));

    // Atomicidade: NENHUMA folha pode ter sido persistida para esta competência (RN-64)
    const folhasGravadas = db.prepare('SELECT COUNT(*) as total FROM folhas WHERE competencia_id = ?').get(comp.id) as any;
    assert.strictEqual(folhasGravadas.total, 0, 'Nenhum dado parcial pode ficar salvo em caso de falha');

    // Competência continua na situação anterior (ABERTA)
    const compVerif = db.prepare('SELECT situacao, em_processamento FROM competencias WHERE id = ?').get(comp.id) as any;
    assert.strictEqual(compVerif.situacao, 'ABERTA');
    assert.strictEqual(compVerif.em_processamento, 0);

    // Verifica log de operação crítica cancelada (RN-71 / RNF-39)
    const logs = db.prepare("SELECT * FROM logs_auditoria WHERE acao = 'OPERACAO_CALCULO' AND valor_novo = 'CANCELADA'").all() as any[];
    assert.ok(logs.length > 0, 'Deve registrar operação crítica cancelada no log');
  });

  it('Cenário US-15 / RN-64: Cálculo em lote concluído com sucesso comita todas as folhas e grava log', () => {
    const comp = abrirOuObterCompetencia(db, rhUser, '2027-02');
    const colab = criarColaborador(db, rhUser, {
      filialId: matrizId,
      nome: 'Sucesso Total',
      cpf: '52998224725',
      nascimento: '1993-03-03',
      admissao: '2024-01-01',
      cargo: 'Engenheiro',
      setor: 'Engenharia',
      salarioBase: '5000.00',
      banco: '001',
      agencia: '1234',
      conta: '998877',
    });

    // Inativa colaboradores inválidos de outros testes para garantir lote 100% limpo
    db.prepare("UPDATE colaboradores SET situacao = 'INATIVO' WHERE id != ?").run(colab.id);

    const resultado = calcularFolhaCompetenciaLote(db, rhUser, { competenciaId: comp.id });

    assert.strictEqual(resultado.sucesso, true);
    assert.strictEqual(resultado.concluida, true);
    assert.strictEqual(resultado.falhas.length, 0);
    assert.strictEqual(resultado.totalCalculados, 1);
    assert.ok(resultado.mensagem.includes('Operação concluída com sucesso'));

    // Competência atualizada para CALCULADA
    const compVerif = db.prepare('SELECT situacao, em_processamento FROM competencias WHERE id = ?').get(comp.id) as any;
    assert.strictEqual(compVerif.situacao, 'CALCULADA');
    assert.strictEqual(compVerif.em_processamento, 0);

    // Log de operação crítica CONCLUIDA gravado
    const logs = db.prepare("SELECT * FROM logs_auditoria WHERE acao = 'OPERACAO_CALCULO' AND valor_novo = 'CONCLUIDA'").all() as any[];
    assert.ok(logs.length > 0);
  });

  it('Cenário US-15 / RN-65 & RN-71: Duplo clique no fechamento da folha não duplica registros nem gera versão extra', () => {
    const comp = abrirOuObterCompetencia(db, rhUser, '2027-03');
    const colab = criarColaborador(db, rhUser, {
      filialId: matrizId,
      nome: 'Idempotente Colab',
      cpf: '52998224725',
      nascimento: '1990-09-09',
      admissao: '2024-01-01',
      cargo: 'Auditor',
      setor: 'Compliance',
      salarioBase: '4500.00',
      banco: '237',
      agencia: '0001',
      conta: '556677',
    });
    db.prepare("UPDATE colaboradores SET situacao = 'INATIVO' WHERE id != ?").run(colab.id);

    calcularFolhaColaborador(db, rhUser, { colaboradorId: colab.id, competenciaId: comp.id });
    confirmarConferenciaFolha(db, rhUser, comp.id, 'Conferência OK');

    // 1º Clique em Fechar
    const fechamento1 = fecharFolhaSegura(db, rhUser, comp.id);
    assert.strictEqual(fechamento1.versao, 'V1');

    // 2º Clique em Fechar (Duplo clique imediato do usuário / rede)
    const fechamento2 = fecharFolhaSegura(db, rhUser, comp.id);
    assert.strictEqual(fechamento2.versao, 'V1');
    assert.strictEqual(fechamento2.duploCliqueIgnorado, true);

    // Valida que existe APENAS 1 versão V1 gravada
    const totalVersoes = db.prepare('SELECT COUNT(*) as total FROM folha_versoes WHERE competencia_id = ?').get(comp.id) as any;
    assert.strictEqual(totalVersoes.total, 1, 'Duplo clique não pode gerar duas versões');

    // Valida que existe APENAS 1 log de fechamento
    const logsFechamento = db.prepare(`
      SELECT COUNT(*) as total FROM logs_auditoria
      WHERE acao = 'FECHAR_FOLHA_COMPETENCIA' AND registro_id = ?
    `).get(String(comp.id)) as any;
    assert.strictEqual(logsFechamento.total, 1, 'Duplo clique deve gerar apenas 1 registro no log imutável');
  });

  it('Cenário US-15 / RN-65: Lançamento de evento duplicado exige confirmação do RH', () => {
    const comp = abrirOuObterCompetencia(db, rhUser, '2027-04');
    const colab = criarColaborador(db, rhUser, {
      filialId: matrizId,
      nome: 'Eventos Colab',
      cpf: '52998224725',
      nascimento: '1995-05-15',
      admissao: '2024-01-01',
      cargo: 'Técnico',
      setor: 'Suporte',
      salarioBase: '3000.00',
      banco: '104',
      agencia: '1111',
      conta: '223344',
    });

    // 1º Lançamento de hora extra
    const ev1 = lancarHorasExtras(db, rhUser, {
      colaboradorId: colab.id,
      competenciaId: comp.id,
      tipo: 'UTIL',
      quantidadeHoras: 2,
      data: '2027-04-10',
    });
    assert.ok(ev1.id > 0);

    // 2º Lançamento exatamente igual sem confirmação -> Rejeição por aviso de duplicidade (RN-65)
    assert.throws(
      () =>
        lancarHorasExtras(db, rhUser, {
          colaboradorId: colab.id,
          competenciaId: comp.id,
          tipo: 'UTIL',
          quantidadeHoras: 2,
          data: '2027-04-10',
          confirmarDuplicidade: false,
        }),
      /Aviso de possível duplicidade: este evento já foi lançado para o colaborador/
    );

    // 3º Lançamento igual com confirmação explícita do RH -> Grava com sucesso (RN-65)
    const ev2 = lancarHorasExtras(db, rhUser, {
      colaboradorId: colab.id,
      competenciaId: comp.id,
      tipo: 'UTIL',
      quantidadeHoras: 2,
      data: '2027-04-10',
      confirmarDuplicidade: true,
    });
    assert.ok(ev2.id > 0);
    assert.notStrictEqual(ev1.id, ev2.id);
  });

  it('Cenário US-15 / RNF-24: Reenvio de formulário de cadastro de colaborador não duplica registros', () => {
    const colab1 = criarColaborador(db, rhUser, {
      filialId: matrizId,
      nome: 'Colab Reenvio',
      cpf: '52998224725',
      nascimento: '1991-07-07',
      admissao: '2024-01-01',
      cargo: 'Especialista',
      setor: 'Projetos',
      salarioBase: '6000.00',
      banco: '033',
      agencia: '0010',
      conta: '990011',
      permitirReenvioIdempotente: true,
    });

    assert.ok(colab1.id > 0);

    // Segundo clique imediato em "Salvar" com a mesma requisição
    const colab2 = criarColaborador(db, rhUser, {
      filialId: matrizId,
      nome: 'Colab Reenvio',
      cpf: '52998224725',
      nascimento: '1991-07-07',
      admissao: '2024-01-01',
      cargo: 'Especialista',
      setor: 'Projetos',
      salarioBase: '6000.00',
      banco: '033',
      agencia: '0010',
      conta: '990011',
      permitirReenvioIdempotente: true,
    });

    assert.strictEqual(colab1.id, colab2.id, 'Deve retornar o mesmo identificador sem duplicar');
    assert.strictEqual(colab2.duplicadoEvitado, true);

    // Valida que existe apenas um colaborador no banco com este CPF
    const qtdColabs = db.prepare("SELECT COUNT(*) as total FROM colaboradores WHERE cpf = '52998224725'").get() as any;
    assert.strictEqual(qtdColabs.total, 1, 'Existe apenas um colaborador cadastrado com aquele CPF');
  });

  it('Cenário US-15 / RN-71: Competência em processamento bloqueia edição concorrente', () => {
    const comp = abrirOuObterCompetencia(db, rhUser, '2027-05');
    const colab = criarColaborador(db, rhUser, {
      filialId: matrizId,
      nome: 'Bloqueio Colab',
      cpf: '52998224725',
      nascimento: '1992-08-08',
      admissao: '2024-01-01',
      cargo: 'Auxiliar',
      setor: 'Financeiro',
      salarioBase: '2200.00',
      banco: '001',
      agencia: '1234',
      conta: '445566',
    });

    // Simula bloqueio de operação concorrente em andamento (RN-71)
    db.prepare('UPDATE competencias SET em_processamento = 1 WHERE id = ?').run(comp.id);

    // Tentativa de calcular bloqueada
    assert.throws(
      () => calcularFolhaCompetenciaLote(db, rhUser, { competenciaId: comp.id }),
      /A competência está em processamento por outra operação crítica \(RN-71\)\. Edição bloqueada\./
    );

    // Tentativa de lançar evento bloqueada
    assert.throws(
      () =>
        lancarHorasExtras(db, rhUser, {
          colaboradorId: colab.id,
          competenciaId: comp.id,
          tipo: 'UTIL',
          quantidadeHoras: 1,
        }),
      /A competência está em processamento por outra operação crítica \(RN-71\)\. Edição bloqueada\./
    );

    // Tentativa de fechar bloqueada
    assert.throws(
      () => fecharFolhaSegura(db, rhUser, comp.id),
      /A competência está em processamento por outra operação crítica \(RN-71\)\. Edição bloqueada\./
    );

    // Libera processamento e valida que operação volta a ser permitida
    db.prepare('UPDATE competencias SET em_processamento = 0 WHERE id = ?').run(comp.id);
    const ev = lancarHorasExtras(db, rhUser, {
      colaboradorId: colab.id,
      competenciaId: comp.id,
      tipo: 'UTIL',
      quantidadeHoras: 1,
    });
    assert.ok(ev.id > 0);
  });

  it('Cenário US-15 / RNF-25: Concorrência otimista impede sobrescrita de cadastro desatualizado', () => {
    const colab = criarColaborador(db, rhUser, {
      filialId: matrizId,
      nome: 'Concorrencia Versao',
      cpf: '52998224725',
      nascimento: '1988-12-12',
      admissao: '2024-01-01',
      cargo: 'Arquiteto',
      setor: 'Sistemas',
      salarioBase: '8000.00',
      banco: '237',
      agencia: '5544',
      conta: '112233',
    });

    assert.strictEqual(colab.versao, 1, 'Versão inicial deve ser 1 (RNF-25)');

    // Usuário 1 salva com base na versão 1 -> Sucesso, versão incrementada para 2
    const res1 = atualizarColaborador(db, rhUser, colab.id, {
      cargo: 'Arquiteto Sênior',
      versaoEsperada: 1,
    });
    assert.strictEqual(res1.versao, 2);

    // Usuário 2, com a tela aberta na versão 1 antiga, tenta salvar -> Bloqueado com aviso (RNF-25)
    assert.throws(
      () =>
        atualizarColaborador(db, rhUser, colab.id, {
          cargo: 'Arquiteto Especialista',
          versaoEsperada: 1,
        }),
      /O registro foi alterado por outra pessoa \(RNF-25\)\. Recarregue a página antes de salvar\./
    );

    // Usuário 2 recarrega e envia com a versão 2 atualizada -> Sucesso, versão incrementada para 3
    const res2 = atualizarColaborador(db, rhUser, colab.id, {
      cargo: 'Arquiteto Especialista',
      versaoEsperada: 2,
    });
    assert.strictEqual(res2.versao, 3);
  });

  // =========================================================================
  // US-16: TRILHA DE APROVAÇÃO, DEVOLUÇÃO E VERSIONAMENTO (RN-04, RN-67, RN-68, RNF-54)
  // =========================================================================

  it('Cenário US-16 / Critério 1: Registro de usuários, datas e horas de lançamento, cálculo, conferência e fechamento', () => {
    const comp = abrirOuObterCompetencia(db, rhUser, '2026-10');
    const colab = criarColaborador(db, rhUser, {
      filialId: matrizId,
      nome: 'Colab Trilha',
      cpf: '52998224725',
      nascimento: '1992-05-10',
      admissao: '2025-01-01',
      cargo: 'Analista de Operações',
      setor: 'Operações',
      salarioBase: '3000.00',
      banco: '001',
      agencia: '1234',
      conta: '56789',
    });

    // 1. Lançamento de Evento por outroRhUser
    lancarHorasExtras(db, outroRhUser, {
      colaboradorId: colab.id,
      competenciaId: comp.id,
      tipo: 'UTIL',
      quantidadeHoras: 2,
    });

    const compAposLanc = db.prepare('SELECT lancado_por, lancado_em FROM competencias WHERE id = ?').get(comp.id) as any;
    assert.strictEqual(compAposLanc.lancado_por, outroRhUser.id, 'Deve registrar o ID do usuário que lançou eventos');
    assert.ok(compAposLanc.lancado_em, 'Deve registrar data/hora do lançamento');

    // 2. Cálculo da Folha por rhUser
    calcularFolhaColaborador(db, rhUser, {
      colaboradorId: colab.id,
      competenciaId: comp.id,
      diasUteisMes: 25,
      domingosEFeriadosMes: 5,
    });

    const compAposCalc = db.prepare('SELECT calculado_por, calculado_em FROM competencias WHERE id = ?').get(comp.id) as any;
    assert.strictEqual(compAposCalc.calculado_por, rhUser.id, 'Deve registrar o ID do usuário que calculou a folha');
    assert.ok(compAposCalc.calculado_em, 'Deve registrar data/hora do cálculo');

    // 3. Confirmação da Conferência por outroRhUser
    confirmarConferenciaFolha(db, outroRhUser, comp.id);

    const compAposConf = db.prepare('SELECT conferido_por, conferido_em FROM competencias WHERE id = ?').get(comp.id) as any;
    assert.strictEqual(compAposConf.conferido_por, outroRhUser.id, 'Deve registrar o ID do usuário que confirmou a conferência');
    assert.ok(compAposConf.conferido_em, 'Deve registrar data/hora da confirmação da conferência');

    // 4. Fechamento da Folha por rhUser
    fecharFolhaSegura(db, rhUser, comp.id);

    const compAposFech = db.prepare('SELECT fechado_por, fechado_em, situacao FROM competencias WHERE id = ?').get(comp.id) as any;
    assert.strictEqual(compAposFech.situacao, 'FECHADA');
    assert.strictEqual(compAposFech.fechado_por, rhUser.id, 'Deve registrar o ID do usuário que fechou a folha');
    assert.ok(compAposFech.fechado_em, 'Deve registrar data/hora do fechamento');
  });

  it('Cenário US-16 / Critério 2: Devolução de folha para ajuste com motivo volta a Aberta e invalida conferência', () => {
    const comp = abrirOuObterCompetencia(db, rhUser, '2026-10');
    const colab = criarColaborador(db, rhUser, {
      filialId: matrizId,
      nome: 'Colab Devolucao',
      cpf: '52998224725',
      nascimento: '1990-03-15',
      admissao: '2025-01-01',
      cargo: 'Caixa',
      setor: 'Atendimento',
      salarioBase: '2500.00',
      banco: '001',
      agencia: '1234',
      conta: '998877',
    });

    calcularFolhaColaborador(db, rhUser, {
      colaboradorId: colab.id,
      competenciaId: comp.id,
    });

    // Confirma conferência inicialmente
    confirmarConferenciaFolha(db, outroRhUser, comp.id);
    const compConf = db.prepare('SELECT conferido_por, conferido_em, situacao FROM competencias WHERE id = ?').get(comp.id) as any;
    assert.ok(compConf.conferido_por);
    assert.ok(compConf.conferido_em);

    // Devolve para ajuste com motivo
    devolverFolhaParaAjuste(db, rhUser, comp.id, 'Corrigir faltas injustificadas lançadas indevidamente');

    const compDevolvida = db.prepare('SELECT situacao, conferido_por, conferido_em, motivo_devolucao FROM competencias WHERE id = ?').get(comp.id) as any;
    assert.strictEqual(compDevolvida.situacao, 'ABERTA', 'Competência deve voltar a Aberta');
    assert.strictEqual(compDevolvida.conferido_por, null, 'Conferência deve perder validade (conferido_por = null)');
    assert.strictEqual(compDevolvida.conferido_em, null, 'Conferência deve perder validade (conferido_em = null)');
    assert.strictEqual(compDevolvida.motivo_devolucao, 'Corrigir faltas injustificadas lançadas indevidamente');

    // Valida registro no log de auditoria
    const logs = consultarLogs(db, diretoriaUser, { entidade: 'COMPETENCIA', registroId: comp.id });
    const logDevolucao = logs.find((l: any) => l.acao === 'DEVOLVER_FOLHA_AJUSTE');
    assert.ok(logDevolucao, 'Deve registrar log da ação DEVOLVER_FOLHA_AJUSTE');
    assert.ok(logDevolucao.detalhes.includes('Corrigir faltas injustificadas'));

    // Validações de erro
    assert.throws(
      () => devolverFolhaParaAjuste(db, rhUser, comp.id, '  '),
      /Informe o motivo da devolução para ajuste\./
    );

    assert.throws(
      () => devolverFolhaParaAjuste(db, diretoriaUser as any, comp.id, 'Motivo qualquer'),
      /Você não tem permissão para esta ação\./
    );
  });

  it('Cenário US-16 / Critério 3: Fechamento V1 guarda snapshot completo com valores, totais, eventos, parâmetros, usuários, data/hora e hash', () => {
    const comp = abrirOuObterCompetencia(db, rhUser, '2026-10');
    const colab = criarColaborador(db, rhUser, {
      filialId: matrizId,
      nome: 'Colab Snapshot V1',
      cpf: '52998224725',
      nascimento: '1985-04-20',
      admissao: '2024-01-01',
      cargo: 'Coordenador',
      setor: 'Operações',
      salarioBase: '4000.00',
      banco: '001',
      agencia: '1234',
      conta: '12345',
    });

    lancarHorasExtras(db, outroRhUser, {
      colaboradorId: colab.id,
      competenciaId: comp.id,
      tipo: 'UTIL',
      quantidadeHoras: 4,
    });

    calcularFolhaColaborador(db, rhUser, {
      colaboradorId: colab.id,
      competenciaId: comp.id,
      diasUteisMes: 25,
      domingosEFeriadosMes: 5,
    });

    confirmarConferenciaFolha(db, outroRhUser, comp.id);
    const resFechamento = fecharFolhaSegura(db, rhUser, comp.id);

    assert.strictEqual(resFechamento.versao, 'V1');
    assert.ok(resFechamento.hashSha256);
    assert.strictEqual(resFechamento.hashSha256.length, 64, 'Hash SHA-256 deve ter 64 caracteres hex');

    // Valida dados gravados na tabela folha_versoes
    const versoes = consultarVersoesFolha(db, comp.id);
    assert.strictEqual(versoes.length, 1);
    const v1 = versoes[0];
    assert.strictEqual(v1.versao_numero, 'V1');
    assert.strictEqual(v1.hash_sha256, resFechamento.hashSha256);

    const snapshot = JSON.parse(v1.dados_json);
    assert.strictEqual(snapshot.versao, 'V1');
    assert.strictEqual(snapshot.competencia, '2026-10');
    assert.ok(snapshot.dataHora);
    assert.ok(snapshot.totais.liquido > 0);
    assert.ok(snapshot.colaboradores.length === 1);
    assert.ok(snapshot.colaboradores[0].verbas.length > 0, 'Snapshot deve guardar as verbas e valores detalhados');
    assert.ok(snapshot.eventos.length === 1, 'Snapshot deve guardar a lista de eventos');
    assert.ok(snapshot.parametros.length > 0, 'Snapshot deve guardar os parâmetros legais vigentes');
    assert.ok(snapshot.usuarios.lancamento.dataHora, 'Snapshot deve guardar data/hora de lançamento');
    assert.ok(snapshot.usuarios.calculo.dataHora, 'Snapshot deve guardar data/hora de cálculo');
    assert.ok(snapshot.usuarios.conferencia.dataHora, 'Snapshot deve guardar data/hora de conferência');
    assert.ok(snapshot.usuarios.fechamento.dataHora, 'Snapshot deve guardar data/hora de fechamento');
  });

  it('Cenário US-16 / Critério 4: Reabrir, recalcular e fechar gera V2 sem apagar V1', () => {
    const comp = abrirOuObterCompetencia(db, rhUser, '2026-10');
    const colab = criarColaborador(db, rhUser, {
      filialId: matrizId,
      nome: 'Colab Multiplas Versoes',
      cpf: '52998224725',
      nascimento: '1989-08-10',
      admissao: '2024-01-01',
      cargo: 'Analista Pleno',
      setor: 'TI',
      salarioBase: '5000.00',
      banco: '001',
      agencia: '1234',
      conta: '98765',
    });

    calcularFolhaColaborador(db, rhUser, {
      colaboradorId: colab.id,
      competenciaId: comp.id,
    });
    confirmarConferenciaFolha(db, outroRhUser, comp.id);
    const resV1 = fecharFolhaSegura(db, rhUser, comp.id);
    assert.strictEqual(resV1.versao, 'V1');

    // Reabertura com justificativa obrigatória
    reabrirCompetencia(db, rhUser, comp.mes_ano, 'Ajuste de adicional de transferência retroativo');
    const compReaberta = db.prepare('SELECT situacao, conferido_em FROM competencias WHERE id = ?').get(comp.id) as any;
    assert.strictEqual(compReaberta.situacao, 'ABERTA');
    assert.strictEqual(compReaberta.conferido_em, null, 'Conferência perde validade na reabertura');

    // Verifica que V1 continua salva e intacta
    const versoesAposReabrir = consultarVersoesFolha(db, comp.id);
    assert.strictEqual(versoesAposReabrir.length, 1);
    assert.strictEqual(versoesAposReabrir[0].versao_numero, 'V1');

    // Recalcula a folha com novos lançamentos
    lancarHorasExtras(db, rhUser, {
      colaboradorId: colab.id,
      competenciaId: comp.id,
      tipo: 'UTIL',
      quantidadeHoras: 2,
    });
    calcularFolhaColaborador(db, rhUser, {
      colaboradorId: colab.id,
      competenciaId: comp.id,
    });

    // Revalida conferência e fecha novamente -> Gera V2
    confirmarConferenciaFolha(db, outroRhUser, comp.id);
    const resV2 = fecharFolhaSegura(db, rhUser, comp.id);
    assert.strictEqual(resV2.versao, 'V2');
    assert.notStrictEqual(resV2.hashSha256, resV1.hashSha256, 'Hash de V2 deve ser diferente de V1 devido aos novos eventos');

    // Verifica que ambas as versões V1 e V2 existem e nenhuma foi apagada
    const todasVersoes = consultarVersoesFolha(db, comp.id);
    assert.strictEqual(todasVersoes.length, 2, 'Devem existir exatamente 2 versões salvas (V1 e V2)');
    assert.strictEqual(todasVersoes[0].versao_numero, 'V1');
    assert.strictEqual(todasVersoes[1].versao_numero, 'V2');
    assert.strictEqual(todasVersoes[0].hash_sha256, resV1.hashSha256, 'V1 original permanece inalterada');
    assert.strictEqual(todasVersoes[1].hash_sha256, resV2.hashSha256, 'V2 registrada corretamente');
  });

  it('Cenário US-16 / Critério 5: Diretoria consulta trilha completa e relatórios/contracheques identificam versão', () => {
    const comp = abrirOuObterCompetencia(db, rhUser, '2026-10');
    const colab = criarColaborador(db, rhUser, {
      filialId: matrizId,
      nome: 'Colab Trilha Diretoria',
      cpf: '52998224725',
      nascimento: '1987-02-18',
      admissao: '2024-01-01',
      cargo: 'Supervisora',
      setor: 'Crédito',
      salarioBase: '3500.00',
      banco: '001',
      agencia: '1234',
      conta: '43210',
    });

    // Lança, calcula, confere e fecha V1
    lancarHorasExtras(db, outroRhUser, {
      colaboradorId: colab.id,
      competenciaId: comp.id,
      tipo: 'UTIL',
      quantidadeHoras: 1,
    });
    calcularFolhaColaborador(db, rhUser, {
      colaboradorId: colab.id,
      competenciaId: comp.id,
    });
    confirmarConferenciaFolha(db, outroRhUser, comp.id);
    fecharFolhaSegura(db, rhUser, comp.id);

    // Reabre e fecha V2
    reabrirCompetencia(db, rhUser, comp.mes_ano, 'Inclusão de hora extra complementar');
    lancarHorasExtras(db, rhUser, {
      colaboradorId: colab.id,
      competenciaId: comp.id,
      tipo: 'DOMINGO',
      quantidadeHoras: 2,
    });
    calcularFolhaColaborador(db, rhUser, {
      colaboradorId: colab.id,
      competenciaId: comp.id,
    });
    confirmarConferenciaFolha(db, outroRhUser, comp.id);
    fecharFolhaSegura(db, rhUser, comp.id);

    // 1. Diretoria consulta a trilha completa de aprovação
    const trilha = consultarTrilhaAprovacaoCompetencia(db, diretoriaUser, comp.id);
    assert.strictEqual(trilha.mesAno, '2026-10');
    assert.strictEqual(trilha.situacao, 'FECHADA');
    assert.strictEqual(trilha.etapas.lancamento.concluido, true);
    assert.strictEqual(trilha.etapas.calculo.concluido, true);
    assert.strictEqual(trilha.etapas.conferencia.valida, true);
    assert.strictEqual(trilha.etapas.fechamento.fechada, true);
    assert.strictEqual(trilha.etapas.fechamento.versaoAtual, 'V2');
    assert.strictEqual(trilha.totalVersoes, 2);
    assert.strictEqual(trilha.versoes[0].versao, 'V1');
    assert.strictEqual(trilha.versoes[1].versao, 'V2');

    // 2. Diretoria consulta detalhe de snapshot de versão anterior V1
    const detalheV1 = obterDetalheVersaoFolha(db, diretoriaUser, comp.id, 'V1');
    assert.strictEqual(detalheV1.versaoNumero, 'V1');
    assert.strictEqual(detalheV1.dadosSnapshot.eventos.length, 1);

    // 3. Relatórios identificam a versão atual (V2)
    const relFolha = gerarRelatorioFolhaMes(db, diretoriaUser, comp.id);
    assert.strictEqual(relFolha.versao, 'V2');
    assert.ok(relFolha.titulo.includes('V2'));

    const relPag = gerarRelatorioDadosPagamento(db, diretoriaUser, comp.id);
    assert.strictEqual(relPag.versao, 'V2');

    // 4. Contracheques identificam a versão e permitem consultar versão anterior
    const ccAtual = gerarContrachequeEstruturado(db, diretoriaUser, colab.id, comp.id);
    assert.strictEqual(ccAtual.cabecalho.versao, 'V2');

    const ccV1 = gerarContrachequeEstruturado(db, diretoriaUser, colab.id, comp.id, 'V1');
    assert.strictEqual(ccV1.cabecalho.versao, 'V1');
    assert.notStrictEqual(ccV1.totais.liquido, ccAtual.totais.liquido, 'Líquido de V1 deve ser diferente de V2');

    // 5. Perfil não autorizado é bloqueado
    assert.throws(
      () => consultarTrilhaAprovacaoCompetencia(db, { perfil: 'COLABORADOR' } as any, comp.id),
      /Você não tem permissão para esta ação\./
    );
  });
});
