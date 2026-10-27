/**
 * etapa2.test.ts - Testes automatizados da Etapa 2 (Lançamento de Eventos).
 * 
 * Cobre cenários Gherkin da Seção 10:
 * - Horas extras (dia útil 50%, domingo 100%, convenção 120%, hora extra negativa)
 * - Trava de competência fechada e reabertura com justificativa obrigatória e log destacado
 * - Permissões de perfis (Diretoria não fecha nem reabre competência)
 * - Faltas injustificadas e perda do DSR
 * - Atestados médicos com anexo, período e controle estrito de dados de saúde (LGPD)
 * - Vale-Transporte (optante, 6% vs custo, não optante)
 * - Verbas avulsas com marcações de incidência (RN-25)
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { DatabaseSync } from 'node:sqlite';
import { SCHEMA_SQL } from '../src/db.js';
import { criarUsuario } from '../src/services/usuarioService.js';
import { criarFilial } from '../src/services/filialService.js';
import { criarColaborador } from '../src/services/colaboradorService.js';
import {
  inicializarFeriadosEParametros,
  cadastrarParametro,
} from '../src/services/parametroFeriadoService.js';
import {
  abrirOuObterCompetencia,
  fecharCompetencia,
  reabrirCompetencia,
} from '../src/services/competenciaService.js';
import {
  lancarHorasExtras,
  lancarFaltaInjustificada,
  lancarAtestado,
  consultarAtestado,
  lancarValeTransporte,
  lancarVerbaAvulsa,
} from '../src/services/eventoService.js';
import { consultarLogs } from '../src/services/logService.js';
import { limparTodasSessoes } from '../src/security.js';

describe('ETAPA 2: Lançamento de Eventos (Horas Extras, Faltas, Atestados, VT, VA e Verbas Avulsas)', () => {
  let db: DatabaseSync;
  const adminUser = { id: 1, email: 'admin@empresa.com', perfil: 'ADMIN' };
  let rhUser: { id: number; email: string; perfil: string };
  let diretoriaUser: { id: number; email: string; perfil: string };
  let colaboradorId: number;
  let competenciaAbertaId: number;
  const mesAnoCompetencia = '2026-10';

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
      nome: 'Diretor RH',
      email: 'diretor@empresa.com',
      senha: 'Diretoria2026',
      perfil: 'DIRETORIA',
    });
    diretoriaUser = { id: uDir.id, email: uDir.email, perfil: 'DIRETORIA' };

    const filial = criarFilial(db, rhUser, { nome: 'Matriz São Paulo', tipo: 'MATRIZ' });

    // Colaborador padrão (Salário R$ 2.200,00 e divisor 220 -> R$ 10,00/hora)
    const colab = criarColaborador(db, rhUser, {
      filialId: filial.id,
      nome: 'Ana Souza',
      cpf: '52998224725',
      nascimento: '1995-04-10',
      admissao: '2023-03-10',
      cargo: 'Atendente',
      setor: 'Atendimento',
      salarioBase: '2200.00',
      banco: '001',
      agencia: '1234',
      conta: '56789',
    });
    colaboradorId = colab.id;

    const comp = abrirOuObterCompetencia(db, rhUser, mesAnoCompetencia);
    competenciaAbertaId = comp.id;
  });

  // --- CENÁRIOS DE HORAS EXTRAS ---

  it('Cenário: Hora extra em dia útil e em domingo', () => {
    // 2 horas em dia útil -> 2h * 10,00 * 1,5 = R$ 30,00
    const resUtil = lancarHorasExtras(db, rhUser, {
      colaboradorId,
      competenciaId: competenciaAbertaId,
      tipo: 'UTIL',
      quantidadeHoras: 2,
    });
    assert.strictEqual(resUtil.valorCalculado, 30.00);

    // 2 horas em domingo -> 2h * 10,00 * 2,0 = R$ 40,00
    const resDom = lancarHorasExtras(db, rhUser, {
      colaboradorId,
      competenciaId: competenciaAbertaId,
      tipo: 'DOMINGO',
      quantidadeHoras: 2,
    });
    assert.strictEqual(resDom.valorCalculado, 40.00);
  });

  it('Cenário: Hora extra negativa é rejeitada', () => {
    assert.throws(
      () =>
        lancarHorasExtras(db, rhUser, {
          colaboradorId,
          competenciaId: competenciaAbertaId,
          tipo: 'UTIL',
          quantidadeHoras: -2,
        }),
      { message: 'A quantidade de horas extras deve ser maior que zero.' }
    );
  });

  it('Cenário: Convenção coletiva altera o adicional de domingo (ex: 120%)', () => {
    // Cadastra convenção como parâmetro com adicional de 120% em domingo
    cadastrarParametro(db, rhUser, {
      nome: 'adicional_hora_extra_domingo',
      valor: '1.20', // 120%
      dataInicio: '2026-01-01',
      dataFim: '2026-12-31',
    });

    // 2 horas em domingo -> 10,00 * 2.2 * 2 = R$ 44,00
    const res = lancarHorasExtras(db, rhUser, {
      colaboradorId,
      competenciaId: competenciaAbertaId,
      tipo: 'DOMINGO',
      quantidadeHoras: 2,
    });

    assert.strictEqual(res.valorCalculado, 44.00);
  });

  // --- CENÁRIOS DE COMPETÊNCIA FECHADA E REABERTURA ---

  it('Cenário: Competência fechada não é alterada', () => {
    // Fecha a competência
    fecharCompetencia(db, rhUser, mesAnoCompetencia);

    // Tentar lançar hora extra em competência fechada deve ser rejeitado
    assert.throws(
      () =>
        lancarHorasExtras(db, rhUser, {
          colaboradorId,
          competenciaId: competenciaAbertaId,
          tipo: 'UTIL',
          quantidadeHoras: 2,
        }),
      { message: 'Esta competência está fechada. Para alterar, reabra informando a justificativa.' }
    );
  });

  it('Cenário: Reabertura de competência pelo RH homologa na hora e grava evento destacado no log', () => {
    fecharCompetencia(db, rhUser, mesAnoCompetencia);

    // RH reabre com justificativa
    reabrirCompetencia(db, rhUser, mesAnoCompetencia, 'Ajuste de horas extras pendentes');

    // Agora pode lançar evento normalmente
    const res = lancarHorasExtras(db, rhUser, {
      colaboradorId,
      competenciaId: competenciaAbertaId,
      tipo: 'UTIL',
      quantidadeHoras: 1,
    });
    assert.strictEqual(res.valorCalculado, 15.00);

    // Confere se o Log de Auditoria gravou o evento destacado
    const logs = consultarLogs(db, adminUser, { entidade: 'COMPETENCIA' });
    const logReabertura = logs.find((l) => l.acao === 'REABERTURA_COMPETENCIA_DESTACADA');
    assert.ok(logReabertura, 'Deve existir log destacado de reabertura');
    assert.ok(logReabertura.detalhes.includes('Ajuste de horas extras pendentes'));
  });

  it('Cenário: Reabertura sem justificativa é rejeitada', () => {
    fecharCompetencia(db, rhUser, mesAnoCompetencia);

    assert.throws(
      () => reabrirCompetencia(db, rhUser, mesAnoCompetencia, ''),
      { message: 'Para reabrir uma competência fechada, informe a justificativa obrigatória.' }
    );
  });

  it('Cenário: Diretoria não reabre competência', () => {
    fecharCompetencia(db, rhUser, mesAnoCompetencia);

    assert.throws(
      () => reabrirCompetencia(db, diretoriaUser, mesAnoCompetencia, 'Tentativa diretoria'),
      { message: 'Você não tem permissão para esta ação.' }
    );
  });

  it('Cenário: Diretoria não fecha a folha', () => {
    assert.throws(
      () => fecharCompetencia(db, diretoriaUser, mesAnoCompetencia),
      { message: 'Você não tem permissão para esta ação.' }
    );
  });

  // --- CENÁRIOS DE FALTAS E ATESTADOS MÉDICOS ---

  it('Cenário: Falta injustificada com perda do DSR', () => {
    // Para salário 3.000,00 e 1 falta: (3000 / 30) = 100,00 falta + 100,00 DSR
    const filial = db.prepare('SELECT id FROM filiais LIMIT 1').get() as any;
    const colab3k = criarColaborador(db, rhUser, {
      filialId: filial.id,
      nome: 'Colaborador 3k',
      cpf: '01234567890', // simulado
      cpfValidoIgnorar: true,
      nascimento: '1990-01-01',
      admissao: '2022-01-01',
      cargo: 'Analista',
      setor: 'TI',
      salarioBase: '3000.00',
      banco: '001',
      agencia: '1111',
      conta: '2222',
    });

    const resFalta = lancarFaltaInjustificada(db, rhUser, {
      colaboradorId: colab3k.id,
      competenciaId: competenciaAbertaId,
      diasFalta: 1,
    });

    assert.strictEqual(resFalta.descontoFalta, 100.00);
    assert.strictEqual(resFalta.descontoDSR, 100.00);
  });

  it('Cenário: Atestado válido não desconta falta nem DSR', () => {
    const res = lancarAtestado(db, rhUser, {
      colaboradorId,
      competenciaId: competenciaAbertaId,
      dataInicio: '2026-10-14',
      dataFim: '2026-10-16',
      anexoNome: 'atestado_medico.pdf',
      anexoTipo: 'application/pdf',
      anexoTamanhoBytes: 500000,
    });

    assert.strictEqual(res.status, 'ATESTADO_REGISTRADO_SEM_DESCONTO');
  });

  it('Cenário: Atestado sem anexo ou sem período é rejeitado', () => {
    assert.throws(
      () =>
        lancarAtestado(db, rhUser, {
          colaboradorId,
          competenciaId: competenciaAbertaId,
          dataInicio: '',
          dataFim: '',
          anexoNome: '',
          anexoTipo: '',
          anexoTamanhoBytes: 0,
        }),
      { message: 'Informe o anexo e o período do atestado.' }
    );
  });

  it('Cenário: Anexo inválido (tamanho maior que 10 MB ou formato incorreto)', () => {
    // Arquivo maior que 10 MB (12 MB)
    assert.throws(
      () =>
        lancarAtestado(db, rhUser, {
          colaboradorId,
          competenciaId: competenciaAbertaId,
          dataInicio: '2026-10-01',
          dataFim: '2026-10-02',
          anexoNome: 'documento_pesado.pdf',
          anexoTipo: 'application/pdf',
          anexoTamanhoBytes: 12 * 1024 * 1024,
        }),
      { message: 'Arquivo inválido. Use PDF, JPG ou PNG de até 10 MB.' }
    );

    // Formato não permitido (ex: .exe)
    assert.throws(
      () =>
        lancarAtestado(db, rhUser, {
          colaboradorId,
          competenciaId: competenciaAbertaId,
          dataInicio: '2026-10-01',
          dataFim: '2026-10-02',
          anexoNome: 'virus.exe',
          anexoTipo: 'application/octet-stream',
          anexoTamanhoBytes: 1000,
        }),
      { message: 'Arquivo inválido. Use PDF, JPG ou PNG de até 10 MB.' }
    );
  });

  it('Cenário: Diretoria não vê dados de saúde e Log de acesso a dado de saúde é registrado', () => {
    const atestadoCriado = lancarAtestado(db, rhUser, {
      colaboradorId,
      competenciaId: competenciaAbertaId,
      dataInicio: '2026-10-05',
      dataFim: '2026-10-06',
      anexoNome: 'consulta.jpg',
      anexoTipo: 'image/jpeg',
      anexoTamanhoBytes: 300000,
    });

    // Diretoria tenta consultar atestado -> negado
    assert.throws(
      () => consultarAtestado(db, diretoriaUser, atestadoCriado.id),
      { message: 'Você não tem permissão para acessar dados de saúde.' }
    );

    // RH consulta atestado -> autorizado e gera log
    const consultaRH = consultarAtestado(db, rhUser, atestadoCriado.id);
    assert.ok(consultaRH.id > 0);

    const logs = consultarLogs(db, adminUser, { entidade: 'ATESTADO' });
    const logConsulta = logs.find((l) => l.acao === 'CONSULTAR_DADO_SAUDE');
    assert.ok(logConsulta, 'Consulta a dado de saúde deve estar registrada no log');
  });

  // --- CENÁRIOS DE BENEFÍCIOS (VALE-TRANSPORTE) ---

  it('Cenário: Desconto do vale-transporte (menor entre 6% do salário e custo)', () => {
    // Salário R$ 2.000,00 -> 6% = R$ 120,00
    // Caso 1: Custo 180,00 -> desconto de 120,00
    const res1 = lancarValeTransporte(db, rhUser, {
      colaboradorId, // salário base 2.200 (6% = 132,00)
      competenciaId: competenciaAbertaId,
      optante: true,
      custoMensalInformado: 180.00,
    });
    assert.strictEqual(res1.valorDesconto, 132.00); // limitado a 6%

    // Caso 2: Custo 90,00 -> limitado ao custo: desconto 90,00
    const res2 = lancarValeTransporte(db, rhUser, {
      colaboradorId,
      competenciaId: competenciaAbertaId,
      optante: true,
      custoMensalInformado: 90.00,
    });
    assert.strictEqual(res2.valorDesconto, 90.00);
  });

  it('Cenário: Colaborador sem vale-transporte (não optante não desconta)', () => {
    const res = lancarValeTransporte(db, rhUser, {
      colaboradorId,
      competenciaId: competenciaAbertaId,
      optante: false,
    });
    assert.strictEqual(res.valorDesconto, 0);
  });

  // --- CENÁRIOS DE VERBAS AVULSAS (RN-25) ---

  it('Cenário: Verba avulsa com e sem incidência (INSS, IRRF, FGTS)', () => {
    // Com incidência em INSS e IRRF
    const v1 = lancarVerbaAvulsa(db, rhUser, {
      colaboradorId,
      competenciaId: competenciaAbertaId,
      tipo: 'PROVENTO',
      descricao: 'Bônus Operacional',
      valor: '100.00',
      incideINSS: true,
      incideIRRF: true,
      incideFGTS: false,
    });

    assert.strictEqual(v1.valor, 100.00);
    assert.strictEqual(v1.incideINSS, true);
    assert.strictEqual(v1.incideIRRF, true);
    assert.strictEqual(v1.incideFGTS, false);

    // Sem incidência
    const v2 = lancarVerbaAvulsa(db, rhUser, {
      colaboradorId,
      competenciaId: competenciaAbertaId,
      tipo: 'PROVENTO',
      descricao: 'Ajuda de Custo',
      valor: '100.00',
      incideINSS: false,
      incideIRRF: false,
      incideFGTS: false,
    });

    assert.strictEqual(v2.incideINSS, false);
    assert.strictEqual(v2.incideIRRF, false);
    assert.strictEqual(v2.incideFGTS, false);
  });
});
