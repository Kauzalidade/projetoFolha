import assert from 'node:assert';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { SCHEMA_SQL } from '../back-end/src/db.js';
import { limparTodasSessoes } from '../back-end/src/security.js';
import { criarUsuario } from '../back-end/src/services/usuarioService.js';
import { criarFilial } from '../back-end/src/services/filialService.js';
import { inicializarFeriadosEParametros } from '../back-end/src/services/parametroFeriadoService.js';
import { abrirOuObterCompetencia, reabrirCompetencia } from '../back-end/src/services/competenciaService.js';
import { criarColaborador } from '../back-end/src/services/colaboradorService.js';
import { lancarHorasExtras } from '../back-end/src/services/eventoService.js';
import { consultarLogs } from '../back-end/src/services/logService.js';
import {
  calcularFolhaColaborador,
  confirmarConferenciaFolha,
  devolverFolhaParaAjuste,
  fecharFolhaSegura,
  consultarVersoesFolha,
  consultarTrilhaAprovacaoCompetencia,
  obterDetalheVersaoFolha,
} from '../back-end/src/services/folhaService.js';
import {
  gerarRelatorioFolhaMes,
  gerarRelatorioDadosPagamento,
  gerarContrachequeEstruturado,
  gerarContrachequePDF,
} from '../back-end/src/services/relatoriosService.js';

export interface PassoResultado {
  etapa: string;
  resultado: 'OK' | 'BLOQUEADO' | 'ERRO';
  mensagem: string;
  detalhes?: Record<string, unknown>;
}

export interface CenarioResultado {
  id: number;
  codigo: string;
  titulo: string;
  regra: string;
  status: 'PASSOU' | 'FALHOU';
  erroValidacao?: string;
  passos: PassoResultado[];
  destaqueVisual: Record<string, unknown>;
  evidenciasDb: Record<string, unknown>;
  executadoEm: string;
  duracaoMs: number;
}

export const CENARIOS_META = [
  {
    id: 1,
    codigo: 'US-16 / Critério 1',
    titulo: '1. Trilha de aprovação (lançamento, cálculo, conferência e fechamento)',
    regra: 'RNF-54 / RN-67 — Registro de usuário, data/hora e status de cada etapa da competência',
  },
  {
    id: 2,
    codigo: 'US-16 / Critério 2',
    titulo: '2. Devolução para ajuste com motivo obrigatório e auditoria',
    regra: 'RN-67 — Rejeição sem motivo, retorno para ABERTA, invalidação da conferência e log',
  },
  {
    id: 3,
    codigo: 'US-16 / Critério 3',
    titulo: '3. Fechamento e geração da V1 com snapshot e hash SHA-256',
    regra: 'RN-68 / RNF-54 — Snapshot completo, versão V1, hash SHA-256 (64 chars) e verificação',
  },
  {
    id: 4,
    codigo: 'US-16 / Critério 4',
    titulo: '4. Preservação histórica (reabertura, V2 e imutabilidade da V1)',
    regra: 'RN-04 / RN-68 — Reabertura com justificativa, alteração controlada, V2 e V1 intacta',
  },
  {
    id: 5,
    codigo: 'US-16 / Critério 5',
    titulo: '5. Consulta pela Diretoria (trilha, versões, relatórios e contracheques)',
    regra: 'RN-68 / RNF-54 / Tab. 4.1 — Consulta da Diretoria e comparação de contracheques V1 vs V2',
  },
];

interface AmbienteDemo {
  db: DatabaseSync;
  rhLancamento: { id: number; email: string; perfil: string };
  rhCalculo: { id: number; email: string; perfil: string };
  rhConferencia: { id: number; email: string; perfil: string };
  diretoriaUser: { id: number; email: string; perfil: string };
  matrizId: number;
}

function criarAmbienteIsolado(): AmbienteDemo {
  limparTodasSessoes();
  const db = new DatabaseSync(':memory:');
  db.exec(SCHEMA_SQL);
  inicializarFeriadosEParametros(db);

  const adminUser = { id: 1, email: 'admin.demo@folha.local', perfil: 'ADMIN' };

  const uLanc = criarUsuario(db, adminUser, {
    nome: 'Camila Teixeira (RH Lançamento)',
    email: 'rh.lancamento@folha.local',
    senha: 'DemoPass!2026A',
    perfil: 'RH',
  });
  const uCalc = criarUsuario(db, adminUser, {
    nome: 'Rafael Nogueira (RH Cálculo)',
    email: 'rh.calculo@folha.local',
    senha: 'DemoPass!2026B',
    perfil: 'RH',
  });
  const uConf = criarUsuario(db, adminUser, {
    nome: 'Mariana Vasconcelos (RH Conferência)',
    email: 'rh.conferencia@folha.local',
    senha: 'DemoPass!2026C',
    perfil: 'RH',
  });
  const uDir = criarUsuario(db, adminUser, {
    nome: 'Eduardo Monteiro (Diretoria)',
    email: 'diretoria@folha.local',
    senha: 'DemoPass!2026D',
    perfil: 'DIRETORIA',
  });

  const rhLancamento = { id: uLanc.id, email: uLanc.email, perfil: 'RH' };
  const rhCalculo = { id: uCalc.id, email: uCalc.email, perfil: 'RH' };
  const rhConferencia = { id: uConf.id, email: uConf.email, perfil: 'RH' };
  const diretoriaUser = { id: uDir.id, email: uDir.email, perfil: 'DIRETORIA' };

  const filial = criarFilial(db, rhCalculo, { nome: 'Matriz Demo QA', tipo: 'MATRIZ' });

  return {
    db,
    rhLancamento,
    rhCalculo,
    rhConferencia,
    diretoriaUser,
    matrizId: filial.id,
  };
}

function executarCenario1(): CenarioResultado {
  const t0 = Date.now();
  const meta = CENARIOS_META[0];
  const { db, rhLancamento, rhCalculo, rhConferencia, diretoriaUser, matrizId } = criarAmbienteIsolado();
  const passos: PassoResultado[] = [];

  try {
    const comp = abrirOuObterCompetencia(db, rhCalculo, '2026-10');
    const colab = criarColaborador(db, rhCalculo, {
      filialId: matrizId,
      nome: 'Bruno Almeida (Fictício)',
      cpf: '52998224725',
      nascimento: '1991-06-14',
      admissao: '2024-02-01',
      cargo: 'Analista Operacional',
      setor: 'Operações',
      salarioBase: '3600.00',
      banco: '001',
      agencia: '1234',
      conta: '567890',
    });

    // 1. Lançamento
    lancarHorasExtras(db, rhLancamento, {
      colaboradorId: colab.id,
      competenciaId: comp.id,
      tipo: 'UTIL',
      quantidadeHoras: 3,
      data: '2026-10-12',
    });
    const aposLanc = db.prepare('SELECT situacao, lancado_por, lancado_em FROM competencias WHERE id = ?').get(comp.id) as any;
    assert.strictEqual(aposLanc.lancado_por, rhLancamento.id);
    assert.ok(aposLanc.lancado_em);
    passos.push({
      etapa: '1. Lançamento de eventos',
      resultado: 'OK',
      mensagem: `Lançamento registrado por ${rhLancamento.email}`,
      detalhes: { responsavel: rhLancamento.email, dataHora: aposLanc.lancado_em, situacao: aposLanc.situacao },
    });

    // 2. Cálculo
    calcularFolhaColaborador(db, rhCalculo, {
      colaboradorId: colab.id,
      competenciaId: comp.id,
      diasUteisMes: 25,
      domingosEFeriadosMes: 5,
    });
    const aposCalc = db.prepare('SELECT situacao, calculado_por, calculado_em FROM competencias WHERE id = ?').get(comp.id) as any;
    assert.strictEqual(aposCalc.calculado_por, rhCalculo.id);
    assert.ok(aposCalc.calculado_em);
    passos.push({
      etapa: '2. Cálculo da folha',
      resultado: 'OK',
      mensagem: `Cálculo realizado por ${rhCalculo.email} (situação: ${aposCalc.situacao})`,
      detalhes: { responsavel: rhCalculo.email, dataHora: aposCalc.calculado_em, situacao: aposCalc.situacao },
    });

    // 3. Conferência
    const resConf = confirmarConferenciaFolha(db, rhConferencia, comp.id);
    const aposConf = db.prepare('SELECT situacao, conferido_por, conferido_em FROM competencias WHERE id = ?').get(comp.id) as any;
    assert.strictEqual(aposConf.conferido_por, rhConferencia.id);
    assert.ok(aposConf.conferido_em);
    passos.push({
      etapa: '3. Confirmação da conferência',
      resultado: 'OK',
      mensagem: `Conferência confirmada por ${rhConferencia.email} (${resConf.status})`,
      detalhes: { responsavel: rhConferencia.email, dataHora: aposConf.conferido_em, status: resConf.status },
    });

    // 4. Fechamento
    const resFech = fecharFolhaSegura(db, rhCalculo, comp.id);
    const aposFech = db.prepare('SELECT situacao, fechado_por, fechado_em FROM competencias WHERE id = ?').get(comp.id) as any;
    assert.strictEqual(aposFech.situacao, 'FECHADA');
    assert.strictEqual(aposFech.fechado_por, rhCalculo.id);
    assert.ok(aposFech.fechado_em);
    passos.push({
      etapa: '4. Fechamento da folha',
      resultado: 'OK',
      mensagem: `Folha fechada por ${rhCalculo.email} (${resFech.versao})`,
      detalhes: { responsavel: rhCalculo.email, dataHora: aposFech.fechado_em, situacao: aposFech.situacao, versao: resFech.versao },
    });

    const trilha = consultarTrilhaAprovacaoCompetencia(db, diretoriaUser, comp.id);
    const etapasTabela = [
      {
        etapa: 'Lançamento',
        responsavel: trilha.etapas.lancamento.usuarioEmail,
        dataHora: trilha.etapas.lancamento.dataHora,
        status: trilha.etapas.lancamento.concluido ? 'CONCLUÍDA' : 'PENDENTE',
      },
      {
        etapa: 'Cálculo',
        responsavel: trilha.etapas.calculo.usuarioEmail,
        dataHora: trilha.etapas.calculo.dataHora,
        status: trilha.etapas.calculo.concluido ? 'CONCLUÍDA' : 'PENDENTE',
      },
      {
        etapa: 'Conferência',
        responsavel: trilha.etapas.conferencia.usuarioEmail,
        dataHora: trilha.etapas.conferencia.dataHora,
        status: trilha.etapas.conferencia.valida ? 'VÁLIDA' : 'PENDENTE / INVALIDADA',
      },
      {
        etapa: 'Fechamento',
        responsavel: trilha.etapas.fechamento.usuarioEmail,
        dataHora: trilha.etapas.fechamento.dataHora,
        status: trilha.etapas.fechamento.fechada ? `FECHADA (${trilha.etapas.fechamento.versaoAtual})` : 'ABERTA',
      },
    ];

    return {
      id: meta.id,
      codigo: meta.codigo,
      titulo: meta.titulo,
      regra: meta.regra,
      status: 'PASSOU',
      passos,
      destaqueVisual: {
        tipo: 'TRILHA_ETAPAS',
        competencia: trilha.mesAno,
        situacaoAtual: trilha.situacao,
        etapas: etapasTabela,
      },
      evidenciasDb: {
        competenciaRow: db.prepare('SELECT id, mes_ano, situacao, lancado_por, lancado_em, calculado_por, calculado_em, conferido_por, conferido_em, fechado_por, fechado_em FROM competencias WHERE id = ?').get(comp.id),
      },
      executadoEm: new Date().toISOString(),
      duracaoMs: Date.now() - t0,
    };
  } catch (err: any) {
    return {
      id: meta.id,
      codigo: meta.codigo,
      titulo: meta.titulo,
      regra: meta.regra,
      status: 'FALHOU',
      erroValidacao: err.message,
      passos,
      destaqueVisual: {},
      evidenciasDb: {},
      executadoEm: new Date().toISOString(),
      duracaoMs: Date.now() - t0,
    };
  } finally {
    db.close();
  }
}

function executarCenario2(): CenarioResultado {
  const t0 = Date.now();
  const meta = CENARIOS_META[1];
  const { db, rhLancamento, rhCalculo, rhConferencia, diretoriaUser, matrizId } = criarAmbienteIsolado();
  const passos: PassoResultado[] = [];

  try {
    const comp = abrirOuObterCompetencia(db, rhCalculo, '2026-10');
    const colab = criarColaborador(db, rhCalculo, {
      filialId: matrizId,
      nome: 'Lucas Ferreira (Fictício)',
      cpf: '52998224725',
      nascimento: '1993-09-22',
      admissao: '2024-03-01',
      cargo: 'Assistente Administrativo',
      setor: 'Administrativo',
      salarioBase: '2800.00',
      banco: '237',
      agencia: '0410',
      conta: '112233',
    });

    calcularFolhaColaborador(db, rhCalculo, { colaboradorId: colab.id, competenciaId: comp.id });
    confirmarConferenciaFolha(db, rhConferencia, comp.id);
    const antesDevolucao = db.prepare('SELECT situacao, conferido_por, conferido_em, motivo_devolucao FROM competencias WHERE id = ?').get(comp.id) as any;
    assert.ok(antesDevolucao.conferido_por);
    assert.ok(antesDevolucao.conferido_em);

    passos.push({
      etapa: '1. Pré-condição: Folha calculada e conferência confirmada',
      resultado: 'OK',
      mensagem: `Conferência confirmada por ${rhConferencia.email}`,
      detalhes: antesDevolucao,
    });

    // Tentativa sem motivo -> deve rejeitar
    let erroSemMotivo = '';
    try {
      devolverFolhaParaAjuste(db, rhLancamento, comp.id, '   ');
      throw new Error('Devolução sem motivo deveria ter sido rejeitada!');
    } catch (e: any) {
      erroSemMotivo = e.message;
      assert.match(erroSemMotivo, /Informe o motivo da devolução para ajuste\./);
    }
    passos.push({
      etapa: '2. Tentativa de devolução sem motivo',
      resultado: 'BLOQUEADO',
      mensagem: `Rejeição esperada confirmada: "${erroSemMotivo}"`,
      detalhes: { motivoEnviado: '   ', erroRetornado: erroSemMotivo },
    });

    // Devolução com motivo válido
    const motivoValido = 'Horas extras do setor operacional precisam ser ajustadas antes do fechamento';
    devolverFolhaParaAjuste(db, rhLancamento, comp.id, motivoValido);

    const aposDevolucao = db.prepare('SELECT situacao, conferido_por, conferido_em, motivo_devolucao FROM competencias WHERE id = ?').get(comp.id) as any;
    assert.strictEqual(aposDevolucao.situacao, 'ABERTA');
    assert.strictEqual(aposDevolucao.conferido_por, null);
    assert.strictEqual(aposDevolucao.conferido_em, null);
    assert.strictEqual(aposDevolucao.motivo_devolucao, motivoValido);

    passos.push({
      etapa: '3. Devolução com motivo válido',
      resultado: 'OK',
      mensagem: 'Competência retornou para ABERTA e conferência anterior foi invalidada.',
      detalhes: aposDevolucao,
    });

    const logs = consultarLogs(db, diretoriaUser, { entidade: 'COMPETENCIA', registroId: comp.id });
    const logDevolucao = logs.find((l: any) => l.acao === 'DEVOLVER_FOLHA_AJUSTE');
    assert.ok(logDevolucao);
    passos.push({
      etapa: '4. Auditoria da devolução',
      resultado: 'OK',
      mensagem: `Log imutável registrado (${logDevolucao.acao})`,
      detalhes: logDevolucao,
    });

    return {
      id: meta.id,
      codigo: meta.codigo,
      titulo: meta.titulo,
      regra: meta.regra,
      status: 'PASSOU',
      passos,
      destaqueVisual: {
        tipo: 'DEVOLUCAO',
        rejeicaoSemMotivo: erroSemMotivo,
        motivoValido,
        antes: antesDevolucao,
        depois: aposDevolucao,
        logAuditoria: logDevolucao,
      },
      evidenciasDb: {
        competenciaAtual: aposDevolucao,
        logDevolucao,
      },
      executadoEm: new Date().toISOString(),
      duracaoMs: Date.now() - t0,
    };
  } catch (err: any) {
    return {
      id: meta.id,
      codigo: meta.codigo,
      titulo: meta.titulo,
      regra: meta.regra,
      status: 'FALHOU',
      erroValidacao: err.message,
      passos,
      destaqueVisual: {},
      evidenciasDb: {},
      executadoEm: new Date().toISOString(),
      duracaoMs: Date.now() - t0,
    };
  } finally {
    db.close();
  }
}

function executarCenario3(): CenarioResultado {
  const t0 = Date.now();
  const meta = CENARIOS_META[2];
  const { db, rhLancamento, rhCalculo, rhConferencia, diretoriaUser, matrizId } = criarAmbienteIsolado();
  const passos: PassoResultado[] = [];

  try {
    const comp = abrirOuObterCompetencia(db, rhCalculo, '2026-10');
    const colab = criarColaborador(db, rhCalculo, {
      filialId: matrizId,
      nome: 'Fernanda Ribeiro (Fictício)',
      cpf: '52998224725',
      nascimento: '1988-11-05',
      admissao: '2023-06-01',
      cargo: 'Coordenadora de Atendimento',
      setor: 'Atendimento',
      salarioBase: '4500.00',
      banco: '341',
      agencia: '0099',
      conta: '778899',
    });

    lancarHorasExtras(db, rhLancamento, {
      colaboradorId: colab.id,
      competenciaId: comp.id,
      tipo: 'UTIL',
      quantidadeHoras: 4,
      data: '2026-10-15',
    });

    calcularFolhaColaborador(db, rhCalculo, {
      colaboradorId: colab.id,
      competenciaId: comp.id,
      diasUteisMes: 25,
      domingosEFeriadosMes: 5,
    });

    confirmarConferenciaFolha(db, rhConferencia, comp.id);
    const resFech = fecharFolhaSegura(db, rhCalculo, comp.id);

    assert.strictEqual(resFech.versao, 'V1');
    assert.ok(resFech.hashSha256 && resFech.hashSha256.length === 64);

    passos.push({
      etapa: '1. Fechamento seguro da folha (V1)',
      resultado: 'OK',
      mensagem: `Versão ${resFech.versao} fechada em ${resFech.fechadoEm}`,
      detalhes: resFech,
    });

    const versoes = consultarVersoesFolha(db, comp.id);
    assert.strictEqual(versoes.length, 1);
    const v1Row = versoes[0];
    const hashRecalculado = crypto.createHash('sha256').update(v1Row.dados_json).digest('hex');
    const hashIntegro = hashRecalculado === v1Row.hash_sha256 && v1Row.hash_sha256.length === 64;
    assert.strictEqual(hashIntegro, true, 'Hash recalculado deve bater exatamente com o armazenado');

    passos.push({
      etapa: '2. Verificação criptográfica do hash SHA-256',
      resultado: 'OK',
      mensagem: 'Hash SHA-256 (64 caracteres) recalculado sobre dados_json confere integralmente.',
      detalhes: {
        hashArmazenado: v1Row.hash_sha256,
        hashRecalculado,
        tamanhoCaracteres: v1Row.hash_sha256.length,
        integro: hashIntegro,
      },
    });

    const detalheV1 = obterDetalheVersaoFolha(db, diretoriaUser, comp.id, 'V1');
    const snap = detalheV1.dadosSnapshot;
    assert.ok(snap.totais.liquido > 0);
    assert.strictEqual(snap.colaboradores.length, 1);
    assert.ok(snap.colaboradores[0].verbas.length > 0);
    assert.strictEqual(snap.eventos.length, 1);
    assert.ok(snap.parametros.length > 0);
    assert.ok(snap.usuarios.lancamento.dataHora);
    assert.ok(snap.usuarios.calculo.dataHora);
    assert.ok(snap.usuarios.conferencia.dataHora);
    assert.ok(snap.usuarios.fechamento.dataHora);

    passos.push({
      etapa: '3. Validação do payload completo do snapshot V1',
      resultado: 'OK',
      mensagem: `Snapshot contém ${snap.colaboradores.length} colaborador(es), ${snap.colaboradores[0].verbas.length} verbas, ${snap.eventos.length} evento(s), ${snap.parametros.length} parâmetro(s) e 4 responsáveis.`,
      detalhes: {
        totais: snap.totais,
        qtdColaboradores: snap.colaboradores.length,
        qtdVerbasColab1: snap.colaboradores[0].verbas.length,
        qtdEventos: snap.eventos.length,
        qtdParametros: snap.parametros.length,
      },
    });

    return {
      id: meta.id,
      codigo: meta.codigo,
      titulo: meta.titulo,
      regra: meta.regra,
      status: 'PASSOU',
      passos,
      destaqueVisual: {
        tipo: 'SNAPSHOT_V1',
        versao: v1Row.versao_numero,
        fechadoEm: v1Row.data_hora,
        hashArmazenado: v1Row.hash_sha256,
        hashRecalculado,
        hashTamanho: v1Row.hash_sha256.length,
        hashIntegro,
        totais: snap.totais,
        usuarios: snap.usuarios,
        eventos: snap.eventos,
        qtdParametros: snap.parametros.length,
        amostraParametros: snap.parametros.slice(0, 4).map((p: any) => ({ nome: p.nome, valor: p.valor, fonte: p.fonte })),
        verbasColaborador: snap.colaboradores[0].verbas.map((v: any) => ({
          descricao: v.descricao,
          natureza: v.natureza,
          valor: v.valor_centavos / 100,
        })),
      },
      evidenciasDb: {
        versaoSalva: {
          id: v1Row.id,
          versao_numero: v1Row.versao_numero,
          data_hora: v1Row.data_hora,
          usuario_email: v1Row.usuario_email,
          hash_sha256: v1Row.hash_sha256,
          totais: detalheV1.totais,
        },
      },
      executadoEm: new Date().toISOString(),
      duracaoMs: Date.now() - t0,
    };
  } catch (err: any) {
    return {
      id: meta.id,
      codigo: meta.codigo,
      titulo: meta.titulo,
      regra: meta.regra,
      status: 'FALHOU',
      erroValidacao: err.message,
      passos,
      destaqueVisual: {},
      evidenciasDb: {},
      executadoEm: new Date().toISOString(),
      duracaoMs: Date.now() - t0,
    };
  } finally {
    db.close();
  }
}

function executarCenario4(): CenarioResultado {
  const t0 = Date.now();
  const meta = CENARIOS_META[3];
  const { db, rhLancamento, rhCalculo, rhConferencia, diretoriaUser, matrizId } = criarAmbienteIsolado();
  const passos: PassoResultado[] = [];

  try {
    const comp = abrirOuObterCompetencia(db, rhCalculo, '2026-10');
    const colab = criarColaborador(db, rhCalculo, {
      filialId: matrizId,
      nome: 'Henrique Santos (Fictício)',
      cpf: '52998224725',
      nascimento: '1989-07-19',
      admissao: '2023-01-10',
      cargo: 'Analista Pleno',
      setor: 'Financeiro',
      salarioBase: '5000.00',
      banco: '001',
      agencia: '3210',
      conta: '654321',
    });

    // Fechamento V1
    calcularFolhaColaborador(db, rhCalculo, { colaboradorId: colab.id, competenciaId: comp.id });
    confirmarConferenciaFolha(db, rhConferencia, comp.id);
    const resV1 = fecharFolhaSegura(db, rhCalculo, comp.id);
    const v1Antes = db.prepare('SELECT * FROM folha_versoes WHERE competencia_id = ? AND versao_numero = ?').get(comp.id, 'V1') as any;
    const snapV1Antes = JSON.parse(v1Antes.dados_json);

    passos.push({
      etapa: '1. Fechamento inicial (V1)',
      resultado: 'OK',
      mensagem: `V1 fechada com líquido R$ ${resV1.totalLiquido.toFixed(2)}`,
      detalhes: { versao: resV1.versao, hashSha256: resV1.hashSha256, totalLiquido: resV1.totalLiquido },
    });

    // Reabertura com justificativa
    const justificativa = 'Inclusão retroativa de 2h extras trabalhadas em domingo conforme ponto ajustado';
    reabrirCompetencia(db, rhCalculo, comp.mes_ano, justificativa);
    const compReaberta = db.prepare('SELECT situacao, conferido_em, justificativa_reabertura FROM competencias WHERE id = ?').get(comp.id) as any;
    assert.strictEqual(compReaberta.situacao, 'ABERTA');
    assert.strictEqual(compReaberta.conferido_em, null);

    passos.push({
      etapa: '2. Reabertura com justificativa obrigatória',
      resultado: 'OK',
      mensagem: `Competência reaberta para ABERTA; conferência anterior invalidada.`,
      detalhes: compReaberta,
    });

    // Alteração controlada + recálculo + nova conferência + fechamento V2
    lancarHorasExtras(db, rhLancamento, {
      colaboradorId: colab.id,
      competenciaId: comp.id,
      tipo: 'DOMINGO',
      quantidadeHoras: 2,
      data: '2026-10-18',
    });
    calcularFolhaColaborador(db, rhCalculo, { colaboradorId: colab.id, competenciaId: comp.id });
    confirmarConferenciaFolha(db, rhConferencia, comp.id);
    const resV2 = fecharFolhaSegura(db, rhCalculo, comp.id);
    assert.strictEqual(resV2.versao, 'V2');
    assert.notStrictEqual(resV2.hashSha256, resV1.hashSha256);

    passos.push({
      etapa: '3. Alteração controlada, recálculo, conferência e fechamento (V2)',
      resultado: 'OK',
      mensagem: `V2 gerada com líquido R$ ${resV2.totalLiquido.toFixed(2)} e novo hash SHA-256.`,
      detalhes: { versao: resV2.versao, hashSha256: resV2.hashSha256, totalLiquido: resV2.totalLiquido },
    });

    // Verificação de imutabilidade da V1
    const versoes = consultarVersoesFolha(db, comp.id);
    assert.strictEqual(versoes.length, 2);
    const v1Depois = db.prepare('SELECT * FROM folha_versoes WHERE competencia_id = ? AND versao_numero = ?').get(comp.id, 'V1') as any;
    const v2Depois = db.prepare('SELECT * FROM folha_versoes WHERE competencia_id = ? AND versao_numero = ?').get(comp.id, 'V2') as any;
    const snapV2 = JSON.parse(v2Depois.dados_json);

    const payloadV1Intacto = v1Depois.dados_json === v1Antes.dados_json;
    const hashV1Intacto = v1Depois.hash_sha256 === v1Antes.hash_sha256;
    const hashV1Recalculado = crypto.createHash('sha256').update(v1Depois.dados_json).digest('hex');
    const hashV1Valido = hashV1Recalculado === v1Antes.hash_sha256;

    assert.strictEqual(payloadV1Intacto, true);
    assert.strictEqual(hashV1Intacto, true);
    assert.strictEqual(hashV1Valido, true);

    passos.push({
      etapa: '4. Comprovação de preservação histórica da V1',
      resultado: 'OK',
      mensagem: 'Snapshot JSON e hash SHA-256 da V1 permaneceram 100% inalterados após geração da V2.',
      detalhes: {
        payloadV1Intacto,
        hashV1Intacto,
        hashV1Valido,
        hashV1: v1Depois.hash_sha256,
        hashV2: v2Depois.hash_sha256,
      },
    });

    const logs = consultarLogs(db, diretoriaUser, { entidade: 'COMPETENCIA', registroId: comp.id });

    return {
      id: meta.id,
      codigo: meta.codigo,
      titulo: meta.titulo,
      regra: meta.regra,
      status: 'PASSOU',
      passos,
      destaqueVisual: {
        tipo: 'COMPARACAO_V1_V2',
        justificativaReabertura: justificativa,
        v1Intacta: payloadV1Intacto && hashV1Intacto && hashV1Valido,
        v1: {
          versao: 'V1',
          dataHora: v1Depois.data_hora,
          hashSha256: v1Depois.hash_sha256,
          totais: snapV1Antes.totais,
          qtdEventos: snapV1Antes.eventos.length,
        },
        v2: {
          versao: 'V2',
          dataHora: v2Depois.data_hora,
          hashSha256: v2Depois.hash_sha256,
          totais: snapV2.totais,
          qtdEventos: snapV2.eventos.length,
        },
        diferencaLiquido: Math.round((snapV2.totais.liquido - snapV1Antes.totais.liquido) * 100) / 100,
      },
      evidenciasDb: {
        totalVersoes: versoes.length,
        logsReaberturaEFechamento: logs.filter((l: any) => l.acao === 'REABERTURA_COMPETENCIA_DESTACADA' || l.acao === 'FECHAR_FOLHA_COMPETENCIA'),
      },
      executadoEm: new Date().toISOString(),
      duracaoMs: Date.now() - t0,
    };
  } catch (err: any) {
    return {
      id: meta.id,
      codigo: meta.codigo,
      titulo: meta.titulo,
      regra: meta.regra,
      status: 'FALHOU',
      erroValidacao: err.message,
      passos,
      destaqueVisual: {},
      evidenciasDb: {},
      executadoEm: new Date().toISOString(),
      duracaoMs: Date.now() - t0,
    };
  } finally {
    db.close();
  }
}

function executarCenario5(): CenarioResultado {
  const t0 = Date.now();
  const meta = CENARIOS_META[4];
  const { db, rhLancamento, rhCalculo, rhConferencia, diretoriaUser, matrizId } = criarAmbienteIsolado();
  const passos: PassoResultado[] = [];

  try {
    const comp = abrirOuObterCompetencia(db, rhCalculo, '2026-10');
    const colab = criarColaborador(db, rhCalculo, {
      filialId: matrizId,
      nome: 'Patrícia Azevedo (Fictício)',
      cpf: '52998224725',
      nascimento: '1987-04-08',
      admissao: '2023-05-01',
      cargo: 'Supervisora de Crédito',
      setor: 'Crédito',
      salarioBase: '3800.00',
      banco: '104',
      agencia: '0202',
      conta: '445566',
    });

    // V1
    lancarHorasExtras(db, rhLancamento, {
      colaboradorId: colab.id,
      competenciaId: comp.id,
      tipo: 'UTIL',
      quantidadeHoras: 1,
      data: '2026-10-10',
    });
    calcularFolhaColaborador(db, rhCalculo, { colaboradorId: colab.id, competenciaId: comp.id });
    confirmarConferenciaFolha(db, rhConferencia, comp.id);
    fecharFolhaSegura(db, rhCalculo, comp.id);

    // Reabertura + V2
    reabrirCompetencia(db, rhCalculo, comp.mes_ano, 'Inclusão de horas extras de domingo para fechamento V2');
    lancarHorasExtras(db, rhLancamento, {
      colaboradorId: colab.id,
      competenciaId: comp.id,
      tipo: 'DOMINGO',
      quantidadeHoras: 3,
      data: '2026-10-25',
    });
    calcularFolhaColaborador(db, rhCalculo, { colaboradorId: colab.id, competenciaId: comp.id });
    confirmarConferenciaFolha(db, rhConferencia, comp.id);
    fecharFolhaSegura(db, rhCalculo, comp.id);

    // 1. Diretoria consulta trilha completa
    const trilha = consultarTrilhaAprovacaoCompetencia(db, diretoriaUser, comp.id);
    assert.strictEqual(trilha.totalVersoes, 2);
    assert.strictEqual(trilha.etapas.fechamento.versaoAtual, 'V2');
    passos.push({
      etapa: '1. Consulta da trilha de aprovação pela Diretoria',
      resultado: 'OK',
      mensagem: `Diretoria consultou trilha de ${trilha.mesAno}: ${trilha.totalVersoes} versões, atual ${trilha.etapas.fechamento.versaoAtual}.`,
      detalhes: { etapas: trilha.etapas, totalVersoes: trilha.totalVersoes },
    });

    // 2. Diretoria consulta versões históricas V1 e V2
    const detV1 = obterDetalheVersaoFolha(db, diretoriaUser, comp.id, 'V1');
    const detV2 = obterDetalheVersaoFolha(db, diretoriaUser, comp.id, 'V2');
    assert.strictEqual(detV1.versaoNumero, 'V1');
    assert.strictEqual(detV2.versaoNumero, 'V2');
    passos.push({
      etapa: '2. Consulta de versões históricas (V1 e V2)',
      resultado: 'OK',
      mensagem: `Snapshots V1 (líquido R$ ${detV1.totais.liquido.toFixed(2)}) e V2 (líquido R$ ${detV2.totais.liquido.toFixed(2)}) acessíveis à Diretoria.`,
      detalhes: { v1Hash: detV1.hashSha256, v2Hash: detV2.hashSha256 },
    });

    // 3. Relatórios identificando versão e hash
    const relFolha = gerarRelatorioFolhaMes(db, diretoriaUser, comp.id);
    const relPag = gerarRelatorioDadosPagamento(db, diretoriaUser, comp.id);
    assert.strictEqual(relFolha.versao, 'V2');
    assert.strictEqual(relPag.versao, 'V2');
    assert.ok(relFolha.hashSha256 && relFolha.hashSha256.length === 64);
    assert.ok(relPag.hashSha256 && relPag.hashSha256.length === 64);
    passos.push({
      etapa: '3. Identificação de versão e hash nos relatórios gerenciais',
      resultado: 'OK',
      mensagem: `Relatórios exibem versão ${relFolha.versao} e hash SHA-256 completo.`,
      detalhes: {
        relatorioFolhaMes: { titulo: relFolha.titulo, versao: relFolha.versao, hashSha256: relFolha.hashSha256, totaisGerais: relFolha.totaisGerais },
        relatorioDadosPagamento: { titulo: relPag.titulo, versao: relPag.versao, hashSha256: relPag.hashSha256, totalLiquido: relPag.totalLiquido },
      },
    });

    // 4. Comparação de contracheques históricos entre V1 e V2
    const ccV1 = gerarContrachequeEstruturado(db, diretoriaUser, colab.id, comp.id, 'V1');
    const ccV2 = gerarContrachequeEstruturado(db, diretoriaUser, colab.id, comp.id, 'V2');
    const pdfV1 = gerarContrachequePDF(db, diretoriaUser, colab.id, comp.id, 'V1').toString('binary');
    const pdfV2 = gerarContrachequePDF(db, diretoriaUser, colab.id, comp.id, 'V2').toString('binary');

    assert.strictEqual(ccV1.cabecalho.versao, 'V1');
    assert.strictEqual(ccV2.cabecalho.versao, 'V2');
    assert.notStrictEqual(ccV1.totais.liquido, ccV2.totais.liquido);
    assert.ok(pdfV1.includes('Versao: V1') && pdfV1.includes(detV1.hashSha256));
    assert.ok(pdfV2.includes('Versao: V2') && pdfV2.includes(detV2.hashSha256));

    passos.push({
      etapa: '4. Comparação de contracheques históricos (V1 vs V2)',
      resultado: 'OK',
      mensagem: `Contracheques estruturados e PDFs distinguem V1 (R$ ${ccV1.totais.liquido.toFixed(2)}) e V2 (R$ ${ccV2.totais.liquido.toFixed(2)}) com hash.`,
      detalhes: {
        v1Liquido: ccV1.totais.liquido,
        v2Liquido: ccV2.totais.liquido,
        pdfV1TemVersaoEHash: pdfV1.includes('Versao: V1') && pdfV1.includes(detV1.hashSha256),
        pdfV2TemVersaoEHash: pdfV2.includes('Versao: V2') && pdfV2.includes(detV2.hashSha256),
      },
    });

    // 5. Bloqueio de escrita pela Diretoria e acesso de Colaborador
    let bloqueioEscrita = '';
    try {
      fecharFolhaSegura(db, diretoriaUser, comp.id);
    } catch (e: any) {
      bloqueioEscrita = e.message;
    }
    assert.match(bloqueioEscrita, /Você não tem permissão para esta ação/);
    passos.push({
      etapa: '5. Segregação de perfil (Diretoria somente consulta)',
      resultado: 'BLOQUEADO',
      mensagem: `Tentativa de fechamento pela Diretoria bloqueada: "${bloqueioEscrita}"`,
    });

    return {
      id: meta.id,
      codigo: meta.codigo,
      titulo: meta.titulo,
      regra: meta.regra,
      status: 'PASSOU',
      passos,
      destaqueVisual: {
        tipo: 'CONSULTA_DIRETORIA',
        trilhaResumo: trilha.etapas,
        relatorios: [
          { nome: relFolha.titulo, versao: relFolha.versao, hashSha256: relFolha.hashSha256, totalLiquido: relFolha.totaisGerais.liquido },
          { nome: relPag.titulo, versao: relPag.versao, hashSha256: relPag.hashSha256, totalLiquido: relPag.totalLiquido },
        ],
        contrachequeV1: {
          versao: ccV1.cabecalho.versao,
          hashSha256: ccV1.cabecalho.hashSha256,
          totais: ccV1.totais,
          verbas: ccV1.verbas,
        },
        contrachequeV2: {
          versao: ccV2.cabecalho.versao,
          hashSha256: ccV2.cabecalho.hashSha256,
          totais: ccV2.totais,
          verbas: ccV2.verbas,
        },
      },
      evidenciasDb: {
        versoes: trilha.versoes,
        auditoriaLogs: trilha.auditoriaLogs,
      },
      executadoEm: new Date().toISOString(),
      duracaoMs: Date.now() - t0,
    };
  } catch (err: any) {
    return {
      id: meta.id,
      codigo: meta.codigo,
      titulo: meta.titulo,
      regra: meta.regra,
      status: 'FALHOU',
      erroValidacao: err.message,
      passos,
      destaqueVisual: {},
      evidenciasDb: {},
      executadoEm: new Date().toISOString(),
      duracaoMs: Date.now() - t0,
    };
  } finally {
    db.close();
  }
}

export function executarCenario(id: number): CenarioResultado {
  switch (id) {
    case 1:
      return executarCenario1();
    case 2:
      return executarCenario2();
    case 3:
      return executarCenario3();
    case 4:
      return executarCenario4();
    case 5:
      return executarCenario5();
    default:
      throw new Error(`Cenário ${id} não encontrado.`);
  }
}

export function executarTodosCenarios(): CenarioResultado[] {
  return CENARIOS_META.map((m) => executarCenario(m.id));
}
