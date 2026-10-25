# Back-end – Sistema de RH e Folha de Pagamento

Back-end em **Node.js + TypeScript + SQLite**, feito a partir da *Especificação de Requisitos v1.0* (GTI 4º período).
Cobre a **Etapa 1** (login, perfis, filiais, colaboradores, histórico e logs) e o **motor de cálculo** da folha
(INSS, IRRF, horas extras, DSR, faltas, VT, VA, FGTS e férias).

**Sem framework:** usa só módulos do próprio Node (`http`, `crypto`, `sqlite`, `test`). As únicas dependências são de desenvolvimento (TypeScript, tsx).
**Dinheiro:** JavaScript erra conta com `number` (0.1 + 0.2), então o projeto tem a classe `Dec` (`src/dec.ts`), com contas exatas em BigInt. Nunca use `number` para valores em R$.

## Como rodar
```bash
npm install
npm run init-db
npm run criar-usuario -- --nome "Maria" --email maria@empresa.com --perfil RH --senha minhasenha123
npm run seed-demo            # opcional: filiais e colaboradores de exemplo
npm start                    # http://localhost:5000/api/health
npm test                     # 44 testes
npm run typecheck            # confere os tipos do TypeScript
npm run build && npm run start:prod    # versão compilada
```
**Node 22.5 ou mais novo** usa o SQLite embutido. Em Node 18/20, o `npm install` baixa o `better-sqlite3`, que o projeto usa sozinho.
Variáveis opcionais: `SECRET_KEY` (troque em produção), `DATABASE`, `TOKEN_HORAS`, `CORS_ORIGIN`, `PORT`.

## Perfis (seção 4)
`RH` cadastra e calcula · `DIRETORIA` consulta e vê logs · `ADMIN` gerencia usuários e vê logs.

## Endpoints (`Authorization: Bearer <token>`)
| Método | Rota | Perfis |
|---|---|---|
| POST | `/api/auth/login` | público |
| GET | `/api/auth/me` | logado |
| GET/POST/PATCH | `/api/usuarios` | ADMIN |
| GET | `/api/filiais` | RH, DIRETORIA |
| POST/PUT | `/api/filiais` · `/api/filiais/:id` | RH |
| GET | `/api/colaboradores?busca=&filial_id=&situacao=` | RH, DIRETORIA |
| POST | `/api/colaboradores` | RH |
| GET | `/api/colaboradores/:id` (gera log de consulta) | RH, DIRETORIA |
| PUT | `/api/colaboradores/:id` | RH |
| DELETE | `/api/colaboradores/:id` (**inativa**, não exclui) | RH |
| POST | `/api/colaboradores/:id/reativar` | RH |
| GET | `/api/colaboradores/:id/historico` · `/pendencias` | RH, DIRETORIA |
| GET | `/api/logs?usuario_email=&entidade=&acao=&de=&ate=` | DIRETORIA, ADMIN |
| GET | `/api/parametros?competencia=2026-10` | RH, DIRETORIA |
| POST | `/api/simulacao/folha` · `/api/simulacao/ferias` | RH |
| GET | `/api/health` | público |

## Estrutura
```
src/dec.ts            decimal exato (BigInt)       src/calculo.ts     motor de cálculo (funções puras)
src/parametros.ts     parâmetros 2026 com vigência src/security.ts    senha (scrypt) e token JWT
src/db.ts             banco, transação e log       src/http.ts, app.ts roteador e servidor
src/routes/           auth, cadastro, misc         src/manage.ts      comandos (init-db, criar-usuario, seed-demo)
database/schema.sql   banco completo (17 tabelas)  tests/             exemplos da seção 8 e cenários da seção 10
```

## Regras implementadas
RN-01 (parâmetros com vigência) · RN-02 (memória de cálculo) · RN-03 (arredondamento por verba) ·
RN-05/RN-10 (pendências do colaborador) · RN-07 (histórico) · RN-11 a RN-14 (CPF único e válido,
inativar, dados proibidos) · RN-21 a RN-24 · RN-30 a RN-33 · RN-41 · RN-50/RN-51 · RNF-01 a RNF-03
(senha com hash, sessão com expiração, log imutável por trigger do banco).

## Dúvidas para o GTI 4º período (a spec não define; não inventamos regra)
1. **Faltas e base de INSS/IRRF:** seguimos a spec ao pé da letra (falta é "demais desconto", etapa 6, depois dos impostos). Na prática as faltas costumam reduzir a base. Confirmar.
2. **DSR (RN-31):** a fórmula fala em "total de horas extras"; aplicamos sobre o **valor em R$** das horas extras. Confirmar.
3. **Perda do DSR por falta (RN-33):** sem fórmula na spec, **não implementado**.
4. **Abono pecuniário (RN-43):** a spec não diz se o abono recebe o 1/3. **Não implementado.**
5. **Proporcional de admitidos/desligados (RN-20)** e **afastamentos (RN-34/P-03):** hipóteses, **não implementados**.
6. **Jornada:** aceitamos de 1 a 44 h semanais (a spec só fala em 44).
7. **Parâmetros legais** têm fim em 31/12/2026; sem tabela nova, folha de 2027 dá erro de "sem vigência" (de propósito).
8. **Quem edita parâmetros** não está definido; por ora entram pelo seed/banco.

## Falta fazer (Etapas 2 a 4)
As tabelas já existem em `database/schema.sql`, mas faltam as rotas: lançamento de eventos, folha persistida com
fechamento/reabertura, férias com saldo e alertas, documentos e exames, contracheque e relatórios em PDF/Excel,
cifragem de dados de saúde (RNF-04), backup (RNF-05) e retenção (RN-56).
