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
