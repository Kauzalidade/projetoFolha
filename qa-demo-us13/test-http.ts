/**
 * test-http.ts - Testes automatizados dos endpoints HTTP do servidor QA Demo US-13.
 */

import http from 'node:http';
import assert from 'node:assert';
import { criarServidorDemo } from './server.js';

const PORT = 3020;
const BASE_URL = `http://127.0.0.1:${PORT}`;

function makeRequest(path: string, options: http.RequestOptions = {}, postData?: any): Promise<{ statusCode: number; headers: http.IncomingHttpHeaders; body: string; json?: any }> {
  return new Promise((resolve, reject) => {
    const req = http.request(`${BASE_URL}${path}`, options, (res) => {
      let body = '';
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () => {
        let json;
        if (res.headers['content-type']?.includes('application/json')) {
          try {
            json = JSON.parse(body);
          } catch {}
        }
        resolve({
          statusCode: res.statusCode || 0,
          headers: res.headers,
          body,
          json,
        });
      });
    });

    req.on('error', reject);

    if (postData) {
      req.write(typeof postData === 'string' ? postData : JSON.stringify(postData));
    }
    req.end();
  });
}

async function runHttpTests() {
  const server = criarServidorDemo(PORT);
  await new Promise<void>((resolve) => server.listen(PORT, '127.0.0.1', () => resolve()));
  console.log(`[TEST-HTTP] Servidor de demonstração QA US-13 iniciado em ${BASE_URL}`);

  try {
    // 1. GET /
    const rRoot = await makeRequest('/');
    assert.strictEqual(rRoot.statusCode, 200);
    assert.ok(rRoot.headers['content-type']?.includes('text/html'));
    assert.ok(rRoot.body.includes('US-13'));
    console.log('✔ [PASS] GET / -> 200 OK (HTML do portal)');

    // 2. GET /style.css
    const rCss = await makeRequest('/style.css');
    assert.strictEqual(rCss.statusCode, 200);
    assert.ok(rCss.headers['content-type']?.includes('text/css'));
    console.log('✔ [PASS] GET /style.css -> 200 OK (CSS)');

    // 3. GET /app.js
    const rJs = await makeRequest('/app.js');
    assert.strictEqual(rJs.statusCode, 200);
    assert.ok(rJs.headers['content-type']?.includes('application/javascript'));
    console.log('✔ [PASS] GET /app.js -> 200 OK (JavaScript)');

    // 4. GET /api/status
    const rStatus = await makeRequest('/api/status');
    assert.strictEqual(rStatus.statusCode, 200);
    assert.strictEqual(rStatus.json?.totalCenarios, 12);
    assert.strictEqual(rStatus.json?.aprovados, 12);
    assert.strictEqual(rStatus.json?.reprovados, 0);
    assert.strictEqual(rStatus.json?.taxaAprovacao, 100);
    console.log('✔ [PASS] GET /api/status -> 200 OK (Métricas 100% aprovado)');

    // 5. GET /api/scenarios/run-all
    const rAll = await makeRequest('/api/scenarios/run-all');
    assert.strictEqual(rAll.statusCode, 200);
    assert.ok(Array.isArray(rAll.json));
    assert.strictEqual(rAll.json.length, 12);
    console.log('✔ [PASS] GET /api/scenarios/run-all -> 200 OK (12 cenários)');

    // 6. POST /api/scenarios/1/run
    const rCen1 = await makeRequest('/api/scenarios/1/run', { method: 'POST' });
    assert.strictEqual(rCen1.statusCode, 200);
    assert.strictEqual(rCen1.json?.id, 1);
    assert.strictEqual(rCen1.json?.classificacao, 'APROVADO');
    console.log('✔ [PASS] POST /api/scenarios/1/run -> 200 OK');

    // 7. GET /api/conferencia/detalhes
    const rConf = await makeRequest('/api/conferencia/detalhes');
    assert.strictEqual(rConf.statusCode, 200);
    assert.strictEqual(rConf.json?.conferencia?.statusGeral, 'APROVADO');
    assert.ok(Array.isArray(rConf.json?.conferencia?.itens));
    console.log('✔ [PASS] GET /api/conferencia/detalhes -> 200 OK');

    // 8. POST /api/conferencia/simular-divergencia
    const rSim = await makeRequest('/api/conferencia/simular-divergencia', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    }, { tipo: 'LIQUIDO' });
    assert.strictEqual(rSim.statusCode, 200);
    assert.strictEqual(rSim.json?.statusGeral, 'DIVERGENTE');
    console.log('✔ [PASS] POST /api/conferencia/simular-divergencia -> 200 OK (Divergência detectada)');

    // 9. POST /api/conferencia/restaurar
    const rRest = await makeRequest('/api/conferencia/restaurar', { method: 'POST' });
    assert.strictEqual(rRest.statusCode, 200);
    assert.strictEqual(rRest.json?.statusGeral, 'APROVADO');
    console.log('✔ [PASS] POST /api/conferencia/restaurar -> 200 OK (Restaurado com sucesso)');

    // 10. POST /api/conferencia/confirmar (sem justificativa pelo mesmo usuário -> 400)
    const rConfSemJust = await makeRequest('/api/conferencia/confirmar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    }, { mesmoUsuario: true, justificativa: '' });
    assert.strictEqual(rConfSemJust.statusCode, 400);
    assert.ok(rConfSemJust.json?.erro?.includes('Conferência realizada pelo mesmo usuário que calculou'));
    console.log('✔ [PASS] POST /api/conferencia/confirmar (bloqueio sem justificativa) -> 400 OK');

    // 11. POST /api/conferencia/confirmar (com justificativa pelo mesmo usuário -> 200)
    const rConfComJust = await makeRequest('/api/conferencia/confirmar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    }, { mesmoUsuario: true, justificativa: 'Fechamento emergencial homologado pela Diretoria' });
    assert.strictEqual(rConfComJust.statusCode, 200);
    assert.strictEqual(rConfComJust.json?.status, 'CONFERENCIA_CONFIRMADA');
    assert.strictEqual(rConfComJust.json?.notificouDiretoria, true);
    console.log('✔ [PASS] POST /api/conferencia/confirmar (com justificativa) -> 200 OK');

    // 12. GET /api/alertas
    const rAlertas = await makeRequest('/api/alertas');
    assert.strictEqual(rAlertas.statusCode, 200);
    assert.ok(Array.isArray(rAlertas.json));
    console.log('✔ [PASS] GET /api/alertas -> 200 OK (Central de Alertas)');

    // 13. GET /api/logs
    const rLogs = await makeRequest('/api/logs');
    assert.strictEqual(rLogs.statusCode, 200);
    assert.ok(Array.isArray(rLogs.json));
    console.log('✔ [PASS] GET /api/logs -> 200 OK (Logs de auditoria)');

    // 14. 404 rota inexistente
    const r404 = await makeRequest('/rota-inexistente-teste');
    assert.strictEqual(r404.statusCode, 404);
    console.log('✔ [PASS] GET /rota-inexistente-teste -> 404 OK');

    console.log('\nTODOS OS TESTES HTTP DA QA DEMO US-13 FORAM APROVADOS COM 100% DE SUCESSO!');
  } finally {
    server.close();
  }
}

runHttpTests().catch((e) => {
  console.error('[ERRO NO TESTE HTTP]:', e);
  process.exit(1);
});
