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
import { abrirOuObterCompetencia } from '../src/services/competenciaService.js';
import { consultarLogs, registrarOperacaoCritica } from '../src/services/logService.js';
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
});
