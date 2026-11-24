import assert from 'node:assert';
import { DatabaseSync } from 'node:sqlite';
import { SCHEMA_SQL } from '../back-end/src/db.js';
import { limparTodasSessoes } from '../back-end/src/security.js';
import { criarUsuario } from '../back-end/src/services/usuarioService.js';
import { criarFilial } from '../back-end/src/services/filialService.js';
import { inicializarFeriadosEParametros } from '../back-end/src/services/parametroFeriadoService.js';
import { abrirOuObterCompetencia } from '../back-end/src/services/competenciaService.js';
import { criarColaborador, atualizarColaborador } from '../back-end/src/services/colaboradorService.js';
import { lancarHorasExtras } from '../back-end/src/services/eventoService.js';
import { solicitarFerias } from '../back-end/src/services/feriasService.js';
import { consultarLogs } from '../back-end/src/services/logService.js';
import {
  anexarDocumento,
  cadastrarExameOcupacional,
  avaliarRetencaoColaborador,
  executarEliminacaoAnonimizacaoLGPD,
} from '../back-end/src/services/documentosAlertasService.js';
import {
  gerarFichaColaboradorPDF,
  obterFichaColaboradorLGPD,
  gerarTermoEliminacaoPDF,
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

export interface UsuarioDemoInfo {
  id: number;
  nome: string;
  email: string;
  perfil: string;
  permissoesResumo: string;
}

export const CENARIOS_META = [
  {
    id: 1,
    codigo: 'US-17 / Critério 1',
    titulo: '1. Busca por CPF e Ficha Completa em PDF (Direitos do Titular)',
    regra: 'RN-76 — Cadastro, dependentes, eventos, férias, documentos, histórico, PDF real e log imutável',
  },
  {
    id: 2,
    codigo: 'US-17 / Critério 2',
    titulo: '2. Retificação de Dados Pessoais e Bancários com Auditoria',
    regra: 'RN-07 / US-17 — Valor anterior, valor novo, responsável, data/hora e log ATUALIZAR_COLABORADOR',
  },
  {
    id: 3,
    codigo: 'US-17 / Critério 3',
    titulo: '3. Bloqueios de Eliminação (Ativo, Retenção 5 anos, Confirmação e Perfil)',
    regra: 'RN-56 / RNF-55 — Bloqueio de ativo/prazo de 5 anos, confirmação expressa do RH e justificativa legal',
  },
  {
    id: 4,
    codigo: 'US-17 / Critério 4',
    titulo: '4. Anonimização, Regra do Maior Prazo (NR-7) e Termo de Eliminação em PDF',
    regra: 'RN-56 / RNF-29 / RNF-55 — Preservação NR-7 (20 anos), descarte pessoal/bancário, Termo PDF e log',
  },
];

interface AmbienteDemo {
  db: DatabaseSync;
  adminUser: { id: number; email: string; perfil: string };
  rhUser: { id: number; email: string; perfil: string };
  diretoriaUser: { id: number; email: string; perfil: string };
  colaboradorPerfil: { id: number; email: string; perfil: string };
  usuariosInfo: UsuarioDemoInfo[];
  matrizId: number;
}

let ultimoPdfFicha: Buffer | null = null;
let ultimoPdfTermo: Buffer | null = null;

export function obterUltimoPdfFicha(): Buffer | null {
  return ultimoPdfFicha;
}

export function obterUltimoPdfTermo(): Buffer | null {
  return ultimoPdfTermo;
}

export function limparPdfsEmCache(): void {
  ultimoPdfFicha = null;
  ultimoPdfTermo = null;
}

function criarAmbienteIsolado(): AmbienteDemo {
  limparTodasSessoes();
  const db = new DatabaseSync(':memory:');
  db.exec(SCHEMA_SQL);
  inicializarFeriadosEParametros(db);

  const adminUser = { id: 1, email: 'admin.demo@folha.local', perfil: 'ADMIN' };

  const uRH = criarUsuario(db, adminUser, {
    nome: 'Larissa Andrade (RH LGPD)',
    email: 'rh.lgpd@folha.local',
    senha: 'DemoPass!2026A',
    perfil: 'RH',
  });

  const uDir = criarUsuario(db, adminUser, {
    nome: 'Helena Vasconcelos (Diretoria)',
    email: 'diretoria@folha.local',
    senha: 'DemoPass!2026B',
    perfil: 'DIRETORIA',
  });

  const rhUser = { id: uRH.id, email: uRH.email, perfil: 'RH' };
  const diretoriaUser = { id: uDir.id, email: uDir.email, perfil: 'DIRETORIA' };
  const colaboradorPerfil = { id: 999, email: 'titular.externo@folha.local', perfil: 'COLABORADOR' };

  const filial = criarFilial(db, rhUser, { nome: 'Matriz Demo QA (São Paulo)', tipo: 'MATRIZ' });

  const usuariosInfo: UsuarioDemoInfo[] = [
    {
      id: adminUser.id,
      nome: 'Administrador Padrão (Seed)',
      email: adminUser.email,
      perfil: 'ADMIN',
      permissoesResumo: 'Gerencia usuários e consulta logs; sem acesso a dados da folha/LGPD.',
    },
    {
      id: uRH.id,
      nome: uRH.nome,
      email: uRH.email,
      perfil: 'RH',
      permissoesResumo: 'Busca ficha por CPF, gera PDF, retifica cadastro e homologa eliminação LGPD.',
    },
    {
      id: uDir.id,
      nome: uDir.nome,
      email: uDir.email,
      perfil: 'DIRETORIA',
      permissoesResumo: 'Consulta logs de auditoria e ficha estruturada; bloqueado para homologar descarte.',
    },
    {
      id: colaboradorPerfil.id,
      nome: 'Titular / Perfil Não Autorizado',
      email: colaboradorPerfil.email,
      perfil: 'COLABORADOR',
      permissoesResumo: 'Bloqueado para acesso direto à ficha completa LGPD no painel administrativo.',
    },
  ];

  return {
    db,
    adminUser,
    rhUser,
    diretoriaUser,
    colaboradorPerfil,
    usuariosInfo,
    matrizId: filial.id,
  };
}

export function obterResumoUsuariosDemo(): UsuarioDemoInfo[] {
  const { db, usuariosInfo } = criarAmbienteIsolado();
  db.close();
  return usuariosInfo;
}

function executarCenario1(): CenarioResultado {
  const t0 = Date.now();
  const meta = CENARIOS_META[0];
  const { db, rhUser, diretoriaUser, colaboradorPerfil, usuariosInfo, matrizId } = criarAmbienteIsolado();
  const passos: PassoResultado[] = [];

  try {
    const comp = abrirOuObterCompetencia(db, rhUser, '2026-10');
    const colab = criarColaborador(db, rhUser, {
      filialId: matrizId,
      nome: 'Juliana Mendes LGPD',
      cpf: '52998224725',
      nascimento: '1991-07-25',
      admissao: '2023-03-01',
      cargo: 'Supervisora de Crédito',
      setor: 'Crédito',
      salarioBase: '4500.00',
      banco: '341',
      agencia: '0987',
      conta: '54321',
      titularConta: 'Juliana Mendes LGPD',
      dependentes: [
        { nome: 'Pedro Mendes', nascimento: '2018-05-10', parentesco: 'FILHO' },
      ],
    });

    // 1. Lança eventos na folha
    lancarHorasExtras(db, rhUser, {
      colaboradorId: colab.id,
      competenciaId: comp.id,
      tipo: 'UTIL',
      quantidadeHoras: 3,
    });
    passos.push({
      etapa: '1. Cadastro e lançamento de evento na folha',
      resultado: 'OK',
      mensagem: `Colaboradora "${colab.nome}" (CPF 529.982.247-25) com dependente e 3h extras úteis lançadas.`,
    });

    // 2. Anexa documento
    anexarDocumento(db, rhUser, {
      colaboradorId: colab.id,
      tipo: 'CNH',
      nomeArquivo: 'cnh_juliana.pdf',
      dataValidade: '2028-10-10',
    });

    // 3. Concede férias
    solicitarFerias(db, rhUser, {
      colaboradorId: colab.id,
      dataInicio: '2026-11-03',
      diasGozo: 15,
      diasAbono: 0,
    });
    passos.push({
      etapa: '2. Anexo de documento e registro de férias',
      resultado: 'OK',
      mensagem: 'Documento CNH (cnh_juliana.pdf) anexado e férias de 15 dias registradas.',
    });

    // 4. Busca estruturada por CPF (com máscara)
    const fichaEstruturada = obterFichaColaboradorLGPD(db, rhUser, '529.982.247-25');
    assert.strictEqual(fichaEstruturada.colaborador.nome, 'Juliana Mendes LGPD');
    assert.strictEqual(fichaEstruturada.colaborador.cargo, 'Supervisora de Crédito');
    assert.strictEqual(fichaEstruturada.dependentes.length, 1);
    assert.strictEqual(fichaEstruturada.dependentes[0].nome, 'Pedro Mendes');
    assert.ok(fichaEstruturada.eventos.length >= 1, 'Ficha deve conter os eventos lançados da folha');
    assert.strictEqual(fichaEstruturada.eventos[0].tipo, 'HORA_EXTRA_UTIL');
    assert.strictEqual(fichaEstruturada.documentos.length, 1);
    assert.strictEqual(fichaEstruturada.ferias.length, 1);

    passos.push({
      etapa: '3. Busca estruturada por CPF (obterFichaColaboradorLGPD)',
      resultado: 'OK',
      mensagem: `Ficha localizada para CPF ${fichaEstruturada.colaborador.cpf}: ${fichaEstruturada.dependentes.length} dependente(s), ${fichaEstruturada.eventos.length} evento(s), ${fichaEstruturada.ferias.length} férias, ${fichaEstruturada.documentos.length} documento(s).`,
    });

    // 5. Geração em PDF real
    const pdfBuffer = gerarFichaColaboradorPDF(db, rhUser, '52998224725');
    assert.ok(pdfBuffer instanceof Buffer);
    assert.strictEqual(pdfBuffer.subarray(0, 4).toString(), '%PDF', 'Deve gerar PDF válido');
    ultimoPdfFicha = pdfBuffer;

    passos.push({
      etapa: '4. Geração da Ficha Completa em PDF (gerarFichaColaboradorPDF)',
      resultado: 'OK',
      mensagem: `PDF real gerado (${pdfBuffer.subarray(0, 8).toString('utf-8')}, ${pdfBuffer.length} bytes).`,
      detalhes: { assinaturaPdf: pdfBuffer.subarray(0, 8).toString('utf-8'), tamanhoBytes: pdfBuffer.length },
    });

    // 6. Validação do log de auditoria
    const logs = consultarLogs(db, diretoriaUser, { entidade: 'COLABORADOR', registroId: colab.id });
    const logFicha = logs.find((l: any) => l.acao === 'GERAR_FICHA_COLABORADOR_LGPD');
    assert.ok(logFicha, 'Deve registrar log imutável GERAR_FICHA_COLABORADOR_LGPD');

    passos.push({
      etapa: '5. Registro no log de auditoria imutável',
      resultado: 'OK',
      mensagem: `Ação ${logFicha.acao} gravada por ${logFicha.usuario_email} em ${logFicha.data_hora}.`,
    });

    // 7. Bloqueio de perfil não autorizado
    let erroPerfilBloqueado = '';
    try {
      obterFichaColaboradorLGPD(db, colaboradorPerfil as any, '52998224725');
      throw new Error('Perfil COLABORADOR deveria ter sido bloqueado!');
    } catch (e: any) {
      erroPerfilBloqueado = e.message;
      assert.match(erroPerfilBloqueado, /Você não tem permissão para acessar a ficha completa do colaborador\./);
    }

    passos.push({
      etapa: '6. Validação de controle de acesso (perfil COLABORADOR)',
      resultado: 'BLOQUEADO',
      mensagem: `Bloqueio real confirmado: "${erroPerfilBloqueado}"`,
    });

    const historicoBanco = db
      .prepare('SELECT campo, valor_anterior, valor_novo, data_hora FROM historico_colaborador WHERE colaborador_id = ? ORDER BY id DESC')
      .all(colab.id);

    return {
      id: meta.id,
      codigo: meta.codigo,
      titulo: meta.titulo,
      regra: meta.regra,
      status: 'PASSOU',
      passos,
      destaqueVisual: {
        tipo: 'FICHA_LGPD',
        cpfBuscado: '529.982.247-25',
        ficha: fichaEstruturada,
        pdf: {
          disponivel: true,
          url: '/api/pdf/ficha',
          cabecalho: pdfBuffer.subarray(0, 8).toString('utf-8'),
          tamanhoBytes: pdfBuffer.length,
        },
        logAuditoria: logFicha,
        bloqueioPerfil: {
          perfilTestado: 'COLABORADOR',
          mensagemErro: erroPerfilBloqueado,
        },
      },
      evidenciasDb: {
        usuariosPerfis: usuariosInfo,
        colaboradorRow: db.prepare('SELECT id, nome, cpf, cargo, setor, situacao, versao FROM colaboradores WHERE id = ?').get(colab.id),
        historicoColaborador: historicoBanco,
        logsAuditoria: logs,
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
  const { db, rhUser, diretoriaUser, matrizId } = criarAmbienteIsolado();
  const passos: PassoResultado[] = [];

  try {
    const colab = criarColaborador(db, rhUser, {
      filialId: matrizId,
      nome: 'Carlos Eduardo Silva',
      cpf: '52998224725',
      nascimento: '1985-11-20',
      admissao: '2024-01-10',
      cargo: 'Assistente',
      setor: 'Atendimento',
      salarioBase: '2000.00',
      banco: '001',
      agencia: '1234',
      conta: '11111',
      titularConta: 'Carlos Eduardo Silva',
    });

    const antes = {
      nome: colab.nome,
      banco: colab.banco,
      agencia: colab.agencia,
      conta: colab.conta,
      versao: 1,
    };

    passos.push({
      etapa: '1. Estado inicial do cadastro (versão 1)',
      resultado: 'OK',
      mensagem: `Colaborador "${colab.nome}" cadastrado com Banco 001, Agência 1234, Conta 11111.`,
      detalhes: antes,
    });

    // Correção de dados pessoais e bancários pelo RH
    const resAtualizacao = atualizarColaborador(db, rhUser, colab.id, {
      nome: 'Carlos Eduardo da Silva Mendes',
      banco: '237',
      agencia: '4321',
      conta: '99999',
      versaoEsperada: 1,
    });
    assert.strictEqual(resAtualizacao.versao, 2);

    passos.push({
      etapa: '2. Retificação de dados pessoais e bancários pelo RH',
      resultado: 'OK',
      mensagem: `Atualização concluída por ${rhUser.email} (versão ${resAtualizacao.versao}).`,
    });

    // Valida histórico de alterações do colaborador (RN-07 / US-17)
    const historico = db
      .prepare(`
        SELECT h.id, h.campo, h.valor_anterior, h.valor_novo, h.data_hora, u.nome as responsavel_nome, u.email as responsavel_email
        FROM historico_colaborador h
        LEFT JOIN usuarios u ON u.id = h.usuario_id
        WHERE h.colaborador_id = ?
        ORDER BY h.id ASC
      `)
      .all(colab.id) as any[];

    const histNome = historico.find((h) => h.campo === 'nome');
    assert.ok(histNome, 'Deve registrar alteração de nome no histórico');
    assert.strictEqual(histNome.valor_anterior, 'Carlos Eduardo Silva');
    assert.strictEqual(histNome.valor_novo, 'Carlos Eduardo da Silva Mendes');

    const histBanco = historico.find((h) => h.campo === 'banco');
    assert.ok(histBanco, 'Deve registrar alteração de banco no histórico');
    assert.strictEqual(histBanco.valor_anterior, '001');
    assert.strictEqual(histBanco.valor_novo, '237');

    const histConta = historico.find((h) => h.campo === 'conta');
    assert.ok(histConta, 'Deve registrar alteração de conta no histórico');
    assert.strictEqual(histConta.valor_anterior, '11111');
    assert.strictEqual(histConta.valor_novo, '99999');

    passos.push({
      etapa: '3. Conferência do histórico detalhado (anterior x novo, responsável e data/hora)',
      resultado: 'OK',
      mensagem: `${historico.length} alterações gravadas em historico_colaborador (nome, banco, agência e conta).`,
    });

    // Valida log de auditoria
    const logs = consultarLogs(db, diretoriaUser, { entidade: 'COLABORADOR', registroId: colab.id });
    const logAtt = logs.find((l: any) => l.acao === 'ATUALIZAR_COLABORADOR');
    assert.ok(logAtt, 'Deve registrar log imutável de atualização de dados');

    passos.push({
      etapa: '4. Validação do log de auditoria imutável',
      resultado: 'OK',
      mensagem: `Log ${logAtt.acao} consultado pela Diretoria (${diretoriaUser.email}) em ${logAtt.data_hora}.`,
    });

    const colabDepois = db
      .prepare('SELECT id, nome, cpf, banco, agencia, conta, versao, atualizado_em FROM colaboradores WHERE id = ?')
      .get(colab.id) as any;

    return {
      id: meta.id,
      codigo: meta.codigo,
      titulo: meta.titulo,
      regra: meta.regra,
      status: 'PASSOU',
      passos,
      destaqueVisual: {
        tipo: 'RETIFICACAO_DADOS',
        antes,
        depois: {
          nome: colabDepois.nome,
          banco: colabDepois.banco,
          agencia: colabDepois.agencia,
          conta: colabDepois.conta,
          versao: colabDepois.versao,
          atualizadoEm: colabDepois.atualizado_em,
        },
        historicoAlteracoes: historico,
        logAuditoria: logAtt,
      },
      evidenciasDb: {
        colaboradorAtual: colabDepois,
        historicoColaborador: historico,
        logsAuditoria: logs,
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
  const { db, rhUser, diretoriaUser, matrizId } = criarAmbienteIsolado();
  const passos: PassoResultado[] = [];

  try {
    // 1. Colaborador com vínculo ativo não pode ser eliminado
    const colabAtivo = criarColaborador(db, rhUser, {
      filialId: matrizId,
      nome: 'Colab Ativo LGPD',
      cpf: '52998224725',
      nascimento: '1995-02-14',
      admissao: '2024-01-01',
      cargo: 'Caixa',
      setor: 'Atendimento',
      salarioBase: '2200.00',
      banco: '001',
      agencia: '1234',
      conta: '12345',
    });

    const avalAtivo = avaliarRetencaoColaborador(db, colabAtivo.id);
    assert.strictEqual(avalAtivo.aptoParaEliminacao, false);
    assert.ok(avalAtivo.motivoBloqueio?.includes('vínculo ativo'));

    let erroAtivo = '';
    try {
      executarEliminacaoAnonimizacaoLGPD(db, rhUser, colabAtivo.id, {
        confirmacaoRH: true,
        justificativa: 'Solicitação indevida',
      });
      throw new Error('Eliminação de colaborador ativo deveria ser bloqueada!');
    } catch (e: any) {
      erroAtivo = e.message;
      assert.match(erroAtivo, /Eliminação rejeitada: Colaborador com vínculo ativo/);
    }
    passos.push({
      etapa: '1. Bloqueio de colaborador com vínculo ativo',
      resultado: 'BLOQUEADO',
      mensagem: erroAtivo,
      detalhes: { avaliacao: avalAtivo },
    });

    // 2. Colaborador desligado há apenas 2 anos (desligamento em 2024, referência em 2026)
    const colabRecente = criarColaborador(db, rhUser, {
      filialId: matrizId,
      nome: 'Colab Desligado Recente',
      cpf: '12345678909',
      nascimento: '1993-06-10',
      admissao: '2023-01-01',
      desligamento: '2024-05-01',
      cargo: 'Caixa',
      setor: 'Atendimento',
      salarioBase: '2200.00',
      banco: '001',
      agencia: '1234',
      conta: '54321',
    });
    db.prepare("UPDATE colaboradores SET situacao = 'INATIVO' WHERE id = ?").run(colabRecente.id);

    const avalRecente = avaliarRetencaoColaborador(db, colabRecente.id, '2026-10-01');
    assert.strictEqual(avalRecente.aptoParaEliminacao, false);
    assert.ok(avalRecente.motivoBloqueio?.includes('mínimo de retenção de 5 anos'));

    let erroRetencao = '';
    try {
      executarEliminacaoAnonimizacaoLGPD(db, rhUser, colabRecente.id, {
        confirmacaoRH: true,
        justificativa: 'Tentativa antes do prazo',
        dataReferencia: '2026-10-01',
      });
      throw new Error('Eliminação dentro do prazo de 5 anos deveria ser bloqueada!');
    } catch (e: any) {
      erroRetencao = e.message;
      assert.match(erroRetencao, /Eliminação rejeitada: .* Dentro do prazo legal mínimo de retenção de 5 anos/);
    }
    passos.push({
      etapa: '2. Bloqueio dentro do prazo mínimo de retenção (5 anos)',
      resultado: 'BLOQUEADO',
      mensagem: erroRetencao,
      detalhes: { avaliacao: avalRecente },
    });

    // 3. Exige confirmação expressa do RH
    let erroConfirmacao = '';
    try {
      executarEliminacaoAnonimizacaoLGPD(db, rhUser, colabRecente.id, {
        confirmacaoRH: false,
        justificativa: 'Sem confirmação',
      });
      throw new Error('Eliminação sem confirmação expressa do RH deveria ser bloqueada!');
    } catch (e: any) {
      erroConfirmacao = e.message;
      assert.match(erroConfirmacao, /A eliminação\/anonimização exige confirmação expressa do RH/);
    }
    passos.push({
      etapa: '3. Exigência de confirmação expressa do RH',
      resultado: 'BLOQUEADO',
      mensagem: erroConfirmacao,
    });

    // 4. Exige justificativa legal obrigatória
    let erroJustificativa = '';
    try {
      executarEliminacaoAnonimizacaoLGPD(db, rhUser, colabRecente.id, {
        confirmacaoRH: true,
        justificativa: '   ',
      });
      throw new Error('Eliminação sem justificativa legal deveria ser bloqueada!');
    } catch (e: any) {
      erroJustificativa = e.message;
      assert.match(erroJustificativa, /Informe a justificativa e o fundamento legal/);
    }
    passos.push({
      etapa: '4. Exigência de justificativa e fundamento legal',
      resultado: 'BLOQUEADO',
      mensagem: erroJustificativa,
    });

    // 5. Bloqueia perfil não autorizado
    let erroPerfil = '';
    try {
      executarEliminacaoAnonimizacaoLGPD(db, diretoriaUser as any, colabRecente.id, {
        confirmacaoRH: true,
        justificativa: 'Diretoria tentando descarte',
      });
      throw new Error('Perfil DIRETORIA não pode homologar eliminação!');
    } catch (e: any) {
      erroPerfil = e.message;
      assert.match(erroPerfil, /Apenas o perfil RH pode homologar a eliminação ou anonimização de dados/);
    }
    passos.push({
      etapa: '5. Bloqueio de perfil não autorizado (DIRETORIA)',
      resultado: 'BLOQUEADO',
      mensagem: erroPerfil,
    });

    const registrosPreservados = db
      .prepare('SELECT id, nome, situacao, desligamento FROM colaboradores WHERE id IN (?, ?) ORDER BY id ASC')
      .all(colabAtivo.id, colabRecente.id);

    return {
      id: meta.id,
      codigo: meta.codigo,
      titulo: meta.titulo,
      regra: meta.regra,
      status: 'PASSOU',
      passos,
      destaqueVisual: {
        tipo: 'BLOQUEIOS_RETENCAO',
        bloqueios: [
          {
            regra: 'Vínculo Ativo (LGPD art. 7º, V)',
            titular: colabAtivo.nome,
            aptoParaEliminacao: avalAtivo.aptoParaEliminacao,
            erroBackend: erroAtivo,
          },
          {
            regra: 'Prazo Mínimo de Retenção — 5 anos (CF art. 7º, XXIX)',
            titular: `${colabRecente.nome} (desligado em 2024-05-01; ref. 2026-10-01 = ${avalRecente.anosPosDesligamento} anos)`,
            aptoParaEliminacao: avalRecente.aptoParaEliminacao,
            erroBackend: erroRetencao,
          },
          {
            regra: 'Confirmação Expressa do RH (RN-56 / RNF-55)',
            titular: 'confirmacaoRH = false',
            aptoParaEliminacao: false,
            erroBackend: erroConfirmacao,
          },
          {
            regra: 'Justificativa e Fundamento Legal Obrigatórios',
            titular: 'justificativa = "" (vazia)',
            aptoParaEliminacao: false,
            erroBackend: erroJustificativa,
          },
          {
            regra: 'Segregação de Perfis (Somente RH homologa)',
            titular: `Usuário ${diretoriaUser.email} (DIRETORIA)`,
            aptoParaEliminacao: false,
            erroBackend: erroPerfil,
          },
        ],
      },
      evidenciasDb: {
        avaliacaoAtivo: avalAtivo,
        avaliacaoRecente: avalRecente,
        colaboradoresIntactos: registrosPreservados,
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
  const { db, rhUser, diretoriaUser, matrizId } = criarAmbienteIsolado();
  const passos: PassoResultado[] = [];

  try {
    // Colaborador desligado há mais de 5 anos (desligado em 2020, data de referência 2026-10-01)
    const colabAntigo = criarColaborador(db, rhUser, {
      filialId: matrizId,
      nome: 'Marcos Oliveira Desligado',
      cpf: '52998224725',
      nascimento: '1980-03-12',
      admissao: '2015-02-01',
      desligamento: '2020-05-01',
      cargo: 'Gerente Operacional',
      setor: 'Operações',
      salarioBase: '7000.00',
      banco: '237',
      agencia: '1122',
      conta: '334455',
      titularConta: 'Marcos Oliveira',
    });
    db.prepare("UPDATE colaboradores SET situacao = 'INATIVO' WHERE id = ?").run(colabAntigo.id);

    // Anexa documento pessoal (CNH) e cadastra exame ocupacional (ASO Demissional)
    anexarDocumento(db, rhUser, {
      colaboradorId: colabAntigo.id,
      tipo: 'CNH',
      nomeArquivo: 'cnh_marcos.pdf',
      dataValidade: '2022-01-01',
    });

    cadastrarExameOcupacional(db, rhUser, {
      colaboradorId: colabAntigo.id,
      tipo: 'ASO_DEMISSIONAL',
      dataUltimoExame: '2020-05-01',
      periodicidadeMeses: 12,
    });

    const antes = db
      .prepare('SELECT id, nome, cpf, banco, agencia, conta, titular_conta, situacao, desligamento FROM colaboradores WHERE id = ?')
      .get(colabAntigo.id) as any;

    // 1. Avalia retenção: pessoal vencido (> 5 anos), mas saúde retida (NR-7 - 20 anos)
    const aval = avaliarRetencaoColaborador(db, colabAntigo.id, '2026-10-01');
    assert.strictEqual(aval.aptoParaEliminacao, true);
    assert.strictEqual(aval.categorias.pessoaisEBancarios.vencido, true);
    assert.strictEqual(aval.categorias.saudeOcupacionalNR7.vencido, false, 'Exame ocupacional ainda não atingiu 20 anos');
    assert.strictEqual(aval.categorias.saudeOcupacionalNR7.retidoPorMaiorPrazo, true, 'Deve estar retido pelo maior prazo');

    passos.push({
      etapa: '1. Avaliação de prazos legais (Regra do Maior Prazo — RNF-29)',
      resultado: 'OK',
      mensagem: `Desligado há ${aval.anosPosDesligamento} anos: Pessoais/Bancários (5 anos) vencidos; Folha (10 anos) e Saúde NR-7 (20 anos) retidos.`,
    });

    // 2. Executa eliminação/anonimização com confirmação do RH
    const justificativaLegal = 'Prescrição trabalhista de 5 anos atingida (CF art. 7º, XXIX). Ausência de demandas judiciais ativas.';
    const resEliminacao = executarEliminacaoAnonimizacaoLGPD(db, rhUser, colabAntigo.id, {
      confirmacaoRH: true,
      justificativa: justificativaLegal,
      dataReferencia: '2026-10-01',
    });

    assert.strictEqual(resEliminacao.sucesso, true);
    assert.ok(resEliminacao.termo.termoId.startsWith('TERMO-LGPD-'));
    assert.strictEqual(resEliminacao.termo.status, 'CONCLUIDO');
    assert.ok(resEliminacao.termo.categoriasEliminadas.some((c: string) => c.includes('Pessoais e Dados Bancários')));
    assert.ok(resEliminacao.termo.categoriasRetidas.some((c: string) => c.includes('Saúde Ocupacional e Exames NR-7')));

    passos.push({
      etapa: '2. Execução da anonimização/eliminação homologada pelo RH',
      resultado: 'OK',
      mensagem: `Termo ${resEliminacao.termo.termoId} emitido com status ${resEliminacao.termo.status}.`,
    });

    // 3. Valida no banco de dados que dados pessoais e bancários foram anonimizados
    const colabApos = db
      .prepare('SELECT id, nome, cpf, banco, agencia, conta, titular_conta, situacao, desligamento FROM colaboradores WHERE id = ?')
      .get(colabAntigo.id) as any;
    assert.strictEqual(colabApos.banco, '***');
    assert.strictEqual(colabApos.agencia, '***');
    assert.strictEqual(colabApos.conta, '***');
    assert.strictEqual(colabApos.titular_conta, 'ANONIMIZADO');
    assert.strictEqual(colabApos.cpf, '00000000000');
    assert.ok(colabApos.nome.includes('ANONIMIZADO'));

    const docsApos = db.prepare('SELECT count(*) as qtd FROM documentos_colaborador WHERE colaborador_id = ?').get(colabAntigo.id) as any;
    assert.strictEqual(docsApos.qtd, 0, 'Documentos pessoais devem ser excluídos');

    // 4. REGRA DO MAIOR PRAZO (RNF-29): Exames ocupacionais PERMANECEM RETIDOS na tabela
    const examesApos = db.prepare('SELECT count(*) as qtd FROM exames_ocupacionais WHERE colaborador_id = ?').get(colabAntigo.id) as any;
    assert.strictEqual(examesApos.qtd, 1, 'Exame ocupacional deve permanecer retido conforme prazo maior de 20 anos da NR-7');
    const examesLista = db.prepare('SELECT id, tipo, data_ultimo_exame FROM exames_ocupacionais WHERE colaborador_id = ?').all(colabAntigo.id);

    passos.push({
      etapa: '3. Conferência de integridade no SQLite (anonimização + preservação NR-7)',
      resultado: 'OK',
      mensagem: `Dados pessoais/bancários anonimizados (CPF 00000000000, banco/conta ***), documentos pessoais = ${docsApos.qtd}, exames NR-7 preservados = ${examesApos.qtd}.`,
    });

    // 5. Valida gravação no log de auditoria imutável (RNF-03 / RNF-55)
    const logs = consultarLogs(db, diretoriaUser, { entidade: 'COLABORADOR', registroId: colabAntigo.id });
    const logEliminacao = logs.find((l: any) => l.acao === 'ELIMINACAO_DADOS_LGPD');
    assert.ok(logEliminacao, 'Deve registrar ação ELIMINACAO_DADOS_LGPD no log de auditoria');
    assert.ok(logEliminacao.detalhes.includes('TERMO-LGPD-'));
    assert.ok(logEliminacao.detalhes.includes('Prescrição trabalhista'));

    passos.push({
      etapa: '4. Registro no log de auditoria imutável (ELIMINACAO_DADOS_LGPD)',
      resultado: 'OK',
      mensagem: `Log gravado com referência ao termo ${resEliminacao.termo.termoId} e fundamento legal.`,
    });

    // 6. Geração do Termo de Eliminação em PDF (RNF-55)
    const pdfTermo = gerarTermoEliminacaoPDF(resEliminacao.termo);
    assert.ok(pdfTermo instanceof Buffer);
    assert.strictEqual(pdfTermo.subarray(0, 4).toString(), '%PDF', 'Deve gerar PDF válido do Termo de Eliminação');
    ultimoPdfTermo = pdfTermo;

    passos.push({
      etapa: '5. Geração do Termo de Eliminação em PDF (gerarTermoEliminacaoPDF)',
      resultado: 'OK',
      mensagem: `Termo em PDF real gerado (${pdfTermo.subarray(0, 8).toString('utf-8')}, ${pdfTermo.length} bytes).`,
    });

    return {
      id: meta.id,
      codigo: meta.codigo,
      titulo: meta.titulo,
      regra: meta.regra,
      status: 'PASSOU',
      passos,
      destaqueVisual: {
        tipo: 'ANONIMIZACAO_TERMO',
        avaliacaoRetencao: aval,
        antes,
        depois: colabApos,
        contadores: {
          documentosPessoaisAntes: 1,
          documentosPessoaisDepois: docsApos.qtd,
          examesNR7Antes: 1,
          examesNR7Depois: examesApos.qtd,
        },
        termo: resEliminacao.termo,
        pdf: {
          disponivel: true,
          url: '/api/pdf/termo',
          cabecalho: pdfTermo.subarray(0, 8).toString('utf-8'),
          tamanhoBytes: pdfTermo.length,
        },
        logAuditoria: logEliminacao,
      },
      evidenciasDb: {
        colaboradorApos: colabApos,
        examesOcupacionaisPreservados: examesLista,
        logsAuditoria: logs,
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
    default:
      throw new Error(`Cenário ${id} não encontrado.`);
  }
}

export function executarTodosCenarios(): CenarioResultado[] {
  return [1, 2, 3, 4].map((id) => executarCenario(id));
}
