/**
 * server.ts - Servidor HTTP Node.js para Demonstração de QA da Etapa 2.
 * 
 * Executa testes reais nos serviços de back-end/src/services/ usando SQLite em memória (:memory:),
 * isolado do banco de dados principal.
 * 
 * Resolve os caminhos dos arquivos estáticos usando __dirname relativo a este arquivo,
 * evitando o erro "Arquivo não encontrado" independentemente de onde o processo for iniciado.
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { carregarFixtures, FixtureContext } from './fixtures.js';
import {
  lancarHorasExtras,
  lancarFaltaInjustificada,
  lancarAtestado,
  consultarAtestado,
  lancarValeTransporte,
} from '../back-end/src/services/eventoService.js';
import { fecharCompetencia, reabrirCompetencia } from '../back-end/src/services/competenciaService.js';
import { consultarLogs } from '../back-end/src/services/logService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PUBLIC_DIR = path.resolve(__dirname, 'public');

let ctx: FixtureContext = carregarFixtures();

export interface ScenarioResult {
  id: number;
  nome: string;
  regraReferencia: string;
  descricaoRegra: string;
  classificacao: 'APROVADO' | 'REPROVADO' | 'NAO_IMPLEMENTADO';
  statusTexto: string;
  comportamentoEsperado: string;
  comportamentoObtido: string;
  detalhesTecnicos: any;
  sucesso: boolean;
}

export function executarCenario1(localCtx: FixtureContext): ScenarioResult {
  try {
    const ana = localCtx.colaboradores.ana;
    const comp = localCtx.competencias.aberta;

    const res50 = lancarHorasExtras(localCtx.db, localCtx.rhUser, {
      colaboradorId: ana.id,
      competenciaId: comp.id,
      tipo: 'UTIL',
      quantidadeHoras: 2,
      observacao: 'QA Demo - HE 50% dia útil',
    });

    const res100 = lancarHorasExtras(localCtx.db, localCtx.rhUser, {
      colaboradorId: ana.id,
      competenciaId: comp.id,
      tipo: 'DOMINGO',
      quantidadeHoras: 2,
      observacao: 'QA Demo - HE 100% domingo',
    });

    const aprovado = res50.valorCalculado === 30.00 && res100.valorCalculado === 40.00;

    return {
      id: 1,
      nome: 'Lançamento de horas extras de 50% e 100%',
      regraReferencia: 'RN-30, Seção 5.3',
      descricaoRegra: 'Valor/hora = salário / 220. Dia útil adicional de 50% (x1.5). Domingo/feriado adicional de 100% (x2.0).',
      classificacao: aprovado ? 'APROVADO' : 'REPROVADO',
      statusTexto: aprovado ? 'Critério Aprovado' : 'Critério Reprovado',
      comportamentoEsperado: '2h úteis = R$ 30,00 (2 x 10 x 1,5); 2h domingo = R$ 40,00 (2 x 10 x 2,0). Salário base R$ 2.200,00.',
      comportamentoObtido: `Backend calculou exatamente R$ ${res50.valorCalculado.toFixed(2)} (50%) e R$ ${res100.valorCalculado.toFixed(2)} (100%). Eventos persistidos.`,
      detalhesTecnicos: {
        colaborador: ana.nome,
        salarioBase: 'R$ 2.200,00',
        valorHora: 'R$ 10,00',
        resultadoUtil50: res50,
        resultadoDomingo100: res100,
      },
      sucesso: aprovado,
    };
  } catch (err: any) {
    return {
      id: 1,
      nome: 'Lançamento de horas extras de 50% e 100%',
      regraReferencia: 'RN-30, Seção 5.3',
      descricaoRegra: 'Valor/hora = salário / 220. Dia útil adicional de 50% (x1.5). Domingo/feriado adicional de 100% (x2.0).',
      classificacao: 'REPROVADO',
      statusTexto: 'Erro na execução',
      comportamentoEsperado: 'Cálculo de horas extras com 50% e 100%.',
      comportamentoObtido: `Falha com erro: ${err.message}`,
      detalhesTecnicos: { erro: err.message, stack: err.stack },
      sucesso: false,
    };
  }
}

export function executarCenario2(localCtx: FixtureContext): ScenarioResult {
  try {
    const bruno = localCtx.colaboradores.bruno;
    const comp = localCtx.competencias.aberta;

    const resFalta = lancarFaltaInjustificada(localCtx.db, localCtx.rhUser, {
      colaboradorId: bruno.id,
      competenciaId: comp.id,
      diasFalta: 1,
      observacao: 'QA Demo - Falta injustificada com DSR',
    });

    const aprovado = resFalta.descontoFalta === 100.00 && resFalta.descontoDSR === 100.00;

    return {
      id: 2,
      nome: 'Registro de faltas e cálculo do DSR',
      regraReferencia: 'RN-33, Seção 5.3',
      descricaoRegra: 'Desconto de falta = (salário-base / 30) x dias. Perda do DSR da semana = (salário-base / 30) x 1 dia por semana.',
      classificacao: aprovado ? 'APROVADO' : 'REPROVADO',
      statusTexto: aprovado ? 'Critério Aprovado' : 'Critério Reprovado',
      comportamentoEsperado: 'Salário R$ 3.000,00: Desconto de Falta = R$ 100,00 e Perda do DSR = R$ 100,00 (Total R$ 200,00).',
      comportamentoObtido: `Backend calculou descontoFalta: R$ ${resFalta.descontoFalta.toFixed(2)} e descontoDSR: R$ ${resFalta.descontoDSR.toFixed(2)}.`,
      detalhesTecnicos: {
        colaborador: bruno.nome,
        salarioBase: 'R$ 3.000,00',
        diasFalta: resFalta.diasFalta,
        descontoFalta: resFalta.descontoFalta,
        descontoDSR: resFalta.descontoDSR,
        totalDescontoCalculado: resFalta.descontoFalta + resFalta.descontoDSR,
        eventoId: resFalta.id,
      },
      sucesso: aprovado,
    };
  } catch (err: any) {
    return {
      id: 2,
      nome: 'Registro de faltas e cálculo do DSR',
      regraReferencia: 'RN-33, Seção 5.3',
      descricaoRegra: 'Desconto de falta e perda do DSR.',
      classificacao: 'REPROVADO',
      statusTexto: 'Erro na execução',
      comportamentoEsperado: 'Cálculo de falta e DSR.',
      comportamentoObtido: `Falha: ${err.message}`,
      detalhesTecnicos: { erro: err.message },
      sucesso: false,
    };
  }
}

export function executarCenario3(localCtx: FixtureContext): ScenarioResult {
  try {
    const ana = localCtx.colaboradores.ana;
    const comp = localCtx.competencias.aberta;

    const resAtestado = lancarAtestado(localCtx.db, localCtx.rhUser, {
      colaboradorId: ana.id,
      competenciaId: comp.id,
      dataInicio: '2026-10-14',
      dataFim: '2026-10-16',
      anexoNome: 'atestado_medico.pdf',
      anexoTipo: 'application/pdf',
      anexoTamanhoBytes: 500000,
      observacao: 'QA Demo - Atestado válido sem desconto',
    });

    let erroDiretoriaCapturado = false;
    try {
      consultarAtestado(localCtx.db, localCtx.diretoriaUser, resAtestado.id);
    } catch (err: any) {
      if (err.message.includes('Você não tem permissão para acessar dados de saúde')) {
        erroDiretoriaCapturado = true;
      }
    }

    const logsSaude = consultarLogs(localCtx.db, localCtx.adminUser, { entidade: 'ATESTADO' });
    const logGerado = logsSaude.some((l) => l.acao === 'TENTATIVA_ACESSO_DADO_SAUDE_NEGADA');

    const aprovado = resAtestado.status === 'ATESTADO_REGISTRADO_SEM_DESCONTO' && erroDiretoriaCapturado && logGerado;

    return {
      id: 3,
      nome: 'Registro de atestados e proteção LGPD de saúde',
      regraReferencia: 'RN-33, RN-54, RNF-21',
      descricaoRegra: 'Atestado médico válido não desconta falta nem DSR. Exige anexo (PDF/JPG/PNG <= 10MB) e período. Diretoria bloqueada (LGPD).',
      classificacao: aprovado ? 'APROVADO' : 'REPROVADO',
      statusTexto: aprovado ? 'Critério Aprovado' : 'Critério Reprovado',
      comportamentoEsperado: 'Atestado registrado sem descontos (R$ 0). Diretoria tem acesso negado e tentativa registrada no log de auditoria.',
      comportamentoObtido: `Atestado registrado com status '${resAtestado.status}'. Bloqueio da Diretoria verificado e log gravado com sucesso.`,
      detalhesTecnicos: {
        colaborador: ana.nome,
        periodo: '2026-10-14 a 2026-10-16',
        anexo: 'atestado_medico.pdf (application/pdf)',
        resultadoLancamento: resAtestado,
        bloqueioLGPDDiretoria: erroDiretoriaCapturado,
        logAuditoriaGravado: logGerado,
      },
      sucesso: aprovado,
    };
  } catch (err: any) {
    return {
      id: 3,
      nome: 'Registro de atestados',
      regraReferencia: 'RN-33, RN-54, RNF-21',
      descricaoRegra: 'Atestados sem desconto.',
      classificacao: 'REPROVADO',
      statusTexto: 'Erro na execução',
      comportamentoEsperado: 'Registro de atestado válido.',
      comportamentoObtido: `Erro: ${err.message}`,
      detalhesTecnicos: { erro: err.message },
      sucesso: false,
    };
  }
}

export function executarCenario4(localCtx: FixtureContext): ScenarioResult {
  try {
    const ana = localCtx.colaboradores.ana;
    const comp = localCtx.competencias.aberta;

    // Caso 1: Custo informado R$ 180,00 (6% de 2.200 = R$ 132,00 -> desconta R$ 132,00)
    const res1 = lancarValeTransporte(localCtx.db, localCtx.rhUser, {
      colaboradorId: ana.id,
      competenciaId: comp.id,
      optante: true,
      custoMensalInformado: 180.00,
    });

    // Caso 2: Custo informado R$ 90,00 (menor que R$ 132,00 -> desconta R$ 90,00)
    const res2 = lancarValeTransporte(localCtx.db, localCtx.rhUser, {
      colaboradorId: ana.id,
      competenciaId: comp.id,
      optante: true,
      custoMensalInformado: 90.00,
    });

    // Caso 3: Não optante -> Desconto R$ 0,00
    const res3 = lancarValeTransporte(localCtx.db, localCtx.rhUser, {
      colaboradorId: ana.id,
      competenciaId: comp.id,
      optante: false,
    });

    const aprovado = res1.valorDesconto === 132.00 && res2.valorDesconto === 90.00 && res3.valorDesconto === 0;

    return {
      id: 4,
      nome: 'Vale-transporte (regra do menor entre 6% e custo)',
      regraReferencia: 'RN-50, Seção 5.6',
      descricaoRegra: 'Desconto do VT é o menor valor entre 6% do salário-base e o custo informado pelo RH. Não optante tem desconto zero.',
      classificacao: aprovado ? 'APROVADO' : 'REPROVADO',
      statusTexto: aprovado ? 'Critério Aprovado' : 'Critério Reprovado',
      comportamentoEsperado: 'Salário R$ 2.200,00 (6% = R$ 132,00). Custo R$ 180 -> R$ 132; Custo R$ 90 -> R$ 90; Não optante -> R$ 0.',
      comportamentoObtido: `Caso 1: R$ ${res1.valorDesconto.toFixed(2)} | Caso 2: R$ ${res2.valorDesconto.toFixed(2)} | Caso 3: R$ ${res3.valorDesconto.toFixed(2)}.`,
      detalhesTecnicos: {
        colaborador: ana.nome,
        salarioBase: 'R$ 2.200,00',
        teto6PorCento: 132.00,
        caso1_custo180: res1,
        caso2_custo90: res2,
        caso3_naoOptante: res3,
      },
      sucesso: aprovado,
    };
  } catch (err: any) {
    return {
      id: 4,
      nome: 'Vale-transporte',
      regraReferencia: 'RN-50, Seção 5.6',
      descricaoRegra: 'Cálculo de VT.',
      classificacao: 'REPROVADO',
      statusTexto: 'Erro na execução',
      comportamentoEsperado: 'Menor entre 6% e custo.',
      comportamentoObtido: `Erro: ${err.message}`,
      detalhesTecnicos: { erro: err.message },
      sucesso: false,
    };
  }
}

export function executarCenario5(localCtx: FixtureContext): ScenarioResult {
  try {
    const ana = localCtx.colaboradores.ana;
    const compFechada = localCtx.competencias.fechada;

    let erroEsperadoCapturado = false;
    let mensagemErro = '';

    try {
      lancarHorasExtras(localCtx.db, localCtx.rhUser, {
        colaboradorId: ana.id,
        competenciaId: compFechada.id,
        tipo: 'UTIL',
        quantidadeHoras: 2,
        observacao: 'Tentativa indevida em competência fechada',
      });
    } catch (err: any) {
      mensagemErro = err.message;
      if (err.message.includes('Esta competência está fechada. Para alterar, reabra informando a justificativa.')) {
        erroEsperadoCapturado = true;
      }
    }

    return {
      id: 5,
      nome: 'Bloqueio de competência fechada',
      regraReferencia: 'RN-04, Seção 4',
      descricaoRegra: 'Competência fechada não aceita novos lançamentos ou alterações até que seja formalmente reaberta com justificativa.',
      classificacao: erroEsperadoCapturado ? 'APROVADO' : 'REPROVADO',
      statusTexto: erroEsperadoCapturado ? 'Critério Aprovado' : 'Critério Reprovado',
      comportamentoEsperado: 'Lançamento rejeitado com exceção explícita impedindo gravação na competência fechada.',
      comportamentoObtido: `Operação devidamente bloqueada pelo backend. Mensagem capturada: "${mensagemErro}".`,
      detalhesTecnicos: {
        competenciaTestada: `${compFechada.mes_ano} (${compFechada.situacao})`,
        bloqueioAtivo: erroEsperadoCapturado,
        mensagemExcecao: mensagemErro,
      },
      sucesso: erroEsperadoCapturado,
    };
  } catch (err: any) {
    return {
      id: 5,
      nome: 'Bloqueio de competência fechada',
      regraReferencia: 'RN-04, Seção 4',
      descricaoRegra: 'Trava de competência.',
      classificacao: 'REPROVADO',
      statusTexto: 'Erro inesperado',
      comportamentoEsperado: 'Bloqueio de alteração.',
      comportamentoObtido: `Erro: ${err.message}`,
      detalhesTecnicos: { erro: err.message },
      sucesso: false,
    };
  }
}

export function executarCenario6(localCtx: FixtureContext): ScenarioResult {
  try {
    const ana = localCtx.colaboradores.ana;
    const comp = localCtx.competencias.aberta;

    // 1º lançamento
    const res1 = lancarHorasExtras(localCtx.db, localCtx.rhUser, {
      colaboradorId: ana.id,
      competenciaId: comp.id,
      tipo: 'UTIL',
      quantidadeHoras: 1.5,
      observacao: 'Lançamento original - HE 1.5h dia útil',
    });

    // 2º lançamento exatamente idêntico (duplicado)
    let res2: any = null;
    let solicitouConfirmacaoOuBloqueou = false;
    let mensagemErro = '';

    try {
      res2 = lancarHorasExtras(localCtx.db, localCtx.rhUser, {
        colaboradorId: ana.id,
        competenciaId: comp.id,
        tipo: 'UTIL',
        quantidadeHoras: 1.5,
        observacao: 'Lançamento idêntico repetido (duplicata)',
      });
    } catch (err: any) {
      solicitouConfirmacaoOuBloqueou = true;
      mensagemErro = err.message;
    }

    if (solicitouConfirmacaoOuBloqueou) {
      return {
        id: 6,
        nome: 'Tentativa de lançamento duplicado',
        regraReferencia: 'RN-65',
        descricaoRegra: 'O sistema deve detectar possível duplicidade e solicitar confirmação, garantindo que reenvios ou duplo clique não gerem registros duplicados.',
        classificacao: 'APROVADO',
        statusTexto: 'Critério Aprovado',
        comportamentoEsperado: 'Detectar duplicidade de evento na mesma competência/data e solicitar confirmação ao usuário, prevenindo inserções redundantes.',
        comportamentoObtido: `Duplicidade detectada com sucesso pelo backend: "${mensagemErro}".`,
        detalhesTecnicos: { res1, mensagemErro },
        sucesso: true,
      };
    } else {
      // Backend REAL permitiu a duplicata sem validação nem confirmação
      return {
        id: 6,
        nome: 'Tentativa de lançamento duplicado',
        regraReferencia: 'RN-65',
        descricaoRegra: 'O sistema deve detectar possível duplicidade e solicitar confirmação, garantindo que reenvios ou duplo clique não gerem registros duplicados.',
        classificacao: 'REPROVADO',
        statusTexto: 'Reprovado nos critérios v1.7',
        comportamentoEsperado: 'Detectar possível duplicidade e solicitar confirmação, garantindo que reenvios ou duplo clique não gerem registros duplicados.',
        comportamentoObtido: `O backend NÃO implementa a RN-65: inseriu diretamente o 2º lançamento idêntico (Evento ID ${res2.id} além do ID ${res1.id}) sem detecção de duplicidade e sem solicitar confirmação.`,
        detalhesTecnicos: {
          lancamentoOriginal: res1,
          lancamentoDuplicadoAceito: res2,
          regraViolada: 'RN-65 (Detecção de Duplicidade)',
          impacto: 'Riscos de duplo clique ou reenvio gerarem pagamentos ou descontos em duplicidade na folha.',
        },
        sucesso: false,
      };
    }
  } catch (err: any) {
    return {
      id: 6,
      nome: 'Tentativa de lançamento duplicado',
      regraReferencia: 'RN-65',
      descricaoRegra: 'O sistema deve detectar possível duplicidade e solicitar confirmação.',
      classificacao: 'REPROVADO',
      statusTexto: 'Erro de execução',
      comportamentoEsperado: 'Detecção de duplicidade com confirmação.',
      comportamentoObtido: `Erro: ${err.message}`,
      detalhesTecnicos: { erro: err.message },
      sucesso: false,
    };
  }
}

export function executarCenario7(localCtx: FixtureContext): ScenarioResult {
  try {
    const carla = localCtx.colaboradores.carla;
    const comp = localCtx.competencias.aberta;
    const ferias = localCtx.feriasCarla;

    // Carla possui férias de 2026-10-13 a 2026-10-27
    // Tentativa de lançar 2h extras durante o período de férias
    let resEvento: any = null;
    let foiBloqueado = false;
    let mensagemErro = '';

    try {
      resEvento = lancarHorasExtras(localCtx.db, localCtx.rhUser, {
        colaboradorId: carla.id,
        competenciaId: comp.id,
        tipo: 'UTIL',
        quantidadeHoras: 2,
        observacao: 'Tentativa de HE durante férias (15/10/2026)',
      });
    } catch (err: any) {
      foiBloqueado = true;
      mensagemErro = err.message;
    }

    if (foiBloqueado) {
      return {
        id: 7,
        nome: 'Tentativa de lançamento durante férias',
        regraReferencia: 'RN-81',
        descricaoRegra: 'O sistema deve rejeitar eventos incompatíveis com férias, afastamento ou desligamento.',
        classificacao: 'APROVADO',
        statusTexto: 'Critério Aprovado',
        comportamentoEsperado: 'Rejeitar eventos incompatíveis com férias, afastamento ou desligamento.',
        comportamentoObtido: `Lançamento rejeitado com sucesso: "${mensagemErro}".`,
        detalhesTecnicos: { ferias, mensagemErro },
        sucesso: true,
      };
    } else {
      // Backend REAL não valida cruzamento com tabela 'ferias'
      return {
        id: 7,
        nome: 'Tentativa de lançamento durante férias',
        regraReferencia: 'RN-81',
        descricaoRegra: 'O sistema deve rejeitar eventos incompatíveis com férias, afastamento ou desligamento.',
        classificacao: 'REPROVADO',
        statusTexto: 'Reprovado nos critérios v1.7',
        comportamentoEsperado: 'Rejeitar eventos incompatíveis com férias, afastamento ou desligamento.',
        comportamentoObtido: `O backend NÃO implementa a RN-81: o serviço lancarHorasExtras não cruza dados com a tabela de férias e permitiu o lançamento de 2h extras para Carla Dias em gozo de férias (Evento ID ${resEvento.id}).`,
        detalhesTecnicos: {
          colaborador: carla.nome,
          feriasCadastradas: ferias ? { inicio: ferias.dataInicio, fim: ferias.dataFim, situacao: 'APROVADA' } : 'Sem registro',
          eventoIndevidoAceito: resEvento,
          regraViolada: 'RN-81 (Incompatibilidade com Férias, Afastamentos ou Desligamento)',
          impacto: 'Inconsistência cadastral grave (pagamento de sobrejornada em dias de afastamento remunerado por férias).',
        },
        sucesso: false,
      };
    }
  } catch (err: any) {
    return {
      id: 7,
      nome: 'Tentativa de lançamento durante férias',
      regraReferencia: 'RN-81',
      descricaoRegra: 'Rejeição de eventos incompatíveis com férias, afastamento ou desligamento.',
      classificacao: 'REPROVADO',
      statusTexto: 'Erro de execução',
      comportamentoEsperado: 'Rejeição de evento incompatível.',
      comportamentoObtido: `Erro: ${err.message}`,
      detalhesTecnicos: { erro: err.message },
      sucesso: false,
    };
  }
}

export function executarCenario8(localCtx: FixtureContext): ScenarioResult {
  try {
    const ana = localCtx.colaboradores.ana;
    const comp = localCtx.competencias.aberta;

    // Tentativa de lançar 4 horas extras em um único dia (superior a 2 horas)
    let res: any = null;
    let emitiuAvisoEpediuConfirmacao = false;
    let mensagemAviso = '';

    try {
      res = lancarHorasExtras(localCtx.db, localCtx.rhUser, {
        colaboradorId: ana.id,
        competenciaId: comp.id,
        tipo: 'UTIL',
        quantidadeHoras: 4, // 4 horas no dia > 2h
        observacao: 'Tentativa de 4h extras diárias (excedendo 2h diárias - RN-66)',
      });
    } catch (err: any) {
      mensagemAviso = err.message;
    }

    // Na v1.7, a RN-66 exige que o sistema emita aviso e solicite confirmação (sem bloquear automaticamente).
    // O backend atual apenas insere diretamente no banco sem aviso nem solicitação de confirmação.
    const possuiFluxoConfirmacao = false; // O backend não possui flag de aviso nem retorno de confirmação pendente

    if (possuiFluxoConfirmacao) {
      return {
        id: 8,
        nome: 'Horas extras superiores a 2 horas no dia',
        regraReferencia: 'RN-66',
        descricaoRegra: 'O sistema deve emitir aviso e solicitar confirmação, mas não bloquear automaticamente o lançamento.',
        classificacao: 'APROVADO',
        statusTexto: 'Critério Aprovado',
        comportamentoEsperado: 'O sistema deve emitir aviso e solicitar confirmação, mas não bloquear automaticamente o lançamento.',
        comportamentoObtido: 'Aviso emitido e confirmação solicitada com sucesso antes de efetivar o lançamento.',
        detalhesTecnicos: { mensagemAviso },
        sucesso: true,
      };
    } else {
      // Backend REAL aceitou diretamente sem emitir aviso e sem solicitar confirmação
      return {
        id: 8,
        nome: 'Horas extras superiores a 2 horas no dia',
        regraReferencia: 'RN-66',
        descricaoRegra: 'O sistema deve emitir aviso e solicitar confirmação, mas não bloquear automaticamente o lançamento.',
        classificacao: 'REPROVADO',
        statusTexto: 'Reprovado nos critérios v1.7',
        comportamentoEsperado: 'O sistema deve emitir aviso e solicitar confirmação, mas não bloquear automaticamente o lançamento.',
        comportamentoObtido: `O backend NÃO implementa a RN-66: inseriu diretamente o lançamento de 4 horas extras (calculou R$ ${res.valorCalculado.toFixed(2)} e gerou Evento ID ${res.id}) sem emitir aviso e sem solicitar confirmação de sobrejornada.`,
        detalhesTecnicos: {
          quantidadeInformada: 4,
          limiteDiarioAlerta: 2,
          eventoAceitoSemAviso: res,
          regraViolada: 'RN-66 (Alerta de Limite Diário de Horas Extras)',
          impacto: 'Falta de mecanismo de alerta e confirmação para sobrejornada superior ao padrão legal (CLT art. 59).',
        },
        sucesso: false,
      };
    }
  } catch (err: any) {
    return {
      id: 8,
      nome: 'Horas extras superiores a 2 horas no dia',
      regraReferencia: 'RN-66',
      descricaoRegra: 'Alerta e confirmação para horas extras superiores a 2h no dia.',
      classificacao: 'REPROVADO',
      statusTexto: 'Erro de execução',
      comportamentoEsperado: 'Emissão de aviso e confirmação.',
      comportamentoObtido: `Erro: ${err.message}`,
      detalhesTecnicos: { erro: err.message },
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
  ];
}

export const LACUNAS_US02 = [
  {
    id: 'LAC-01',
    titulo: 'Atrasos e Saídas Antecipadas',
    regra: 'US-02 / CLT art. 58',
    status: 'NÃO CONTEMPLADO NO BACKEND',
    diagnosticoReal: 'O schema SQLite e os serviços de evento da Etapa 2 tratam exclusivamente faltas integrais (FALTA_INJUSTIFICADA). Não há cálculo para descontos fracionados em minutos ou horas de atraso.',
    impactoFolha: 'Impossibilidade de apurar pontualidade com precisão; qualquer atraso parcial precisa ser ignorado ou transformado artificialmente em dia inteiro de falta.',
  },
  {
    id: 'LAC-02',
    titulo: 'Afastamentos Temporários e Previdenciários',
    regra: 'RN-34 / Pendência P-03',
    status: 'NÃO CONTEMPLADO NO BACKEND',
    diagnosticoReal: 'Afastamentos por doença (>15 dias pelo INSS), acidente, maternidade ou paternidade não possuem rotina de lançamento no eventoService.ts nem regra de suspensão salarial automática após o 15º dia.',
    impactoFolha: 'Risco de pagar salário integral em períodos cobertos pelo INSS ou de calcular encargos indevidos durante a suspensão contratual.',
  },
  {
    id: 'LAC-03',
    titulo: 'Vale-Alimentação (VA)',
    regra: 'RN-51',
    status: 'NÃO CONTEMPLADO NO BACKEND',
    diagnosticoReal: 'Embora o tipo VALE_ALIMENTACAO exista no CHECK constraint da tabela eventos no schema, inexiste qualquer função lancarValeAlimentacao no eventoService.ts (apenas o VT foi implementado).',
    impactoFolha: 'O benefício de alimentação (valor mensal fixo com coparticipação padrão de 0%) não pode ser lançado via serviços oficiais.',
  },
  {
    id: 'LAC-04',
    titulo: 'Rastreabilidade Completa de Eventos',
    regra: 'US-02 / RNF-03',
    status: 'PARCIALMENTE CONTEMPLADO',
    diagnosticoReal: 'A US-02 determina que "Evento fica salvo com usuário e data". A tabela eventos grava criado_por_usuario_id e criado_em, mas os métodos lancarHorasExtras, lancarFaltaInjustificada e lancarValeTransporte NÃO gravam logs na tabela logs_auditoria (apenas atestados geram log).',
    impactoFolha: 'Dificuldade de auditoria para identificar histórico de lançamentos e alterações em conformidade com o RNF-03.',
  },
  {
    id: 'LAC-05',
    titulo: 'Validação de Vínculo Contratual Ativo',
    regra: 'RN-12 / RN-15',
    status: 'NÃO CONTEMPLADO NO BACKEND',
    diagnosticoReal: 'Os serviços de lançamento consultam apenas se o colaborador existe (SELECT id ... WHERE id = ?), mas não validam se situacao = "ATIVO", nem se a data do evento ocorre após o desligamento ou antes da admissão.',
    impactoFolha: 'Possibilidade de lançar horas extras, faltas ou benefícios para colaboradores já inativados ou desligados da empresa.',
  },
];

// -------------------------------------------------------------
// Servidor HTTP
// -------------------------------------------------------------

function parseRequestBody(req: http.IncomingMessage): Promise<any> {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        resolve({});
      }
    });
  });
}

function sendJson(res: http.ServerResponse, statusCode: number, data: any) {
  const jsonStr = JSON.stringify(data, null, 2);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  });
  res.end(jsonStr);
}

function serveStatic(res: http.ServerResponse, pathname: string): boolean {
  let relativePath = pathname === '/' ? 'index.html' : pathname.replace(/^\//, '');
  const filePath = path.resolve(PUBLIC_DIR, relativePath);

  // Segurança: evitar directory traversal
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Acesso proibido');
    return true;
  }

  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    return false;
  }

  const ext = path.extname(filePath).toLowerCase();
  const mimeTypes: Record<string, string> = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
  };

  const contentType = mimeTypes[ext] || 'application/octet-stream';
  res.writeHead(200, {
    'Content-Type': contentType,
    'Cache-Control': 'no-cache',
  });
  fs.createReadStream(filePath).pipe(res);
  return true;
}

export function criarServidor() {
  const server = http.createServer(async (req, res) => {
    const parsedUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost:3000'}`);
    const pathname = parsedUrl.pathname;
    const method = req.method || 'GET';

    if (method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      });
      res.end();
      return;
    }

    // 1. Rotas de API
    if (pathname === '/api/scenarios/run-all' && (method === 'GET' || method === 'POST')) {
      const freshCtx = carregarFixtures();
      const results = executarTodosCenarios(freshCtx);
      ctx = freshCtx; // Atualiza contexto ativo com as execuções
      sendJson(res, 200, {
        timestamp: new Date().toISOString(),
        total: results.length,
        aprovados: results.filter((r) => r.classificacao === 'APROVADO').length,
        reprovados: results.filter((r) => r.classificacao === 'REPROVADO').length,
        cenarios: results,
        lacunasUS02: LACUNAS_US02,
      });
      return;
    }

    if (pathname === '/api/lacunas-us02' && method === 'GET') {
      sendJson(res, 200, {
        total: LACUNAS_US02.length,
        lacunas: LACUNAS_US02,
      });
      return;
    }

    if (pathname.startsWith('/api/scenarios/run/') && method === 'POST') {
      const id = parseInt(pathname.replace('/api/scenarios/run/', ''), 10);
      let result: ScenarioResult | null = null;
      switch (id) {
        case 1: result = executarCenario1(ctx); break;
        case 2: result = executarCenario2(ctx); break;
        case 3: result = executarCenario3(ctx); break;
        case 4: result = executarCenario4(ctx); break;
        case 5: result = executarCenario5(ctx); break;
        case 6: result = executarCenario6(ctx); break;
        case 7: result = executarCenario7(ctx); break;
        case 8: result = executarCenario8(ctx); break;
        default:
          sendJson(res, 404, { erro: `Cenário ${id} inválido. Use de 1 a 8.` });
          return;
      }
      sendJson(res, 200, result);
      return;
    }

    if (pathname === '/api/status' && method === 'GET') {
      const eventos = ctx.db.prepare(`
        SELECT e.*, c.nome as colaborador_nome, comp.mes_ano as competencia_mes_ano
        FROM eventos e
        JOIN colaboradores c ON c.id = e.colaborador_id
        JOIN competencias comp ON comp.id = e.competencia_id
        ORDER BY e.id DESC
      `).all();

      const colabs = ctx.db.prepare('SELECT id, nome, cargo, setor, salario_base_centavos FROM colaboradores ORDER BY id ASC').all();
      const comps = ctx.db.prepare('SELECT * FROM competencias ORDER BY mes_ano DESC').all();
      const logs = ctx.db.prepare('SELECT * FROM logs_auditoria ORDER BY id DESC LIMIT 20').all();

      sendJson(res, 200, {
        status: 'OK',
        banco: 'SQLite nativo em memória (:memory:)',
        colaboradores: colabs.map((c: any) => ({
          id: c.id,
          nome: c.nome,
          cargo: c.cargo,
          setor: c.setor,
          salarioBase: (Number(c.salario_base_centavos) / 100).toFixed(2),
        })),
        competencias: comps,
        totalEventos: eventos.length,
        eventos,
        logsRecentes: logs,
      });
      return;
    }

    if (pathname === '/api/reset' && method === 'POST') {
      ctx = carregarFixtures();
      sendJson(res, 200, {
        mensagem: 'Ambiente de demonstração reinicializado com sucesso com as fixtures padrão!',
        timestamp: new Date().toISOString(),
      });
      return;
    }

    // Formulários interativos manuais
    if (pathname === '/api/manual/horas-extras' && method === 'POST') {
      const body = await parseRequestBody(req);
      try {
        const resHE = lancarHorasExtras(ctx.db, ctx.rhUser, {
          colaboradorId: Number(body.colaboradorId),
          competenciaId: Number(body.competenciaId),
          tipo: body.tipo,
          quantidadeHoras: Number(body.quantidadeHoras),
          observacao: body.observacao || 'Lançamento manual interativo',
        });
        sendJson(res, 200, { sucesso: true, dados: resHE });
      } catch (err: any) {
        sendJson(res, 400, { sucesso: false, erro: err.message });
      }
      return;
    }

    if (pathname === '/api/manual/faltas' && method === 'POST') {
      const body = await parseRequestBody(req);
      try {
        const resFalta = lancarFaltaInjustificada(ctx.db, ctx.rhUser, {
          colaboradorId: Number(body.colaboradorId),
          competenciaId: Number(body.competenciaId),
          diasFalta: Number(body.diasFalta),
          observacao: body.observacao || 'Lançamento manual de falta',
        });
        sendJson(res, 200, { sucesso: true, dados: resFalta });
      } catch (err: any) {
        sendJson(res, 400, { sucesso: false, erro: err.message });
      }
      return;
    }

    if (pathname === '/api/manual/atestados' && method === 'POST') {
      const body = await parseRequestBody(req);
      try {
        const resAtestado = lancarAtestado(ctx.db, ctx.rhUser, {
          colaboradorId: Number(body.colaboradorId),
          competenciaId: Number(body.competenciaId),
          dataInicio: body.dataInicio,
          dataFim: body.dataFim,
          anexoNome: body.anexoNome,
          anexoTipo: body.anexoTipo,
          anexoTamanhoBytes: Number(body.anexoTamanhoBytes || 100000),
          observacao: body.observacao || 'Lançamento manual de atestado',
        });
        sendJson(res, 200, { sucesso: true, dados: resAtestado });
      } catch (err: any) {
        sendJson(res, 400, { sucesso: false, erro: err.message });
      }
      return;
    }

    if (pathname === '/api/manual/vale-transporte' && method === 'POST') {
      const body = await parseRequestBody(req);
      try {
        const resVT = lancarValeTransporte(ctx.db, ctx.rhUser, {
          colaboradorId: Number(body.colaboradorId),
          competenciaId: Number(body.competenciaId),
          optante: Boolean(body.optante),
          custoMensalInformado: body.custoMensalInformado ? Number(body.custoMensalInformado) : undefined,
        });
        sendJson(res, 200, { sucesso: true, dados: resVT });
      } catch (err: any) {
        sendJson(res, 400, { sucesso: false, erro: err.message });
      }
      return;
    }

    // 2. Arquivos estáticos da pasta qa-demo/public
    const staticServed = serveStatic(res, pathname);
    if (staticServed) {
      return;
    }

    // 404
    res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`<h1>404 - Rota não encontrada</h1><p>O caminho <code>${pathname}</code> não existe no servidor de demonstração QA.</p>`);
  });

  return server;
}

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

if (process.argv[1] && (process.argv[1].endsWith('server.ts') || process.argv[1].endsWith('server.js'))) {
  const server = criarServidor();
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`\n========================================================`);
    console.log(`  QA DEMO - ETAPA 2 (Spec v1.7)`);
    console.log(`  Servidor Node.js rodando em: http://localhost:${PORT}/`);
    console.log(`  Pasta pública resolvida: ${PUBLIC_DIR}`);
    console.log(`  Banco: SQLite em memória isolado (:memory:)`);
    console.log(`========================================================\n`);
  });
}
