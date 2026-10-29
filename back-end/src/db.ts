/**
 * db.ts - Gerenciador do banco de dados SQLite nativo (node:sqlite).
 * 
 * Cria as tabelas da Etapa 1 e garante imutabilidade dos logs de auditoria (RNF-03).
 */

import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';

let dbInstance: DatabaseSync | null = null;

export const SCHEMA_SQL = `
-- Tabela de Usuários do Sistema (RNF-01, RNF-02, Seção 4)
CREATE TABLE IF NOT EXISTS usuarios (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nome TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  senha_hash TEXT NOT NULL,
  perfil TEXT NOT NULL CHECK(perfil IN ('RH', 'DIRETORIA', 'ADMIN')),
  ativo INTEGER NOT NULL DEFAULT 1,
  criado_em TEXT NOT NULL,
  atualizado_em TEXT NOT NULL
);

-- Tabela de Filiais (1 Matriz + Filiais - Seção 1.4 e Seção 2)
CREATE TABLE IF NOT EXISTS filiais (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nome TEXT NOT NULL,
  tipo TEXT NOT NULL CHECK(tipo IN ('MATRIZ', 'FILIAL')),
  ativa INTEGER NOT NULL DEFAULT 1,
  criado_em TEXT NOT NULL
);

-- Tabela de Colaboradores (RN-10 a RN-15, RN-12 inativação lógica)
CREATE TABLE IF NOT EXISTS colaboradores (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  filial_id INTEGER NOT NULL REFERENCES filiais(id),
  nome TEXT NOT NULL,
  cpf TEXT UNIQUE NOT NULL,
  nascimento TEXT NOT NULL,
  admissao TEXT NOT NULL,
  desligamento TEXT NULL,
  cargo TEXT NOT NULL,
  setor TEXT NOT NULL,
  salario_base_centavos INTEGER NOT NULL,
  jornada_horas_mensais INTEGER NOT NULL DEFAULT 220,
  banco TEXT NOT NULL,
  agencia TEXT NOT NULL,
  conta TEXT NOT NULL,
  situacao TEXT NOT NULL DEFAULT 'ATIVO' CHECK(situacao IN ('ATIVO', 'INATIVO')),
  criado_em TEXT NOT NULL,
  atualizado_em TEXT NOT NULL
);

-- Tabela de Dependentes para IRRF (RN-16)
CREATE TABLE IF NOT EXISTS dependentes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  colaborador_id INTEGER NOT NULL REFERENCES colaboradores(id),
  nome TEXT NOT NULL,
  nascimento TEXT NOT NULL,
  parentesco TEXT NOT NULL
);

-- Histórico de alterações do colaborador (RN-07)
CREATE TABLE IF NOT EXISTS historico_colaborador (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  colaborador_id INTEGER NOT NULL REFERENCES colaboradores(id),
  campo TEXT NOT NULL,
  valor_anterior TEXT NOT NULL,
  valor_novo TEXT NOT NULL,
  data_hora TEXT NOT NULL,
  usuario_id INTEGER NULL REFERENCES usuarios(id)
);

-- Parâmetros legais com vigência (RN-01, Seção 6)
CREATE TABLE IF NOT EXISTS parametros (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nome TEXT NOT NULL,
  valor TEXT NOT NULL,
  data_inicio TEXT NOT NULL,
  data_fim TEXT NOT NULL,
  versao TEXT NOT NULL DEFAULT '1.0',
  criado_em TEXT NOT NULL
);

-- Calendário de Feriados (RN-35)
CREATE TABLE IF NOT EXISTS feriados (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  data TEXT NOT NULL UNIQUE,
  descricao TEXT NOT NULL,
  tipo TEXT NOT NULL DEFAULT 'NACIONAL' CHECK(tipo IN ('NACIONAL', 'ESTADUAL', 'MUNICIPAL'))
);

-- Competências da Folha (RN-04, RN-08, Tabela 7.5)
CREATE TABLE IF NOT EXISTS competencias (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  mes_ano TEXT NOT NULL UNIQUE, -- Formato 'AAAA-MM'
  situacao TEXT NOT NULL DEFAULT 'ABERTA' CHECK(situacao IN ('ABERTA', 'CALCULADA', 'FECHADA')),
  fechado_em TEXT NULL,
  justificativa_reabertura TEXT NULL,
  criado_em TEXT NOT NULL
);

-- Lançamento de Eventos (Horas Extras, Faltas, Atestados, VT, VA, Verbas Avulsas - Etapa 2)
CREATE TABLE IF NOT EXISTS eventos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  colaborador_id INTEGER NOT NULL REFERENCES colaboradores(id),
  competencia_id INTEGER NOT NULL REFERENCES competencias(id),
  tipo TEXT NOT NULL CHECK(tipo IN (
    'HORA_EXTRA_UTIL', 'HORA_EXTRA_DOMINGO',
    'FALTA_INJUSTIFICADA', 'ATESTADO',
    'VALE_TRANSPORTE', 'VALE_ALIMENTACAO',
    'VERBA_AVULSA_PROVENTO', 'VERBA_AVULSA_DESCONTO'
  )),
  quantidade REAL NULL, -- horas (HE) ou dias (faltas/atestado)
  valor_centavos INTEGER NULL, -- Dec centavos
  descricao TEXT NULL,
  incide_inss INTEGER NOT NULL DEFAULT 0,
  incide_irrf INTEGER NOT NULL DEFAULT 0,
  incide_fgts INTEGER NOT NULL DEFAULT 0,
  data_inicio TEXT NULL,
  data_fim TEXT NULL,
  anexo_nome TEXT NULL,
  anexo_tipo TEXT NULL,
  observacao TEXT NULL,
  criado_por_usuario_id INTEGER NOT NULL REFERENCES usuarios(id),
  criado_em TEXT NOT NULL
);

-- Folha de Pagamento por Colaborador e Competência (RN-20 a RN-24, Etapa 3)
CREATE TABLE IF NOT EXISTS folhas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  colaborador_id INTEGER NOT NULL REFERENCES colaboradores(id),
  competencia_id INTEGER NOT NULL REFERENCES competencias(id),
  total_proventos_centavos INTEGER NOT NULL,
  total_descontos_centavos INTEGER NOT NULL,
  liquido_centavos INTEGER NOT NULL,
  fgts_centavos INTEGER NOT NULL,
  saldo_a_descontar_centavos INTEGER NOT NULL DEFAULT 0,
  justificativa_saldo TEXT NULL,
  status TEXT NOT NULL DEFAULT 'CALCULADA' CHECK(status IN ('CALCULADA', 'FECHADA')),
  calculado_em TEXT NOT NULL,
  UNIQUE(colaborador_id, competencia_id)
);

-- Memória de Cálculo detalhada por Verba (RN-02)
CREATE TABLE IF NOT EXISTS folha_verbas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  folha_id INTEGER NOT NULL REFERENCES folhas(id) ON DELETE CASCADE,
  tipo TEXT NOT NULL,
  descricao TEXT NOT NULL,
  natureza TEXT NOT NULL CHECK(natureza IN ('PROVENTO', 'DESCONTO', 'ENCARGO')),
  valor_centavos INTEGER NOT NULL,
  base_calculo_centavos INTEGER NOT NULL,
  regra_aplicada TEXT NOT NULL,
  parametro_utilizado TEXT NULL,
  arredondamento TEXT NOT NULL DEFAULT 'HALF_UP_2_CASAS'
);

-- Saldo a Descontar em Competências Seguintes (RN-06, Tabela 7.1)
CREATE TABLE IF NOT EXISTS saldos_a_descontar (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  colaborador_id INTEGER NOT NULL REFERENCES colaboradores(id),
  competencia_origem_id INTEGER NOT NULL REFERENCES competencias(id),
  valor_original_centavos INTEGER NOT NULL,
  valor_restante_centavos INTEGER NOT NULL,
  situacao TEXT NOT NULL DEFAULT 'PENDENTE' CHECK(situacao IN ('PENDENTE', 'QUITADO')),
  criado_em TEXT NOT NULL
);

-- Férias e Controle de Períodos (RN-40 a RN-49, Etapa 4)
CREATE TABLE IF NOT EXISTS ferias (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  colaborador_id INTEGER NOT NULL REFERENCES colaboradores(id),
  periodo_aquisitivo_inicio TEXT NOT NULL,
  periodo_aquisitivo_fim TEXT NOT NULL,
  periodo_concessivo_fim TEXT NOT NULL,
  dias_direito INTEGER NOT NULL DEFAULT 30,
  dias_gozo INTEGER NOT NULL,
  dias_abono INTEGER NOT NULL DEFAULT 0,
  data_inicio TEXT NOT NULL,
  data_fim TEXT NOT NULL,
  data_limite_pagamento TEXT NOT NULL,
  valor_ferias_centavos INTEGER NOT NULL,
  valor_terco_centavos INTEGER NOT NULL,
  valor_abono_centavos INTEGER NOT NULL DEFAULT 0,
  valor_terco_abono_centavos INTEGER NOT NULL DEFAULT 0,
  inss_centavos INTEGER NOT NULL DEFAULT 0,
  irrf_centavos INTEGER NOT NULL DEFAULT 0,
  liquido_centavos INTEGER NOT NULL,
  situacao TEXT NOT NULL DEFAULT 'PENDENTE' CHECK(situacao IN ('PENDENTE', 'APROVADA', 'RECUSADA')),
  justificativa TEXT NULL,
  criado_em TEXT NOT NULL
);

-- 13º Salário (RN-46, RN-48, Etapa 4)
CREATE TABLE IF NOT EXISTS decimo_terceiro (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  colaborador_id INTEGER NOT NULL REFERENCES colaboradores(id),
  ano INTEGER NOT NULL,
  meses_trabalhados INTEGER NOT NULL,
  parcela INTEGER NOT NULL CHECK(parcela IN (1, 2)),
  valor_bruto_centavos INTEGER NOT NULL,
  inss_centavos INTEGER NOT NULL DEFAULT 0,
  irrf_centavos INTEGER NOT NULL DEFAULT 0,
  desconto_primeira_parcela_centavos INTEGER NOT NULL DEFAULT 0,
  liquido_centavos INTEGER NOT NULL,
  calculado_em TEXT NOT NULL,
  UNIQUE(colaborador_id, ano, parcela)
);

-- Documentos e Anexos com Validade (RN-52, Etapa 4)
CREATE TABLE IF NOT EXISTS documentos_colaborador (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  colaborador_id INTEGER NOT NULL REFERENCES colaboradores(id),
  tipo TEXT NOT NULL,
  nome_arquivo TEXT NOT NULL,
  data_validade TEXT NULL,
  anexado_por_usuario_id INTEGER NOT NULL REFERENCES usuarios(id),
  criado_em TEXT NOT NULL
);

-- Exames Ocupacionais Periódicos (RN-53, Etapa 4)
CREATE TABLE IF NOT EXISTS exames_ocupacionais (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  colaborador_id INTEGER NOT NULL REFERENCES colaboradores(id),
  tipo TEXT NOT NULL,
  data_ultimo_exame TEXT NOT NULL,
  periodicidade_meses INTEGER NOT NULL DEFAULT 12,
  data_proximo_vencimento TEXT NOT NULL,
  criado_em TEXT NOT NULL
);

-- Log de Auditoria Imutável (RNF-03)
CREATE TABLE IF NOT EXISTS logs_auditoria (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  data_hora TEXT NOT NULL,
  usuario_id INTEGER NULL,
  usuario_email TEXT NOT NULL,
  usuario_perfil TEXT NOT NULL,
  acao TEXT NOT NULL,
  entidade TEXT NOT NULL,
  registro_id TEXT NULL,
  detalhes TEXT NULL,
  valor_anterior TEXT NULL,
  valor_novo TEXT NULL
);

-- Triggers de segurança: Impedir UPDATE e DELETE em logs_auditoria (RNF-03)
CREATE TRIGGER IF NOT EXISTS impede_update_log BEFORE UPDATE ON logs_auditoria
BEGIN
  SELECT RAISE(ABORT, 'Logs de auditoria são imutáveis e não podem ser alterados.');
END;

CREATE TRIGGER IF NOT EXISTS impede_delete_log BEFORE DELETE ON logs_auditoria
BEGIN
  SELECT RAISE(ABORT, 'Logs de auditoria são imutáveis e não podem ser apagados.');
END;
`;

export function inicializarBanco(caminhoArquivo?: string): DatabaseSync {
  const local = caminhoArquivo || path.join(process.cwd(), 'rh_folha.db');
  const db = new DatabaseSync(local);
  db.exec(SCHEMA_SQL);
  return db;
}

export function obterBanco(): DatabaseSync {
  if (!dbInstance) {
    dbInstance = inicializarBanco();
  }
  return dbInstance;
}

export function definirBancoTeste(db: DatabaseSync): void {
  dbInstance = db;
}
