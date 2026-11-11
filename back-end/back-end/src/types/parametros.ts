// Tipos para os Parâmetros Legais e Feriados (US-11)

export interface Feriado {
  id?: string;
  nome: string;
  data: string; // Formato YYYY-MM-DD
  tipo: 'NACIONAL' | 'ESTADUAL' | 'MUNICIPAL' | 'PONTO_FACULTATIVO';
  impactaHorasExtras: boolean; // RN-35
}

export interface ParametroLegal {
  id?: string;
  vigenciaInicio: string; // RN-01 e RN-62: controle de vigência
  vigenciaFim?: string;
  aliquotaINSS: number[];
  tabelaIRRF: {
    faixa: number;
    aliquota: number;
    deducao: number;
  }[];
  percentualFGTS: number;
  responsavelAlteracao: string; // RN-01: histórico de responsável
  atualizadoEm: Date;
}
