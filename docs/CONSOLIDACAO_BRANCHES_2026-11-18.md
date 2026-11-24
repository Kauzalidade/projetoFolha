# Consolidação das branches de desenvolvimento (2026-11-18)

Esta branch foi montada a partir de `main`, preservando os arquivos existentes e incorporando as alterações de três branches independentes de funcionalidades.

## Fontes congeladas
- Base: `main` em `b84143e5c620e9888b43bc819716e83d030a1922` (tree `fc3b73302267e2cc8e7fa843084f8bcbb48cdf20`)
- US-10 (verbas avulsas): `cad15550fcb8f746cf08e9819297a9d1478177a3`
- US-12 (gestão de usuários): `14f4fe6aa5abf378a73ec143c7253cbfc2d123f0`
- US-13 (conferência de totais): `58de7fc84cf781d6a82425ae04a209200472a051`

## Integração
- Os patches de cada branch foram confrontados com o mesmo ancestral `main`; a reconstrução de cada arquivo individual a partir do diff foi conferida contra o blob da branch correspondente.
- Foram conciliadas as alterações simultâneas de `back-end/src/server.ts`, `back-end/src/db.ts` e `back-end/src/services/folhaService.ts`, preservando a lógica de cada US.
- As migrações independentes `usuarios.segundo_fator_ativo` (US-12) e `competencias.justificativa_conferencia` (US-13) foram incluídas.
- Foram mantidos os testes e os diretórios `qa-demo-us10`, `qa-demo-us12` e `qa-demo-us13`, além dos relatórios de evidências.
- O commit de consolidação tem como pais a base e os três HEADs das funcionalidades, para preservar a ancestralidade verificável.

Branches antigas de documentação e testes não foram mescladas indiscriminadamente porque divergem da `main` e/ou porque seus testes/documentação já constam da base atual. A branch `testes/demo-etapa2-v17` tem uma demo isolada adicional não incorporada nesta consolidação de código de produção.

## Limites e pendências
- Esta consolidação valida estrutura, arquivos e patches; não equivale a testes executados do conjunto.
- Em `back-end/`, executar `npm ci`, `npm run typecheck`, `npm test`, `npm run build` e testes da API e da interface.
- Não implantar com dados reais: há credenciais demonstrativas fixas no servidor base, login automatizado de demonstração e entrega de códigos 2FA simulada.
- Atualizar/alinha documentação: o README anuncia v1.7, enquanto `docs/spec.md` ainda se identifica como v1.3; há divergência histórica entre PostgreSQL e SQLite.
- Avaliar o código legado na estrutura aninhada `back-end/back-end/` antes de qualquer remoção.
- Revisar os requisitos legais/tributários com responsáveis competentes antes de uso real.
