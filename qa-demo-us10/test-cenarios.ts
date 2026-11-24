import { executarTodosCenarios } from './server.js';
import { carregarFixtures } from './fixtures.js';

const ctx = carregarFixtures();
const resultados = executarTodosCenarios(ctx);

console.log('\n================ VALIDAÇÃO DOS 10 CENÁRIOS QA US-10 (SPEC v1.7) ================');
resultados.forEach((r) => {
  const badge = r.classificacao === 'APROVADO' ? '✅ [APROVADO]' : '❌ [REPROVADO]';
  console.log(`\n${badge} Cenário #${r.id}: ${r.nome}`);
  console.log(`   Regra:    ${r.regraReferencia}`);
  console.log(`   Esperado: ${r.comportamentoEsperado}`);
  console.log(`   Obtido:   ${r.comportamentoObtido}`);
});

const total = resultados.length;
const aprovados = resultados.filter((r) => r.classificacao === 'APROVADO').length;
const reprovados = resultados.filter((r) => r.classificacao === 'REPROVADO').length;

console.log('\n================ RESUMO DOS INDICADORES US-10 ================');
console.log(`Total de Cenários Avaliados: ${total}`);
console.log(`Cenários Aprovados:          ${aprovados}`);
console.log(`Cenários Reprovados:         ${reprovados}`);
console.log(`Status Geral da Validação:   ${aprovados === total ? '100% CONFORME / APROVADO' : 'PENDENTE'}\n`);

if (reprovados > 0) {
  process.exit(1);
}
