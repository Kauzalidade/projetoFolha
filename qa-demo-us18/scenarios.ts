import assert from 'node:assert';
import { DatabaseSync } from 'node:sqlite';
import { SCHEMA_SQL } from '../back-end/src/db.js';
import { limparTodasSessoes } from '../back-end/src/security.js';
import { criarUsuario } from '../back-end/src/services/usuarioService.js';
import { inicializarFeriadosEParametros } from '../back-end/src/services/parametroFeriadoService.js';
import { consultarLogs } from '../back-end/src/services/logService.js';
import {
  registrarIncidenteSeguranca,
  atualizarIncidenteSeguranca,
  obterIncidenteSeguranca,
  decidirComunicacaoIncidente,
} from '../back-end/src/services/documentosAlertasService.js';

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

export interface MatrizPermissaoItem {
  acao: string;
  regra: string;
  rh: string;
  admin: string;
  diretoria: string;
  colaborador: string;
}

export const MATRIZ_PERMISSOES: MatrizPermissaoItem[] = [
  {
    acao: 'Registrar incidente de segurança',
    regra: 'RN-77 / US-18',
    rh: 'PERMITIDO',
    admin: 'PERMITIDO',
    diretoria: 'PERMITIDO',
    colaborador: 'BLOQUEADO',
  },
  {
    acao: 'Consultar incidente e histórico de providências',
    regra: 'RN-77 / US-18',
    rh: 'PERMITIDO',
    admin: 'PERMITIDO',
    diretoria: 'PERMITIDO',
    colaborador: 'BLOQUEADO',
  },
  {
    acao: 'Tratar, registrar providências e encerrar (EM_TRATAMENTO / ENCERRADO)',
    regra: 'RN-77 / US-18',
    rh: 'BLOQUEADO',
    admin: 'PERMITIDO',
    diretoria: 'PERMITIDO',
    colaborador: 'BLOQUEADO',
  },
  {
    acao: 'Decidir comunicação à ANPD e aos titulares (com parecer jurídico)',
    regra: 'RN-77 / US-18 (LGPD art. 48)',
    rh: 'BLOQUEADO',
    admin: 'BLOQUEADO',
    diretoria: 'PERMITIDO (parecer obrigatório)',
    colaborador: 'BLOQUEADO',
  },
];

export const CENARIOS_META = [
  {
    id: 1,
    codigo: 'US-18 / Cenário 1',
    titulo: '1. Registro completo do incidente',
    regra: 'RN-77 — Registro pelo RH, campos obrigatórios, estado inicial ABERTO e log REGISTRAR_INCIDENTE_SEGURANCA',
  },
  {
    id: 2,
    codigo: 'US-18 / Cenário 2',
    titulo: '2. Tratamento, histórico e permissões',
    regra: 'RN-77 — Bloqueio ao RH, tratamento por Admin (EM_TRATAMENTO) e Diretoria (ENCERRADO), histórico cronológico e log',
  },
  {
    id: 3,
    codigo: 'US-18 / Cenário 3',
    titulo: '3. Decisão de comunicação à ANPD e aos titulares',
    regra: 'RN-77 / LGPD art. 48 — Bloqueio a RH/Admin e sem parecer, decisão pela Diretoria e log DECISAO_COMUNICACAO_INCIDENTE_LGPD',
  },
];

interface AmbienteDemo {
  db: DatabaseSync;
  adminUser: { id: number; email: string; perfil: string };
  rhUser: { id: number; email: string; perfil: string };
  diretoriaUser: { id: number; email: string; perfil: string };
}

function criarAmbienteIsolado(): AmbienteDemo {
  limparTodasSessoes();
  const db = new DatabaseSync(':memory:');
  db.exec(SCHEMA_SQL);
  inicializarFeriadosEParametros(db);

  const adminUser = { id: 1, email: 'admin.demo@folha.local', perfil: 'ADMIN' };

  const uRH = criarUsuario(db, adminUser, {
    nome: 'Analista RH Demo',
    email: 'rh.demo@folha.local',
    senha: 'DemoPass!2026A',
    perfil: 'RH',
  });

  const uDir = criarUsuario(db, adminUser, {
    nome: 'Diretoria Demo',
    email: 'diretoria.demo@folha.local',
    senha: 'DemoPass!2026B',
    perfil: 'DIRETORIA',
  });

  return {
    db,
    adminUser,
    rhUser: { id: uRH.id, email: uRH.email, perfil: 'RH' },
    diretoriaUser: { id: uDir.id, email: uDir.email, perfil: 'DIRETORIA' },
  };
}

function executarCenario1(): CenarioResultado {
  const t0 = Date.now();
  const meta = CENARIOS_META[0];
  const { db, rhUser, diretoriaUser } = criarAmbienteIsolado();
  const passos: PassoResultado[] = [];

  try {
    // 1. RH registra incidente
    const incRH = registrarIncidenteSeguranca(db, rhUser, {
      descricao: 'Envio incorreto de e-mail com relatório de folha contendo CPFs.',
      dadosAfetados: 'CPF, Nome e Salário Líquido',
      pessoasAfetadas: '15 colaboradores do setor de operações',
      providenciasIniciais: 'E-mail recall solicitado e destinatário orientado a apagar.',
    });

    assert.ok(incRH.id > 0);
    assert.strictEqual(incRH.situacao, 'ABERTO');
    assert.ok(incRH.criadoEm);

    passos.push({
      etapa: '1. Registro de incidente pelo RH',
      resultado: 'OK',
      mensagem: `Incidente #${incRH.id} registrado por ${rhUser.email} com situação inicial ${incRH.situacao}.`,
    });

    // 2. Validação da consulta detalhada
    const detalhe = obterIncidenteSeguranca(db, rhUser, incRH.id);
    assert.strictEqual(detalhe.id, incRH.id);
    assert.strictEqual(detalhe.descricao, 'Envio incorreto de e-mail com relatório de folha contendo CPFs.');
    assert.strictEqual(detalhe.dadosAfetados, 'CPF, Nome e Salário Líquido');
    assert.strictEqual(detalhe.pessoasAfetadas, '15 colaboradores do setor de operações');
    assert.strictEqual(detalhe.responsavel.id, rhUser.id);
    assert.strictEqual(detalhe.responsavel.email, rhUser.email);
    assert.strictEqual(detalhe.situacao, 'ABERTO');
    assert.strictEqual(detalhe.comunicarANPD, false);
    assert.strictEqual(detalhe.comunicarTitulares, false);

    passos.push({
      etapa: '2. Consulta completa dos campos registrados e situação ABERTO',
      resultado: 'OK',
      mensagem: `Descrição, dados afetados, pessoas afetadas, responsável (${detalhe.responsavel.email}) e data/hora (${detalhe.dataHora}) confirmados.`,
    });

    // 3. Rejeição de campos obrigatórios vazios
    let erroCamposVazios = '';
    try {
      registrarIncidenteSeguranca(db, rhUser, { descricao: '', dadosAfetados: 'x', pessoasAfetadas: 'y' });
      throw new Error('Campos obrigatórios vazios deveriam ser rejeitados!');
    } catch (e: any) {
      erroCamposVazios = e.message;
      assert.match(erroCamposVazios, /Informe a descrição, os dados possivelmente afetados e as pessoas afetadas/);
    }

    passos.push({
      etapa: '3. Rejeição de campos obrigatórios vazios',
      resultado: 'BLOQUEADO',
      mensagem: `Validação confirmada: "${erroCamposVazios}"`,
    });

    // 4. Log de auditoria imutável
    const logs = consultarLogs(db, diretoriaUser, { entidade: 'INCIDENTE', registroId: incRH.id });
    const logRegistro = logs.find((l: any) => l.acao === 'REGISTRAR_INCIDENTE_SEGURANCA');
    assert.ok(logRegistro, 'Deve registrar log de auditoria do registro do incidente');
    assert.strictEqual(logRegistro.usuario_email, rhUser.email);

    passos.push({
      etapa: '4. Log imutável REGISTRAR_INCIDENTE_SEGURANCA',
      resultado: 'OK',
      mensagem: `Log ${logRegistro.acao} gravado para ${logRegistro.usuario_email} em ${logRegistro.data_hora}.`,
    });

    return {
      id: meta.id,
      codigo: meta.codigo,
      titulo: meta.titulo,
      regra: meta.regra,
      status: 'PASSOU',
      passos,
      destaqueVisual: {
        tipo: 'REGISTRO_INCIDENTE',
        incidente: detalhe,
        validacaoCamposVazios: erroCamposVazios,
        logAuditoria: logRegistro,
      },
      evidenciasDb: {
        incidenteRow: db.prepare('SELECT * FROM incidentes_seguranca WHERE id = ?').get(incRH.id),
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
  const { db, adminUser, rhUser, diretoriaUser } = criarAmbienteIsolado();
  const passos: PassoResultado[] = [];

  try {
    // 1. Registro inicial pelo RH
    const inc = registrarIncidenteSeguranca(db, rhUser, {
      descricao: 'Pen drive não criptografado com planilhas de pagamento esquecido em sala de reunião.',
      dadosAfetados: 'Dados cadastrais e remunerações de 40 colaboradores',
      pessoasAfetadas: '40 colaboradores',
    });
    passos.push({
      etapa: '1. Registro inicial do incidente pelo RH (ABERTO)',
      resultado: 'OK',
      mensagem: `Incidente #${inc.id} aberto por ${rhUser.email}.`,
    });

    // 2. RH tenta tratar/encerrar -> bloqueado
    let erroRH = '';
    try {
      atualizarIncidenteSeguranca(db, rhUser, inc.id, {
        providencias: 'RH tenta fechar',
        situacao: 'ENCERRADO',
      });
      throw new Error('RH não deveria poder tratar ou encerrar incidente!');
    } catch (e: any) {
      erroRH = e.message;
      assert.match(erroRH, /Apenas Diretoria e Admin podem tratar e encerrar incidentes de segurança/);
    }
    passos.push({
      etapa: '2. Tentativa de tratamento e encerramento pelo RH',
      resultado: 'BLOQUEADO',
      mensagem: `Bloqueio real confirmado: "${erroRH}"`,
    });

    // 3. Admin registra 1ª providência e altera para EM_TRATAMENTO
    atualizarIncidenteSeguranca(db, adminUser, inc.id, {
      providencias: 'Dispositivo recolhido pelo suporte de TI. Iniciada perícia de logs de acesso.',
      situacao: 'EM_TRATAMENTO',
    });

    let detalhe = obterIncidenteSeguranca(db, adminUser, inc.id);
    assert.strictEqual(detalhe.situacao, 'EM_TRATAMENTO');
    assert.strictEqual(detalhe.historicoProvidencias.length, 1);
    assert.strictEqual(detalhe.historicoProvidencias[0].usuarioEmail, adminUser.email);
    assert.ok(detalhe.historicoProvidencias[0].descricao.includes('Dispositivo recolhido'));

    passos.push({
      etapa: '3. Admin registra providência e altera situação para EM_TRATAMENTO',
      resultado: 'OK',
      mensagem: `1ª providência registrada por ${adminUser.email} (ADMIN) -> EM_TRATAMENTO.`,
    });

    // 4. Diretoria registra 2ª providência e altera para ENCERRADO
    atualizarIncidenteSeguranca(db, diretoriaUser, inc.id, {
      providencias: 'Perícia confirmou ausência de cópia ou acesso indevido. Arquivos destruídos com segurança.',
      situacao: 'ENCERRADO',
    });

    detalhe = obterIncidenteSeguranca(db, diretoriaUser, inc.id);
    assert.strictEqual(detalhe.situacao, 'ENCERRADO');
    assert.strictEqual(detalhe.historicoProvidencias.length, 2);
    assert.ok(detalhe.historicoProvidencias[1].descricao.includes('Perícia confirmou ausência'));
    assert.strictEqual(detalhe.historicoProvidencias[1].usuarioEmail, diretoriaUser.email);
    assert.strictEqual(detalhe.historicoProvidencias[1].situacaoResultante, 'ENCERRADO');

    passos.push({
      etapa: '4. Diretoria registra nova providência e encerra (ENCERRADO)',
      resultado: 'OK',
      mensagem: `2ª providência registrada por ${diretoriaUser.email} (DIRETORIA) -> ENCERRADO.`,
    });

    // 5. RH consulta histórico completo das providências
    const detalheRH = obterIncidenteSeguranca(db, rhUser, inc.id);
    assert.strictEqual(detalheRH.historicoProvidencias.length, 2);
    assert.strictEqual(detalheRH.situacao, 'ENCERRADO');

    passos.push({
      etapa: '5. RH consulta histórico cronológico completo',
      resultado: 'OK',
      mensagem: `RH visualizou ${detalheRH.historicoProvidencias.length} providências em ordem cronológica (situação final: ${detalheRH.situacao}).`,
    });

    // 6. Logs de auditoria TRATAR_INCIDENTE_SEGURANCA
    const logs = consultarLogs(db, diretoriaUser, { entidade: 'INCIDENTE', registroId: inc.id });
    const logsTratamento = logs.filter((l: any) => l.acao === 'TRATAR_INCIDENTE_SEGURANCA');
    assert.strictEqual(logsTratamento.length, 2);

    passos.push({
      etapa: '6. Validação dos logs TRATAR_INCIDENTE_SEGURANCA',
      resultado: 'OK',
      mensagem: `${logsTratamento.length} registros TRATAR_INCIDENTE_SEGURANCA gravados no log imutável.`,
    });

    return {
      id: meta.id,
      codigo: meta.codigo,
      titulo: meta.titulo,
      regra: meta.regra,
      status: 'PASSOU',
      passos,
      destaqueVisual: {
        tipo: 'TRATAMENTO_HISTORICO',
        incidenteId: inc.id,
        descricaoIncidente: detalheRH.descricao,
        situacaoFinal: detalheRH.situacao,
        bloqueioRH: erroRH,
        historicoCronologico: detalheRH.historicoProvidencias,
        logsTratamento,
      },
      evidenciasDb: {
        incidenteRow: db.prepare('SELECT id, situacao, responsavel_email, atualizado_em FROM incidentes_seguranca WHERE id = ?').get(inc.id),
        providenciasRows: db.prepare('SELECT * FROM incidentes_providencias WHERE incidente_id = ? ORDER BY id ASC').all(inc.id),
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
  const { db, adminUser, rhUser, diretoriaUser } = criarAmbienteIsolado();
  const passos: PassoResultado[] = [];

  try {
    // 1. Registro de incidente com potencial risco
    const inc = registrarIncidenteSeguranca(db, rhUser, {
      descricao: 'Acesso não autorizado detectado em servidor de backup contendo extratos bancários.',
      dadosAfetados: 'Dados bancários e valores líquidos de rescisões',
      pessoasAfetadas: '85 colaboradores',
    });
    passos.push({
      etapa: '1. Registro do incidente com potencial risco aos titulares',
      resultado: 'OK',
      mensagem: `Incidente #${inc.id} registrado por ${rhUser.email} (${inc.situacao}).`,
    });

    // 2. Bloqueio de decisão pelo RH
    let erroRH = '';
    try {
      decidirComunicacaoIncidente(db, rhUser, inc.id, {
        comunicarANPD: true,
        comunicarTitulares: true,
        orientacaoJuridica: 'RH acha que deve comunicar',
      });
      throw new Error('RH não deveria poder decidir comunicação!');
    } catch (e: any) {
      erroRH = e.message;
      assert.match(erroRH, /Apenas a Diretoria, com orientação jurídica, pode decidir sobre a comunicação à ANPD e aos titulares/);
    }
    passos.push({
      etapa: '2. Bloqueio de decisão pelo RH',
      resultado: 'BLOQUEADO',
      mensagem: erroRH,
    });

    // 3. Bloqueio de decisão pelo Admin
    let erroAdmin = '';
    try {
      decidirComunicacaoIncidente(db, adminUser, inc.id, {
        comunicarANPD: true,
        comunicarTitulares: false,
        orientacaoJuridica: 'TI e Admin recomendam notificação',
      });
      throw new Error('Admin não deveria poder decidir comunicação!');
    } catch (e: any) {
      erroAdmin = e.message;
      assert.match(erroAdmin, /Apenas a Diretoria, com orientação jurídica, pode decidir sobre a comunicação à ANPD e aos titulares/);
    }
    passos.push({
      etapa: '3. Bloqueio de decisão pelo Admin',
      resultado: 'BLOQUEADO',
      mensagem: erroAdmin,
    });

    // 4. Bloqueio de decisão pela Diretoria sem orientação jurídica
    let erroSemParecer = '';
    try {
      decidirComunicacaoIncidente(db, diretoriaUser, inc.id, {
        comunicarANPD: true,
        comunicarTitulares: true,
        orientacaoJuridica: '   ',
      });
      throw new Error('Decisão sem parecer jurídico deveria ser bloqueada!');
    } catch (e: any) {
      erroSemParecer = e.message;
      assert.match(erroSemParecer, /A orientação jurídica e fundamentação técnica são obrigatórias para a decisão de comunicação/);
    }
    passos.push({
      etapa: '4. Bloqueio de decisão pela Diretoria sem orientação jurídica',
      resultado: 'BLOQUEADO',
      mensagem: erroSemParecer,
    });

    // 5. Decisão válida pela Diretoria com parecer jurídico fictício (sem disparo externo real)
    const parecer =
      'Parecer Jurídico nº 14/2026: Conforme art. 48 da LGPD e Resolução CD/ANPD nº 15/2024, recomenda-se a comunicação imediata à ANPD em até 3 dias úteis e aos titulares afetados, devido ao risco potencial aos direitos fundamentais decorrente da natureza dos dados bancários.';
    const decisao = decidirComunicacaoIncidente(db, diretoriaUser, inc.id, {
      comunicarANPD: true,
      comunicarTitulares: true,
      orientacaoJuridica: parecer,
    });

    assert.strictEqual(decisao.incidenteId, inc.id);
    assert.strictEqual(decisao.comunicarANPD, true);
    assert.strictEqual(decisao.comunicarTitulares, true);
    assert.strictEqual(decisao.orientacaoJuridica, parecer);
    assert.strictEqual(decisao.decisaoPor, diretoriaUser.email);
    assert.ok(decisao.decisaoEm);

    const detalhe = obterIncidenteSeguranca(db, diretoriaUser, inc.id);
    assert.strictEqual(detalhe.comunicarANPD, true);
    assert.strictEqual(detalhe.comunicarTitulares, true);
    assert.strictEqual(detalhe.orientacaoJuridica, parecer);
    assert.strictEqual(detalhe.decisaoComunicacaoPor, diretoriaUser.email);
    assert.ok(detalhe.historicoProvidencias.some((p: any) => p.descricao.includes('Parecer Jurídico nº 14/2026')));

    passos.push({
      etapa: '5. Decisão válida registrada pela Diretoria com parecer jurídico (somente registro interno)',
      resultado: 'OK',
      mensagem: `Decisão gravada por ${decisao.decisaoPor} em ${decisao.decisaoEm} (ANPD=SIM, Titulares=SIM). Nenhuma comunicação externa real disparada.`,
    });

    // 6. Log DECISAO_COMUNICACAO_INCIDENTE_LGPD
    const logs = consultarLogs(db, diretoriaUser, { entidade: 'INCIDENTE', registroId: inc.id });
    const logDecisao = logs.find((l: any) => l.acao === 'DECISAO_COMUNICACAO_INCIDENTE_LGPD');
    assert.ok(logDecisao, 'Deve registrar log DECISAO_COMUNICACAO_INCIDENTE_LGPD');
    assert.strictEqual(logDecisao.usuario_email, diretoriaUser.email);
    assert.strictEqual(logDecisao.usuario_perfil, 'DIRETORIA');
    assert.ok(logDecisao.detalhes.includes('ANPD=SIM'));

    passos.push({
      etapa: '6. Validação do log DECISAO_COMUNICACAO_INCIDENTE_LGPD',
      resultado: 'OK',
      mensagem: `Log ${logDecisao.acao} registrado por ${logDecisao.usuario_email} (${logDecisao.usuario_perfil}).`,
    });

    return {
      id: meta.id,
      codigo: meta.codigo,
      titulo: meta.titulo,
      regra: meta.regra,
      status: 'PASSOU',
      passos,
      destaqueVisual: {
        tipo: 'DECISAO_ANPD',
        bloqueios: [
          { perfilOuRegra: 'Perfil RH', erro: erroRH },
          { perfilOuRegra: 'Perfil ADMIN', erro: erroAdmin },
          { perfilOuRegra: 'DIRETORIA sem orientação jurídica', erro: erroSemParecer },
        ],
        decisao,
        detalheIncidente: {
          id: detalhe.id,
          descricao: detalhe.descricao,
          comunicarANPD: detalhe.comunicarANPD,
          comunicarTitulares: detalhe.comunicarTitulares,
          orientacaoJuridica: detalhe.orientacaoJuridica,
          decisaoComunicacaoPor: detalhe.decisaoComunicacaoPor,
          decisaoComunicacaoEm: detalhe.decisaoComunicacaoEm,
        },
        avisoSemEnvioExterno: 'Nenhuma comunicação externa real foi enviada à ANPD ou aos titulares neste ambiente isolado.',
        logAuditoria: logDecisao,
      },
      evidenciasDb: {
        incidenteRow: db.prepare('SELECT id, comunicar_anpd, comunicar_titulares, orientacao_juridica, decisao_comunicacao_email, decisao_comunicacao_em FROM incidentes_seguranca WHERE id = ?').get(inc.id),
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
    default:
      throw new Error(`Cenário ${id} não encontrado.`);
  }
}

export function executarTodosCenarios(): CenarioResultado[] {
  return [1, 2, 3].map((id) => executarCenario(id));
}
