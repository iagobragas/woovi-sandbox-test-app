# Woovi Sandbox Test App

Aplicação mínima para testar a API sandbox da Woovi com:

- criação de cobrança
- simulação de pagamento
- recebimento de webhook
- validação de assinatura `x-webhook-signature`
- deploy local ou na Vercel

## O que este projeto faz

Este app fornece uma interface simples para:

- criar cobranças no ambiente sandbox da Woovi
- simular o pagamento da última cobrança criada
- receber webhooks em `POST /webhooks/woovi`
- listar os últimos eventos recebidos
- filtrar eventos por tipo

## Requisitos

- Node.js 18+
- um `AppID` do ambiente sandbox da Woovi

## Configuração local

1. Copie `.env.example` para `.env`
2. Preencha `WOOVI_APP_ID`
3. Rode:

```bash
npm start
```

A aplicação sobe por padrão em:

```text
http://127.0.0.1:3000
```

## Variáveis de ambiente

- `HOST=127.0.0.1`
- `PORT=3000`
- `WOOVI_APP_ID=SEU_APP_ID_DO_SANDBOX`
- `WOOVI_BASE_URL=https://api.woovi-sandbox.com`
- `DATABASE_URL=` opcional para persistência em Postgres/Neon
- `WEBHOOK_HMAC_SECRET=` opcional
- `WOOVI_WEBHOOK_IP_ALLOWLIST=179.190.27.5,179.190.27.6,186.224.205.214`

## Como obter um AppID

1. Acesse `https://app.woovi-sandbox.com/`
2. Crie ou acesse sua conta de sandbox
3. Vá em `API/Plugins`
4. Crie uma integração do tipo `API`
5. Copie o `AppID`

## Fluxo sugerido de teste

1. Inicie o app
2. Abra a interface local
3. Crie uma cobrança
4. Simule o pagamento
5. Verifique os webhooks recebidos

Se estiver rodando localmente e quiser receber webhooks reais da Woovi, exponha a aplicação com um túnel ou publique em um ambiente acessível pela internet.

## Endpoints

- `GET /` interface web
- `GET /health` status da aplicação
- `POST /api/charge` cria uma cobrança
- `POST /api/charge/simulate-payment` simula o pagamento de uma cobrança de teste
- `POST /webhooks/woovi` recebe eventos de webhook da Woovi
- `GET /api/webhooks` lista os últimos webhooks
- `GET /api/webhooks?event=OPENPIX:CHARGE_COMPLETED` filtra por evento

## Segurança

- a autenticação com a Woovi usa `Authorization: <AppID>`
- `x-webhook-signature` é o mecanismo recomendado para validar a origem do webhook
- allowlist de IP pode ser usada como camada complementar
- `X-OpenPix-Signature` foi mantido como validação HMAC opcional
- não versione `.env`
- não versione `data/webhooks.json`

## Persistência

- se `DATABASE_URL` estiver configurado, os webhooks são persistidos em Postgres
- em execução local, sem banco, os webhooks podem ser persistidos em `data/webhooks.json`
- na Vercel, sem banco, os webhooks recentes ficam em memória da função e não devem ser tratados como armazenamento persistente

## Deploy na Vercel

O projeto já inclui suporte a deploy serverless com:

- `vercel.json`
- `api/index.js`
- `lib/app.js`

Variáveis recomendadas na Vercel:

- `WOOVI_APP_ID`
- `WOOVI_BASE_URL=https://api.woovi-sandbox.com`
- `DATABASE_URL`
- `WEBHOOK_HMAC_SECRET` opcional
- `WOOVI_WEBHOOK_IP_ALLOWLIST`

## Observações

Este projeto foi pensado para desenvolvimento, QA e validação de fluxo de integração com a Woovi sandbox. Se você for usar isso como base para produção, vale adicionar autenticação adicional, observabilidade, persistência real e tratamento mais forte de erros e retries.
