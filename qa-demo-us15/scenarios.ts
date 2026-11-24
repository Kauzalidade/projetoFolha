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
import {
  calcularFolhaColaborador,
  calcularFolhaCompetenciaLote,
  confirmarConferenciaFolha,
  fecharFolhaSegura,
} from '../back-end/src/services/folhaService.js';

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
  antes: Record<string, unknown>;
  passos: PassoResultado[];
  depois: Record<string, unknown>;
  evidenciasDb: Record<string, unknown>;
  executadoEm: string;
  duracaoMs: number;
}

export const CENARIOS_META = [
  { id: 1, codigo: 'US-15 / RN-64', titulo: '1. Rollback do cálculo em lote após falha individual' },
  { id: 2, codigo: 'US-15 / RN-64', titulo: '2. Cálculo em lote bem-sucedido' },
  { id: 3, codigo: 'US-15 / RN-65 & RN-71', titulo: '3. Duplo clique no fechamento sem duplicidade de registros' },
  { id: 4, codigo: 'US-15 / RN-65', titulo: '4. Evento duplicado exigindo confirmação do RH' },
  { id: 5, codigo: 'US-15 / RNF-24', titulo: '5. Reenvio de cadastro sem duplicidade' },
  { id: 6, codigo: 'US-15 / RN-71', titulo: '6. Bloqueio de edição durante processamento' },
  { id: 7, codigo: 'US-15 / RNF-25', titulo: '7. Conflito de versão entre dois usuários' },
];

function criarBancoIsolado() {
  limparTodasSessoes();
  const db = new DatabaseSync(':memory:');
  db.exec(SCHEMA_SQL);
  inicializarFeriadosEParametros(db);

  const adminUser = { id: 1, email: 'admin@empresa.com', perfil: 'ADMIN' };
  const uRH1 = criarUsuario(db, adminUser, {
    nome: 'Analista RH 1',
    email: 'rh1@empresa.com',
    senha: 'SenhaForte123',
    perfil: 'RH',
  });
  const uRH2 = criarUsuario(db, adminUser, {
    nome: 'Analista RH 2',
    email: 'rh2@empresa.com',
    senha: 'SenhaForte456',
    perfil: 'RH',
  });

  const rhUser = { id: uRH1.id, email: uRH1.email, perfil: 'RH' };
  const outroRhUser = { id: uRH2.id, email: uRH2.email, perfil: 'RH' };
  const filial = criarFilial(db, rhUser, { nome: 'Matriz São Paulo', tipo: 'MATRIZ' });

  return { db, rhUser, outroRhUser, matrizId: filial.id };
}

function executarCenario1(): CenarioResultado {
  const t0 = Date.now();
  const { db, rhUser, matrizId } = criarBancoIsolado();

  const comp = abrirOuObterCompetencia(db, rhUser, '2027-01');
  criarColaborador(db, rhUser, {
    filialId: matrizId,
    nome: 'Ana Beatriz (Válida)',
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
  criarColaborador(db, rhUser, {
    filialId: matrizId,
    nome: 'Bruno Costa (Válido)',
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
  const colabFalha = criarColaborador(db, rhUser, {
    filialId: matrizId,
    nome: 'Carlos Falha (Salário Inválido)',
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
  db.prepare('UPDATE colaboradores SET salario_base_centavos = -100 WHERE id = ?').run(colabFalha.id);

  const compAntes = db.prepare('SELECT situacao, em_processamento FROM competencias WHERE id = ?').get(comp.id) as any;
  const folhasAntes = (db.prepare('SELECT COUNT(*) as total FROM folhas WHERE competencia_id = ?').get(comp.id) as any).total;
  const logsAntes = (db.prepare("SELECT COUNT(*) as total FROM logs_auditoria WHERE acao = 'OPERACAO_CALCULO' AND valor_novo = 'CANCELADA'").get() as any).total;

  const antes = {
    competencia: '2027-01',
    situacaoCompetencia: compAntes.situacao,
    emProcessamento: compAntes.em_processamento,
    colaboradoresAtivos: 3,
    colaboradorCorrompido: `${colabFalha.nome} (salario_base_centavos = -100)`,
    folhasPersistidas: folhasAntes,
    logsCancelamento: logsAntes,
  };

  const resultado = calcularFolhaCompetenciaLote(db, rhUser, { competenciaId: comp.id });

  const compDepois = db.prepare('SELECT situacao, em_processamento FROM competencias WHERE id = ?').get(comp.id) as any;
  const folhasDepois = (db.prepare('SELECT COUNT(*) as total FROM folhas WHERE competencia_id = ?').get(comp.id) as any).total;
  const logsCancelados = db.prepare("SELECT registro_id, acao, valor_novo, detalhes FROM logs_auditoria WHERE acao = 'OPERACAO_CALCULO' AND valor_novo = 'CANCELADA'").all() as any[];

  const passos: PassoResultado[] = [
    {
      etapa: 'Executar calcularFolhaCompetenciaLote(2027-01)',
      resultado: resultado.sucesso ? 'OK' : 'BLOQUEADO',
      mensagem: resultado.mensagem,
      detalhes: {
        sucesso: resultado.sucesso,
        concluida: resultado.concluida,
        totalCalculados: resultado.totalCalculados,
        falhas: resultado.falhas,
      },
    },
  ];

  const depois = {
    competencia: '2027-01',
    situacaoCompetencia: compDepois.situacao,
    emProcessamento: compDepois.em_processamento,
    totalCalculados: resultado.totalCalculados,
    folhasPersistidas: folhasDepois,
    falhasDetectadas: resultado.falhas,
    logsCancelamento: logsCancelados.length,
  };

  let status: 'PASSOU' | 'FALHOU' = 'PASSOU';
  let erroValidacao: string | undefined;
  try {
    assert.strictEqual(resultado.sucesso, false);
    assert.strictEqual(resultado.concluida, false);
    assert.ok(resultado.falhas.length > 0);
    assert.ok(resultado.falhas.some((f) => f.colaboradorId === colabFalha.id));
    assert.strictEqual(folhasDepois, 0);
    assert.strictEqual(compDepois.situacao, 'ABERTA');
    assert.strictEqual(compDepois.em_processamento, 0);
    assert.ok(logsCancelados.length > 0);
  } catch (e: any) {
    status = 'FALHOU';
    erroValidacao = e.message;
  }

  return {
    id: 1,
    codigo: 'US-15 / RN-64, RNF-22, RNF-23',
    titulo: '1. Rollback do cálculo em lote após falha individual',
    regra: 'Falha em um colaborador desfaz todo o lote (SAVEPOINT/ROLLBACK), mantém resultado anterior e registra operação CANCELADA.',
    status,
    erroValidacao,
    antes,
    passos,
    depois,
    evidenciasDb: {
      folhasNoBanco: folhasDepois,
      ultimoLogCritico: logsCancelados[logsCancelados.length - 1] ?? null,
    },
    executadoEm: new Date().toISOString(),
    duracaoMs: Date.now() - t0,
  };
}

function executarCenario2(): CenarioResultado {
  const t0 = Date.now();
  const { db, rhUser, matrizId } = criarBancoIsolado();

  const comp = abrirOuObterCompetencia(db, rhUser, '2027-02');
  criarColaborador(db, rhUser, {
    filialId: matrizId,
    nome: 'Sucesso Total (Engenharia)',
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

  const compAntes = db.prepare('SELECT situacao, em_processamento FROM competencias WHERE id = ?').get(comp.id) as any;
  const folhasAntes = (db.prepare('SELECT COUNT(*) as total FROM folhas WHERE competencia_id = ?').get(comp.id) as any).total;

  const antes = {
    competencia: '2027-02',
    situacaoCompetencia: compAntes.situacao,
    emProcessamento: compAntes.em_processamento,
    colaboradoresAtivos: 1,
    folhasPersistidas: folhasAntes,
  };

  const resultado = calcularFolhaCompetenciaLote(db, rhUser, { competenciaId: comp.id });

  const compDepois = db.prepare('SELECT situacao, em_processamento FROM competencias WHERE id = ?').get(comp.id) as any;
  const folhasDepois = db.prepare('SELECT colaborador_id, total_proventos_centavos, total_descontos_centavos, liquido_centavos FROM folhas WHERE competencia_id = ?').all(comp.id) as any[];
  const logsConcluidos = db.prepare("SELECT registro_id, acao, valor_novo, detalhes FROM logs_auditoria WHERE acao = 'OPERACAO_CALCULO' AND valor_novo = 'CONCLUIDA'").all() as any[];

  const passos: PassoResultado[] = [
    {
      etapa: 'Executar calcularFolhaCompetenciaLote(2027-02)',
      resultado: resultado.sucesso ? 'OK' : 'ERRO',
      mensagem: resultado.mensagem,
      detalhes: {
        sucesso: resultado.sucesso,
        concluida: resultado.concluida,
        totalCalculados: resultado.totalCalculados,
        falhas: resultado.falhas,
      },
    },
  ];

  const depois = {
    competencia: '2027-02',
    situacaoCompetencia: compDepois.situacao,
    emProcessamento: compDepois.em_processamento,
    totalCalculados: resultado.totalCalculados,
    folhasPersistidas: folhasDepois.length,
    logsConcluidos: logsConcluidos.length,
  };

  let status: 'PASSOU' | 'FALHOU' = 'PASSOU';
  let erroValidacao: string | undefined;
  try {
    assert.strictEqual(resultado.sucesso, true);
    assert.strictEqual(resultado.concluida, true);
    assert.strictEqual(resultado.falhas.length, 0);
    assert.strictEqual(resultado.totalCalculados, 1);
    assert.strictEqual(compDepois.situacao, 'CALCULADA');
    assert.strictEqual(compDepois.em_processamento, 0);
    assert.ok(logsConcluidos.length > 0);
  } catch (e: any) {
    status = 'FALHOU';
    erroValidacao = e.message;
  }

  return {
    id: 2,
    codigo: 'US-15 / RN-64, RNF-23',
    titulo: '2. Cálculo em lote bem-sucedido',
    regra: 'Sem falhas individuais, comita todas as folhas, atualiza competência para CALCULADA e grava log CONCLUIDA.',
    status,
    erroValidacao,
    antes,
    passos,
    depois,
    evidenciasDb: {
      folhasGravadas: folhasDepois.map((f) => ({
        colaboradorId: f.colaborador_id,
        proventos: f.total_proventos_centavos / 100,
        descontos: f.total_descontos_centavos / 100,
        liquido: f.liquido_centavos / 100,
      })),
      ultimoLogCritico: logsConcluidos[logsConcluidos.length - 1] ?? null,
    },
    executadoEm: new Date().toISOString(),
    duracaoMs: Date.now() - t0,
  };
}

function executarCenario3(): CenarioResultado {
  const t0 = Date.now();
  const { db, rhUser, matrizId } = criarBancoIsolado();

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

  calcularFolhaColaborador(db, rhUser, { colaboradorId: colab.id, competenciaId: comp.id });
  confirmarConferenciaFolha(db, rhUser, comp.id, 'Conferência OK');

  const compAntes = db.prepare('SELECT situacao FROM competencias WHERE id = ?').get(comp.id) as any;
  const versoesAntes = (db.prepare('SELECT COUNT(*) as total FROM folha_versoes WHERE competencia_id = ?').get(comp.id) as any).total;
  const logsAntes = (db.prepare("SELECT COUNT(*) as total FROM logs_auditoria WHERE acao = 'FECHAR_FOLHA_COMPETENCIA' AND registro_id = ?").get(String(comp.id)) as any).total;

  const antes = {
    competencia: '2027-03',
    situacaoCompetencia: compAntes.situacao,
    versoesGravadas: versoesAntes,
    logsFechamento: logsAntes,
  };

  const fechamento1 = fecharFolhaSegura(db, rhUser, comp.id);
  const fechamento2 = fecharFolhaSegura(db, rhUser, comp.id);

  const compDepois = db.prepare('SELECT situacao FROM competencias WHERE id = ?').get(comp.id) as any;
  const versoesDepois = db.prepare('SELECT versao_numero, hash_sha256, liquido_centavos FROM folha_versoes WHERE competencia_id = ?').all(comp.id) as any[];
  const logsDepois = (db.prepare("SELECT COUNT(*) as total FROM logs_auditoria WHERE acao = 'FECHAR_FOLHA_COMPETENCIA' AND registro_id = ?").get(String(comp.id)) as any).total;

  const passos: PassoResultado[] = [
    {
      etapa: '1º Clique em Fechar Folha',
      resultado: 'OK',
      mensagem: `Folha fechada na versão ${fechamento1.versao}`,
      detalhes: {
        versao: fechamento1.versao,
        hashSha256: fechamento1.hashSha256,
        totalLiquido: fechamento1.totalLiquido,
      },
    },
    {
      etapa: '2º Clique imediato em Fechar Folha (Duplo Clique)',
      resultado: 'OK',
      mensagem: fechamento2.mensagem || 'Duplo clique tratado sem duplicação',
      detalhes: {
        versao: fechamento2.versao,
        duploCliqueIgnorado: fechamento2.duploCliqueIgnorado,
        hashSha256: fechamento2.hashSha256,
      },
    },
  ];

  const depois = {
    competencia: '2027-03',
    situacaoCompetencia: compDepois.situacao,
    versoesGravadas: versoesDepois.length,
    logsFechamento: logsDepois,
    duploCliqueIgnorado: fechamento2.duploCliqueIgnorado,
  };

  let status: 'PASSOU' | 'FALHOU' = 'PASSOU';
  let erroValidacao: string | undefined;
  try {
    assert.strictEqual(fechamento1.versao, 'V1');
    assert.strictEqual(fechamento2.versao, 'V1');
    assert.strictEqual(fechamento2.duploCliqueIgnorado, true);
    assert.strictEqual(versoesDepois.length, 1);
    assert.strictEqual(logsDepois, 1);
  } catch (e: any) {
    status = 'FALHOU';
    erroValidacao = e.message;
  }

  return {
    id: 3,
    codigo: 'US-15 / RN-65 & RN-71',
    titulo: '3. Duplo clique no fechamento sem duplicidade de registros',
    regra: 'Segundo clique imediato no fechamento é idempotente: retorna V1 existente e não cria V2 nem log duplicado.',
    status,
    erroValidacao,
    antes,
    passos,
    depois,
    evidenciasDb: {
      versoesNoBanco: versoesDepois,
      totalLogsFechamento: logsDepois,
    },
    executadoEm: new Date().toISOString(),
    duracaoMs: Date.now() - t0,
  };
}

function executarCenario4(): CenarioResultado {
  const t0 = Date.now();
  const { db, rhUser, matrizId } = criarBancoIsolado();

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

  const eventosAntes = (db.prepare('SELECT COUNT(*) as total FROM eventos WHERE competencia_id = ?').get(comp.id) as any).total;
  const antes = {
    competencia: '2027-04',
    colaborador: colab.nome,
    eventosRegistrados: eventosAntes,
  };

  const ev1 = lancarHorasExtras(db, rhUser, {
    colaboradorId: colab.id,
    competenciaId: comp.id,
    tipo: 'UTIL',
    quantidadeHoras: 2,
    data: '2027-04-10',
  });

  let erroDuplicidade = '';
  try {
    lancarHorasExtras(db, rhUser, {
      colaboradorId: colab.id,
      competenciaId: comp.id,
      tipo: 'UTIL',
      quantidadeHoras: 2,
      data: '2027-04-10',
      confirmarDuplicidade: false,
    });
  } catch (err: any) {
    erroDuplicidade = err.message;
  }

  const qtdAposBloqueio = (db.prepare('SELECT COUNT(*) as total FROM eventos WHERE competencia_id = ?').get(comp.id) as any).total;

  const ev2 = lancarHorasExtras(db, rhUser, {
    colaboradorId: colab.id,
    competenciaId: comp.id,
    tipo: 'UTIL',
    quantidadeHoras: 2,
    data: '2027-04-10',
    confirmarDuplicidade: true,
  });

  const eventosDepois = db.prepare('SELECT id, tipo, quantidade, valor_centavos, data_inicio FROM eventos WHERE competencia_id = ?').all(comp.id) as any[];

  const passos: PassoResultado[] = [
    {
      etapa: '1º Lançamento: 2h extras em 2027-04-10',
      resultado: 'OK',
      mensagem: `Evento #${ev1.id} lançado (R$ ${ev1.valorCalculado.toFixed(2)})`,
      detalhes: { eventoId: ev1.id, valorCalculado: ev1.valorCalculado },
    },
    {
      etapa: '2º Lançamento idêntico (confirmarDuplicidade: false)',
      resultado: erroDuplicidade ? 'BLOQUEADO' : 'ERRO',
      mensagem: erroDuplicidade || 'Não bloqueou como esperado',
      detalhes: { eventosNoBancoAposTentativa: qtdAposBloqueio },
    },
    {
      etapa: '3º Lançamento com confirmação explícita do RH (confirmarDuplicidade: true)',
      resultado: 'OK',
      mensagem: `Evento #${ev2.id} gravado após confirmação explícita (R$ ${ev2.valorCalculado.toFixed(2)})`,
      detalhes: { eventoId: ev2.id, valorCalculado: ev2.valorCalculado },
    },
  ];

  const depois = {
    competencia: '2027-04',
    eventosRegistrados: eventosDepois.length,
    primeiroEventoId: ev1.id,
    segundoEventoId: ev2.id,
  };

  let status: 'PASSOU' | 'FALHOU' = 'PASSOU';
  let erroValidacao: string | undefined;
  try {
    assert.ok(ev1.id > 0);
    assert.match(erroDuplicidade, /Aviso de possível duplicidade: este evento já foi lançado para o colaborador/);
    assert.strictEqual(qtdAposBloqueio, 1);
    assert.ok(ev2.id > 0);
    assert.notStrictEqual(ev1.id, ev2.id);
    assert.strictEqual(eventosDepois.length, 2);
  } catch (e: any) {
    status = 'FALHOU';
    erroValidacao = e.message;
  }

  return {
    id: 4,
    codigo: 'US-15 / RN-65',
    titulo: '4. Evento duplicado exigindo confirmação do RH',
    regra: 'Lançamento idêntico é bloqueado com aviso ao RH e só é persistido após confirmarDuplicidade: true.',
    status,
    erroValidacao,
    antes,
    passos,
    depois,
    evidenciasDb: {
      eventosNoBanco: eventosDepois.map((e) => ({
        id: e.id,
        tipo: e.tipo,
        quantidade: e.quantidade,
        valor: e.valor_centavos / 100,
        data: e.data_inicio,
      })),
    },
    executadoEm: new Date().toISOString(),
    duracaoMs: Date.now() - t0,
  };
}

function executarCenario5(): CenarioResultado {
  const t0 = Date.now();
  const { db, rhUser, matrizId } = criarBancoIsolado();

  const qtdAntes = (db.prepare("SELECT COUNT(*) as total FROM colaboradores WHERE cpf = '52998224725'").get() as any).total;
  const antes = {
    cpfAlvo: '52998224725',
    colaboradoresComCpf: qtdAntes,
  };

  const payload = {
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
  };

  const colab1 = criarColaborador(db, rhUser, payload);
  const colab2 = criarColaborador(db, rhUser, payload);

  const registrosCpf = db.prepare("SELECT id, nome, cpf, cargo FROM colaboradores WHERE cpf = '52998224725'").all() as any[];

  const passos: PassoResultado[] = [
    {
      etapa: '1º Envio do formulário de cadastro',
      resultado: 'OK',
      mensagem: `Colaborador criado com ID #${colab1.id}`,
      detalhes: { id: colab1.id, nome: colab1.nome },
    },
    {
      etapa: '2º Envio imediato (reenvio idempotente)',
      resultado: 'OK',
      mensagem: colab2.mensagem || 'Reenvio tratado sem duplicação',
      detalhes: { idRetornado: colab2.id, duplicadoEvitado: colab2.duplicadoEvitado },
    },
  ];

  const depois = {
    cpfAlvo: '52998224725',
    colaboradoresComCpf: registrosCpf.length,
    idPrimeiroEnvio: colab1.id,
    idReenvio: colab2.id,
    duplicadoEvitado: colab2.duplicadoEvitado,
  };

  let status: 'PASSOU' | 'FALHOU' = 'PASSOU';
  let erroValidacao: string | undefined;
  try {
    assert.ok(colab1.id > 0);
    assert.strictEqual(colab1.id, colab2.id);
    assert.strictEqual(colab2.duplicadoEvitado, true);
    assert.strictEqual(registrosCpf.length, 1);
  } catch (e: any) {
    status = 'FALHOU';
    erroValidacao = e.message;
  }

  return {
    id: 5,
    codigo: 'US-15 / RNF-24',
    titulo: '5. Reenvio de cadastro sem duplicidade',
    regra: 'Reenvio do formulário com mesmo CPF e flag idempotente retorna o mesmo ID sem duplicar registro no SQLite.',
    status,
    erroValidacao,
    antes,
    passos,
    depois,
    evidenciasDb: {
      registrosComCpfNoBanco: registrosCpf,
    },
    executadoEm: new Date().toISOString(),
    duracaoMs: Date.now() - t0,
  };
}

function executarCenario6(): CenarioResultado {
  const t0 = Date.now();
  const { db, rhUser, matrizId } = criarBancoIsolado();

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

  db.prepare('UPDATE competencias SET em_processamento = 1 WHERE id = ?').run(comp.id);
  const compAntes = db.prepare('SELECT situacao, em_processamento FROM competencias WHERE id = ?').get(comp.id) as any;

  const antes = {
    competencia: '2027-05',
    situacaoCompetencia: compAntes.situacao,
    emProcessamento: compAntes.em_processamento,
    eventosGravados: 0,
  };

  let errCalc = '';
  try {
    calcularFolhaCompetenciaLote(db, rhUser, { competenciaId: comp.id });
  } catch (e: any) {
    errCalc = e.message;
  }

  let errEvento = '';
  try {
    lancarHorasExtras(db, rhUser, {
      colaboradorId: colab.id,
      competenciaId: comp.id,
      tipo: 'UTIL',
      quantidadeHoras: 1,
    });
  } catch (e: any) {
    errEvento = e.message;
  }

  let errFechar = '';
  try {
    fecharFolhaSegura(db, rhUser, comp.id);
  } catch (e: any) {
    errFechar = e.message;
  }

  // Libera processamento
  db.prepare('UPDATE competencias SET em_processamento = 0 WHERE id = ?').run(comp.id);
  const ev = lancarHorasExtras(db, rhUser, {
    colaboradorId: colab.id,
    competenciaId: comp.id,
    tipo: 'UTIL',
    quantidadeHoras: 1,
  });

  const compDepois = db.prepare('SELECT situacao, em_processamento FROM competencias WHERE id = ?').get(comp.id) as any;
  const eventosDepois = (db.prepare('SELECT COUNT(*) as total FROM eventos WHERE competencia_id = ?').get(comp.id) as any).total;

  const passos: PassoResultado[] = [
    {
      etapa: 'Tentar calcular folha em lote com em_processamento = 1',
      resultado: errCalc ? 'BLOQUEADO' : 'ERRO',
      mensagem: errCalc || 'Não bloqueou',
    },
    {
      etapa: 'Tentar lançar hora extra com em_processamento = 1',
      resultado: errEvento ? 'BLOQUEADO' : 'ERRO',
      mensagem: errEvento || 'Não bloqueou',
    },
    {
      etapa: 'Tentar fechar folha com em_processamento = 1',
      resultado: errFechar ? 'BLOQUEADO' : 'ERRO',
      mensagem: errFechar || 'Não bloqueou',
    },
    {
      etapa: 'Liberar em_processamento = 0 e lançar hora extra',
      resultado: 'OK',
      mensagem: `Evento #${ev.id} gravado após liberação`,
      detalhes: { eventoId: ev.id, valorCalculado: ev.valorCalculado },
    },
  ];

  const depois = {
    competencia: '2027-05',
    situacaoCompetencia: compDepois.situacao,
    emProcessamento: compDepois.em_processamento,
    eventosGravados: eventosDepois,
  };

  let status: 'PASSOU' | 'FALHOU' = 'PASSOU';
  let erroValidacao: string | undefined;
  try {
    const regexBloqueio = /A competência está em processamento por outra operação crítica \(RN-71\)\. Edição bloqueada\./;
    assert.match(errCalc, regexBloqueio);
    assert.match(errEvento, regexBloqueio);
    assert.match(errFechar, regexBloqueio);
    assert.ok(ev.id > 0);
    assert.strictEqual(eventosDepois, 1);
  } catch (e: any) {
    status = 'FALHOU';
    erroValidacao = e.message;
  }

  return {
    id: 6,
    codigo: 'US-15 / RN-71',
    titulo: '6. Bloqueio de edição durante processamento',
    regra: 'Enquanto em_processamento = 1, cálculo, lançamento de evento e fechamento são bloqueados; após liberação, edição volta a funcionar.',
    status,
    erroValidacao,
    antes,
    passos,
    depois,
    evidenciasDb: {
      emProcessamentoFinal: compDepois.em_processamento,
      eventosAposLiberacao: eventosDepois,
    },
    executadoEm: new Date().toISOString(),
    duracaoMs: Date.now() - t0,
  };
}

function executarCenario7(): CenarioResultado {
  const t0 = Date.now();
  const { db, rhUser, outroRhUser, matrizId } = criarBancoIsolado();

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

  const antes = {
    colaboradorId: colab.id,
    nome: colab.nome,
    cargo: 'Arquiteto',
    versaoInicial: colab.versao,
  };

  const res1 = atualizarColaborador(db, rhUser, colab.id, {
    cargo: 'Arquiteto Sênior',
    versaoEsperada: 1,
  });

  let erroConflito = '';
  try {
    atualizarColaborador(db, outroRhUser, colab.id, {
      cargo: 'Arquiteto Especialista',
      versaoEsperada: 1,
    });
  } catch (e: any) {
    erroConflito = e.message;
  }

  const colabAposBloqueio = db.prepare('SELECT cargo, versao FROM colaboradores WHERE id = ?').get(colab.id) as any;

  const res2 = atualizarColaborador(db, outroRhUser, colab.id, {
    cargo: 'Arquiteto Especialista',
    versaoEsperada: 2,
  });

  const colabFinal = db.prepare('SELECT id, nome, cargo, versao FROM colaboradores WHERE id = ?').get(colab.id) as any;

  const passos: PassoResultado[] = [
    {
      etapa: `Usuário 1 (${rhUser.email}) salva cargo='Arquiteto Sênior' com versaoEsperada=1`,
      resultado: 'OK',
      mensagem: `${res1.mensagem} (versão ${res1.versao})`,
      detalhes: { versaoAnterior: 1, novaVersao: res1.versao },
    },
    {
      etapa: `Usuário 2 (${outroRhUser.email}) tenta salvar cargo='Arquiteto Especialista' com versaoEsperada=1 (desatualizada)`,
      resultado: erroConflito ? 'BLOQUEADO' : 'ERRO',
      mensagem: erroConflito || 'Não bloqueou sobrescrita',
      detalhes: { cargoPreservadoNoBanco: colabAposBloqueio.cargo, versaoNoBanco: colabAposBloqueio.versao },
    },
    {
      etapa: `Usuário 2 recarrega (v2) e salva cargo='Arquiteto Especialista' com versaoEsperada=2`,
      resultado: 'OK',
      mensagem: `${res2.mensagem} (versão ${res2.versao})`,
      detalhes: { versaoAnterior: 2, novaVersao: res2.versao },
    },
  ];

  const depois = {
    colaboradorId: colabFinal.id,
    cargoFinal: colabFinal.cargo,
    versaoFinal: colabFinal.versao,
  };

  let status: 'PASSOU' | 'FALHOU' = 'PASSOU';
  let erroValidacao: string | undefined;
  try {
    assert.strictEqual(colab.versao, 1);
    assert.strictEqual(res1.versao, 2);
    assert.match(erroConflito, /O registro foi alterado por outra pessoa \(RNF-25\)\. Recarregue a página antes de salvar\./);
    assert.strictEqual(colabAposBloqueio.cargo, 'Arquiteto Sênior');
    assert.strictEqual(res2.versao, 3);
    assert.strictEqual(colabFinal.cargo, 'Arquiteto Especialista');
    assert.strictEqual(colabFinal.versao, 3);
  } catch (e: any) {
    status = 'FALHOU';
    erroValidacao = e.message;
  }

  return {
    id: 7,
    codigo: 'US-15 / RNF-25',
    titulo: '7. Conflito de versão entre dois usuários',
    regra: 'Concorrência otimista via versaoEsperada impede sobrescrita silenciosa de registro desatualizado.',
    status,
    erroValidacao,
    antes,
    passos,
    depois,
    evidenciasDb: {
      registroFinal: colabFinal,
    },
    executadoEm: new Date().toISOString(),
    duracaoMs: Date.now() - t0,
  };
}

export function executarCenario(id: number): CenarioResultado {
  switch (id) {
    case 1: return executarCenario1();
    case 2: return executarCenario2();
    case 3: return executarCenario3();
    case 4: return executarCenario4();
    case 5: return executarCenario5();
    case 6: return executarCenario6();
    case 7: return executarCenario7();
    default: throw new Error(`Cenário ${id} inválido. Use 1 a 7.`);
  }
}

export function executarTodosCenarios(): CenarioResultado[] {
  return [1, 2, 3, 4, 5, 6, 7].map((id) => executarCenario(id));
}
