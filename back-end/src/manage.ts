/**
 * manage.ts - Comandos CLI do sistema de RH e Folha de Pagamento.
 * Uso:
 *   npx tsx src/manage.ts init-db
 *   npx tsx src/manage.ts criar-usuario --nome "Maria" --email maria@empresa.com --perfil RH --senha "SenhaForte123"
 *   npx tsx src/manage.ts seed-demo
 */

import { inicializarBanco } from './db.js';
import { criarUsuario } from './services/usuarioService.js';
import { criarFilial } from './services/filialService.js';
import { criarColaborador } from './services/colaboradorService.js';
import { inicializarFeriadosEParametros } from './services/parametroFeriadoService.js';

function parseArgs(args: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--')) {
      const key = args[i].substring(2);
      const val = args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : 'true';
      result[key] = val;
    }
  }
  return result;
}

function main() {
  const args = process.argv.slice(2);
  const comando = args[0];

  if (!comando) {
    console.log('Comandos disponíveis: init-db, criar-usuario, seed-demo');
    process.exit(1);
  }

  const db = inicializarBanco();

  if (comando === 'init-db') {
    inicializarFeriadosEParametros(db);
    console.log('Banco de dados inicializado com sucesso (Tabelas criadas, feriados e parâmetros de 2026 carregados).');
  } else if (comando === 'criar-usuario') {
    const params = parseArgs(args.slice(1));
    if (!params.nome || !params.email || !params.senha || !params.perfil) {
      console.error('Uso: npx tsx src/manage.ts criar-usuario --nome "Nome" --email "email@empresa.com" --perfil "RH|DIRETORIA|ADMIN" --senha "Senha123"');
      process.exit(1);
    }
    const adminFake = { id: 0, email: 'sistema@sistema.local', perfil: 'ADMIN' };
    const usuario = criarUsuario(db, adminFake, {
      nome: params.nome,
      email: params.email,
      senha: params.senha,
      perfil: params.perfil as any,
    });
    console.log(`Usuário ${usuario.email} (${usuario.perfil}) criado com sucesso!`);
  } else if (comando === 'seed-demo') {
    inicializarFeriadosEParametros(db);
    const rh = { id: 1, email: 'rh@empresa.com', perfil: 'RH' };

    // Cria Matriz e 2 Filiais (Seção 1.4)
    const matriz = criarFilial(db, rh, { nome: 'Matriz - São Paulo', tipo: 'MATRIZ' });
    const filial1 = criarFilial(db, rh, { nome: 'Filial 1 - Campinas', tipo: 'FILIAL' });
    const filial2 = criarFilial(db, rh, { nome: 'Filial 2 - Santos', tipo: 'FILIAL' });

    console.log('Filiais cadastradas:');
    console.log(`- ${matriz.nome} (${matriz.tipo})`);
    console.log(`- ${filial1.nome} (${filial1.tipo})`);
    console.log(`- ${filial2.nome} (${filial2.tipo})`);

    // Cadastro de colaborador de exemplo da Seção 11 (Ana Souza)
    const colabAna = criarColaborador(db, rh, {
      filialId: matriz.id,
      nome: 'Ana Souza',
      cpf: '52998224725', // CPF válido para demonstração
      nascimento: '1995-04-10',
      admissao: '2023-03-10',
      cargo: 'Atendente',
      setor: 'Atendimento',
      salarioBase: '2200.00',
      banco: '001',
      agencia: '1234',
      conta: '56789',
    });
    console.log(`Colaborador demo cadastrado: ${colabAna.nome} (CPF: ${colabAna.cpf})`);
    console.log('Seed demo concluído com sucesso!');
  } else {
    console.error(`Comando desconhecido: "${comando}"`);
    process.exit(1);
  }
}

main();
