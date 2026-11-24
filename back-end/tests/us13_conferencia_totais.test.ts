/**
 * us13_conferencia_totais.test.ts
 * Suíte de testes automatizados independentes para a US-13 — Conferência de Totais da Folha (Spec v1.7).
 * 
 * Critérios cobertos:
 * 1. Conferir em centavos a soma dos líquidos individuais contra o total da folha.
 * 2. Conferir proventos menos descontos contra líquido.
 * 3. Conferir totais por filial contra o total geral.
 * 4. Conciliar Folha do mês, Dados de pagamento e soma dos contracheques.
 * 5. Conferir INSS, IRRF e FGTS dos relatórios contra as verbas individuais.
 * 6. Aplicar tolerância exata de R$ 0,00: qualquer diferença bloqueia fechamento e identifica item divergente.
 * 7. Exigir confirmação da conferência por usuário RH.
 * 8. Se a mesma pessoa lançou/calculou e confirmar a conferência, havendo outro RH ativo, exigir justificativa e notificar Diretoria.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { DatabaseSync } from 'node:sqlite';
import { SCHEMA_SQL } from '../src/db.js';
import { criarUsuario } from '../src/services/usuarioService.js';
import { criarFilial } from '../src/services/filialService.js';
import { criarColaborador } from '../src/services/colaboradorService.js';
import { inicializarFeriadosEParametros } from '../src/services/parametroFeriadoService.js';
import { abrirOuObterCompetencia } from '../src/services/competenciaService.js';
import {
  calcularFolhaColaborador,
  executarConferenciaFinanceira,
  confirmarConferenciaFolha,
  devolverFolhaParaAjuste,
  fecharFolhaSegura,
} from '../src/services/folhaService.js';
import {
  gerarRelatorioFolhaMes,
  gerarRelatorioDadosPagamento,
  gerarContrachequeEstruturado,
} from '../src/services/relatoriosService.js';
import { consultarAlertas } from '../src/services/documentosAlertasService.js';
import { limparTodasSessoes } from '../src/security.js';

describe('US-13: Conferência de Totais da Folha (Spec v1.7)', () => {
  let db: DatabaseSync;
  const adminUser = { id: 1, email: 'admin@empresa.com', perfil: 'ADMIN' };
  let rhUser1: { id: number; email: string; perfil: string };
  let rhUser2: { id: number; email: string; perfil: string };
  let diretoriaUser: { id: number; email: string; perfil: string };

  let matrizId: number;
  let filial1Id: number;
  let colabMatriz1: any;
  let colabMatriz2: any;
  let colabFilial1: any;

  beforeEach(() => {
    limparTodasSessoes();
    db = new DatabaseSync(':memory:');
    db.exec(SCHEMA_SQL);
    inicializarFeriadosEParametros(db);

    // 1. Usuários do sistema
    const uRH1 = criarUsuario(db, adminUser, {
      nome: 'Mariana Silva (Analista RH 1)',
      email: 'mariana.rh@empresa.com',
      senha: 'SenhaForte123',
      perfil: 'RH',
    });
    rhUser1 = { id: uRH1.id, email: uRH1.email, perfil: 'RH' };

    const uRH2 = criarUsuario(db, adminUser, {
      nome: 'Carlos Eduardo (Analista RH 2)',
      email: 'carlos.rh@empresa.com',
      senha: 'SenhaForte123',
      perfil: 'RH',
    });
    rhUser2 = { id: uRH2.id, email: uRH2.email, perfil: 'RH' };

    const uDir = criarUsuario(db, adminUser, {
      nome: 'Diretor Geral',
      email: 'diretoria@empresa.com',
      senha: 'SenhaDiretoria123',
      perfil: 'DIRETORIA',
    });
    diretoriaUser = { id: uDir.id, email: uDir.email, perfil: 'DIRETORIA' };

    // 2. Filiais
    const fMatriz = criarFilial(db, rhUser1, {
      nome: 'Matriz São Paulo',
      tipo: 'MATRIZ',
    });
    matrizId = fMatriz.id;

    const fCampinas = criarFilial(db, rhUser1, {
      nome: 'Filial Campinas',
      tipo: 'FILIAL',
    });
    filial1Id = fCampinas.id;

    // 3. Colaboradores com dados completos (sem pendências cadastrais ou bancárias)
    colabMatriz1 = criarColaborador(db, rhUser1, {
      filialId: matrizId,
      nome: 'Alice Ferreira',
      cpf: '11144477735',
      nascimento: '1992-05-10',
      admissao: '2022-03-01',
      cargo: 'Analista de Operações',
      setor: 'Operações',
      salarioBase: '4000.00',
      banco: '001',
      agencia: '1111',
      conta: '22222',
    });

    colabMatriz2 = criarColaborador(db, rhUser1, {
      filialId: matrizId,
      nome: 'Bernardo Costa',
      cpf: '22255588846',
      nascimento: '1988-11-20',
      admissao: '2021-08-15',
      cargo: 'Coordenador',
      setor: 'Operações',
      salarioBase: '7000.00',
      banco: '237',
      agencia: '3333',
      conta: '44444',
    });

    colabFilial1 = criarColaborador(db, rhUser1, {
      filialId: filial1Id,
      nome: 'Camila Rocha',
      cpf: '33366699957',
      nascimento: '1995-02-14',
      admissao: '2023-01-10',
      cargo: 'Atendente',
      setor: 'Atendimento',
      salarioBase: '2500.00',
      banco: '341',
      agencia: '5555',
      conta: '66666',
    });
  });

  // --- CRITÉRIO 1: SOMA DOS LÍQUIDOS INDIVIDUAIS CONTRA TOTAL DA FOLHA EM CENTAVOS ---

  it('1. Deve conferir em centavos a soma dos líquidos individuais contra o total da folha (Cenário de Sucesso)', () => {
    const comp = abrirOuObterCompetencia(db, rhUser1, '2026-10');

    const f1 = calcularFolhaColaborador(db, rhUser1, { colaboradorId: colabMatriz1.id, competenciaId: comp.id });
    const f2 = calcularFolhaColaborador(db, rhUser1, { colaboradorId: colabMatriz2.id, competenciaId: comp.id });
    const f3 = calcularFolhaColaborador(db, rhUser1, { colaboradorId: colabFilial1.id, competenciaId: comp.id });

    const somaLiquidosEsperada = f1.liquido + f2.liquido + f3.liquido;

    const conf = executarConferenciaFinanceira(db, comp.id);

    assert.strictEqual(conf.statusGeral, 'APROVADO');
    assert.strictEqual(conf.totalColaboradores, 3);
    assert.strictEqual(conf.totalLiquido, Number(somaLiquidosEsperada.toFixed(2)));

    const itemLiquido = conf.itens.find((i) => i.item.includes('Soma dos líquidos'));
    assert.ok(itemLiquido);
    assert.strictEqual(itemLiquido.status, 'CONFERE');
    assert.strictEqual(itemLiquido.divergencia, 0);
  });

  it('2. Deve detectar divergência de R$ 0,01 na soma dos líquidos e rejeitar a conferência', () => {
    const comp = abrirOuObterCompetencia(db, rhUser1, '2026-10');
    calcularFolhaColaborador(db, rhUser1, { colaboradorId: colabMatriz1.id, competenciaId: comp.id });

    // Induz divergência de 1 centavo no banco de dados da folha calculada
    db.prepare('UPDATE folhas SET liquido_centavos = liquido_centavos + 1 WHERE colaborador_id = ?').run(colabMatriz1.id);

    const conf = executarConferenciaFinanceira(db, comp.id);

    // O status geral é DIVERGENTE devido à regra de tolerância R$ 0,00
    assert.strictEqual(conf.statusGeral, 'DIVERGENTE');
    const itemProvDesc = conf.itens.find((i) => i.item.includes('Total Proventos - Total Descontos'));
    assert.ok(itemProvDesc);
    assert.strictEqual(itemProvDesc.status, 'DIVERGENTE');
    assert.strictEqual(itemProvDesc.divergencia, 0.01);
  });

  // --- CRITÉRIO 2: PROVENTOS MENOS DESCONTOS CONTRA LÍQUIDO ---

  it('3. Deve conferir com precisão matemática se Proventos menos Descontos é igual ao Líquido apurado', () => {
    const comp = abrirOuObterCompetencia(db, rhUser1, '2026-10');
    calcularFolhaColaborador(db, rhUser1, { colaboradorId: colabMatriz1.id, competenciaId: comp.id });
    calcularFolhaColaborador(db, rhUser1, { colaboradorId: colabMatriz2.id, competenciaId: comp.id });

    const conf = executarConferenciaFinanceira(db, comp.id);

    const esperadoLiquido = Number((conf.totalProventos - conf.totalDescontos).toFixed(2));
    assert.strictEqual(conf.totalLiquido, esperadoLiquido);

    const itemFormula = conf.itens.find((i) => i.item.includes('Total Proventos - Total Descontos'));
    assert.ok(itemFormula);
    assert.strictEqual(itemFormula.status, 'CONFERE');
    assert.strictEqual(itemFormula.divergencia, 0.00);
  });

  // --- CRITÉRIO 3: TOTAIS POR FILIAL CONTRA O TOTAL GERAL ---

  it('4. Deve conferir os totais por filial (Matriz e Filial) contra o total geral da folha', () => {
    const comp = abrirOuObterCompetencia(db, rhUser1, '2026-10');
    calcularFolhaColaborador(db, rhUser1, { colaboradorId: colabMatriz1.id, competenciaId: comp.id }); // Matriz
    calcularFolhaColaborador(db, rhUser1, { colaboradorId: colabMatriz2.id, competenciaId: comp.id }); // Matriz
    calcularFolhaColaborador(db, rhUser1, { colaboradorId: colabFilial1.id, competenciaId: comp.id }); // Filial Campinas

    const conf = executarConferenciaFinanceira(db, comp.id);

    const itemFilial = conf.itens.find((i) => i.item.includes('Soma dos Totais por Filial'));
    assert.ok(itemFilial);
    assert.strictEqual(itemFilial.status, 'CONFERE');
    assert.strictEqual(itemFilial.divergencia, 0.00);
    assert.strictEqual(itemFilial.calculado, conf.totalLiquido);
  });

  // --- CRITÉRIO 4: CONCILIAÇÃO: FOLHA DO MÊS, DADOS DE PAGAMENTO E SOMA DOS CONTRACHEQUES ---

  it('5. Deve conciliar rigorosamente o Relatório da Folha do Mês, Dados de Pagamento e soma dos Contracheques', () => {
    const comp = abrirOuObterCompetencia(db, rhUser1, '2026-10');
    calcularFolhaColaborador(db, rhUser1, { colaboradorId: colabMatriz1.id, competenciaId: comp.id });
    calcularFolhaColaborador(db, rhUser1, { colaboradorId: colabMatriz2.id, competenciaId: comp.id });
    calcularFolhaColaborador(db, rhUser1, { colaboradorId: colabFilial1.id, competenciaId: comp.id });

    // 1. Relatório Folha do Mês
    const relFolha = gerarRelatorioFolhaMes(db, rhUser1, comp.id);

    // 2. Relatório Dados de Pagamento (sem exigir fechada para fins de conferência prévia)
    const relPag = gerarRelatorioDadosPagamento(db, rhUser1, comp.id, undefined, { exigirFechada: false });

    // 3. Soma dos Contracheques Estruturados
    const cc1 = gerarContrachequeEstruturado(db, rhUser1, colabMatriz1.id, comp.id);
    const cc2 = gerarContrachequeEstruturado(db, rhUser1, colabMatriz2.id, comp.id);
    const cc3 = gerarContrachequeEstruturado(db, rhUser1, colabFilial1.id, comp.id);
    const somaContracheques = Number((cc1.totais.liquido + cc2.totais.liquido + cc3.totais.liquido).toFixed(2));

    // Conciliação exata
    assert.strictEqual(relFolha.totaisGerais.liquido, relPag.totalLiquido);
    assert.strictEqual(relFolha.totaisGerais.liquido, somaContracheques);

    // Validação na conferência oficial
    const conf = executarConferenciaFinanceira(db, comp.id);
    const itemConciliaPag = conf.itens.find((i) => i.item.includes('Conciliação Folha do Mês vs Dados de Pagamento'));
    const itemConciliaContra = conf.itens.find((i) => i.item.includes('Conciliação Folha do Mês vs Soma dos Contracheques'));

    assert.ok(itemConciliaPag);
    assert.strictEqual(itemConciliaPag.status, 'CONFERE');
    assert.ok(itemConciliaContra);
    assert.strictEqual(itemConciliaContra.status, 'CONFERE');
  });

  // --- CRITÉRIO 5: CONFERÊNCIA DE INSS, IRRF E FGTS DAS VERBAS INDIVIDUAIS ---

  it('6. Deve conferir INSS, IRRF e FGTS dos relatórios contra a soma das verbas individuais', () => {
    const comp = abrirOuObterCompetencia(db, rhUser1, '2026-10');
    calcularFolhaColaborador(db, rhUser1, { colaboradorId: colabMatriz1.id, competenciaId: comp.id });
    calcularFolhaColaborador(db, rhUser1, { colaboradorId: colabMatriz2.id, competenciaId: comp.id });

    const conf = executarConferenciaFinanceira(db, comp.id);

    const itemINSS = conf.itens.find((i) => i.item.includes('Verbas Individuais de INSS'));
    const itemIRRF = conf.itens.find((i) => i.item.includes('Verbas Individuais de IRRF'));
    const itemFGTS = conf.itens.find((i) => i.item.includes('Total FGTS Memória'));

    assert.ok(itemINSS);
    assert.strictEqual(itemINSS.status, 'CONFERE');
    assert.strictEqual(itemINSS.divergencia, 0.00);

    assert.ok(itemIRRF);
    assert.strictEqual(itemIRRF.status, 'CONFERE');
    assert.strictEqual(itemIRRF.divergencia, 0.00);

    assert.ok(itemFGTS);
    assert.strictEqual(itemFGTS.status, 'CONFERE');
    assert.strictEqual(itemFGTS.divergencia, 0.00);
  });

  it('7. Deve acusar DIVERGENTE e identificar o item caso ocorra discrepância de R$ 0,01 em verba de INSS', () => {
    const comp = abrirOuObterCompetencia(db, rhUser1, '2026-10');
    calcularFolhaColaborador(db, rhUser1, { colaboradorId: colabMatriz1.id, competenciaId: comp.id });

    // Modifica uma verba de INSS em 1 centavo
    db.prepare("UPDATE folha_verbas SET valor_centavos = valor_centavos + 1 WHERE tipo = 'INSS'").run();

    const conf = executarConferenciaFinanceira(db, comp.id);

    assert.strictEqual(conf.statusGeral, 'DIVERGENTE');
    const itemINSS = conf.itens.find((i) => i.item.includes('Verbas Individuais de INSS'));
    assert.ok(itemINSS);
    assert.strictEqual(itemINSS.status, 'DIVERGENTE');
    assert.strictEqual(itemINSS.divergencia, 0.01);
  });

  it('8. Deve acusar DIVERGENTE e identificar o item caso ocorra discrepância de R$ 0,01 em verba de FGTS', () => {
    const comp = abrirOuObterCompetencia(db, rhUser1, '2026-10');
    calcularFolhaColaborador(db, rhUser1, { colaboradorId: colabMatriz1.id, competenciaId: comp.id });

    // Modifica o FGTS em 1 centavo na tabela de folhas
    db.prepare('UPDATE folhas SET fgts_centavos = fgts_centavos + 1 WHERE colaborador_id = ?').run(colabMatriz1.id);

    const conf = executarConferenciaFinanceira(db, comp.id);

    assert.strictEqual(conf.statusGeral, 'DIVERGENTE');
    const itemFGTS = conf.itens.find((i) => i.item.includes('Total FGTS Memória'));
    assert.ok(itemFGTS);
    assert.strictEqual(itemFGTS.status, 'DIVERGENTE');
    assert.strictEqual(itemFGTS.divergencia, 0.01);
  });

  // --- CRITÉRIO 6: TOLERÂNCIA R$ 0,00 BLOQUEIA FECHAMENTO E CONFIRMAÇÃO ---

  it('9. Qualquer divergência de R$ 0,01 deve bloquear o fechamento seguro da folha e apontar o item', () => {
    const comp = abrirOuObterCompetencia(db, rhUser1, '2026-10');
    calcularFolhaColaborador(db, rhUser1, { colaboradorId: colabMatriz1.id, competenciaId: comp.id });

    // Cria divergência de R$ 0,01 no líquido da folha
    db.prepare('UPDATE folhas SET liquido_centavos = liquido_centavos + 1 WHERE colaborador_id = ?').run(colabMatriz1.id);

    // Tenta fechar folha
    assert.throws(
      () => fecharFolhaSegura(db, rhUser1, comp.id),
      (err: any) => {
        assert.ok(err.message.includes('existem divergências na conferência financeira interna'));
        assert.ok(err.message.includes('RN-59 / US-13'));
        return true;
      }
    );
  });

  it('10. Qualquer divergência de R$ 0,01 deve bloquear a confirmação da conferência pelo RH', () => {
    const comp = abrirOuObterCompetencia(db, rhUser1, '2026-10');
    calcularFolhaColaborador(db, rhUser1, { colaboradorId: colabMatriz1.id, competenciaId: comp.id });

    // Induz divergência
    db.prepare("UPDATE folha_verbas SET valor_centavos = valor_centavos + 1 WHERE tipo = 'INSS'").run();

    assert.throws(
      () => confirmarConferenciaFolha(db, rhUser2, comp.id),
      (err: any) => {
        assert.ok(err.message.includes('existem divergências financeiras (RN-59 / US-13)'));
        return true;
      }
    );
  });

  // --- CRITÉRIO 7: EXIGIR CONFIRMAÇÃO POR USUÁRIO RH ---

  it('11. Confirmação da conferência é restrita ao perfil RH; Diretoria e Admin são rejeitados', () => {
    const comp = abrirOuObterCompetencia(db, rhUser1, '2026-10');
    calcularFolhaColaborador(db, rhUser1, { colaboradorId: colabMatriz1.id, competenciaId: comp.id });

    // Diretoria tenta confirmar -> Rejeitada
    assert.throws(
      () => confirmarConferenciaFolha(db, diretoriaUser, comp.id),
      /Você não tem permissão para esta ação/
    );

    // Admin tenta confirmar -> Rejeitado
    assert.throws(
      () => confirmarConferenciaFolha(db, adminUser, comp.id),
      /Você não tem permissão para esta ação/
    );

    // Usuário RH confirma com sucesso
    const res = confirmarConferenciaFolha(db, rhUser2, comp.id);
    assert.strictEqual(res.status, 'CONFERENCIA_CONFIRMADA');
    assert.strictEqual(res.conferidoPor, rhUser2.id);
  });

  // --- CRITÉRIO 8: MESMA PESSOA QUE LANÇOU/CALCULOU E CONFIRMAR ---

  it('12. Mesma pessoa que calculou tenta confirmar sem justificativa, havendo outro RH ativo: deve ser bloqueada', () => {
    const comp = abrirOuObterCompetencia(db, rhUser1, '2026-10');
    calcularFolhaColaborador(db, rhUser1, { colaboradorId: colabMatriz1.id, competenciaId: comp.id });

    // Verifica que quem calculou foi o rhUser1
    const compCalculada = db.prepare('SELECT calculado_por FROM competencias WHERE id = ?').get(comp.id) as any;
    assert.strictEqual(compCalculada.calculado_por, rhUser1.id);

    // rhUser1 tenta confirmar sem justificativa (havendo rhUser2 ativo) -> Bloqueado
    assert.throws(
      () => confirmarConferenciaFolha(db, rhUser1, comp.id),
      (err: any) => {
        assert.ok(err.message.includes('Conferência realizada pelo mesmo usuário que calculou'));
        assert.ok(err.message.includes('informe uma justificativa para notificação da Diretoria'));
        return true;
      }
    );
  });

  it('13. Mesma pessoa com justificativa informa motivo válido: aprova, grava log e notifica Diretoria', () => {
    const comp = abrirOuObterCompetencia(db, rhUser1, '2026-10');
    calcularFolhaColaborador(db, rhUser1, { colaboradorId: colabMatriz1.id, competenciaId: comp.id });

    const justificativa = 'Plantão de fechamento extraordinário: analista 2 ausente em licença médica';

    // rhUser1 confirma fornecendo a justificativa
    const res = confirmarConferenciaFolha(db, rhUser1, comp.id, justificativa);

    assert.strictEqual(res.status, 'CONFERENCIA_CONFIRMADA');
    assert.strictEqual(res.notificouDiretoria, true);
    assert.strictEqual(res.justificativaMesmoUsuario, justificativa);

    // Valida persistência da justificativa na competência
    const compAtualizada = db.prepare('SELECT conferido_por, justificativa_conferencia FROM competencias WHERE id = ?').get(comp.id) as any;
    assert.strictEqual(compAtualizada.conferido_por, rhUser1.id);
    assert.strictEqual(compAtualizada.justificativa_conferencia, justificativa);

    // Valida gravação no Log de Auditoria imutável
    const log = db.prepare(`
      SELECT * FROM logs_auditoria
      WHERE acao = 'CONFIRMAR_CONFERENCIA_FOLHA' AND registro_id = ?
    `).get(String(comp.id)) as any;
    assert.ok(log);
    assert.ok(log.detalhes.includes('Justificativa mesmo usuário'));
    assert.ok(log.detalhes.includes(justificativa));

    // Valida geração de alerta de notificação para a Diretoria na Central de Alertas
    const alertas = consultarAlertas(db, diretoriaUser);
    const alertaNotificacao = alertas.find((a) => a.tipo === 'NOTIFICACAO_DIRETORIA_CONFERENCIA');
    assert.ok(alertaNotificacao);
    assert.ok(alertaNotificacao.titulo.includes('Notificação à Diretoria'));
    assert.ok(alertaNotificacao.detalhes.includes(justificativa));
  });

  it('14. Analistas de RH diferentes dispensam justificativa para confirmar conferência', () => {
    const comp = abrirOuObterCompetencia(db, rhUser1, '2026-10');
    calcularFolhaColaborador(db, rhUser1, { colaboradorId: colabMatriz1.id, competenciaId: comp.id });

    // rhUser1 calculou; rhUser2 confere e confirma (sem necessidade de justificativa)
    const res = confirmarConferenciaFolha(db, rhUser2, comp.id);

    assert.strictEqual(res.status, 'CONFERENCIA_CONFIRMADA');
    assert.strictEqual(res.conferidoPor, rhUser2.id);
    assert.strictEqual(res.notificouDiretoria, false);
  });

  it('15. Devolução da folha para ajuste com motivo reabre a competência e limpa conferência', () => {
    const comp = abrirOuObterCompetencia(db, rhUser1, '2026-10');
    calcularFolhaColaborador(db, rhUser1, { colaboradorId: colabMatriz1.id, competenciaId: comp.id });
    confirmarConferenciaFolha(db, rhUser2, comp.id);

    // Devolve para ajuste
    const motivo = 'Identificada pendência de lançamento de atestado médico para colaborador da Matriz';
    devolverFolhaParaAjuste(db, rhUser1, comp.id, motivo);

    const compDevolvida = db.prepare('SELECT situacao, conferido_por, conferido_em, motivo_devolucao FROM competencias WHERE id = ?').get(comp.id) as any;
    assert.strictEqual(compDevolvida.situacao, 'ABERTA');
    assert.strictEqual(compDevolvida.conferido_por, null);
    assert.strictEqual(compDevolvida.conferido_em, null);
    assert.strictEqual(compDevolvida.motivo_devolucao, motivo);
  });
});
