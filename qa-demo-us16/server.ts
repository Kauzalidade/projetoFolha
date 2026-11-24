import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { CENARIOS_META, CenarioResultado, executarCenario, executarTodosCenarios } from './scenarios.js';

const PORT = Number(process.env.PORT || 3016);
const INDEX_PATH = fs.existsSync(path.resolve(process.cwd(), 'qa-demo-us16', 'index.html'))
  ? path.resolve(process.cwd(), 'qa-demo-us16', 'index.html')
  : path.resolve(process.cwd(), 'index.html');

let ultimoEstado: Record<number, CenarioResultado> = {};

function enviarJson(res: http.ServerResponse, statusCode: number, data: unknown) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify(data));
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url || '/', `http://localhost:${PORT}`);

  if (req.method === 'GET' && url.pathname === '/') {
    const html = fs.readFileSync(INDEX_PATH, 'utf-8');
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/scenarios') {
    enviarJson(res, 200, {
      cenarios: CENARIOS_META,
      resultados: Object.values(ultimoEstado),
    });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/run-all') {
    try {
      const resultados = executarTodosCenarios();
      ultimoEstado = {};
      for (const r of resultados) {
        ultimoEstado[r.id] = r;
      }
      const passaram = resultados.filter((r) => r.status === 'PASSOU').length;
      enviarJson(res, 200, {
        total: resultados.length,
        passaram,
        falharam: resultados.length - passaram,
        resultados,
      });
    } catch (err: any) {
      enviarJson(res, 500, { erro: err.message });
    }
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/reset') {
    ultimoEstado = {};
    enviarJson(res, 200, {
      ok: true,
      mensagem: 'Ambiente demonstrativo restaurado. Banco SQLite isolado pronto para nova execução.',
      cenarios: CENARIOS_META,
    });
    return;
  }

  const matchRun = url.pathname.match(/^\/api\/run\/(\d+)$/);
  if (req.method === 'POST' && matchRun) {
    const id = Number(matchRun[1]);
    try {
      const resultado = executarCenario(id);
      ultimoEstado[resultado.id] = resultado;
      enviarJson(res, 200, resultado);
    } catch (err: any) {
      enviarJson(res, 400, { erro: err.message });
    }
    return;
  }

  enviarJson(res, 404, { erro: 'Rota não encontrada' });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`US-16 QA Demo rodando em http://localhost:${PORT}`);
});
