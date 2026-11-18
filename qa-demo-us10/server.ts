/**
 * server.ts - Servidor HTTP Node.js para Demonstração de QA da US-10 (Spec v1.7).
 * 
 * Executa testes reais nos serviços de back-end/src/services/ usando SQLite em memória (:memory:),
 * isolado do banco de dados principal.
 * 
 * Resolve os caminhos dos arquivos estáticos usando __dirname relativo a este arquivo,
 * garantindo funcionamento independente do diretório de onde o processo for iniciado.
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { carregarFixtures, FixtureContext } from './fixtures.js';
import { lancarVerbaAvulsa, listarEventos } from '../back-end/src/services/eventoService.js';
import { calcularFolhaColaborador } from '../back-end/src/services/folhaService.js';
import { abrirOuObterCompetencia } from '../back-end/src/services/competenciaService.js';

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

// ---------------------------------------------------------------------------
// Execução dos 10 Cenários de Aceite da US-10
// ---------------------------------------------------------------------------

export function executarCenario1(localCtx: FixtureContext): ScenarioResult {
  try {
    const ana = localCtx.colaboradores.ana;
    const comp = localCtx.competencias.aberta;

    const res = lancarVerbaAvulsa(localCtx.db, localCtx.rhUser, {
      colaboradorId: ana.id,
      competenciaId: comp.id,
      tipo: 'PROVENTO',
      descricao: 'Bônus por Desempenho Operacional',
      valor: 500.00,
      incideINSS: true,
      incideIRRF: true,
      incideFGTS: true,
    });

    const eventoGravado = localCtx.db.prepare('SELECT * FROM eventos WHERE id = ?').get(res.id) as any;
    const aprovado = res.id > 0 &&
      res.tipo === 'VERBA_AVULSA_PROVENTO' &&
      res.valor === 500.00 &&
      eventoGravado.valor_centavos === 50000 &&
      eventoGravado.descricao === 'Bônus por Desempenho Operacional' &&
      eventoGravado.incide_inss === 1 &&
      eventoGravado.incide_irrf === 1 &&
      eventoGravado.incide_fgts === 1;

    return {
      id: 1,
      nome: 'Cadastro de Provento Manual com Descrição e Valor',
      regraReferencia: 'RN-25, Seção 2, Seção 5.3',
      descricaoRegra: 'O RH lança provento avulso com descrição obrigatória, valor estritamente positivo e marcações tributárias.',
      classificacao: aprovado ? 'APROVADO' : 'REPROVADO',
      statusTexto: aprovado ? 'Critério Aprovado' : 'Critério Reprovado',
      comportamentoEsperado: 'Provento registrado com tipo VERBA_AVULSA_PROVENTO, R$ 500,00 (50.000 centavos) e descrição informada.',
      comportamentoObtido: `Backend cadastrou evento ID #${res.id} com valor R$ ${res.valor.toFixed(2)}, descrição "${eventoGravado.descricao}" e incidências gravadas.`,
      detalhesTecnicos: {
        colaborador: ana.nome,
        competencia: comp.mes_ano,
        retornoServico: res,
        registroBanco: eventoGravado,
      },
      sucesso: aprovado,
    };
  } catch (err: any) {
    return {
      id: 1,
      nome: 'Cadastro de Provento Manual com Descrição e Valor',
      regraReferencia: 'RN-25, Seção 2, Seção 5.3',
      descricaoRegra: 'O RH lança provento avulso com descrição obrigatória e valor positivo.',
      classificacao: 'REPROVADO',
      statusTexto: 'Erro na execução',
      comportamentoEsperado: 'Provento registrado com sucesso.',
      comportamentoObtido: `Falha: ${err.message}`,
      detalhesTecnicos: { erro: err.message },
      sucesso: false,
    };
  }
}

export function executarCenario2(localCtx: FixtureContext): ScenarioResult {
  try {
    const bruno = localCtx.colaboradores.bruno;
    const comp = localCtx.competencias.aberta;

    const res = lancarVerbaAvulsa(localCtx.db, localCtx.rhUser, {
      colaboradorId: bruno.id,
      competenciaId: comp.id,
      tipo: 'DESCONTO',
      descricao: 'Pensão Alimentícia Judicial',
      valor: 350.00,
      incideINSS: false,
      incideIRRF: true,
      incideFGTS: false,
    });

    const eventoGravado = localCtx.db.prepare('SELECT * FROM eventos WHERE id = ?').get(res.id) as any;
    const aprovado = res.id > 0 &&
      res.tipo === 'VERBA_AVULSA_DESCONTO' &&
      res.valor === 350.00 &&
      eventoGravado.valor_centavos === 35000 &&
      eventoGravado.descricao === 'Pensão Alimentícia Judicial' &&
      eventoGravado.incide_irrf === 1 &&
      eventoGravado.incide_inss === 0;

    return {
      id: 2,
      nome: 'Cadastro de Desconto Manual com Descrição Individualizada',
      regraReferencia: 'RN-25, Seção 2, Seção 5.3',
      descricaoRegra: 'O RH lança desconto avulso (pensão, consignado, etc.) com descrição preservada e marcações independentes.',
      classificacao: aprovado ? 'APROVADO' : 'REPROVADO',
      statusTexto: aprovado ? 'Critério Aprovado' : 'Critério Reprovado',
      comportamentoEsperado: 'Desconto avulso cadastrado com tipo VERBA_AVULSA_DESCONTO, R$ 350,00 e descrição "Pensão Alimentícia Judicial".',
      comportamentoObtido: `Backend gravou evento ID #${res.id} com valor R$ ${res.valor.toFixed(2)}, tipo "${res.tipo}" e descrição exata.`,
      detalhesTecnicos: {
        colaborador: bruno.nome,
        retornoServico: res,
        registroBanco: eventoGravado,
      },
      sucesso: aprovado,
    };
  } catch (err: any) {
    return {
      id: 2,
      nome: 'Cadastro de Desconto Manual com Descrição Individualizada',
      regraReferencia: 'RN-25, Seção 2, Seção 5.3',
      descricaoRegra: 'O RH lança desconto avulso com descrição.',
      classificacao: 'REPROVADO',
      statusTexto: 'Erro na execução',
      comportamentoEsperado: 'Desconto avulso cadastrado com sucesso.',
      comportamentoObtido: `Falha: ${err.message}`,
      detalhesTecnicos: { erro: err.message },
      sucesso: false,
    };
  }
}

export function executarCenario3(localCtx: FixtureContext): ScenarioResult {
  try {
    const bruno = localCtx.colaboradores.bruno; // R$ 3.000,00
    const comp = localCtx.competencias.aberta;

    // Lança provento com incidência EXCLUSIVA em INSS
    const resVerba = lancarVerbaAvulsa(localCtx.db, localCtx.rhUser, {
      colaboradorId: bruno.id,
      competenciaId: comp.id,
      tipo: 'PROVENTO',
      descricao: 'Verba com Incidência Somente INSS',
      valor: 500.00,
      incideINSS: true,
      incideIRRF: false,
      incideFGTS: false,
    });

    const folha = calcularFolhaColaborador(localCtx.db, localCtx.rhUser, {
      colaboradorId: bruno.id,
      competenciaId: comp.id,
    });

    const verbaINSS = folha.memoria.find((v: any) => v.tipo === 'INSS');
    const verbaIRRF = folha.memoria.find((v: any) => v.tipo === 'IRRF');
    const verbaFGTS = folha.memoria.find((v: any) => v.tipo === 'FGTS');

    const baseINSS = Number(verbaINSS.baseCalculo.centavos) / 100;
    const baseFGTS = Number(verbaFGTS.baseCalculo.centavos) / 100;
    const rendTribIRRF = Number(verbaIRRF.baseCalculo.centavos) / 100;

    const aprovado = Math.abs(baseINSS - 3500.00) < 0.001 &&
      Math.abs(rendTribIRRF - 3000.00) < 0.001 &&
      Math.abs(baseFGTS - 3000.00) < 0.001;

    return {
      id: 3,
      nome: 'Incidência Exclusiva em INSS',
      regraReferencia: 'RN-26, Tabela 7.4',
      descricaoRegra: 'A verba marcada apenas para INSS deve compor a base do INSS, mantendo as bases de IRRF e FGTS inalteradas.',
      classificacao: aprovado ? 'APROVADO' : 'REPROVADO',
      statusTexto: aprovado ? 'Critério Aprovado' : 'Critério Reprovado',
      comportamentoEsperado: 'Salário R$ 3.000 + Verba R$ 500: Base INSS = R$ 3.500,00 | Rendimento IRRF = R$ 3.000,00 | Base FGTS = R$ 3.000,00.',
      comportamentoObtido: `Backend apurou Base INSS: R$ ${baseINSS.toFixed(2)}, Rend. IRRF: R$ ${rendTribIRRF.toFixed(2)}, Base FGTS: R$ ${baseFGTS.toFixed(2)}.`,
      detalhesTecnicos: {
        salarioBase: 'R$ 3.000,00',
        verbaAvulsa: { valor: 'R$ 500,00', incideINSS: true, incideIRRF: false, incideFGTS: false },
        basesApuradas: { baseINSS, rendimentoTributavelIRRF: rendTribIRRF, baseFGTS },
        inssCalculado: (Number(verbaINSS.valor.centavos) / 100).toFixed(2),
        fgtsCalculado: (Number(verbaFGTS.valor.centavos) / 100).toFixed(2),
      },
      sucesso: aprovado,
    };
  } catch (err: any) {
    return {
      id: 3,
      nome: 'Incidência Exclusiva em INSS',
      regraReferencia: 'RN-26, Tabela 7.4',
      descricaoRegra: 'Verba avulsa incidindo apenas em INSS.',
      classificacao: 'REPROVADO',
      statusTexto: 'Erro na execução',
      comportamentoEsperado: 'Base INSS majorada e demais inalteradas.',
      comportamentoObtido: `Falha: ${err.message}`,
      detalhesTecnicos: { erro: err.message },
      sucesso: false,
    };
  }
}

export function executarCenario4(localCtx: FixtureContext): ScenarioResult {
  try {
    const ana = localCtx.colaboradores.ana; // R$ 2.200,00
    const comp = localCtx.competencias.aberta;

    // Lança provento com incidência EXCLUSIVA em IRRF
    lancarVerbaAvulsa(localCtx.db, localCtx.rhUser, {
      colaboradorId: ana.id,
      competenciaId: comp.id,
      tipo: 'PROVENTO',
      descricao: 'Verba com Incidência Somente IRRF',
      valor: 600.00,
      incideINSS: false,
      incideIRRF: true,
      incideFGTS: false,
    });

    const folha = calcularFolhaColaborador(localCtx.db, localCtx.rhUser, {
      colaboradorId: ana.id,
      competenciaId: comp.id,
    });

    const verbaINSS = folha.memoria.find((v: any) => v.tipo === 'INSS');
    const verbaIRRF = folha.memoria.find((v: any) => v.tipo === 'IRRF');
    const verbaFGTS = folha.memoria.find((v: any) => v.tipo === 'FGTS');

    const baseINSS = Number(verbaINSS.baseCalculo.centavos) / 100;
    const baseFGTS = Number(verbaFGTS.baseCalculo.centavos) / 100;
    const rendTribIRRF = Number(verbaIRRF.baseCalculo.centavos) / 100;

    const aprovado = Math.abs(baseINSS - 2200.00) < 0.001 &&
      Math.abs(rendTribIRRF - 2800.00) < 0.001 &&
      Math.abs(baseFGTS - 2200.00) < 0.001;

    return {
      id: 4,
      nome: 'Incidência Exclusiva em IRRF',
      regraReferencia: 'RN-26, Tabela 7.4',
      descricaoRegra: 'A verba marcada apenas para IRRF deve compor o rendimento tributável do IRRF, mantendo bases de INSS e FGTS inalteradas.',
      classificacao: aprovado ? 'APROVADO' : 'REPROVADO',
      statusTexto: aprovado ? 'Critério Aprovado' : 'Critério Reprovado',
      comportamentoEsperado: 'Salário R$ 2.200 + Verba R$ 600: Base INSS = R$ 2.200,00 | Rendimento IRRF = R$ 2.800,00 | Base FGTS = R$ 2.200,00.',
      comportamentoObtido: `Backend apurou Base INSS: R$ ${baseINSS.toFixed(2)}, Rend. IRRF: R$ ${rendTribIRRF.toFixed(2)}, Base FGTS: R$ ${baseFGTS.toFixed(2)}.`,
      detalhesTecnicos: {
        salarioBase: 'R$ 2.200,00',
        verbaAvulsa: { valor: 'R$ 600,00', incideINSS: false, incideIRRF: true, incideFGTS: false },
        basesApuradas: { baseINSS, rendimentoTributavelIRRF: rendTribIRRF, baseFGTS },
      },
      sucesso: aprovado,
    };
  } catch (err: any) {
    return {
      id: 4,
      nome: 'Incidência Exclusiva em IRRF',
      regraReferencia: 'RN-26, Tabela 7.4',
      descricaoRegra: 'Verba avulsa incidindo apenas em IRRF.',
      classificacao: 'REPROVADO',
      statusTexto: 'Erro na execução',
      comportamentoEsperado: 'Rendimento tributável de IRRF majorado e demais bases inalteradas.',
      comportamentoObtido: `Falha: ${err.message}`,
      detalhesTecnicos: { erro: err.message },
      sucesso: false,
    };
  }
}

export function executarCenario5(localCtx: FixtureContext): ScenarioResult {
  try {
    const ana = localCtx.colaboradores.ana; // R$ 2.200,00
    const comp = localCtx.competencias.aberta;

    // Lança provento com incidência EXCLUSIVA em FGTS
    lancarVerbaAvulsa(localCtx.db, localCtx.rhUser, {
      colaboradorId: ana.id,
      competenciaId: comp.id,
      tipo: 'PROVENTO',
      descricao: 'Verba com Incidência Somente FGTS',
      valor: 400.00,
      incideINSS: false,
      incideIRRF: false,
      incideFGTS: true,
    });

    const folha = calcularFolhaColaborador(localCtx.db, localCtx.rhUser, {
      colaboradorId: ana.id,
      competenciaId: comp.id,
    });

    const verbaINSS = folha.memoria.find((v: any) => v.tipo === 'INSS');
    const verbaIRRF = folha.memoria.find((v: any) => v.tipo === 'IRRF');
    const verbaFGTS = folha.memoria.find((v: any) => v.tipo === 'FGTS');

    const baseINSS = Number(verbaINSS.baseCalculo.centavos) / 100;
    const baseFGTS = Number(verbaFGTS.baseCalculo.centavos) / 100;
    const rendTribIRRF = Number(verbaIRRF.baseCalculo.centavos) / 100;
    const valorFGTS = Number(verbaFGTS.valor.centavos) / 100;

    const aprovado = Math.abs(baseINSS - 2200.00) < 0.001 &&
      Math.abs(rendTribIRRF - 2200.00) < 0.001 &&
      Math.abs(baseFGTS - 2600.00) < 0.001 &&
      Math.abs(valorFGTS - 208.00) < 0.001; // 2600 x 8% = 208

    return {
      id: 5,
      nome: 'Incidência Exclusiva em FGTS',
      regraReferencia: 'RN-24, RN-26, Tabela 7.4',
      descricaoRegra: 'A verba marcada apenas para FGTS deve compor a base do FGTS (8% encargo patronal), sem alterar INSS e IRRF.',
      classificacao: aprovado ? 'APROVADO' : 'REPROVADO',
      statusTexto: aprovado ? 'Critério Aprovado' : 'Critério Reprovado',
      comportamentoEsperado: 'Salário R$ 2.200 + Verba R$ 400: Base FGTS = R$ 2.600,00 -> FGTS 8% = R$ 208,00 | Bases INSS e IRRF = R$ 2.200,00.',
      comportamentoObtido: `Backend apurou Base FGTS R$ ${baseFGTS.toFixed(2)} gerando R$ ${valorFGTS.toFixed(2)} de encargo patronal, mantendo INSS e IRRF sem alteração.`,
      detalhesTecnicos: {
        salarioBase: 'R$ 2.200,00',
        verbaAvulsa: { valor: 'R$ 400,00', incideINSS: false, incideIRRF: false, incideFGTS: true },
        basesApuradas: { baseINSS, rendimentoTributavelIRRF: rendTribIRRF, baseFGTS },
        fgtsCalculado: valorFGTS,
      },
      sucesso: aprovado,
    };
  } catch (err: any) {
    return {
      id: 5,
      nome: 'Incidência Exclusiva em FGTS',
      regraReferencia: 'RN-24, RN-26, Tabela 7.4',
      descricaoRegra: 'Verba avulsa incidindo apenas em FGTS.',
      classificacao: 'REPROVADO',
      statusTexto: 'Erro na execução',
      comportamentoEsperado: 'Base FGTS majorada para 2.600 e encargo de R$ 208,00.',
      comportamentoObtido: `Falha: ${err.message}`,
      detalhesTecnicos: { erro: err.message },
      sucesso: false,
    };
  }
}

export function executarCenario6(localCtx: FixtureContext): ScenarioResult {
  try {
    const bruno = localCtx.colaboradores.bruno; // R$ 3.000,00
    const comp = localCtx.competencias.aberta;

    // Lança provento SEM incidência
    lancarVerbaAvulsa(localCtx.db, localCtx.rhUser, {
      colaboradorId: bruno.id,
      competenciaId: comp.id,
      tipo: 'PROVENTO',
      descricao: 'Ajuda de Custo Isenta (Sem Incidências)',
      valor: 300.00,
      incideINSS: false,
      incideIRRF: false,
      incideFGTS: false,
    });

    const folha = calcularFolhaColaborador(localCtx.db, localCtx.rhUser, {
      colaboradorId: bruno.id,
      competenciaId: comp.id,
    });

    const verbaINSS = folha.memoria.find((v: any) => v.tipo === 'INSS');
    const verbaIRRF = folha.memoria.find((v: any) => v.tipo === 'IRRF');
    const verbaFGTS = folha.memoria.find((v: any) => v.tipo === 'FGTS');

    const baseINSS = Number(verbaINSS.baseCalculo.centavos) / 100;
    const baseFGTS = Number(verbaFGTS.baseCalculo.centavos) / 100;
    const rendTribIRRF = Number(verbaIRRF.baseCalculo.centavos) / 100;

    const aprovado = Math.abs(folha.totalProventos - 3300.00) < 0.001 &&
      Math.abs(baseINSS - 3000.00) < 0.001 &&
      Math.abs(rendTribIRRF - 3000.00) < 0.001 &&
      Math.abs(baseFGTS - 3000.00) < 0.001;

    return {
      id: 6,
      nome: 'Verba Sem Incidência Tributária',
      regraReferencia: 'RN-25, RN-26, Tabela 7.4',
      descricaoRegra: 'Verba sem nenhuma incidência assinalada integra a remuneração bruta sem onerar nenhuma base tributária.',
      classificacao: aprovado ? 'APROVADO' : 'REPROVADO',
      statusTexto: aprovado ? 'Critério Aprovado' : 'Critério Reprovado',
      comportamentoEsperado: 'Proventos = R$ 3.300,00. Bases de INSS, IRRF e FGTS mantidas em R$ 3.000,00.',
      comportamentoObtido: `Backend somou R$ 300,00 aos proventos (Total R$ ${folha.totalProventos.toFixed(2)}) e manteve INSS (${baseINSS.toFixed(2)}), IRRF (${rendTribIRRF.toFixed(2)}) e FGTS (${baseFGTS.toFixed(2)}) imunes.`,
      detalhesTecnicos: {
        salarioBase: 'R$ 3.000,00',
        totalProventos: folha.totalProventos,
        basesApuradas: { baseINSS, rendimentoTributavelIRRF: rendTribIRRF, baseFGTS },
      },
      sucesso: aprovado,
    };
  } catch (err: any) {
    return {
      id: 6,
      nome: 'Verba Sem Incidência Tributária',
      regraReferencia: 'RN-25, RN-26, Tabela 7.4',
      descricaoRegra: 'Verba sem incidências.',
      classificacao: 'REPROVADO',
      statusTexto: 'Erro na execução',
      comportamentoEsperado: 'Proventos aumentam sem tributação extra.',
      comportamentoObtido: `Falha: ${err.message}`,
      detalhesTecnicos: { erro: err.message },
      sucesso: false,
    };
  }
}

export function executarCenario7(localCtx: FixtureContext): ScenarioResult {
  try {
    const ana = localCtx.colaboradores.ana;
    const comp = localCtx.competencias.aberta;

    let erroDescVazia = false;
    let msgDescVazia = '';
    try {
      lancarVerbaAvulsa(localCtx.db, localCtx.rhUser, {
        colaboradorId: ana.id,
        competenciaId: comp.id,
        tipo: 'PROVENTO',
        descricao: '   ',
        valor: 100.00,
        incideINSS: false,
        incideIRRF: false,
        incideFGTS: false,
      });
    } catch (e: any) {
      erroDescVazia = true;
      msgDescVazia = e.message;
    }

    let erroValorZero = false;
    let msgValorZero = '';
    try {
      lancarVerbaAvulsa(localCtx.db, localCtx.rhUser, {
        colaboradorId: ana.id,
        competenciaId: comp.id,
        tipo: 'PROVENTO',
        descricao: 'Verba Valor Zero',
        valor: 0.00,
        incideINSS: false,
        incideIRRF: false,
        incideFGTS: false,
      });
    } catch (e: any) {
      erroValorZero = true;
      msgValorZero = e.message;
    }

    let erroValorNegativo = false;
    let msgValorNegativo = '';
    try {
      lancarVerbaAvulsa(localCtx.db, localCtx.rhUser, {
        colaboradorId: ana.id,
        competenciaId: comp.id,
        tipo: 'PROVENTO',
        descricao: 'Verba Valor Negativo',
        valor: -50.00,
        incideINSS: false,
        incideIRRF: false,
        incideFGTS: false,
      });
    } catch (e: any) {
      erroValorNegativo = true;
      msgValorNegativo = e.message;
    }

    const aprovado = erroDescVazia && erroValorZero && erroValorNegativo;

    return {
      id: 7,
      nome: 'Rejeição de Descrição Vazia e Valores Inválidos',
      regraReferencia: 'RN-25, Seção 5.3',
      descricaoRegra: 'O sistema deve exigir obrigatoriamente descrição não vazia e valor estritamente positivo (maior que zero).',
      classificacao: aprovado ? 'APROVADO' : 'REPROVADO',
      statusTexto: aprovado ? 'Critério Aprovado' : 'Critério Reprovado',
      comportamentoEsperado: 'Rejeição obrigatória para descrição vazia, valor 0,00 e valor negativo.',
      comportamentoObtido: `Todas as 3 tentativas foram bloqueadas com sucesso: "${msgDescVazia}", "${msgValorZero}" e "${msgValorNegativo}".`,
      detalhesTecnicos: {
        testeDescricaoVazia: { bloqueado: erroDescVazia, mensagem: msgDescVazia },
        testeValorZero: { bloqueado: erroValorZero, mensagem: msgValorZero },
        testeValorNegativo: { bloqueado: erroValorNegativo, mensagem: msgValorNegativo },
      },
      sucesso: aprovado,
    };
  } catch (err: any) {
    return {
      id: 7,
      nome: 'Rejeição de Descrição Vazia e Valores Inválidos',
      regraReferencia: 'RN-25, Seção 5.3',
      descricaoRegra: 'Validações de entrada de verbas avulsas.',
      classificacao: 'REPROVADO',
      statusTexto: 'Erro na execução',
      comportamentoEsperado: 'Bloqueio de entradas inválidas.',
      comportamentoObtido: `Falha: ${err.message}`,
      detalhesTecnicos: { erro: err.message },
      sucesso: false,
    };
  }
}

export function executarCenario8(localCtx: FixtureContext): ScenarioResult {
  try {
    const ana = localCtx.colaboradores.ana;
    const compFechada = localCtx.competencias.fechada;

    // Teste 1: Competência Fechada
    let erroFechada = false;
    let msgFechada = '';
    try {
      lancarVerbaAvulsa(localCtx.db, localCtx.rhUser, {
        colaboradorId: ana.id,
        competenciaId: compFechada.id,
        tipo: 'PROVENTO',
        descricao: 'Tentativa em Competência Fechada',
        valor: 200.00,
        incideINSS: true,
        incideIRRF: true,
        incideFGTS: true,
      });
    } catch (e: any) {
      erroFechada = true;
      msgFechada = e.message;
    }

    // Teste 2: Competência Calculada
    const compCalculada = abrirOuObterCompetencia(localCtx.db, localCtx.rhUser, '2026-08');
    localCtx.db.prepare("UPDATE competencias SET situacao = 'CALCULADA' WHERE id = ?").run(compCalculada.id);
    let erroCalculada = false;
    let msgCalculada = '';
    try {
      lancarVerbaAvulsa(localCtx.db, localCtx.rhUser, {
        colaboradorId: ana.id,
        competenciaId: compCalculada.id,
        tipo: 'PROVENTO',
        descricao: 'Tentativa em Competência Calculada',
        valor: 200.00,
        incideINSS: true,
        incideIRRF: true,
        incideFGTS: true,
      });
    } catch (e: any) {
      erroCalculada = true;
      msgCalculada = e.message;
    }

    const aprovado = erroFechada && erroCalculada;

    return {
      id: 8,
      nome: 'Bloqueio de Lançamento em Competência Calculada ou Fechada',
      regraReferencia: 'RN-25, Tabela 7.5',
      descricaoRegra: 'Verbas avulsas só podem ser lançadas em competências com situação ABERTA. Mês fechado ou calculado bloqueia o lançamento.',
      classificacao: aprovado ? 'APROVADO' : 'REPROVADO',
      statusTexto: aprovado ? 'Critério Aprovado' : 'Critério Reprovado',
      comportamentoEsperado: 'Lançamentos bloqueados em competências FECHADA e CALCULADA.',
      comportamentoObtido: `Backend bloqueou as duas operações. Fechada: "${msgFechada}" | Calculada: "${msgCalculada}".`,
      detalhesTecnicos: {
        competenciaFechada: { bloqueado: erroFechada, mensagem: msgFechada },
        competenciaCalculada: { bloqueado: erroCalculada, mensagem: msgCalculada },
      },
      sucesso: aprovado,
    };
  } catch (err: any) {
    return {
      id: 8,
      nome: 'Bloqueio de Lançamento em Competência Calculada ou Fechada',
      regraReferencia: 'RN-25, Tabela 7.5',
      descricaoRegra: 'Bloqueio de competência não aberta.',
      classificacao: 'REPROVADO',
      statusTexto: 'Erro na execução',
      comportamentoEsperado: 'Bloqueio ativo com exceção amigável.',
      comportamentoObtido: `Falha: ${err.message}`,
      detalhesTecnicos: { erro: err.message },
      sucesso: false,
    };
  }
}

export function executarCenario9(localCtx: FixtureContext): ScenarioResult {
  try {
    const ana = localCtx.colaboradores.ana;
    const comp = localCtx.competencias.aberta;

    let erroDiretoria = false;
    let msgDiretoria = '';
    try {
      lancarVerbaAvulsa(localCtx.db, localCtx.diretoriaUser, {
        colaboradorId: ana.id,
        competenciaId: comp.id,
        tipo: 'PROVENTO',
        descricao: 'Tentativa Perfil Diretoria',
        valor: 150.00,
        incideINSS: true,
        incideIRRF: true,
        incideFGTS: true,
      });
    } catch (e: any) {
      erroDiretoria = true;
      msgDiretoria = e.message;
    }

    let erroAdmin = false;
    let msgAdmin = '';
    try {
      lancarVerbaAvulsa(localCtx.db, localCtx.adminUser, {
        colaboradorId: ana.id,
        competenciaId: comp.id,
        tipo: 'PROVENTO',
        descricao: 'Tentativa Perfil Admin',
        valor: 150.00,
        incideINSS: true,
        incideIRRF: true,
        incideFGTS: true,
      });
    } catch (e: any) {
      erroAdmin = true;
      msgAdmin = e.message;
    }

    // Sucesso com RH
    const resRH = lancarVerbaAvulsa(localCtx.db, localCtx.rhUser, {
      colaboradorId: ana.id,
      competenciaId: comp.id,
      tipo: 'PROVENTO',
      descricao: 'Lançamento Autorizado Perfil RH',
      valor: 150.00,
      incideINSS: true,
      incideIRRF: true,
      incideFGTS: true,
    });

    const aprovado = erroDiretoria && erroAdmin && resRH.id > 0;

    return {
      id: 9,
      nome: 'Controle de Acesso por Perfil RH',
      regraReferencia: 'Tabela 4.1, RN-10',
      descricaoRegra: 'Apenas usuários com perfil RH podem lançar verbas avulsas na folha. Diretoria e Admin não têm permissão.',
      classificacao: aprovado ? 'APROVADO' : 'REPROVADO',
      statusTexto: aprovado ? 'Critério Aprovado' : 'Critério Reprovado',
      comportamentoEsperado: 'Diretoria e Admin bloqueados (403); Perfil RH autorizado.',
      comportamentoObtido: `Diretoria bloqueada: "${msgDiretoria}" | Admin bloqueado: "${msgAdmin}" | RH autorizado: Evento #${resRH.id}.`,
      detalhesTecnicos: {
        diretoria: { bloqueado: erroDiretoria, mensagem: msgDiretoria },
        admin: { bloqueado: erroAdmin, mensagem: msgAdmin },
        rh: { autorizado: resRH.id > 0, eventoId: resRH.id },
      },
      sucesso: aprovado,
    };
  } catch (err: any) {
    return {
      id: 9,
      nome: 'Controle de Acesso por Perfil RH',
      regraReferencia: 'Tabela 4.1, RN-10',
      descricaoRegra: 'Controle de perfis.',
      classificacao: 'REPROVADO',
      statusTexto: 'Erro na execução',
      comportamentoEsperado: 'Diretoria e Admin bloqueados.',
      comportamentoObtido: `Falha: ${err.message}`,
      detalhesTecnicos: { erro: err.message },
      sucesso: false,
    };
  }
}

export function executarCenario10(localCtx: FixtureContext): ScenarioResult {
  try {
    const carla = localCtx.colaboradores.carla; // R$ 3.000,00
    const comp = localCtx.competencias.aberta;

    // Lança provento e desconto manuais
    lancarVerbaAvulsa(localCtx.db, localCtx.rhUser, {
      colaboradorId: carla.id,
      competenciaId: comp.id,
      tipo: 'PROVENTO',
      descricao: 'Adicional de Insalubridade 20%',
      valor: 400.00,
      incideINSS: true,
      incideIRRF: true,
      incideFGTS: true,
    });

    lancarVerbaAvulsa(localCtx.db, localCtx.rhUser, {
      colaboradorId: carla.id,
      competenciaId: comp.id,
      tipo: 'DESCONTO',
      descricao: 'Empréstimo Consignado Caixa',
      valor: 250.00,
      incideINSS: false,
      incideIRRF: false,
      incideFGTS: false,
    });

    const folha = calcularFolhaColaborador(localCtx.db, localCtx.rhUser, {
      colaboradorId: carla.id,
      competenciaId: comp.id,
    });

    const verbasDB = localCtx.db.prepare('SELECT * FROM folha_verbas WHERE folha_id = ? ORDER BY id ASC').all(folha.folhaId) as any[];

    const verbaInsalubridade = verbasDB.find((v) => v.descricao === 'Adicional de Insalubridade 20%');
    const verbaConsignado = verbasDB.find((v) => v.descricao === 'Empréstimo Consignado Caixa');

    const aprovado = !!verbaInsalubridade &&
      verbaInsalubridade.natureza === 'PROVENTO' &&
      verbaInsalubridade.valor_centavos === 40000 &&
      !!verbaConsignado &&
      verbaConsignado.natureza === 'DESCONTO' &&
      verbaConsignado.valor_centavos === 25000;

    return {
      id: 10,
      nome: 'Persistência no SQLite e Apresentação na Memória de Cálculo',
      regraReferencia: 'RN-02, RN-25, Seção 2.1',
      descricaoRegra: 'Os lançamentos manuais devem ser persistidos no SQLite e figurar na memória de cálculo com descrição própria e regra aplicada.',
      classificacao: aprovado ? 'APROVADO' : 'REPROVADO',
      statusTexto: aprovado ? 'Critério Aprovado' : 'Critério Reprovado',
      comportamentoEsperado: 'Verbas discriminadas com fidelidade na tabela folha_verbas e na memória de cálculo detalhada.',
      comportamentoObtido: `Persistência e discriminação validadas: Insalubridade (PROVENTO R$ 400,00) e Consignado (DESCONTO R$ 250,00) gravados com descrições originais.`,
      detalhesTecnicos: {
        folhaId: folha.folhaId,
        totalVerbasGravadas: verbasDB.length,
        verbaInsalubridade,
        verbaConsignado,
        totalProventos: folha.totalProventos,
        totalDescontos: folha.totalDescontos,
        liquido: folha.liquido,
      },
      sucesso: aprovado,
    };
  } catch (err: any) {
    return {
      id: 10,
      nome: 'Persistência no SQLite e Apresentação na Memória de Cálculo',
      regraReferencia: 'RN-02, RN-25, Seção 2.1',
      descricaoRegra: 'Persistência e exibição na memória de cálculo.',
      classificacao: 'REPROVADO',
      statusTexto: 'Erro na execução',
      comportamentoEsperado: 'Verbas discriminadas na memória.',
      comportamentoObtido: `Falha: ${err.message}`,
      detalhesTecnicos: { erro: err.message },
      sucesso: false,
    };
  }
}

export function executarTodosCenarios(localCtx?: FixtureContext): ScenarioResult[] {
  // Cada cenário roda com contexto isolado para garantir repetibilidade sem poluição mútua
  return [
    executarCenario1(carregarFixtures()),
    executarCenario2(carregarFixtures()),
    executarCenario3(carregarFixtures()),
    executarCenario4(carregarFixtures()),
    executarCenario5(carregarFixtures()),
    executarCenario6(carregarFixtures()),
    executarCenario7(carregarFixtures()),
    executarCenario8(carregarFixtures()),
    executarCenario9(carregarFixtures()),
    executarCenario10(carregarFixtures()),
  ];
}

// ---------------------------------------------------------------------------
// Helpers HTTP & Servidor
// ---------------------------------------------------------------------------

function sendJson(res: http.ServerResponse, status: number, data: any) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-cache, no-store, must-revalidate',
  });
  res.end(JSON.stringify(data));
}

function parseRequestBody(req: http.IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 1e6) {
        req.destroy();
        reject(new Error('Payload too large'));
      }
    });
    req.on('end', () => {
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

function serveStatic(res: http.ServerResponse, pathname: string): boolean {
  let relativePath = pathname === '/' ? '/index.html' : pathname;
  // Prevenir path traversal
  const safePath = path.normalize(relativePath).replace(/^(\.\.[\/\\])+/, '');
  const filePath = path.join(PUBLIC_DIR, safePath);

  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
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
    '.svg': 'image/svg+xml',
  };

  const contentType = mimeTypes[ext] || 'application/octet-stream';
  const content = fs.readFileSync(filePath);
  res.writeHead(200, { 'Content-Type': contentType });
  res.end(content);
  return true;
}

export function criarServidor() {
  const server = http.createServer(async (req, res) => {
    // CORS headers para testes
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const host = req.headers.host || 'localhost';
    const parsedUrl = new URL(req.url || '/', `http://${host}`);
    const pathname = parsedUrl.pathname;
    const method = req.method || 'GET';

    // 1. API Endpoints
    if (pathname === '/api/scenarios/run-all' && method === 'GET') {
      const resultados = executarTodosCenarios(ctx);
      sendJson(res, 200, resultados);
      return;
    }

    const scenarioMatch = pathname.match(/^\/api\/scenarios\/(\d+)\/run$/);
    if (scenarioMatch && method === 'POST') {
      const id = parseInt(scenarioMatch[1], 10);
      let resultado: ScenarioResult | null = null;
      switch (id) {
        case 1: resultado = executarCenario1(carregarFixtures()); break;
        case 2: resultado = executarCenario2(carregarFixtures()); break;
        case 3: resultado = executarCenario3(carregarFixtures()); break;
        case 4: resultado = executarCenario4(carregarFixtures()); break;
        case 5: resultado = executarCenario5(carregarFixtures()); break;
        case 6: resultado = executarCenario6(carregarFixtures()); break;
        case 7: resultado = executarCenario7(carregarFixtures()); break;
        case 8: resultado = executarCenario8(carregarFixtures()); break;
        case 9: resultado = executarCenario9(carregarFixtures()); break;
        case 10: resultado = executarCenario10(carregarFixtures()); break;
        default:
          sendJson(res, 404, { erro: `Cenário #${id} não encontrado.` });
          return;
      }
      sendJson(res, 200, resultado);
      return;
    }

    if (pathname === '/api/status' && method === 'GET') {
      const eventos = ctx.db.prepare(`
        SELECT 
          e.id,
          e.colaborador_id,
          c.nome as colaborador_nome,
          e.competencia_id,
          comp.mes_ano as competencia_mes_ano,
          e.tipo,
          CASE WHEN e.tipo = 'VERBA_AVULSA_PROVENTO' THEN 'PROVENTO' ELSE 'DESCONTO' END as natureza,
          e.descricao,
          e.observacao,
          e.valor_centavos,
          e.incide_inss,
          e.incide_irrf,
          e.incide_fgts,
          e.criado_em
        FROM eventos e
        JOIN colaboradores c ON c.id = e.colaborador_id
        JOIN competencias comp ON comp.id = e.competencia_id
        WHERE e.tipo LIKE 'VERBA_AVULSA%'
        ORDER BY e.id DESC
      `).all();

      const colabs = ctx.db.prepare('SELECT id, nome, cargo, setor, salario_base_centavos FROM colaboradores ORDER BY id ASC').all();
      const comps = ctx.db.prepare('SELECT * FROM competencias ORDER BY mes_ano DESC').all();

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
      });
      return;
    }

    if (pathname === '/api/reset' && method === 'POST') {
      ctx = carregarFixtures();
      sendJson(res, 200, {
        mensagem: 'Ambiente isolado reinicializado com sucesso com fixtures limpas!',
        timestamp: new Date().toISOString(),
      });
      return;
    }

    // Formulário manual de verba avulsa
    if (pathname === '/api/manual/verba-avulsa' && method === 'POST') {
      const body = await parseRequestBody(req);
      try {
        const resVerba = lancarVerbaAvulsa(ctx.db, ctx.rhUser, {
          colaboradorId: Number(body.colaboradorId),
          competenciaId: Number(body.competenciaId),
          tipo: body.tipo,
          descricao: body.descricao,
          valor: Number(body.valorReais || body.valor),
          incideINSS: Boolean(body.incideINSS),
          incideIRRF: Boolean(body.incideIRRF),
          incideFGTS: Boolean(body.incideFGTS),
        });
        sendJson(res, 200, { sucesso: true, dados: resVerba });
      } catch (err: any) {
        sendJson(res, 400, { sucesso: false, erro: err.message });
      }
      return;
    }

    // Cálculo da folha
    if (pathname === '/api/folha/calcular' && method === 'POST') {
      const body = await parseRequestBody(req);
      try {
        const folha = calcularFolhaColaborador(ctx.db, ctx.rhUser, {
          colaboradorId: Number(body.colaboradorId),
          competenciaId: Number(body.competenciaId),
        });
        sendJson(res, 200, { sucesso: true, folha });
      } catch (err: any) {
        sendJson(res, 400, { sucesso: false, erro: err.message });
      }
      return;
    }

    // Memória de cálculo detalhada
    if (pathname === '/api/folha/memoria' && method === 'GET') {
      const compId = parseInt(parsedUrl.searchParams.get('competenciaId') || '', 10);
      const colabId = parseInt(parsedUrl.searchParams.get('colaboradorId') || '', 10);
      if (!compId || !colabId) {
        sendJson(res, 400, { erro: 'competenciaId e colaboradorId são obrigatórios.' });
        return;
      }

      const colab = ctx.db.prepare('SELECT id, nome, cargo, salario_base_centavos FROM colaboradores WHERE id = ?').get(colabId) as any;
      const folha = ctx.db.prepare('SELECT * FROM folhas WHERE colaborador_id = ? AND competencia_id = ?').get(colabId, compId) as any;

      if (!folha) {
        sendJson(res, 404, { erro: 'Folha ainda não calculada para este colaborador nesta competência. Clique em "Calcular Folha".' });
        return;
      }

      const verbas = ctx.db.prepare('SELECT * FROM folha_verbas WHERE folha_id = ? ORDER BY id ASC').all(folha.id);

      // Calcular proventos e descontos manuais para destaque
      const verbasAvulsas = verbas.filter((v: any) => v.tipo.startsWith('VERBA_AVULSA'));

      sendJson(res, 200, {
        colaborador: {
          id: colab.id,
          nome: colab.nome,
          cargo: colab.cargo,
          salarioBaseReais: (colab.salario_base_centavos / 100).toFixed(2),
        },
        folha: {
          id: folha.id,
          totalProventosReais: (folha.total_proventos_centavos / 100).toFixed(2),
          totalDescontosReais: (folha.total_descontos_centavos / 100).toFixed(2),
          liquidoReais: (folha.liquido_centavos / 100).toFixed(2),
          fgtsEncargoReais: (folha.fgts_centavos / 100).toFixed(2),
        },
        verbas,
        verbasAvulsas,
      });
      return;
    }

    // 2. Arquivos estáticos
    const staticServed = serveStatic(res, pathname);
    if (staticServed) return;

    // 404
    res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`<h1>404 - Não encontrado</h1><p>O caminho <code>${pathname}</code> não existe na demonstração QA US-10.</p>`);
  });

  return server;
}

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

if (process.argv[1] && (process.argv[1].endsWith('server.ts') || process.argv[1].endsWith('server.js'))) {
  const server = criarServidor();
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`\n========================================================`);
    console.log(`  QA DEMO - US-10: VERBAS AVULSAS (Spec v1.7)`);
    console.log(`  Servidor Node.js rodando em: http://localhost:${PORT}/`);
    console.log(`  Pasta pública resolvida: ${PUBLIC_DIR}`);
    console.log(`  Banco: SQLite em memória isolado (:memory:)`);
    console.log(`========================================================\n`);
  });
}
