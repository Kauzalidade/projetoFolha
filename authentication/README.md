# Folha Clara — autenticação

Aplicação de autenticação para o sistema de folha, com front-end acessível, API Node.js e banco SQLite.

## Requisitos

- Node.js 22.5 ou superior (`node:sqlite`).
- Para HTTPS em produção, certificado e chave configurados por variáveis de ambiente.
- Para envio de e-mails em produção, um endpoint de e-mail configurado por `MAIL_API_URL` e `MAIL_API_KEY`.

## Executar localmente

1. Copie `.env.example` para `.env` e ajuste as configurações desejadas.
2. Execute `npm start`.
3. Abra `http://localhost:3000`.

No primeiro início em desenvolvimento, o servidor cria uma conta de demonstração. Se `DEMO_PASSWORD` estiver vazio, ele gera uma senha temporária aleatória e a imprime no terminal. A primeira entrada exige a troca da senha. O código `123456` é aceito como segundo fator somente para essa conta e somente em acesso local, fora de produção. Para outras contas, o servidor valida TOTP.

O SQLite é criado em `data/auth.sqlite`. O diretório e os segredos locais estão ignorados pelo Git.

## E-mail de recuperação

Em desenvolvimento, o link de recuperação é impresso no terminal. Em produção, configure `MAIL_API_URL` para um endpoint que aceite `POST` JSON com `to`, `subject`, `text` e `html`, e `MAIL_API_KEY` para autenticação Bearer. O servidor falha explicitamente se o envio não puder ser feito.

## Produção

Defina `NODE_ENV=production`, `INITIAL_ADMIN_EMAIL`, `INITIAL_ADMIN_PASSWORD`, `INITIAL_ADMIN_TOTP_SECRET`, `APP_ENCRYPTION_KEY`, `MAIL_API_URL`, `MAIL_API_KEY`, `HTTPS_KEY_FILE`, `HTTPS_CERT_FILE` e `PUBLIC_BASE_URL` com valores reais. Não use a conta/código de demonstração em produção. `APP_ENCRYPTION_KEY` deve ser uma chave aleatória de 32 bytes codificada em Base64. Cookies de sessão recebem `Secure` apenas em produção.

## Segurança implementada

- Mensagem genérica para e-mail ou senha inválidos.
- Bloqueio por 5 falhas de login em 15 minutos e limite de 20 tentativas por IP por minuto.
- Segundo fator TOTP obrigatório, desafio de curta duração e bloqueio após falhas repetidas.
- Segredos TOTP cifrados com AES-256-GCM quando `APP_ENCRYPTION_KEY` está configurada; a chave é obrigatória em produção.
- Troca obrigatória de senha no primeiro acesso, política de senha forte e histórico das últimas 3 senhas.
- Links de redefinição de uso único, com expiração em 15 minutos.
- Sessão única por usuário, expiração após 30 minutos sem atividade e logout.
- Registro de eventos de segurança, cabeçalhos de segurança e validação de origem nas operações mutáveis.

Mantenha `APP_ENCRYPTION_KEY` estável e protegida: perder ou trocar a chave impede a leitura dos segredos TOTP já cifrados.

## Observação de escopo

Este diretório implementa o fluxo de autenticação descrito nos critérios fornecidos. Ele não substitui nem duplica os módulos de cálculo, férias, eventos e relatórios do sistema de folha.
