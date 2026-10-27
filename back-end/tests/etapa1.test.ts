/**
 * etapa1.test.ts - Testes automatizados da Etapa 1 (Seções 2, 4, 5.1, 5.2, 6 e 10).
 * 
 * Executa usando Node.js test runner nativo (node:test e node:assert).
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { DatabaseSync } from 'node:sqlite';
import { SCHEMA_SQL } from '../src/db.js';
import { autenticarUsuario, criarUsuario } from '../src/services/usuarioService.js';
import { criarFilial, listarFiliais } from '../src/services/filialService.js';
import {
  criarColaborador,
  inativarColaborador,
  atualizarColaborador,
  consultarColaborador,
} from '../src/services/colaboradorService.js';
import {
  inicializarFeriadosEParametros,
  cadastrarParametro,
  listarFeriados,
  obterParametroVigente,
} from '../src/services/parametroFeriadoService.js';
import { consultarLogs } from '../src/services/logService.js';
import { validarSessao, limparTodasSessoes } from '../src/security.js';

describe('ETAPA 1: Login, Perfis, Filiais, Colaboradores, Parâmetros e Feriados', () => {
  let db: DatabaseSync;
  const adminUser = { id: 1, email: 'admin@empresa.com', perfil: 'ADMIN' };
  let rhUser: { id: number; email: string; perfil: string };
  let diretoriaUser: { id: number; email: string; perfil: string };
  let matrizId: number;

  beforeEach(() => {
    limparTodasSessoes();
    // Cria banco em memória isolado para cada teste
    db = new DatabaseSync(':memory:');
    db.exec(SCHEMA_SQL);
    inicializarFeriadosEParametros(db);

    // Cria usuários padrão
    const uRH = criarUsuario(db, adminUser, {
      nome: 'Analista de RH',
      email: 'rh@empresa.com',
      senha: 'SenhaForte123',
      perfil: 'RH',
    });
    rhUser = { id: uRH.id, email: uRH.email, perfil: 'RH' };

    const uDir = criarUsuario(db, adminUser, {
      nome: 'Diretor Geral',
      email: 'diretor@empresa.com',
      senha: 'Diretoria2026',
      perfil: 'DIRETORIA',
    });
    diretoriaUser = { id: uDir.id, email: uDir.email, perfil: 'DIRETORIA' };

    // Cria filial Matriz
    const filial = criarFilial(db, rhUser, { nome: 'Matriz São Paulo', tipo: 'MATRIZ' });
    matrizId = filial.id;
  });

  // --- SEÇÃO 10: CENÁRIOS DE LOGIN E SEGURANÇA ---

  it('Cenário: Login válido', () => {
    const res = autenticarUsuario(db, 'rh@empresa.com', 'SenhaForte123');
    assert.ok(res.token, 'Token de sessão deve ser gerado');
    assert.strictEqual(res.usuario.email, 'rh@empresa.com');
    assert.strictEqual(res.usuario.perfil, 'RH');

    // Valida que o token está ativo na sessão
    const sessao = validarSessao(res.token);
    assert.ok(sessao, 'Sessão deve estar válida');
    assert.strictEqual(sessao?.email, 'rh@empresa.com');
  });

  it('Cenário: Senha incorreta exibe mensagem padrão sem dizer qual dos dois errou', () => {
    assert.throws(
      () => autenticarUsuario(db, 'rh@empresa.com', 'SenhaErrada123'),
      { message: 'E-mail ou senha inválidos.' }
    );
  });

  it('Cenário: Bloqueio por tentativas de senha após 5 erros seguidos', () => {
    // 4 tentativas incorretas
    for (let i = 0; i < 4; i++) {
      assert.throws(
        () => autenticarUsuario(db, 'rh@empresa.com', `SenhaErrada${i}`),
        { message: 'E-mail ou senha inválidos.' }
      );
    }

    // 5ª tentativa incorreta aciona o bloqueio de 15 minutos (RNF-19)
    assert.throws(
      () => autenticarUsuario(db, 'rh@empresa.com', 'SenhaErrada5'),
      /Acesso bloqueado por 15 minutos/
    );

    // Tentativa subsequente, mesmo com a senha correta, permanece bloqueada
    assert.throws(
      () => autenticarUsuario(db, 'rh@empresa.com', 'SenhaForte123'),
      /Acesso bloqueado por 15 minutos/
    );
  });

  it('Cenário: Acesso sem login (sessão inválida ou vazia)', () => {
    const sessaoInvalida = validarSessao('token-inexistente-123');
    assert.strictEqual(sessaoInvalida, null, 'Token inexistente não pode validar sessão');
  });

  it('Cenário: Admin gerencia usuários e a ação fica gravada no log de auditoria', () => {
    const novoUsuario = criarUsuario(db, adminUser, {
      nome: 'Carlos Assistente',
      email: 'carlos@empresa.com',
      senha: 'NovaSenha123',
      perfil: 'RH',
    });

    assert.ok(novoUsuario.id > 0);

    // Confere se o log foi registrado
    const logs = consultarLogs(db, adminUser, { entidade: 'USUARIO' });
    assert.ok(logs.length > 0);
    assert.strictEqual(logs[0].acao, 'CRIAR_USUARIO');
    assert.ok(logs[0].detalhes.includes('carlos@empresa.com'));
  });

  it('Cenário: Admin não vê dados da folha / colaboradores', () => {
    const colab = criarColaborador(db, rhUser, {
      filialId: matrizId,
      nome: 'Bruno Lima',
      cpf: '52998224725',
      nascimento: '1990-01-01',
      admissao: '2021-01-02',
      cargo: 'Gerente',
      setor: 'Operações',
      salarioBase: '5000.00',
      banco: '341',
      agencia: '0001',
      conta: '12345',
    });

    // Admin tentando consultar dados do colaborador recebe erro de permissão
    assert.throws(
      () => consultarColaborador(db, { perfil: 'ADMIN' }, colab.id),
      /Você não tem permissão para acessar os dados deste colaborador/
    );
  });

  // --- SEÇÃO 10: CENÁRIOS DE CADASTRO DE COLABORADORES ---

  it('Cenário: CPF inválido rejeita o cadastro e indica conferir 11 dígitos', () => {
    assert.throws(
      () =>
        criarColaborador(db, rhUser, {
          filialId: matrizId,
          nome: 'Fulano Silva',
          cpf: '12345678900', // Dígitos verificadores incorretos
          nascimento: '1990-01-01',
          admissao: '2022-01-01',
          cargo: 'Atendente',
          setor: 'Atendimento',
          salarioBase: '2000.00',
          banco: '001',
          agencia: '1234',
          conta: '5678',
        }),
      { message: 'CPF inválido. Confira os 11 dígitos.' }
    );
  });

  it('Cenário: CPF duplicado é rejeitado', () => {
    const payload = {
      filialId: matrizId,
      nome: 'Fabio Nunes',
      cpf: '52998224725',
      nascimento: '1992-05-15',
      admissao: '2025-02-01',
      cargo: 'Atendente',
      setor: 'Atendimento',
      salarioBase: '2200.00',
      banco: '237',
      agencia: '1234',
      conta: '9876',
    };

    criarColaborador(db, rhUser, payload);

    // Tentar criar outro colaborador com o mesmo CPF
    assert.throws(
      () => criarColaborador(db, rhUser, { ...payload, nome: 'Outro Colaborador' }),
      { message: 'Já existe um colaborador com este CPF.' }
    );
  });

  it('Cenário: Salário zero ou negativo é rejeitado', () => {
    assert.throws(
      () =>
        criarColaborador(db, rhUser, {
          filialId: matrizId,
          nome: 'Gabi Melo',
          cpf: '52998224725',
          nascimento: '1998-07-20',
          admissao: '2025-04-01',
          cargo: 'Atendente',
          setor: 'Atendimento',
          salarioBase: '0.00',
          banco: '001',
          agencia: '1234',
          conta: '5678',
        }),
      { message: 'Informe um salário-base maior que zero.' }
    );
  });

  it('Cenário: Cadastro sem dados sensíveis (LGPD - RN-14)', () => {
    // Tentar incluir campo proibido de religião
    assert.throws(
      () =>
        criarColaborador(db, rhUser, {
          filialId: matrizId,
          nome: 'Teste Sensivel',
          cpf: '52998224725',
          nascimento: '1990-01-01',
          admissao: '2022-01-01',
          cargo: 'Atendente',
          setor: 'Atendimento',
          salarioBase: '2000.00',
          banco: '001',
          agencia: '1234',
          conta: '5678',
          religiao: 'Católica', // PROIBIDO
        }),
      /não permite campos de religião, orientação sexual, raça, dados genéticos ou biomédicos/
    );

    // Tentar incluir campo proibido de orientação sexual ou biometria
    assert.throws(
      () =>
        criarColaborador(db, rhUser, {
          filialId: matrizId,
          nome: 'Teste Sensivel 2',
          cpf: '52998224725',
          nascimento: '1990-01-01',
          admissao: '2022-01-01',
          cargo: 'Atendente',
          setor: 'Atendimento',
          salarioBase: '2000.00',
          banco: '001',
          agencia: '1234',
          conta: '5678',
          biometria: 'digital_base64', // PROIBIDO
        }),
      /não permite campos de religião, orientação sexual, raça, dados genéticos ou biomédicos/
    );
  });

  it('Cenário: Desligamento anterior a admissão é rejeitado', () => {
    assert.throws(
      () =>
        criarColaborador(db, rhUser, {
          filialId: matrizId,
          nome: 'Elisa Rocha',
          cpf: '52998224725',
          nascimento: '1994-03-12',
          admissao: '2026-10-20',
          desligamento: '2026-10-10', // Anterior à admissão
          cargo: 'Analista',
          setor: 'Financeiro',
          salarioBase: '3000.00',
          banco: '033',
          agencia: '1234',
          conta: '5678',
        }),
      { message: 'Data de desligamento não pode ser anterior à admissão.' }
    );
  });

  it('Cenário: Inativar em vez de excluir (RN-12)', () => {
    const colab = criarColaborador(db, rhUser, {
      filialId: matrizId,
      nome: 'Diego Alves',
      cpf: '52998224725',
      nascimento: '1988-11-05',
      admissao: '2022-06-05',
      cargo: 'Operador',
      setor: 'Produção',
      salarioBase: '2000.00',
      banco: '104',
      agencia: '1234',
      conta: '5678',
    });

    inativarColaborador(db, rhUser, colab.id);

    const consultado = consultarColaborador(db, rhUser, colab.id);
    assert.strictEqual(consultado.situacao, 'INATIVO', 'Colaborador deve ter situação INATIVO');
    assert.ok(consultado.historico.some((h: any) => h.campo === 'situacao' && h.valor_novo === 'INATIVO'));
  });

  it('Cenário: Histórico de alterações salariais e de cargo (RN-07)', () => {
    const colab = criarColaborador(db, rhUser, {
      filialId: matrizId,
      nome: 'Carla Dias',
      cpf: '52998224725',
      nascimento: '1996-08-14',
      admissao: '2026-09-15',
      cargo: 'Atendente',
      setor: 'Atendimento',
      salarioBase: '1900.00',
      banco: '001',
      agencia: '1234',
      conta: '5678',
    });

    // Atualiza salário de 1900.00 para 2300.00 e cargo para "Atendente Sênior"
    atualizarColaborador(db, rhUser, colab.id, {
      salarioBase: '2300.00',
      cargo: 'Atendente Sênior',
    });

    const consultado = consultarColaborador(db, rhUser, colab.id);
    assert.strictEqual(consultado.salarioBase, 2300.00);
    assert.strictEqual(consultado.cargo, 'Atendente Sênior');

    const histSalario = consultado.historico.find((h: any) => h.campo === 'salario_base');
    assert.ok(histSalario, 'Histórico de salário deve estar gravado');
    assert.strictEqual(histSalario.valor_anterior, '1900.00');
    assert.strictEqual(histSalario.valor_novo, '2300.00');

    const histCargo = consultado.historico.find((h: any) => h.campo === 'cargo');
    assert.ok(histCargo, 'Histórico de cargo deve estar gravado');
    assert.strictEqual(histCargo.valor_anterior, 'Atendente');
    assert.strictEqual(histCargo.valor_novo, 'Atendente Sênior');
  });

  // --- SEÇÃO 10: CENÁRIOS DE PARÂMETROS E FERIADOS ---

  it('Cenário: Calendário inicial de feriados possui os 10 feriados nacionais de 2026', () => {
    const feriados = listarFeriados(db);
    assert.strictEqual(feriados.length, 10, 'Devem existir exatamente 10 feriados nacionais de 2026');

    // Confere se 12/10/2026 está presente
    const feriadoAparecida = feriados.find((f) => f.data === '2026-10-12');
    assert.ok(feriadoAparecida, 'Feriado de 12/10/2026 deve existir');
    assert.strictEqual(feriadoAparecida.descricao, 'Nossa Senhora Aparecida');
  });

  it('Cenário: Parâmetro com vigência seleciona a regra correta por período', () => {
    // Parâmetro do salário mínimo de 2026
    const salMin2026 = obterParametroVigente(db, 'salario_minimo', '2026-10-15');
    assert.strictEqual(salMin2026, '1621.00');

    // Cadastra nova tabela para 2027
    cadastrarParametro(db, rhUser, {
      nome: 'salario_minimo',
      valor: '1750.00',
      dataInicio: '2027-01-01',
      dataFim: '2027-12-31',
      versao: '2.0',
    });

    // Folha de 12/2026 continua usando o valor de 2026
    const salMinDez2026 = obterParametroVigente(db, 'salario_minimo', '2026-12-15');
    assert.strictEqual(salMinDez2026, '1621.00');

    // Folha de 01/2027 usa o novo valor vigente
    const salMinJan2027 = obterParametroVigente(db, 'salario_minimo', '2027-01-15');
    assert.strictEqual(salMinJan2027, '1750.00');
  });

  it('Cenário: Parâmetro sem vigência é rejeitado', () => {
    assert.throws(
      () =>
        cadastrarParametro(db, rhUser, {
          nome: 'taxa_extra',
          valor: '10.00',
          dataInicio: '', // Sem vigência
        }),
      { message: 'Informe o campo de vigência (data de início).' }
    );
  });

  it('Cenário: Log de auditoria é imutável e impede alteração ou exclusão (RNF-03)', () => {
    const logs = consultarLogs(db, adminUser);
    assert.ok(logs.length > 0, 'Devem existir logs registrados');
    const primeiroLogId = logs[0].id;

    // Tentar dar UPDATE no log deve falhar pelo trigger
    assert.throws(
      () => db.prepare("UPDATE logs_auditoria SET detalhes = 'hackeado' WHERE id = ?").run(primeiroLogId),
      /Logs de auditoria são imutáveis/
    );

    // Tentar dar DELETE no log deve falhar pelo trigger
    assert.throws(
      () => db.prepare('DELETE FROM logs_auditoria WHERE id = ?').run(primeiroLogId),
      /Logs de auditoria são imutáveis/
    );
  });
});
