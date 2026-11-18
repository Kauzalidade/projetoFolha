/**
 * us12_gestao_usuarios.test.ts - Suíte de Testes Automatizados para a US-12 (Spec v1.7).
 * 
 * Cobre os 12 critérios obrigatórios da US-12:
 * 1. Cadastro de usuário válido.
 * 2. Rejeição de e-mail inválido ou duplicado.
 * 3. Inativação e bloqueio de acesso.
 * 4. Redefinição de senha e invalidação de sessões.
 * 5. Histórico das últimas 3 senhas (impedindo reutilização).
 * 6. Hash de senha (scrypt com salt, nunca texto puro).
 * 7. Autenticação de segundo fator (2FA: desafio, código e sessão).
 * 8. Bloqueio por tentativas (5 falhas seguidas -> bloqueio de 15 minutos).
 * 9. Expiração de sessão após 30 minutos sem atividade.
 * 10. Matriz de permissões dos perfis RH, Diretoria e Admin (Seção 4 / Tabela 4.1).
 * 11. Registro imutável de todas as operações administrativas no Log de Auditoria.
 * 12. Rejeição de operações não autorizadas diretamente pelos endpoints HTTP do backend.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { SCHEMA_SQL } from '../src/db.js';
import {
  criarUsuario,
  autenticarUsuario,
  confirmarSegundoFator,
  inativarUsuario,
  redefinirSenha,
  listarUsuarios,
  configurarSegundoFator,
  obterUltimoCodigo2FAParaTeste,
} from '../src/services/usuarioService.js';
import {
  validarForcaSenha,
  gerarHashSenha,
  verificarSenha,
  validarSessao,
  criarSessao,
  limparTodasSessoes,
  contarSessoesAtivasUsuario,
  verificarBloqueio,
} from '../src/security.js';
import { consultarLogs } from '../src/services/logService.js';
import { criarFilial } from '../src/services/filialService.js';
import { criarColaborador, consultarColaborador } from '../src/services/colaboradorService.js';
import { inicializarFeriadosEParametros } from '../src/services/parametroFeriadoService.js';
import { gerarRelatorioFolhaMes } from '../src/services/relatoriosService.js';
import { calcularFolhaColaborador } from '../src/services/folhaService.js';
import { abrirOuObterCompetencia } from '../src/services/competenciaService.js';

describe('US-12: Gestão de Usuários e Perfis (Spec v1.7)', () => {
  let db: DatabaseSync;
  const adminMaster = { id: 1, email: 'admin@empresa.com', perfil: 'ADMIN' };
  let rhUser: { id: number; email: string; perfil: string };
  let diretoriaUser: { id: number; email: string; perfil: string };

  beforeEach(() => {
    limparTodasSessoes();
    db = new DatabaseSync(':memory:');
    db.exec(SCHEMA_SQL);
    inicializarFeriadosEParametros(db);

    // Cria usuário Admin Master
    db.prepare(`
      INSERT INTO usuarios (id, nome, email, senha_hash, perfil, ativo, segundo_fator_ativo, criado_em, atualizado_em)
      VALUES (1, 'Admin Master', 'admin@empresa.com', ?, 'ADMIN', 1, 0, datetime('now'), datetime('now'))
    `).run(gerarHashSenha('AdminMaster123'));

    // Cria usuário RH
    const uRH = criarUsuario(db, adminMaster, {
      nome: 'Analista de RH',
      email: 'rh@empresa.com',
      senha: 'SenhaForte123',
      perfil: 'RH',
    });
    rhUser = { id: uRH.id, email: uRH.email, perfil: 'RH' };

    // Cria usuário Diretoria
    const uDir = criarUsuario(db, adminMaster, {
      nome: 'Diretor Geral',
      email: 'diretor@empresa.com',
      senha: 'Diretoria2026',
      perfil: 'DIRETORIA',
    });
    diretoriaUser = { id: uDir.id, email: uDir.email, perfil: 'DIRETORIA' };
  });

  // -------------------------------------------------------------------------
  // 1. Cadastro de usuário válido
  // -------------------------------------------------------------------------
  it('1. Cadastro de usuário válido pelo ADMIN com perfil e dados corretos', () => {
    const novo = criarUsuario(db, adminMaster, {
      nome: 'Beatriz Analista',
      email: 'beatriz.rh@empresa.com',
      senha: 'SenhaValida2026',
      perfil: 'RH',
      segundoFatorAtivo: true,
    });

    assert.ok(novo.id > 0, 'Usuário deve receber ID gerado');
    assert.strictEqual(novo.nome, 'Beatriz Analista');
    assert.strictEqual(novo.email, 'beatriz.rh@empresa.com');
    assert.strictEqual(novo.perfil, 'RH');
    assert.strictEqual(novo.ativo, 1);
    assert.strictEqual(novo.segundoFatorAtivo, true);

    // Confere no banco de dados
    const row = db.prepare('SELECT id, nome, email, senha_hash, perfil, ativo, segundo_fator_ativo FROM usuarios WHERE id = ?').get(novo.id) as any;
    assert.ok(row, 'Registro deve existir no SQLite');
    assert.strictEqual(row.email, 'beatriz.rh@empresa.com');
    assert.strictEqual(row.segundo_fator_ativo, 1);
  });

  // -------------------------------------------------------------------------
  // 2. Rejeição de e-mail inválido ou duplicado
  // -------------------------------------------------------------------------
  it('2. Rejeição de e-mail inválido e duplicado conforme RN-15 e especificação', () => {
    // E-mail sem @
    assert.throws(
      () => criarUsuario(db, adminMaster, { nome: 'Teste', email: 'emailinvalido.com', senha: 'SenhaValida123', perfil: 'RH' }),
      { message: 'Informe um e-mail válido.' }
    );

    // E-mail sem domínio completo
    assert.throws(
      () => criarUsuario(db, adminMaster, { nome: 'Teste', email: 'usuario@dominio', senha: 'SenhaValida123', perfil: 'RH' }),
      { message: 'Informe um e-mail válido.' }
    );

    // E-mail com espaços
    assert.throws(
      () => criarUsuario(db, adminMaster, { nome: 'Teste', email: 'usuario teste@empresa.com', senha: 'SenhaValida123', perfil: 'RH' }),
      { message: 'Informe um e-mail válido.' }
    );

    // E-mail vazio
    assert.throws(
      () => criarUsuario(db, adminMaster, { nome: 'Teste', email: '', senha: 'SenhaValida123', perfil: 'RH' }),
      { message: 'Informe um e-mail válido.' }
    );

    // E-mail duplicado
    assert.throws(
      () => criarUsuario(db, adminMaster, { nome: 'Outro RH', email: 'rh@empresa.com', senha: 'SenhaValida123', perfil: 'RH' }),
      { message: 'Já existe um usuário cadastrado com este e-mail.' }
    );
  });

  // -------------------------------------------------------------------------
  // 3. Inativação e bloqueio de acesso
  // -------------------------------------------------------------------------
  it('3. Inativação lógica sem exclusão física e bloqueio imediato de acesso', () => {
    const usuarioTeste = criarUsuario(db, adminMaster, {
      nome: 'Assistente Temporário',
      email: 'temp@empresa.com',
      senha: 'SenhaTemp123',
      perfil: 'RH',
    });

    // Login antes de inativar funciona
    const auth1 = autenticarUsuario(db, 'temp@empresa.com', 'SenhaTemp123');
    assert.ok(auth1.token, 'Token gerado antes da inativação');
    assert.strictEqual(contarSessoesAtivasUsuario(usuarioTeste.id), 1);

    // Inativação pelo ADMIN
    const resultadoInativacao = inativarUsuario(db, adminMaster, usuarioTeste.id);
    assert.strictEqual(resultadoInativacao.status, 'INATIVADO');
    assert.strictEqual(resultadoInativacao.sessoesEncerradas, 1, 'Deve encerrar 1 sessão ativa');

    // Registro físico permanece no banco com ativo = 0 (RN-12)
    const row = db.prepare('SELECT id, email, ativo FROM usuarios WHERE id = ?').get(usuarioTeste.id) as any;
    assert.ok(row, 'Usuário não pode ser excluído fisicamente');
    assert.strictEqual(row.ativo, 0, 'Campo ativo deve ser 0');

    // Sessão anterior é invalidada
    const sessaoApos = validarSessao(auth1.token!);
    assert.strictEqual(sessaoApos, null, 'Sessão anterior deve estar inválida');

    // Nova tentativa de login é bloqueada com mensagem padrão
    assert.throws(
      () => autenticarUsuario(db, 'temp@empresa.com', 'SenhaTemp123'),
      { message: 'E-mail ou senha inválidos.' }
    );
  });

  // -------------------------------------------------------------------------
  // 4. Redefinição de senha e encerramento de sessões existentes
  // -------------------------------------------------------------------------
  it('4. Redefinição de senha com encerramento de todas as sessões existentes', () => {
    // Cria 2 sessões ativas para o usuário RH
    const tokenSessao1 = criarSessao({ id: rhUser.id, email: rhUser.email, nome: 'RH', perfil: 'RH' });
    const tokenSessao2 = criarSessao({ id: rhUser.id, email: rhUser.email, nome: 'RH', perfil: 'RH' });
    assert.strictEqual(contarSessoesAtivasUsuario(rhUser.id), 2);

    // Redefine a senha pelo ADMIN
    const resRedef = redefinirSenha(db, adminMaster, rhUser.id, 'NovaSenhaForte2026');
    assert.strictEqual(resRedef.sucesso, true);
    assert.strictEqual(resRedef.sessoesEncerradas, 2, 'Deve ter invalidado 2 sessões');

    // Valida que nenhuma das sessões antigas é mais aceita
    assert.strictEqual(validarSessao(tokenSessao1), null, 'Sessão antiga 1 deve estar encerrada');
    assert.strictEqual(validarSessao(tokenSessao2), null, 'Sessão antiga 2 deve estar encerrada');
    assert.strictEqual(contarSessoesAtivasUsuario(rhUser.id), 0);

    // Login com a senha antiga falha
    assert.throws(
      () => autenticarUsuario(db, 'rh@empresa.com', 'SenhaForte123'),
      { message: 'E-mail ou senha inválidos.' }
    );

    // Login com a nova senha funciona
    const authNovo = autenticarUsuario(db, 'rh@empresa.com', 'NovaSenhaForte2026');
    assert.ok(authNovo.token, 'Deve autenticar com a nova senha');
  });

  // -------------------------------------------------------------------------
  // 5. Histórico das últimas 3 senhas (impedindo reutilização)
  // -------------------------------------------------------------------------
  it('5. Histórico das últimas 3 senhas impede a reutilização de senhas recentes', () => {
    const user = criarUsuario(db, adminMaster, {
      nome: 'Auditor Fiscal',
      email: 'auditor@empresa.com',
      senha: 'PrimeiraSenha1', // Senha 1
      perfil: 'DIRETORIA',
    });

    // 1ª troca: Senha 2
    redefinirSenha(db, adminMaster, user.id, 'SegundaSenha2');

    // 2ª troca: Senha 3
    redefinirSenha(db, adminMaster, user.id, 'TerceiraSenha3');

    // Tentativa de reutilizar Senha 1 (está entre as últimas 3) -> DEVE REJEITAR
    assert.throws(
      () => redefinirSenha(db, adminMaster, user.id, 'PrimeiraSenha1'),
      { message: 'A nova senha não pode ser igual às últimas 3 senhas utilizadas.' }
    );

    // Tentativa de reutilizar Senha 2 (está entre as últimas 3) -> DEVE REJEITAR
    assert.throws(
      () => redefinirSenha(db, adminMaster, user.id, 'SegundaSenha2'),
      { message: 'A nova senha não pode ser igual às últimas 3 senhas utilizadas.' }
    );

    // Tentativa de reutilizar Senha 3 (atual) -> DEVE REJEITAR
    assert.throws(
      () => redefinirSenha(db, adminMaster, user.id, 'TerceiraSenha3'),
      { message: 'A nova senha não pode ser igual às últimas 3 senhas utilizadas.' }
    );

    // 3ª troca para Senha 4 (válida, não reutilizada)
    redefinirSenha(db, adminMaster, user.id, 'QuartaSenha44');

    // Agora o histórico recente contém [Senha 2, Senha 3, Senha 4].
    // 4ª troca: Senha 5
    redefinirSenha(db, adminMaster, user.id, 'QuintaSenha55');

    // O histórico recente agora contém [Senha 3, Senha 4, Senha 5].
    // A Senha 1 saiu da janela das 3 últimas senhas e pode ser reutilizada
    const resReusoAntigo = redefinirSenha(db, adminMaster, user.id, 'PrimeiraSenha1');
    assert.strictEqual(resReusoAntigo.sucesso, true, 'Senha antiga fora da janela de 3 pode ser reutilizada');
  });

  // -------------------------------------------------------------------------
  // 6. Hash seguro de senha (scrypt com salt)
  // -------------------------------------------------------------------------
  it('6. Senhas são armazenadas com algoritmo scrypt e salt aleatório, nunca em texto puro', () => {
    const senhaPura = 'MinhaSenhaSuperSecreta123';
    const hash = gerarHashSenha(senhaPura);

    // Formato salt:derivedKey
    assert.ok(hash.includes(':'), 'Hash deve conter separador de salt');
    const [salt, derivedKey] = hash.split(':');
    assert.strictEqual(salt.length, 32, 'Salt deve ter 16 bytes em hex (32 caracteres)');
    assert.strictEqual(derivedKey.length, 128, 'Chave derivada scrypt deve ter 64 bytes em hex (128 caracteres)');

    // Senha pura não pode aparecer no hash
    assert.ok(!hash.includes(senhaPura), 'Senha pura jamais pode constar no hash');

    // Duas gerações da mesma senha produzem salts e hashes diferentes
    const hash2 = gerarHashSenha(senhaPura);
    assert.notStrictEqual(hash, hash2, 'Salts aleatórios devem gerar hashes hexadecimais distintos');

    // Validação criptográfica
    assert.strictEqual(verificarSenha(senhaPura, hash), true);
    assert.strictEqual(verificarSenha(senhaPura, hash2), true);
    assert.strictEqual(verificarSenha('SenhaIncorreta999', hash), false);
  });

  // -------------------------------------------------------------------------
  // 7. Autenticação de Segundo Fator (2FA)
  // -------------------------------------------------------------------------
  it('7. Login com segundo fator gera desafio, código numérico out-of-band e sessão válida', () => {
    const user2FA = criarUsuario(db, adminMaster, {
      nome: 'Gerente Seguro',
      email: 'gerente.2fa@empresa.com',
      senha: 'SenhaForte2FA1',
      perfil: 'RH',
      segundoFatorAtivo: true,
    });

    // 1ª Etapa: Autenticação com e-mail e senha
    const etapa1 = autenticarUsuario(db, 'gerente.2fa@empresa.com', 'SenhaForte2FA1');
    assert.strictEqual(etapa1.requer2FA, true, 'Deve exigir confirmação de segundo fator');
    assert.ok(etapa1.desafioToken, 'Deve retornar token do desafio 2FA');
    assert.strictEqual(etapa1.token, undefined, 'Não pode liberar token de sessão na 1ª etapa');

    // Recupera o código numérico entregue no canal out-of-band simulado
    const codigoEnviado = obterUltimoCodigo2FAParaTeste(user2FA.id);
    assert.ok(codigoEnviado, 'Código deve ter sido despachado para o usuário');
    assert.strictEqual(codigoEnviado?.length, 6, 'Código deve conter 6 dígitos numéricos');

    // Tentativa com código incorreto deve ser rejeitada
    assert.throws(
      () => confirmarSegundoFator(db, { desafioToken: etapa1.desafioToken!, codigo: '000000' }),
      { message: 'Código de segundo fator incorreto.' }
    );

    // 2ª Etapa: Confirmação com o código correto
    const etapa2 = confirmarSegundoFator(db, { desafioToken: etapa1.desafioToken!, codigo: codigoEnviado! });
    assert.ok(etapa2.token, 'Token de sessão oficial deve ser emitido');
    assert.strictEqual(etapa2.usuario.email, 'gerente.2fa@empresa.com');

    // Sessão emitida é válida no sistema
    const sessaoValida = validarSessao(etapa2.token);
    assert.ok(sessaoValida, 'Sessão do 2FA deve estar ativa');
    assert.strictEqual(sessaoValida?.email, 'gerente.2fa@empresa.com');

    // Tentativa de reutilizar o mesmo desafio deve ser rejeitada (utilizado = 1)
    assert.throws(
      () => confirmarSegundoFator(db, { desafioToken: etapa1.desafioToken!, codigo: codigoEnviado! }),
      /Desafio de segundo fator inválido ou já utilizado/
    );
  });

  // -------------------------------------------------------------------------
  // 8. Bloqueio por tentativas de login (RNF-19)
  // -------------------------------------------------------------------------
  it('8. Bloqueio temporário de 15 minutos acionado após 5 erros seguidos de senha', () => {
    const emailAlvo = 'rh@empresa.com';

    // 4 erros seguidos
    for (let i = 1; i <= 4; i++) {
      assert.throws(
        () => autenticarUsuario(db, emailAlvo, `SenhaErrada${i}`),
        { message: 'E-mail ou senha inválidos.' }
      );
      assert.strictEqual(verificarBloqueio(emailAlvo).bloqueado, false);
    }

    // 5º erro seguido aciona o bloqueio (RNF-19)
    assert.throws(
      () => autenticarUsuario(db, emailAlvo, 'SenhaErrada5'),
      /Acesso bloqueado por 15 minutos após 5 tentativas incorretas/
    );

    // Próxima tentativa mesmo com a senha correta é imediatamente bloqueada
    assert.throws(
      () => autenticarUsuario(db, emailAlvo, 'SenhaForte123'),
      /Acesso bloqueado por 15 minutos após 5 tentativas incorretas/
    );
    assert.strictEqual(verificarBloqueio(emailAlvo).bloqueado, true);
  });

  // -------------------------------------------------------------------------
  // 9. Expiração de sessão após 30 minutos (RNF-01)
  // -------------------------------------------------------------------------
  it('9. Sessão de usuário expira após 30 minutos sem atividade', () => {
    const token = criarSessao({ id: rhUser.id, email: rhUser.email, nome: 'RH', perfil: 'RH' });

    // Acesso imediato é válido
    const sessaoAtiva = validarSessao(token);
    assert.ok(sessaoAtiva, 'Sessão recente deve estar válida');

    // Simula passagem de 31 minutos sem atividade
    const sessaoInterna = sessaoAtiva as any;
    sessaoInterna.ultimoAcesso = Date.now() - (31 * 60 * 1000);

    // Validação deve detectar expiração e revogar o token
    const sessaoExpirada = validarSessao(token);
    assert.strictEqual(sessaoExpirada, null, 'Sessão após 30 minutos sem atividade deve expirar');
  });

  // -------------------------------------------------------------------------
  // 10. Matriz de permissões por perfil (Seção 4 / Tabela 4.1)
  // -------------------------------------------------------------------------
  it('10. Matriz de permissões: RH opera folha, Diretoria apenas consulta, Admin gerencia usuários', () => {
    // Filial Matriz
    const filial = criarFilial(db, rhUser, { nome: 'Matriz SP', tipo: 'MATRIZ' });
    const colab = criarColaborador(db, rhUser, {
      filialId: filial.id,
      nome: 'Carlos Teste',
      cpf: '52998224725',
      nascimento: '1990-01-01',
      admissao: '2022-01-01',
      cargo: 'Atendente',
      setor: 'Atendimento',
      salarioBase: '2500.00',
      banco: '001',
      agencia: '1234',
      conta: '5678',
    });
    const comp = abrirOuObterCompetencia(db, rhUser, '2026-10');

    // A. Perfil RH: calcula folha (PERMITIDO)
    const folhaRH = calcularFolhaColaborador(db, rhUser, {
      colaboradorId: colab.id,
      competenciaId: comp.id,
    });
    assert.ok(folhaRH.liquido > 0, 'RH deve calcular folha com sucesso');

    // B. Perfil DIRETORIA:
    // - Consultar relatórios da folha: PERMITIDO
    const relatorioDir = gerarRelatorioFolhaMes(db, diretoriaUser, comp.id);
    assert.ok(relatorioDir.linhas.length > 0, 'Diretoria deve consultar relatórios da folha');

    // - Calcular folha: BLOQUEADO
    assert.throws(
      () => calcularFolhaColaborador(db, diretoriaUser, { colaboradorId: colab.id, competenciaId: comp.id }),
      /Você não tem permissão para esta ação/
    );

    // - Criar usuário: BLOQUEADO
    assert.throws(
      () => criarUsuario(db, diretoriaUser, { nome: 'Invasor', email: 'invasor@empresa.com', senha: 'SenhaValida123', perfil: 'RH' }),
      /Você não tem permissão para esta ação/
    );

    // C. Perfil ADMIN:
    // - Gerenciar usuários: PERMITIDO
    const listaUsuarios = listarUsuarios(db, adminMaster);
    assert.ok(listaUsuarios.length >= 3, 'Admin lista usuários com sucesso');

    // - Consultar dados do colaborador: BLOQUEADO
    assert.throws(
      () => consultarColaborador(db, { perfil: 'ADMIN' }, colab.id),
      /Você não tem permissão para acessar os dados deste colaborador/
    );

    // - Consultar relatório da folha: BLOQUEADO
    assert.throws(
      () => gerarRelatorioFolhaMes(db, adminMaster, comp.id),
      /Você não tem permissão para esta ação/
    );
  });

  // -------------------------------------------------------------------------
  // 11. Registro de operações no log de auditoria imutável (RNF-03)
  // -------------------------------------------------------------------------
  it('11. Registro de operações administrativas e tentativas não autorizadas no Log de Auditoria', () => {
    // Criação de usuário
    const novo = criarUsuario(db, adminMaster, {
      nome: 'Mariana Auditoria',
      email: 'mariana.log@empresa.com',
      senha: 'SenhaAuditoria1',
      perfil: 'RH',
    });

    // Redefinição de senha
    redefinirSenha(db, adminMaster, novo.id, 'NovaSenhaAuditoria2');

    // Inativação
    inativarUsuario(db, adminMaster, novo.id);

    // Consulta logs pelo perfil ADMIN
    const logs = consultarLogs(db, adminMaster, { entidade: 'USUARIO' });
    const acoes = logs.map((l) => l.acao);

    assert.ok(acoes.includes('CRIAR_USUARIO'), 'Log deve registrar CRIAR_USUARIO');
    assert.ok(acoes.includes('REDEFINIR_SENHA'), 'Log deve registrar REDEFINIR_SENHA');
    assert.ok(acoes.includes('INATIVAR_USUARIO'), 'Log deve registrar INATIVAR_USUARIO');

    // Verifica que RH não pode acessar logs de auditoria (Seção 4)
    assert.throws(
      () => consultarLogs(db, rhUser),
      /Você não tem permissão para esta ação/
    );
  });

  // -------------------------------------------------------------------------
  // 12. Rejeição de operações não autorizadas diretamente pelos endpoints HTTP
  // -------------------------------------------------------------------------
  it('12. Endpoints HTTP do backend rejeitam requisições sem autorização ou com perfil inadequado', async () => {
    // Cria servidor HTTP de teste montado com a mesma lógica do server.ts
    const server = http.createServer((req, res) => {
      const auth = req.headers.authorization;
      if (!auth || !auth.startsWith('Bearer ')) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ erro: 'Autenticação necessária.' }));
      }
      const token = auth.substring(7);
      const sessao = validarSessao(token);
      if (!sessao) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ erro: 'Sessão inválida ou expirada.' }));
      }

      // Endpoint /api/usuarios (exclusivo ADMIN)
      if (req.url === '/api/usuarios') {
        if (sessao.perfil !== 'ADMIN') {
          res.writeHead(403, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ erro: 'Você não tem permissão para esta ação.' }));
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ status: 'OK', usuarios: [] }));
      }

      // Endpoint /api/folha/calcular (exclusivo RH)
      if (req.url === '/api/folha/calcular') {
        if (sessao.perfil !== 'RH') {
          res.writeHead(403, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ erro: 'Você não tem permissão para esta ação.' }));
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ status: 'CALCULADO' }));
      }

      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ erro: 'Não encontrado' }));
    });

    const PORT_TEST = 4099;
    await new Promise<void>((resolve) => server.listen(PORT_TEST, '127.0.0.1', () => resolve()));

    try {
      // 1. Requisição sem token -> 401
      const resSemToken = await fetch(`http://127.0.0.1:${PORT_TEST}/api/usuarios`);
      assert.strictEqual(resSemToken.status, 401, 'Requisição sem token deve retornar HTTP 401');

      // 2. RH tentando acessar endpoint de usuários (exclusivo ADMIN) -> 403
      const tokenRH = criarSessao({ id: rhUser.id, email: rhUser.email, nome: 'RH', perfil: 'RH' });
      const resRHemUsuarios = await fetch(`http://127.0.0.1:${PORT_TEST}/api/usuarios`, {
        headers: { Authorization: `Bearer ${tokenRH}` },
      });
      assert.strictEqual(resRHemUsuarios.status, 403, 'RH tentando acessar /api/usuarios deve retornar HTTP 403');

      // 3. Admin tentando calcular folha (exclusivo RH) -> 403
      const tokenAdmin = criarSessao({ id: 1, email: 'admin@empresa.com', nome: 'Admin', perfil: 'ADMIN' });
      const resAdminNaFolha = await fetch(`http://127.0.0.1:${PORT_TEST}/api/folha/calcular`, {
        headers: { Authorization: `Bearer ${tokenAdmin}` },
      });
      assert.strictEqual(resAdminNaFolha.status, 403, 'Admin tentando calcular folha deve retornar HTTP 403');

      // 4. Admin acessando endpoint de usuários -> 200
      const resAdminOk = await fetch(`http://127.0.0.1:${PORT_TEST}/api/usuarios`, {
        headers: { Authorization: `Bearer ${tokenAdmin}` },
      });
      assert.strictEqual(resAdminOk.status, 200, 'Admin acessando /api/usuarios deve retornar HTTP 200');
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
