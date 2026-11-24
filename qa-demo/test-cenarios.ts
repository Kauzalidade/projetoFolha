import { executarTodosCenarios, LACUNAS_US02 } from './server.js';
import { carregarFixtures } from './fixtures.js';

const ctx = carregarFixtures();
const resultados = executarTodosCenarios(ctx);

console.log('\n================ VALIDAÇÃO DOS 8 CENÁRIOS QA (SPEC v1.7) ================');
resultados.forEach((r) => {
  const badge = r.classificacao === 'APROVADO' ? '✅ [APROVADO]' : '❌ [REPROVADO]';
  console.log(`\n${badge} Cenário ${r.id}: ${r.nome}`);
  console.log(`   Regra: ${r.regraReferencia}`);
  console.log(`   Esperado: ${r.comportamentoEsperado}`);
  console.log(`   Obtido:   ${r.comportamentoObtido}`);
});

console.log('\n================ RESUMO DOS INDICADORES ================');
console.log(`Total de Cenários: ${resultados.length}`);
console.log(`Aprovados: ${resultados.filter((r) => r.classificacao === 'APROVADO').length}`);
console.log(`Reprovados: ${resultados.filter((r) => r.classificacao === 'REPROVADO').length}`);

console.log('\n================ LACUNAS DA US-02 NÃO CONTEMPLADAS NOS 8 CENÁRIOS ================');
LACUNAS_US02.forEach((lac) => {
  console.log(`\n🔸 [${lac.id}] ${lac.titulo} (${lac.regra}) — ${lac.status}`);
  console.log(`   Diagnóstico: ${lac.diagnosticoReal}`);
  console.log(`   Impacto: ${lac.impactoFolha}`);
});
