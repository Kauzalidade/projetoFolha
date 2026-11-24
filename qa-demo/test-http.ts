import http from 'node:http';
import { criarServidor } from './server.js';

async function testarRotas() {
  const server = criarServidor();
  const PORT = 3001; // Porta de teste para validação automatizada

  await new Promise<void>((resolve) => {
    server.listen(PORT, '127.0.0.1', () => {
      console.log(`[TEST-HTTP] Servidor de teste iniciado em http://127.0.0.1:${PORT}`);
      resolve();
    });
  });

  const rotasParaTestar = [
    { path: '/', expectedStatus: 200, contentType: 'text/html' },
    { path: '/index.html', expectedStatus: 200, contentType: 'text/html' },
    { path: '/style.css', expectedStatus: 200, contentType: 'text/css' },
    { path: '/app.js', expectedStatus: 200, contentType: 'application/javascript' },
    { path: '/api/scenarios/run-all', expectedStatus: 200, contentType: 'application/json' },
    { path: '/api/status', expectedStatus: 200, contentType: 'application/json' },
    { path: '/rota-inexistente-teste', expectedStatus: 404, contentType: 'text/html' },
  ];

  let todosPassaram = true;

  for (const rota of rotasParaTestar) {
    await new Promise<void>((resolve) => {
      http.get(`http://127.0.0.1:${PORT}${rota.path}`, (res) => {
        let body = '';
        res.on('data', (chunk) => { body += chunk; });
        res.on('end', () => {
          const statusOk = res.statusCode === rota.expectedStatus;
          const ct = res.headers['content-type'] || '';
          const ctOk = ct.includes(rota.contentType);

          if (statusOk && ctOk) {
            console.log(`✔ [PASS] ${rota.path} -> Status ${res.statusCode}, Content-Type: ${ct} (${body.length} bytes)`);
          } else {
            console.error(`✖ [FAIL] ${rota.path} -> Esperado ${rota.expectedStatus} / ${rota.contentType}, Obtido: ${res.statusCode} / ${ct}`);
            todosPassaram = false;
          }
          resolve();
        });
      }).on('error', (err) => {
        console.error(`✖ [FAIL] Erro de rede em ${rota.path}:`, err.message);
        todosPassaram = false;
        resolve();
      });
    });
  }

  await new Promise<void>((resolve) => {
    server.close(() => {
      console.log('[TEST-HTTP] Servidor de teste encerrado.');
      resolve();
    });
  });

  if (!todosPassaram) {
    console.error('\nAlgum teste de rota HTTP falhou!');
    process.exit(1);
  } else {
    console.log('\nTODAS AS ROTAS HTTP PASSARAM COM SUCESSO! O ERRO ANTERIOR ("Arquivo não encontrado") FOI COMPLETAMENTE RESOLVIDO.');
  }
}

testarRotas();

