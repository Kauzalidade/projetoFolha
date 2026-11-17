/**
 * us10_verbas_avulsas.test.ts - Suíte de testes da US-10 (Registro de Proventos e Descontos Manuais).
 * 
 * Atende aos requisitos da especificação v1.7:
 * - RN-25: Lançamento de proventos e descontos manuais com descrição obrigatória, valor positivo e 3 marcações (INSS, IRRF, FGTS).
 * - RN-26 e Tabela 7.4: Incidências aplicadas conforme marcação individual do RH (bases independentes).
 * - Ciclo de Vida (RN-04 / Tabela 7.5): Lançamento permitido exclusivamente em competência aberta.
 * - Memória de Cálculo (RN-02): Discriminação individualizada de proventos e descontos na memória e no banco.
 * - Segurança e Perfis (Seção 4): Acesso exclusivo ao perfil RH.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { DatabaseSync } from 'node:sqlite';
import { SCHEMA_SQL } from '../src/db.js';
import { criarUsuario } from '../src/services/usuarioService.js';
import { criarFilial } from '../src/services/filialService.js';
import { criarColaborador } from '../src/services/colaboradorService.js';
import { inicializarFeriadosEParametros } from '../src/services/parametroFeriadoService.js';
import {
  abrirOuObterCompetencia,
  fecharCompetencia,
  reabrirCompetencia,
} from '../src/services/competenciaService.js';
import { lancarVerbaAvulsa, listarEventos } from '../src/services/eventoService.js';
import { calcularFolhaColaborador } from '../src/services/folhaService.js';
import { limparTodasSessoes } from '../src/security.js';

describe('US-10: Registro de Proventos e Descontos Manuais (Verbas Avulsas - RN-25 a RN-27)', () => {
  let db: DatabaseSync;
  const adminUser = { id: 1, email: 'admin@empresa.com', perfil: 'ADMIN' };
  let rhUser: { id: number; email: string; perfil: string };
  let diretoriaUser: { id: number; email: string; perfil: string };
  let colaboradorId: number;
  let competenciaId: number;
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
    rhUser = { id: uRH.id, email: uRH.email, perfil: uRH.perfil };

    const uDir = criarUsuario(db, adminUser, {
      nome: 'Diretor Geral',
      email: 'diretor@empresa.com',
      senha: 'SenhaForte123',
      perfil: 'DIRETORIA',
    });
    diretoriaUser = { id: uDir.id, email: uDir.email, perfil: uDir.perfil };

    const matriz = criarFilial(db, rhUser, { nome: 'Matriz São Paulo', tipo: 'MATRIZ' });

    const colab = criarColaborador(db, rhUser, {
      filialId: matriz.id,
      nome: 'Carlos Eduardo Santos',
      cpf: '12345678909',
      nascimento: '1990-05-15',
      admissao: '2024-01-10',
      cargo: 'Analista de Operações',
      setor: 'Operações',
      salarioBase: '3000.00',
      jornadaHorasMensais: 220,
      banco: '001',
      agencia: '1234',
      conta: '5678',
    });
    colaboradorId = colab.id;

    const comp = abrirOuObterCompetencia(db, rhUser, mesAnoCompetencia);
    competenciaId = comp.id;
  });

  // 1. Provento com incidência somente em INSS
  it('1. Provento com incidência somente em INSS altera base do INSS sem afetar FGTS e IRRF', () => {
    lancarVerbaAvulsa(db, rhUser, {
      colaboradorId,
      competenciaId,
      tipo: 'PROVENTO',
      descricao: 'Adicional de Insalubridade Manual',
      valor: '500.00',
      incideINSS: true,
      incideIRRF: false,
      incideFGTS: false,
    });

    const folha = calcularFolhaColaborador(db, rhUser, { colaboradorId, competenciaId });

    // Salário R$ 3.000,00 + R$ 500,00 = R$ 3.500,00 de proventos
    assert.strictEqual(folha.totalProventos, 3500.00);

    // Base do INSS deve ser 3.500,00 -> INSS calculado = R$ 308,60
    assert.strictEqual(folha.inss, 308.60);

    // Base do FGTS deve ser apenas 3.000,00 -> FGTS (8%) = R$ 240,00 (não R$ 280,00)
    assert.strictEqual(folha.fgts, 240.00);

    // Base de IRRF na memória deve ser 3.000,00 (não inclui os 500,00)
    const verbaIRRF = folha.memoria.find((v: any) => v.tipo === 'IRRF');
    assert.strictEqual(verbaIRRF.baseCalculo.toNumber(), 3000.00);

    const verbaFGTS = folha.memoria.find((v: any) => v.tipo === 'FGTS');
    assert.strictEqual(verbaFGTS.baseCalculo.toNumber(), 3000.00);

    const verbaINSS = folha.memoria.find((v: any) => v.tipo === 'INSS');
    assert.strictEqual(verbaINSS.baseCalculo.toNumber(), 3500.00);
  });

  // 2. Provento com incidência somente em IRRF
  it('2. Provento com incidência somente em IRRF altera base do IRRF sem afetar INSS e FGTS', () => {
    lancarVerbaAvulsa(db, rhUser, {
      colaboradorId,
      competenciaId,
      tipo: 'PROVENTO',
      descricao: 'Prêmio Trimestral Manual',
      valor: '500.00',
      incideINSS: false,
      incideIRRF: true,
      incideFGTS: false,
    });

    const folha = calcularFolhaColaborador(db, rhUser, { colaboradorId, competenciaId });

    assert.strictEqual(folha.totalProventos, 3500.00);

    // Base do INSS deve permanecer 3.000,00 -> INSS = R$ 248,60
    assert.strictEqual(folha.inss, 248.60);

    // Base do FGTS deve permanecer 3.000,00 -> FGTS = R$ 240,00
    assert.strictEqual(folha.fgts, 240.00);

    // Base de IRRF deve ser 3.500,00 (inclui o prêmio)
    const verbaIRRF = folha.memoria.find((v: any) => v.tipo === 'IRRF');
    assert.strictEqual(verbaIRRF.baseCalculo.toNumber(), 3500.00);

    const verbaINSS = folha.memoria.find((v: any) => v.tipo === 'INSS');
    assert.strictEqual(verbaINSS.baseCalculo.toNumber(), 3000.00);
  });

  // 3. Provento com incidência somente em FGTS
  it('3. Provento com incidência somente em FGTS altera base do FGTS sem afetar INSS e IRRF', () => {
    lancarVerbaAvulsa(db, rhUser, {
      colaboradorId,
      competenciaId,
      tipo: 'PROVENTO',
      descricao: 'Verba Avulsa FGTS',
      valor: '500.00',
      incideINSS: false,
      incideIRRF: false,
      incideFGTS: true,
    });

    const folha = calcularFolhaColaborador(db, rhUser, { colaboradorId, competenciaId });

    assert.strictEqual(folha.totalProventos, 3500.00);

    // Base do INSS permanece 3.000,00 -> INSS = R$ 248,60
    assert.strictEqual(folha.inss, 248.60);

    // Base do FGTS deve ser 3.500,00 -> FGTS (8%) = R$ 280,00 (R$ 40,00 a mais)
    assert.strictEqual(folha.fgts, 280.00);

    const verbaFGTS = folha.memoria.find((v: any) => v.tipo === 'FGTS');
    assert.strictEqual(verbaFGTS.baseCalculo.toNumber(), 3500.00);

    const verbaIRRF = folha.memoria.find((v: any) => v.tipo === 'IRRF');
    assert.strictEqual(verbaIRRF.baseCalculo.toNumber(), 3000.00);
  });

  // 4. Provento sem incidências
  it('4. Provento sem incidências soma aos proventos sem onerar nenhuma base tributária', () => {
    lancarVerbaAvulsa(db, rhUser, {
      colaboradorId,
      competenciaId,
      tipo: 'PROVENTO',
      descricao: 'Ajuda de Custo Deslocamento',
      valor: '400.00',
      incideINSS: false,
      incideIRRF: false,
      incideFGTS: false,
    });

    const folha = calcularFolhaColaborador(db, rhUser, { colaboradorId, competenciaId });

    // Proventos = 3.000 + 400 = 3.400,00
    assert.strictEqual(folha.totalProventos, 3400.00);

    // Todas as bases permanecem em 3.000,00
    assert.strictEqual(folha.inss, 248.60);
    assert.strictEqual(folha.fgts, 240.00);
    assert.strictEqual(folha.irrf, 0.00);

    // Líquido recebe integralmente a ajuda de custo: 3.400 - 248,60 = 3.151,40
    assert.strictEqual(folha.liquido, 3151.40);
  });

  // 5. Desconto manual com descrição individualizada
  it('5. Múltiplos descontos manuais preservam suas descrições individualizadas na memória', () => {
    lancarVerbaAvulsa(db, rhUser, {
      colaboradorId,
      competenciaId,
      tipo: 'DESCONTO',
      descricao: 'Pensão Alimentícia Judicial',
      valor: '300.00',
      incideINSS: false,
      incideIRRF: false,
      incideFGTS: false,
    });

    lancarVerbaAvulsa(db, rhUser, {
      colaboradorId,
      competenciaId,
      tipo: 'DESCONTO',
      descricao: 'Empréstimo Consignado Caixa',
      valor: '200.00',
      incideINSS: false,
      incideIRRF: false,
      incideFGTS: false,
    });

    lancarVerbaAvulsa(db, rhUser, {
      colaboradorId,
      competenciaId,
      tipo: 'DESCONTO',
      descricao: 'Assistência Médica Coparticipação',
      valor: '150.00',
      incideINSS: false,
      incideIRRF: false,
      incideFGTS: false,
    });

    const folha = calcularFolhaColaborador(db, rhUser, { colaboradorId, competenciaId });

    // Total de descontos: INSS (248,60) + 300 + 200 + 150 = 898,60
    assert.strictEqual(folha.totalDescontos, 898.60);
    assert.strictEqual(folha.liquido, 2101.40);

    // Verifica que cada um dos 3 descontos consta individualmente na memória
    const descPensao = folha.memoria.find((v: any) => v.descricao === 'Pensão Alimentícia Judicial');
    const descConsignado = folha.memoria.find((v: any) => v.descricao === 'Empréstimo Consignado Caixa');
    const descMedica = folha.memoria.find((v: any) => v.descricao === 'Assistência Médica Coparticipação');

    assert.ok(descPensao, 'Deve conter Pensão Alimentícia Judicial na memória');
    assert.strictEqual(descPensao.valor.toNumber(), 300.00);
    assert.strictEqual(descPensao.natureza, 'DESCONTO');

    assert.ok(descConsignado, 'Deve conter Empréstimo Consignado Caixa na memória');
    assert.strictEqual(descConsignado.valor.toNumber(), 200.00);
    assert.strictEqual(descConsignado.natureza, 'DESCONTO');

    assert.ok(descMedica, 'Deve conter Assistência Médica Coparticipação na memória');
    assert.strictEqual(descMedica.valor.toNumber(), 150.00);
    assert.strictEqual(descMedica.natureza, 'DESCONTO');
  });

  // 6. Descrição vazia e valores inválidos
  it('6. Descrição vazia, valor nulo, zero, negativo ou tipo inválido são rejeitados', () => {
    // Descrição vazia
    assert.throws(
      () => lancarVerbaAvulsa(db, rhUser, {
        colaboradorId,
        competenciaId,
        tipo: 'PROVENTO',
        descricao: '',
        valor: '100.00',
        incideINSS: false,
        incideIRRF: false,
        incideFGTS: false,
      }),
      { message: 'Informe a descrição da verba avulsa.' }
    );

    // Descrição somente espaços
    assert.throws(
      () => lancarVerbaAvulsa(db, rhUser, {
        colaboradorId,
        competenciaId,
        tipo: 'PROVENTO',
        descricao: '   ',
        valor: '100.00',
        incideINSS: false,
        incideIRRF: false,
        incideFGTS: false,
      }),
      { message: 'Informe a descrição da verba avulsa.' }
    );

    // Valor zero
    assert.throws(
      () => lancarVerbaAvulsa(db, rhUser, {
        colaboradorId,
        competenciaId,
        tipo: 'PROVENTO',
        descricao: 'Bônus Zero',
        valor: '0.00',
        incideINSS: false,
        incideIRRF: false,
        incideFGTS: false,
      }),
      { message: 'Informe um valor maior que zero para a verba avulsa.' }
    );

    // Valor negativo
    assert.throws(
      () => lancarVerbaAvulsa(db, rhUser, {
        colaboradorId,
        competenciaId,
        tipo: 'PROVENTO',
        descricao: 'Bônus Negativo',
        valor: -50.00,
        incideINSS: false,
        incideIRRF: false,
        incideFGTS: false,
      }),
      { message: 'Informe um valor maior que zero para a verba avulsa.' }
    );

    // Valor formato inválido
    assert.throws(
      () => lancarVerbaAvulsa(db, rhUser, {
        colaboradorId,
        competenciaId,
        tipo: 'PROVENTO',
        descricao: 'Bônus Inválido',
        valor: 'abc',
        incideINSS: false,
        incideIRRF: false,
        incideFGTS: false,
      }),
      { message: 'Informe um valor maior que zero para a verba avulsa.' }
    );

    // Tipo inválido
    assert.throws(
      () => lancarVerbaAvulsa(db, rhUser, {
        colaboradorId,
        competenciaId,
        tipo: 'OUTRO' as any,
        descricao: 'Tipo Incorreto',
        valor: '100.00',
        incideINSS: false,
        incideIRRF: false,
        incideFGTS: false,
      }),
      { message: 'Tipo de verba avulsa inválido. Deve ser PROVENTO ou DESCONTO.' }
    );
  });

  // 7. Competência fechada ou calculada
  it('7. Lançamento em competência fechada ou calculada é bloqueado', () => {
    // 7.1 Competência Fechada
    fecharCompetencia(db, rhUser, mesAnoCompetencia);

    assert.throws(
      () => lancarVerbaAvulsa(db, rhUser, {
        colaboradorId,
        competenciaId,
        tipo: 'PROVENTO',
        descricao: 'Tentativa em Fechada',
        valor: '100.00',
        incideINSS: false,
        incideIRRF: false,
        incideFGTS: false,
      }),
      { message: 'Esta competência está fechada. Para alterar, reabra informando a justificativa.' }
    );

    // Reabre para voltar a ABERTA
    reabrirCompetencia(db, rhUser, mesAnoCompetencia, 'Reabertura para cálculo de homologação');

    // Calcula a folha -> Situação da competência passa para CALCULADA
    calcularFolhaColaborador(db, rhUser, { colaboradorId, competenciaId });

    // 7.2 Competência Calculada
    assert.throws(
      () => lancarVerbaAvulsa(db, rhUser, {
        colaboradorId,
        competenciaId,
        tipo: 'PROVENTO',
        descricao: 'Tentativa em Calculada',
        valor: '100.00',
        incideINSS: false,
        incideIRRF: false,
        incideFGTS: false,
      }),
      { message: 'Lançamentos de verbas avulsas são permitidos exclusivamente em competência aberta.' }
    );
  });

  // 8. Permissões de acesso
  it('8. Apenas usuário com perfil RH pode lançar verbas avulsas; Diretoria e Admin são rejeitados', () => {
    // Diretoria tenta lançar
    assert.throws(
      () => lancarVerbaAvulsa(db, diretoriaUser, {
        colaboradorId,
        competenciaId,
        tipo: 'PROVENTO',
        descricao: 'Bônus Diretoria',
        valor: '100.00',
        incideINSS: false,
        incideIRRF: false,
        incideFGTS: false,
      }),
      { message: 'Você não tem permissão para esta ação.' }
    );

    // Admin tenta lançar
    assert.throws(
      () => lancarVerbaAvulsa(db, adminUser, {
        colaboradorId,
        competenciaId,
        tipo: 'PROVENTO',
        descricao: 'Bônus Admin',
        valor: '100.00',
        incideINSS: false,
        incideIRRF: false,
        incideFGTS: false,
      }),
      { message: 'Você não tem permissão para esta ação.' }
    );

    // RH lança com sucesso
    const lancamento = lancarVerbaAvulsa(db, rhUser, {
      colaboradorId,
      competenciaId,
      tipo: 'PROVENTO',
      descricao: 'Adicional Noturno RH',
      valor: '150.00',
      incideINSS: true,
      incideIRRF: true,
      incideFGTS: true,
    });
    assert.ok(lancamento.id > 0);
  });

  // 9. Persistência no SQLite
  it('9. Verbas avulsas são persistidas com fidelidade na tabela eventos do SQLite', () => {
    const res = lancarVerbaAvulsa(db, rhUser, {
      colaboradorId,
      competenciaId,
      tipo: 'PROVENTO',
      descricao: 'Adicional Noturno (Manual)',
      valor: '350.50',
      incideINSS: true,
      incideIRRF: true,
      incideFGTS: true,
      observacao: 'Escala noturna autorizada',
    });

    const registro = db.prepare('SELECT * FROM eventos WHERE id = ?').get(res.id) as any;
    assert.ok(registro, 'Registro deve existir na tabela eventos');
    assert.strictEqual(registro.colaborador_id, colaboradorId);
    assert.strictEqual(registro.competencia_id, competenciaId);
    assert.strictEqual(registro.tipo, 'VERBA_AVULSA_PROVENTO');
    assert.strictEqual(registro.valor_centavos, 35050);
    assert.strictEqual(registro.descricao, 'Adicional Noturno (Manual)');
    assert.strictEqual(registro.incide_inss, 1);
    assert.strictEqual(registro.incide_irrf, 1);
    assert.strictEqual(registro.incide_fgts, 1);
    assert.strictEqual(registro.observacao, 'Escala noturna autorizada');
    assert.strictEqual(registro.criado_por_usuario_id, rhUser.id);
    assert.ok(registro.criado_em);

    // Consulta pela função listarEventos
    const lista = listarEventos(db, rhUser, { competenciaId });
    assert.ok(lista.some((e: any) => e.id === res.id));
  });

  // 10. Exibição das verbas na memória de cálculo
  it('10. Memória de cálculo registra proventos e descontos avulsos com detalhes e regras', () => {
    lancarVerbaAvulsa(db, rhUser, {
      colaboradorId,
      competenciaId,
      tipo: 'PROVENTO',
      descricao: 'Comissão Especial',
      valor: '800.00',
      incideINSS: true,
      incideIRRF: true,
      incideFGTS: true,
    });

    lancarVerbaAvulsa(db, rhUser, {
      colaboradorId,
      competenciaId,
      tipo: 'DESCONTO',
      descricao: 'Adiantamento Quinzenal',
      valor: '600.00',
      incideINSS: false,
      incideIRRF: false,
      incideFGTS: false,
    });

    const folha = calcularFolhaColaborador(db, rhUser, { colaboradorId, competenciaId });

    // Verifica persistência na tabela folha_verbas
    const verbasBanco = db.prepare('SELECT * FROM folha_verbas WHERE folha_id = ?').all(folha.folhaId) as any[];

    const verbaComissao = verbasBanco.find((v: any) => v.descricao === 'Comissão Especial');
    assert.ok(verbaComissao, 'Comissão Especial deve constar em folha_verbas');
    assert.strictEqual(verbaComissao.natureza, 'PROVENTO');
    assert.strictEqual(verbaComissao.valor_centavos, 80000);
    assert.ok(verbaComissao.regra_aplicada.includes('INSS=Sim, IRRF=Sim, FGTS=Sim'));

    const verbaAdiantamento = verbasBanco.find((v: any) => v.descricao === 'Adiantamento Quinzenal');
    assert.ok(verbaAdiantamento, 'Adiantamento Quinzenal deve constar em folha_verbas');
    assert.strictEqual(verbaAdiantamento.natureza, 'DESCONTO');
    assert.strictEqual(verbaAdiantamento.valor_centavos, 60000);
    assert.ok(verbaAdiantamento.regra_aplicada.includes('Desconto manual (RN-25)'));
  });
});
