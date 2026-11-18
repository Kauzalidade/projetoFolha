/**
 * test-cenarios.ts - Execução em lote dos 12 Cenários da US-13 (CLI Runner).
 */

import { carregarFixtures } from './fixtures.js';
import { executarTodosCenarios } from './server.js';

console.log('================ VALIDAÇÃO DOS 12 CENÁRIOS QA US-13 (SPEC v1.7) ================\n');

const ctx = carregarFixtures();
const resultados = executarTodosCenarios(ctx);

let aprovados = 0;
let reprovados = 0;

for (const r of resultados) {
  const icon = r.classificacao === 'APROVADO' ? '✅' : '❌';
  console.log(`${icon} [${r.classificacao}] Cenário #${r.id}: ${r.nome}`);
  console.log(`   Regra:    ${r.regraReferencia}`);
  console.log(`   Esperado: ${r.comportamentoEsperado}`);
  console.log(`   Obtido:   ${r.comportamentoObtido}\n`);

  if (r.classificacao === 'APROVADO') aprovados++;
  else reprovados++;
}

console.log('================ RESUMO DOS INDICADORES US-13 ================');
console.log(`Total de Cenários Avaliados: ${resultados.length}`);
console.log(`Cenários Aprovados:          ${aprovados}`);
console.log(`Cenários Reprovados:         ${reprovados}`);
console.log(`Status Geral da Validação:   ${reprovados === 0 ? '100% CONFORME / APROVADO' : 'PENDÊNCIAS ENCONTRADAS'}`);

if (reprovados > 0) {
  process.exit(1);
} else {
  process.exit(0);
}
