/**
 * server.ts - Servidor HTTP da Aplicação Demonstrativa da US-13 (Spec v1.7).
 * 
 * Executa testes e simulações interativas contra os serviços reais do backend,
 * utilizando SQLite em memória (:memory:) isolado.
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { carregarFixtures, FixtureContext } from './fixtures.js';
import {
  executarConferenciaFinanceira,
  confirmarConferenciaFolha,
  devolverFolhaParaAjuste,
  fecharFolhaSegura,
  calcularFolhaColaborador,
} from '../back-end/src/services/folhaService.js';
import {
  gerarRelatorioFolhaMes,
  gerarRelatorioDadosPagamento,
  gerarContrachequeEstruturado,
} from '../back-end/src/services/relatoriosService.js';
import { consultarAlertas } from '../back-end/src/services/documentosAlertasService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PUBLIC_DIR = path.resolve(__dirname, 'public');

let ctx: FixtureContext = carregarFixtures();

export interface ScenarioResult {
  id: number;
  nome: string;
  regraReferencia: string;
  criterio: string;
  classificacao: 'APROVADO' | 'REPROVADO';
  statusTexto: string;
  comportamentoEsperado: string;
  comportamentoObtido: string;
  detalhesTecnicos: any;
  sucesso: boolean;
}

// ---------------------------------------------------------------------------
// Execução dos 12 Cenários Oficiais da US-13
// ---------------------------------------------------------------------------

export function executarCenario1(localCtx: FixtureContext): ScenarioResult {
  try {
    const conf = executarConferenciaFinanceira(localCtx.db, localCtx.competencia.id);
    const item = conf.itens.find((i) => i.item.includes('Soma dos líquidos'));

    const confereCentavos = item && item.divergencia === 0;

    return {
      id: 1,
      nome: 'Conferência em Centavos da Soma dos Líquidos vs Total da Folha',
      regraReferencia: 'US-13, RN-59 (Critério 1)',
      criterio: 'Conferir em centavos a soma dos líquidos individuais contra o total da folha.',
      classificacao: confereCentavos ? 'APROVADO' : 'REPROVADO',
      statusTexto: confereCentavos ? 'Aprovado: 0 divergência' : 'Divergência detectada',
      comportamentoEsperado: `Soma dos líquidos em centavos (${item?.detalheCentavos?.esperadoCentavos || 0}¢) coincide exatamente com o total da folha.`,
      comportamentoObtido: `Total apurado R$ ${conf.totalLiquido.toFixed(2)} (${item?.detalheCentavos?.calculadoCentavos || 0}¢). Diferença: R$ ${item?.divergencia.toFixed(2)}.`,
      detalhesTecnicos: { item, totalColaboradores: conf.totalColaboradores },
      sucesso: Boolean(confereCentavos),
    };
  } catch (err: any) {
    return {
      id: 1,
      nome: 'Conferência em Centavos da Soma dos Líquidos vs Total da Folha',
      regraReferencia: 'US-13, RN-59 (Critério 1)',
      criterio: 'Conferir em centavos a soma dos líquidos individuais contra o total da folha.',
      classificacao: 'REPROVADO',
      statusTexto: 'Erro na execução',
      comportamentoEsperado: 'Conferência executada sem falhas',
      comportamentoObtido: `Erro: ${err.message}`,
      detalhesTecnicos: err.stack,
      sucesso: false,
    };
  }
}

export function executarCenario2(localCtx: FixtureContext): ScenarioResult {
  try {
    const conf = executarConferenciaFinanceira(localCtx.db, localCtx.competencia.id);
    const item = conf.itens.find((i) => i.item.includes('Total Proventos - Total Descontos'));

    const formulaCorreta = item && item.status === 'CONFERE';

    return {
      id: 2,
      nome: 'Conferência de Proventos menos Descontos contra Líquido',
      regraReferencia: 'US-13, RN-59 (Critério 2)',
      criterio: 'Conferir proventos menos descontos contra líquido calculado.',
      classificacao: formulaCorreta ? 'APROVADO' : 'REPROVADO',
      statusTexto: formulaCorreta ? 'Aprovado: Equação conferida' : 'Divergência na fórmula',
      comportamentoEsperado: `Proventos (R$ ${conf.totalProventos.toFixed(2)}) - Descontos (R$ ${conf.totalDescontos.toFixed(2)}) == Líquido (R$ ${conf.totalLiquido.toFixed(2)}).`,
      comportamentoObtido: `Calculado: R$ ${item?.calculado.toFixed(2)} vs Esperado R$ ${item?.esperado.toFixed(2)}. Divergência: R$ ${item?.divergencia.toFixed(2)}.`,
      detalhesTecnicos: { proventos: conf.totalProventos, descontos: conf.totalDescontos, liquido: conf.totalLiquido },
      sucesso: Boolean(formulaCorreta),
    };
  } catch (err: any) {
    return {
      id: 2,
      nome: 'Conferência de Proventos menos Descontos contra Líquido',
      regraReferencia: 'US-13, RN-59 (Critério 2)',
      criterio: 'Conferir proventos menos descontos contra líquido calculado.',
      classificacao: 'REPROVADO',
      statusTexto: 'Erro',
      comportamentoEsperado: 'Equação conferida',
      comportamentoObtido: err.message,
      detalhesTecnicos: err.stack,
      sucesso: false,
    };
  }
}

export function executarCenario3(localCtx: FixtureContext): ScenarioResult {
  try {
    const conf = executarConferenciaFinanceira(localCtx.db, localCtx.competencia.id);
    const item = conf.itens.find((i) => i.item.includes('Soma dos Totais por Filial'));

    const filialCorreta = item && item.status === 'CONFERE';

    return {
      id: 3,
      nome: 'Conferência de Totais por Filial contra Total Geral',
      regraReferencia: 'US-13, RN-59 (Critério 3)',
      criterio: 'Conferir totais por filial contra o total geral.',
      classificacao: filialCorreta ? 'APROVADO' : 'REPROVADO',
      statusTexto: filialCorreta ? 'Aprovado: Filiais reconciliadas' : 'Divergência entre filiais',
      comportamentoEsperado: `Soma dos subtotais da Matriz, Campinas e Santos igual ao Total Geral (R$ ${conf.totalLiquido.toFixed(2)}).`,
      comportamentoObtido: `Soma das filiais: R$ ${item?.calculado.toFixed(2)}. Total geral: R$ ${item?.esperado.toFixed(2)}. Divergência: R$ ${item?.divergencia.toFixed(2)}.`,
      detalhesTecnicos: { item },
      sucesso: Boolean(filialCorreta),
    };
  } catch (err: any) {
    return {
      id: 3,
      nome: 'Conferência de Totais por Filial contra Total Geral',
      regraReferencia: 'US-13, RN-59 (Critério 3)',
      criterio: 'Conferir totais por filial contra o total geral.',
      classificacao: 'REPROVADO',
      statusTexto: 'Erro',
      comportamentoEsperado: 'Filiais reconciliadas',
      comportamentoObtido: err.message,
      detalhesTecnicos: err.stack,
      sucesso: false,
    };
  }
}

export function executarCenario4(localCtx: FixtureContext): ScenarioResult {
  try {
    const compId = localCtx.competencia.id;
    const relFolha = gerarRelatorioFolhaMes(localCtx.db, localCtx.rhUser1, compId);
    const relPag = gerarRelatorioDadosPagamento(localCtx.db, localCtx.rhUser1, compId, undefined, { exigirFechada: false });

    // Contracheques
    const colabs = [localCtx.colaboradores.alice, localCtx.colaboradores.bernardo, localCtx.colaboradores.camila, localCtx.colaboradores.daniel];
    let somaCC = 0;
    for (const c of colabs) {
      const cc = gerarContrachequeEstruturado(localCtx.db, localCtx.rhUser1, c.id, compId);
      somaCC += cc.totais.liquido;
    }
    somaCC = Number(somaCC.toFixed(2));

    const conf = executarConferenciaFinanceira(localCtx.db, compId);
    const conciliaOk = relFolha.totaisGerais.liquido === relPag.totalLiquido &&
                       relFolha.totaisGerais.liquido === somaCC;

    return {
      id: 4,
      nome: 'Conciliação Tripla: Folha do Mês vs Dados de Pagamento vs Contracheques',
      regraReferencia: 'US-13, RN-57, RN-60, RN-73 (Critério 4)',
      criterio: 'Conciliar Folha do mês, Dados de pagamento e soma dos contracheques.',
      classificacao: conciliaOk ? 'APROVADO' : 'REPROVADO',
      statusTexto: conciliaOk ? 'Aprovado: 100% Conciliado' : 'Divergência na conciliação',
      comportamentoEsperado: `Folha do Mês (R$ ${relFolha.totaisGerais.liquido.toFixed(2)}) == Dados de Pagamento (R$ ${relPag.totalLiquido.toFixed(2)}) == Soma Contracheques (R$ ${somaCC.toFixed(2)}).`,
      comportamentoObtido: `Valores apurados: Folha R$ ${relFolha.totaisGerais.liquido.toFixed(2)}, Pagamento R$ ${relPag.totalLiquido.toFixed(2)}, Contracheques R$ ${somaCC.toFixed(2)}.`,
      detalhesTecnicos: { folhaMes: relFolha.totaisGerais.liquido, dadosPagamento: relPag.totalLiquido, somaContracheques: somaCC },
      sucesso: conciliaOk,
    };
  } catch (err: any) {
    return {
      id: 4,
      nome: 'Conciliação Tripla: Folha do Mês vs Dados de Pagamento vs Contracheques',
      regraReferencia: 'US-13 (Critério 4)',
      criterio: 'Conciliar Folha do mês, Dados de pagamento e soma dos contracheques.',
      classificacao: 'REPROVADO',
      statusTexto: 'Erro',
      comportamentoEsperado: 'Conciliação completa',
      comportamentoObtido: err.message,
      detalhesTecnicos: err.stack,
      sucesso: false,
    };
  }
}

export function executarCenario5(localCtx: FixtureContext): ScenarioResult {
  try {
    const conf = executarConferenciaFinanceira(localCtx.db, localCtx.competencia.id);
    const item = conf.itens.find((i) => i.item.includes('Verbas Individuais de INSS'));

    const inssOk = item && item.status === 'CONFERE' && item.divergencia === 0;

    return {
      id: 5,
      nome: 'Conferência de Verbas Individuais de INSS contra Totais da Folha',
      regraReferencia: 'US-13, RN-59 (Critério 5)',
      criterio: 'Conferir INSS dos relatórios contra a soma das verbas individuais.',
      classificacao: inssOk ? 'APROVADO' : 'REPROVADO',
      statusTexto: inssOk ? 'Aprovado: INSS bate em centavos' : 'Divergência em INSS',
      comportamentoEsperado: `Soma de cada linha de INSS dos contracheques bate com o total de INSS descontado (R$ ${item?.esperado.toFixed(2)}).`,
      comportamentoObtido: `INSS Esperado: R$ ${item?.esperado.toFixed(2)}, Calculado: R$ ${item?.calculado.toFixed(2)}. Divergência: R$ ${item?.divergencia.toFixed(2)}.`,
      detalhesTecnicos: { item },
      sucesso: Boolean(inssOk),
    };
  } catch (err: any) {
    return {
      id: 5,
      nome: 'Conferência de Verbas Individuais de INSS contra Totais da Folha',
      regraReferencia: 'US-13 (Critério 5)',
      criterio: 'Conferir INSS contra verbas individuais.',
      classificacao: 'REPROVADO',
      statusTexto: 'Erro',
      comportamentoEsperado: 'INSS conferido',
      comportamentoObtido: err.message,
      detalhesTecnicos: err.stack,
      sucesso: false,
    };
  }
}

export function executarCenario6(localCtx: FixtureContext): ScenarioResult {
  try {
    const conf = executarConferenciaFinanceira(localCtx.db, localCtx.competencia.id);
    const item = conf.itens.find((i) => i.item.includes('Verbas Individuais de IRRF'));

    const irrfOk = item && item.status === 'CONFERE' && item.divergencia === 0;

    return {
      id: 6,
      nome: 'Conferência de Verbas Individuais de IRRF contra Totais da Folha',
      regraReferencia: 'US-13, RN-59 (Critério 5)',
      criterio: 'Conferir IRRF dos relatórios contra a soma das verbas individuais.',
      classificacao: irrfOk ? 'APROVADO' : 'REPROVADO',
      statusTexto: irrfOk ? 'Aprovado: IRRF bate em centavos' : 'Divergência em IRRF',
      comportamentoEsperado: `Soma das retenções individuais de IRRF bate com o total descontado (R$ ${item?.esperado.toFixed(2)}).`,
      comportamentoObtido: `IRRF Esperado: R$ ${item?.esperado.toFixed(2)}, Calculado: R$ ${item?.calculado.toFixed(2)}. Divergência: R$ ${item?.divergencia.toFixed(2)}.`,
      detalhesTecnicos: { item },
      sucesso: Boolean(irrfOk),
    };
  } catch (err: any) {
    return {
      id: 6,
      nome: 'Conferência de Verbas Individuais de IRRF contra Totais da Folha',
      regraReferencia: 'US-13 (Critério 5)',
      criterio: 'Conferir IRRF contra verbas individuais.',
      classificacao: 'REPROVADO',
      statusTexto: 'Erro',
      comportamentoEsperado: 'IRRF conferido',
      comportamentoObtido: err.message,
      detalhesTecnicos: err.stack,
      sucesso: false,
    };
  }
}

export function executarCenario7(localCtx: FixtureContext): ScenarioResult {
  try {
    const conf = executarConferenciaFinanceira(localCtx.db, localCtx.competencia.id);
    const item = conf.itens.find((i) => i.item.includes('Total FGTS Memória'));

    const fgtsOk = item && item.status === 'CONFERE' && item.divergencia === 0;

    return {
      id: 7,
      nome: 'Conferência de FGTS da Memória vs Encargos da Empresa',
      regraReferencia: 'US-13, RN-59 (Critério 5)',
      criterio: 'Conferir FGTS dos relatórios contra a soma das verbas individuais.',
      classificacao: fgtsOk ? 'APROVADO' : 'REPROVADO',
      statusTexto: fgtsOk ? 'Aprovado: FGTS bate em centavos' : 'Divergência em FGTS',
      comportamentoEsperado: `Soma do encargo de 8% de FGTS de cada colaborador bate com o total da folha (R$ ${item?.esperado.toFixed(2)}).`,
      comportamentoObtido: `FGTS Esperado: R$ ${item?.esperado.toFixed(2)}, Calculado: R$ ${item?.calculado.toFixed(2)}. Divergência: R$ ${item?.divergencia.toFixed(2)}.`,
      detalhesTecnicos: { item },
      sucesso: Boolean(fgtsOk),
    };
  } catch (err: any) {
    return {
      id: 7,
      nome: 'Conferência de FGTS da Memória vs Encargos da Empresa',
      regraReferencia: 'US-13 (Critério 5)',
      criterio: 'Conferir FGTS contra verbas individuais.',
      classificacao: 'REPROVADO',
      statusTexto: 'Erro',
      comportamentoEsperado: 'FGTS conferido',
      comportamentoObtido: err.message,
      detalhesTecnicos: err.stack,
      sucesso: false,
    };
  }
}

export function executarCenario8(localCtx: FixtureContext): ScenarioResult {
  try {
    const compId = localCtx.competencia.id;

    // Simulação controlada em transação rollback para testar detecção de R$ 0,01
    localCtx.db.exec('SAVEPOINT sim_div');
    localCtx.db.prepare("UPDATE folha_verbas SET valor_centavos = valor_centavos + 1 WHERE tipo = 'INSS'").run();

    const confDiv = executarConferenciaFinanceira(localCtx.db, compId);
    localCtx.db.exec('ROLLBACK TO sim_div');

    const detectouDivergencia = confDiv.statusGeral === 'DIVERGENTE';
    const itemDiv = confDiv.itens.find((i) => i.status === 'DIVERGENTE');

    return {
      id: 8,
      nome: 'Detecção e Identificação Precisa de Divergência de R$ 0,01 (Tolerância Zero)',
      regraReferencia: 'US-13, RN-59 (Critério 6)',
      criterio: 'Aplicar tolerância exata de R$ 0,00: qualquer diferença bloqueia e identifica o item.',
      classificacao: detectouDivergencia ? 'APROVADO' : 'REPROVADO',
      statusTexto: detectouDivergencia ? 'Aprovado: 1 centavo detectado' : 'Falha na detecção',
      comportamentoEsperado: 'Qualquer diferença de R$ 0,01 marca a folha como DIVERGENTE e indica o item afetado.',
      comportamentoObtido: `Status: ${confDiv.statusGeral}. Item divergente identificado: "${itemDiv?.item}" (Divergência: R$ ${itemDiv?.divergencia.toFixed(2)}).`,
      detalhesTecnicos: { statusGeral: confDiv.statusGeral, itemDivergente: itemDiv },
      sucesso: detectouDivergencia,
    };
  } catch (err: any) {
    return {
      id: 8,
      nome: 'Detecção e Identificação Precisa de Divergência de R$ 0,01 (Tolerância Zero)',
      regraReferencia: 'US-13 (Critério 6)',
      criterio: 'Tolerância R$ 0,00 detecta qualquer diferença.',
      classificacao: 'REPROVADO',
      statusTexto: 'Erro',
      comportamentoEsperado: 'Divergência detectada',
      comportamentoObtido: err.message,
      detalhesTecnicos: err.stack,
      sucesso: false,
    };
  }
}

export function executarCenario9(localCtx: FixtureContext): ScenarioResult {
  try {
    const compId = localCtx.competencia.id;

    localCtx.db.exec('SAVEPOINT sim_bloq');
    localCtx.db.prepare('UPDATE folhas SET liquido_centavos = liquido_centavos + 1 WHERE colaborador_id = ?')
      .run(localCtx.colaboradores.alice.id);

    let bloqueou = false;
    let mensagemErro = '';
    try {
      fecharFolhaSegura(localCtx.db, localCtx.rhUser1, compId);
    } catch (e: any) {
      bloqueou = true;
      mensagemErro = e.message;
    }

    localCtx.db.exec('ROLLBACK TO sim_bloq');

    const sucesso = bloqueou && mensagemErro.includes('existem divergências na conferência financeira');

    return {
      id: 9,
      nome: 'Bloqueio Estrito do Fechamento da Folha perante Divergência Financeira',
      regraReferencia: 'US-13, RN-59 (Critério 6)',
      criterio: 'Qualquer diferença bloqueia o fechamento da folha.',
      classificacao: sucesso ? 'APROVADO' : 'REPROVADO',
      statusTexto: sucesso ? 'Aprovado: Fechamento bloqueado' : 'Falha no bloqueio',
      comportamentoEsperado: 'Fechamento da folha terminantemente bloqueado com exceção explicativa.',
      comportamentoObtido: `Bloqueio acionado: ${bloqueou}. Mensagem do sistema: "${mensagemErro}".`,
      detalhesTecnicos: { bloqueou, mensagemErro },
      sucesso,
    };
  } catch (err: any) {
    return {
      id: 9,
      nome: 'Bloqueio Estrito do Fechamento da Folha perante Divergência Financeira',
      regraReferencia: 'US-13 (Critério 6)',
      criterio: 'Bloqueio do fechamento com divergência.',
      classificacao: 'REPROVADO',
      statusTexto: 'Erro',
      comportamentoEsperado: 'Bloqueio realizado',
      comportamentoObtido: err.message,
      detalhesTecnicos: err.stack,
      sucesso: false,
    };
  }
}

export function executarCenario10(localCtx: FixtureContext): ScenarioResult {
  try {
    const compId = localCtx.competencia.id;

    // 1. Diretoria tenta confirmar -> Bloqueada
    let dirBloqueada = false;
    try {
      confirmarConferenciaFolha(localCtx.db, localCtx.diretoriaUser, compId);
    } catch {
      dirBloqueada = true;
    }

    // 2. Admin tenta confirmar -> Bloqueado
    let adminBloqueado = false;
    try {
      confirmarConferenciaFolha(localCtx.db, localCtx.adminUser, compId);
    } catch {
      adminBloqueado = true;
    }

    // 3. Usuário de RH tenta confirmar -> Autorizado
    const resRH = confirmarConferenciaFolha(localCtx.db, localCtx.rhUser2, compId);
    const rhAutorizado = resRH.status === 'CONFERENCIA_CONFIRMADA';

    const sucesso = dirBloqueada && adminBloqueado && rhAutorizado;

    return {
      id: 10,
      nome: 'Controle de Acesso: Apenas Analista de RH pode Confirmar Conferência',
      regraReferencia: 'US-13, Seção 4.1 (Critério 7)',
      criterio: 'Exigir confirmação da conferência por usuário RH.',
      classificacao: sucesso ? 'APROVADO' : 'REPROVADO',
      statusTexto: sucesso ? 'Aprovado: Permissões 4.1 estritas' : 'Falha de permissão',
      comportamentoEsperado: 'Somente analista de RH confirma; Diretoria e Admin são rejeitados com 403.',
      comportamentoObtido: `Diretoria bloqueada: ${dirBloqueada}. Admin bloqueado: ${adminBloqueado}. RH autorizado: ${rhAutorizado}.`,
      detalhesTecnicos: { dirBloqueada, adminBloqueado, rhAutorizado },
      sucesso,
    };
  } catch (err: any) {
    return {
      id: 10,
      nome: 'Controle de Acesso: Apenas Analista de RH pode Confirmar Conferência',
      regraReferencia: 'US-13 (Critério 7)',
      criterio: 'Exigir confirmação por RH.',
      classificacao: 'REPROVADO',
      statusTexto: 'Erro',
      comportamentoEsperado: 'Controle de perfis',
      comportamentoObtido: err.message,
      detalhesTecnicos: err.stack,
      sucesso: false,
    };
  }
}

export function executarCenario11(localCtx: FixtureContext): ScenarioResult {
  try {
    const compId = localCtx.competencia.id;

    // Reset status conferido
    localCtx.db.prepare('UPDATE competencias SET conferido_por = NULL, conferido_em = NULL WHERE id = ?').run(compId);

    // rhUser1 calculou a folha. Tenta confirmar a si mesmo sem justificativa (existindo rhUser2 ativo)
    let bloqueouMesmoUsuario = false;
    let mensagem = '';
    try {
      confirmarConferenciaFolha(localCtx.db, localCtx.rhUser1, compId);
    } catch (e: any) {
      bloqueouMesmoUsuario = true;
      mensagem = e.message;
    }

    const sucesso = bloqueouMesmoUsuario && mensagem.includes('Conferência realizada pelo mesmo usuário que calculou');

    return {
      id: 11,
      nome: 'Bloqueio de Confirmação pelo Mesmo Analista de RH sem Justificativa',
      regraReferencia: 'US-13, RN-67 (Critério 8)',
      criterio: 'Se a mesma pessoa calculou e confirmar, havendo outro RH ativo, exigir justificativa.',
      classificacao: sucesso ? 'APROVADO' : 'REPROVADO',
      statusTexto: sucesso ? 'Aprovado: Justificativa exigida' : 'Falha na exigência de justificativa',
      comportamentoEsperado: 'Bloqueio imediato da confirmação quando o mesmo RH confirma sem justificativa.',
      comportamentoObtido: `Bloqueio: ${bloqueouMesmoUsuario}. Mensagem: "${mensagem}".`,
      detalhesTecnicos: { bloqueouMesmoUsuario, mensagem },
      sucesso,
    };
  } catch (err: any) {
    return {
      id: 11,
      nome: 'Bloqueio de Confirmação pelo Mesmo Analista de RH sem Justificativa',
      regraReferencia: 'US-13 (Critério 8)',
      criterio: 'Exigir justificativa para mesmo usuário.',
      classificacao: 'REPROVADO',
      statusTexto: 'Erro',
      comportamentoEsperado: 'Bloqueio sem justificativa',
      comportamentoObtido: err.message,
      detalhesTecnicos: err.stack,
      sucesso: false,
    };
  }
}

export function executarCenario12(localCtx: FixtureContext): ScenarioResult {
  try {
    const compId = localCtx.competencia.id;
    const justificativa = 'Plantão extraordinário de fechamento da folha: analista 2 ausente em treinamento externo homologado';

    const res = confirmarConferenciaFolha(localCtx.db, localCtx.rhUser1, compId, justificativa);

    const comp = localCtx.db.prepare('SELECT conferido_por, justificativa_conferencia FROM competencias WHERE id = ?').get(compId) as any;
    const log = localCtx.db.prepare(`
      SELECT * FROM logs_auditoria
      WHERE acao = 'CONFIRMAR_CONFERENCIA_FOLHA' AND registro_id = ?
    `).get(String(compId)) as any;

    const alertas = consultarAlertas(localCtx.db, localCtx.diretoriaUser);
    const notifDiretoria = alertas.find((a) => a.tipo === 'NOTIFICACAO_DIRETORIA_CONFERENCIA');

    const sucesso = res.status === 'CONFERENCIA_CONFIRMADA' &&
                    res.notificouDiretoria === true &&
                    comp.justificativa_conferencia === justificativa &&
                    Boolean(log) &&
                    Boolean(notifDiretoria);

    return {
      id: 12,
      nome: 'Confirmação com Justificativa pelo Mesmo Analista, Auditoria e Notificação à Diretoria',
      regraReferencia: 'US-13, RN-04, RN-67 (Critério 8)',
      criterio: 'Com justificativa, aprovar confirmação, registrar log e notificar Diretoria.',
      classificacao: sucesso ? 'APROVADO' : 'REPROVADO',
      statusTexto: sucesso ? 'Aprovado: Notificação emitida à Diretoria' : 'Falha na notificação',
      comportamentoEsperado: 'Confirmação homologada, gravada no log imutável e alerta gerado para a Diretoria.',
      comportamentoObtido: `Status: ${res.status}. Notificou Diretoria: ${res.notificouDiretoria}. Alerta na Central: "${notifDiretoria?.titulo}".`,
      detalhesTecnicos: { resultado: res, logRegistrado: Boolean(log), notifDiretoria },
      sucesso,
    };
  } catch (err: any) {
    return {
      id: 12,
      nome: 'Confirmação com Justificativa pelo Mesmo Analista, Auditoria e Notificação à Diretoria',
      regraReferencia: 'US-13 (Critério 8)',
      criterio: 'Notificação à Diretoria com justificativa.',
      classificacao: 'REPROVADO',
      statusTexto: 'Erro',
      comportamentoEsperado: 'Notificação realizada',
      comportamentoObtido: err.message,
      detalhesTecnicos: err.stack,
      sucesso: false,
    };
  }
}

export function executarTodosCenarios(localCtx: FixtureContext): ScenarioResult[] {
  return [
    executarCenario1(localCtx),
    executarCenario2(localCtx),
    executarCenario3(localCtx),
    executarCenario4(localCtx),
    executarCenario5(localCtx),
    executarCenario6(localCtx),
    executarCenario7(localCtx),
    executarCenario8(localCtx),
    executarCenario9(localCtx),
    executarCenario10(localCtx),
    executarCenario11(localCtx),
    executarCenario12(localCtx),
  ];
}

// ---------------------------------------------------------------------------
// Servidor HTTP e Rotas da Aplicação Demonstrativa
// ---------------------------------------------------------------------------

function enviarJSON(res: http.ServerResponse, status: number, dados: any) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  });
  res.end(JSON.stringify(dados, null, 2));
}

function parseJSONBody(req: http.IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

export function criarServidorDemo(porta: number = 3016): http.Server {
  const server = http.createServer(async (req, res) => {
    const parsedUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    const pathname = parsedUrl.pathname;
    const method = req.method || 'GET';

    if (method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      });
      return res.end();
    }

    try {
      // 1. Status geral e resumo de cenários
      if (method === 'GET' && pathname === '/api/status') {
        const resultados = executarTodosCenarios(ctx);
        const aprovados = resultados.filter((r) => r.classificacao === 'APROVADO').length;
        const reprovados = resultados.filter((r) => r.classificacao === 'REPROVADO').length;
        const conf = executarConferenciaFinanceira(ctx.db, ctx.competencia.id);

        return enviarJSON(res, 200, {
          totalCenarios: resultados.length,
          aprovados,
          reprovados,
          taxaAprovacao: Number(((aprovados / resultados.length) * 100).toFixed(1)),
          conferenciaStatus: conf.statusGeral,
          tolerancia: 'R$ 0,00',
          totalLiquido: conf.totalLiquido,
          totalProventos: conf.totalProventos,
          totalDescontos: conf.totalDescontos,
          competencia: ctx.competencia.mes_ano,
          colaboradores: Object.values(ctx.colaboradores).map((c: any) => ({
            id: c.id,
            nome: c.nome,
            cargo: c.cargo,
            filial: c.filial_id === ctx.filiais.matriz.id ? 'Matriz SP' : c.filial_id === ctx.filiais.campinas.id ? 'Campinas' : 'Santos',
          })),
        });
      }

      // 2. Executar todos os 12 cenários
      if (method === 'GET' && pathname === '/api/scenarios/run-all') {
        const resultados = executarTodosCenarios(ctx);
        return enviarJSON(res, 200, resultados);
      }

      // 3. Executar um cenário específico por ID
      const matchCenario = pathname.match(/^\/api\/scenarios\/(\d+)\/run$/);
      if (method === 'POST' && matchCenario) {
        const cenarioId = parseInt(matchCenario[1], 10);
        let resultado: ScenarioResult | null = null;
        switch (cenarioId) {
          case 1: resultado = executarCenario1(ctx); break;
          case 2: resultado = executarCenario2(ctx); break;
          case 3: resultado = executarCenario3(ctx); break;
          case 4: resultado = executarCenario4(ctx); break;
          case 5: resultado = executarCenario5(ctx); break;
          case 6: resultado = executarCenario6(ctx); break;
          case 7: resultado = executarCenario7(ctx); break;
          case 8: resultado = executarCenario8(ctx); break;
          case 9: resultado = executarCenario9(ctx); break;
          case 10: resultado = executarCenario10(ctx); break;
          case 11: resultado = executarCenario11(ctx); break;
          case 12: resultado = executarCenario12(ctx); break;
          default:
            return enviarJSON(res, 404, { erro: 'Cenário não encontrado (ID deve ser 1..12).' });
        }
        return enviarJSON(res, 200, resultado);
      }

      // 4. Detalhes completos da conferência financeira
      if (method === 'GET' && pathname === '/api/conferencia/detalhes') {
        const conf = executarConferenciaFinanceira(ctx.db, ctx.competencia.id);
        const comp = ctx.db.prepare('SELECT * FROM competencias WHERE id = ?').get(ctx.competencia.id) as any;
        return enviarJSON(res, 200, {
          conferencia: conf,
          competencia: comp,
        });
      }

      // 5. Simular indução de divergência
      if (method === 'POST' && pathname === '/api/conferencia/simular-divergencia') {
        const body = await parseJSONBody(req);
        const tipo = body.tipo || 'LIQUIDO'; // 'LIQUIDO' | 'INSS' | 'IRRF' | 'FGTS'

        if (tipo === 'LIQUIDO') {
          ctx.db.prepare('UPDATE folhas SET liquido_centavos = liquido_centavos + 1 WHERE colaborador_id = ?')
            .run(ctx.colaboradores.alice.id);
        } else if (tipo === 'INSS') {
          ctx.db.prepare("UPDATE folha_verbas SET valor_centavos = valor_centavos + 1 WHERE tipo = 'INSS' LIMIT 1").run();
        } else if (tipo === 'IRRF') {
          ctx.db.prepare("UPDATE folha_verbas SET valor_centavos = valor_centavos + 1 WHERE tipo = 'IRRF' LIMIT 1").run();
        } else if (tipo === 'FGTS') {
          ctx.db.prepare('UPDATE folhas SET fgts_centavos = fgts_centavos + 1 WHERE colaborador_id = ?')
            .run(ctx.colaboradores.alice.id);
        }

        const novaConf = executarConferenciaFinanceira(ctx.db, ctx.competencia.id);
        return enviarJSON(res, 200, {
          mensagem: `Divergência de R$ 0,01 induzida no item ${tipo}.`,
          statusGeral: novaConf.statusGeral,
          itensDivergentes: novaConf.itensDivergentes,
        });
      }

      // 6. Restaurar dados para consistência perfeita
      if (method === 'POST' && pathname === '/api/conferencia/restaurar') {
        ctx = carregarFixtures();
        const conf = executarConferenciaFinanceira(ctx.db, ctx.competencia.id);
        return enviarJSON(res, 200, {
          mensagem: 'Ambiente restaurado com sucesso. Conferência 100% aprovada.',
          statusGeral: conf.statusGeral,
        });
      }

      // 7. Confirmar conferência pelo RH (com ou sem justificativa)
      if (method === 'POST' && pathname === '/api/conferencia/confirmar') {
        const body = await parseJSONBody(req);
        const mesmoUsuario = Boolean(body.mesmoUsuario);
        const usuario = mesmoUsuario ? ctx.rhUser1 : ctx.rhUser2;
        const justificativa = body.justificativa;

        try {
          const resConf = confirmarConferenciaFolha(ctx.db, usuario, ctx.competencia.id, justificativa);
          return enviarJSON(res, 200, resConf);
        } catch (e: any) {
          return enviarJSON(res, 400, { erro: e.message });
        }
      }

      // 8. Tentar fechar a folha (demonstração de bloqueio)
      if (method === 'POST' && pathname === '/api/conferencia/fechar') {
        try {
          const fechado = fecharFolhaSegura(ctx.db, ctx.rhUser1, ctx.competencia.id);
          return enviarJSON(res, 200, fechado);
        } catch (e: any) {
          return enviarJSON(res, 400, { erro: e.message });
        }
      }

      // 9. Central de alertas e notificações para Diretoria
      if (method === 'GET' && pathname === '/api/alertas') {
        const alertas = consultarAlertas(ctx.db, ctx.diretoriaUser);
        return enviarJSON(res, 200, alertas);
      }

      // 10. Consulta de Logs de Auditoria
      if (method === 'GET' && pathname === '/api/logs') {
        const logs = ctx.db.prepare('SELECT * FROM logs_auditoria ORDER BY id DESC LIMIT 50').all();
        return enviarJSON(res, 200, logs);
      }

      // Arquivos Estáticos da Interface Web
      let filePath = pathname === '/' ? '/index.html' : pathname;
      const safePath = path.normalize(filePath).replace(/^(\.\.[\/\\])+/, '');
      const fullPath = path.join(PUBLIC_DIR, safePath);

      if (fs.existsSync(fullPath) && fs.statSync(fullPath).isFile()) {
        const ext = path.extname(fullPath).toLowerCase();
        const mimeTypes: Record<string, string> = {
          '.html': 'text/html; charset=utf-8',
          '.css': 'text/css; charset=utf-8',
          '.js': 'application/javascript; charset=utf-8',
          '.json': 'application/json; charset=utf-8',
          '.svg': 'image/svg+xml',
        };
        const contentType = mimeTypes[ext] || 'application/octet-stream';
        res.writeHead(200, { 'Content-Type': contentType });
        return res.end(fs.readFileSync(fullPath));
      }

      return enviarJSON(res, 404, { erro: 'Rota não encontrada.' });
    } catch (err: any) {
      return enviarJSON(res, 500, { erro: err.message || 'Erro interno no servidor de demonstração.' });
    }
  });

  return server;
}

// Inicia servidor se executado diretamente
if (process.argv[1] && process.argv[1].endsWith('server.ts')) {
  const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3016;
  const srv = criarServidorDemo(PORT);
  srv.listen(PORT, '127.0.0.1', () => {
    console.log(`[DEMO-US13] Servidor de Demonstração QA US-13 ativo em http://127.0.0.1:${PORT}`);
  });
}
