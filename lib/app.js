const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { URL } = require('node:url');

const WOOVI_PUBLIC_KEY_BASE64 =
  'LS0tLS1CRUdJTiBQVUJMSUMgS0VZLS0tLS0KTUlHZk1BMEdDU3FHU0liM0RRRUJBUVVBQTRHTkFEQ0JpUUtCZ1FDLytOdElranpldnZxRCtJM01NdjNiTFhEdApwdnhCalk0QnNSclNkY2EzcnRBd01jUllZdnhTbmQ3amFnVkxwY3RNaU94UU84aWVVQ0tMU1dIcHNNQWpPL3paCldNS2Jxb0c4TU5waS91M2ZwNnp6MG1jSENPU3FZc1BVVUcxOWJ1VzhiaXM1WloySVpnQk9iV1NwVHZKMGNuajYKSEtCQUE4MkpsbitsR3dTMU13SURBUUFCCi0tLS0tRU5EIFBVQkxJQyBLRVktLS0tLQo=';
const WOOVI_PUBLIC_KEY = Buffer.from(WOOVI_PUBLIC_KEY_BASE64, 'base64').toString('ascii');

function createApp({ baseDir }) {
  const env = loadEnv(path.join(baseDir, '.env'));
  const config = {
    WOOVI_APP_ID: env.WOOVI_APP_ID || '',
    WOOVI_BASE_URL: env.WOOVI_BASE_URL || 'https://api.woovi-sandbox.com',
    WEBHOOK_HMAC_SECRET: env.WEBHOOK_HMAC_SECRET || '',
    WOOVI_WEBHOOK_IP_ALLOWLIST: parseIpAllowlist(env.WOOVI_WEBHOOK_IP_ALLOWLIST || ''),
    WEBHOOKS_FILE: path.join(baseDir, 'data', 'webhooks.json'),
    persistToDisk: !process.env.VERCEL,
  };

  const recentWebhooks = loadStoredWebhooks(config);

  return {
    handleNodeRequest: (req, res) => handleRequest({
      method: req.method,
      url: req.url,
      headers: req.headers,
      readBody: () => readRawBody(req),
      sendJson: (statusCode, body) => {
        res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify(body, null, 2));
      },
      sendHtml: (html) => {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(html);
      },
      recentWebhooks,
      config,
      baseDir,
    }),
    handleVercelRequest: (req, res) => handleRequest({
      method: req.method,
      url: req.url,
      headers: req.headers,
      readBody: () => readVercelBody(req),
      sendJson: (statusCode, body) => res.status(statusCode).json(body),
      sendHtml: (html) => res.status(200).setHeader('Content-Type', 'text/html; charset=utf-8').send(html),
      recentWebhooks,
      config,
      baseDir,
    }),
  };
}

async function handleRequest(context) {
  const requestUrl = new URL(context.url, 'http://localhost');

  if (context.method === 'GET' && requestUrl.pathname === '/') {
    const html = fs.readFileSync(path.join(context.baseDir, 'index.html'), 'utf8');
    return context.sendHtml(html);
  }

  if (context.method === 'GET' && requestUrl.pathname === '/health') {
    return context.sendJson(200, {
      ok: true,
      baseUrl: context.config.WOOVI_BASE_URL,
      webhookHmacConfigured: Boolean(context.config.WEBHOOK_HMAC_SECRET),
      recentWebhooks: context.recentWebhooks.length,
      persistence: context.config.persistToDisk ? 'disk' : 'memory',
    });
  }

  if (context.method === 'GET' && requestUrl.pathname === '/api/webhooks') {
    const event = requestUrl.searchParams.get('event');
    const webhooks = event
      ? context.recentWebhooks.filter((item) => item.event === event)
      : context.recentWebhooks;

    return context.sendJson(200, { webhooks });
  }

  if (context.method === 'POST' && requestUrl.pathname === '/api/charge') {
    return handleCreateCharge(context);
  }

  if (context.method === 'POST' && requestUrl.pathname === '/api/charge/simulate-payment') {
    return handleSimulateChargePayment(context);
  }

  if (context.method === 'POST' && requestUrl.pathname === '/webhooks/woovi') {
    return handleWooviWebhook(context);
  }

  return context.sendJson(404, { error: 'Not found' });
}

async function handleCreateCharge(context) {
  if (!context.config.WOOVI_APP_ID) {
    return context.sendJson(500, {
      error: 'WOOVI_APP_ID nao configurado',
      hint: 'Copie .env.example para .env e preencha o AppID do sandbox',
    });
  }

  try {
    const body = await readJsonBody(context);
    const correlationID = body.correlationID || crypto.randomUUID();
    const value = parseAmountToCents(body.value);

    if (!Number.isInteger(value) || value <= 0) {
      return context.sendJson(400, {
        error: 'value deve ser um valor monetario valido maior que zero',
      });
    }

    const payload = {
      correlationID,
      value,
      comment: body.comment || 'Cobranca de teste via sandbox-test-app',
    };

    if (body.customer && typeof body.customer === 'object') {
      payload.customer = body.customer;
    }

    const response = await fetch(`${context.config.WOOVI_BASE_URL}/api/v1/charge`, {
      method: 'POST',
      headers: {
        Authorization: context.config.WOOVI_APP_ID,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(payload),
    });

    const text = await response.text();
    const data = tryParseJson(text);

    if (!response.ok) {
      return context.sendJson(response.status, {
        error: 'Falha ao criar cobranca na Woovi',
        wooviResponse: data || text,
      });
    }

    return context.sendJson(200, {
      charge: data.charge,
      correlationID: data.correlationID,
      brCode: data.brCode,
    });
  } catch (error) {
    return context.sendJson(500, {
      error: 'Erro interno ao criar cobranca',
      details: error.message,
    });
  }
}

async function handleSimulateChargePayment(context) {
  if (!context.config.WOOVI_APP_ID) {
    return context.sendJson(500, {
      error: 'WOOVI_APP_ID nao configurado',
    });
  }

  try {
    const body = await readJsonBody(context);
    const transactionID = body.transactionID || body.identifier;

    if (!transactionID) {
      return context.sendJson(400, {
        error: 'transactionID ou identifier e obrigatorio',
      });
    }

    const testingUrl = `${context.config.WOOVI_BASE_URL}/openpix/testing?transactionID=${encodeURIComponent(transactionID)}`;

    const response = await fetch(testingUrl, {
      method: 'GET',
      headers: {
        Authorization: context.config.WOOVI_APP_ID,
        Accept: 'application/json',
      },
    });

    const text = await response.text();
    const data = tryParseJson(text);

    if (!response.ok) {
      return context.sendJson(response.status, {
        error: 'Falha ao simular pagamento',
        wooviResponse: data || text,
      });
    }

    return context.sendJson(200, {
      ok: true,
      transactionID,
      wooviResponse: data || text,
    });
  } catch (error) {
    return context.sendJson(500, {
      error: 'Erro interno ao simular pagamento',
      details: error.message,
    });
  }
}

async function handleWooviWebhook(context) {
  try {
    const rawBody = await context.readBody();
    const signature = context.headers['x-webhook-signature'];
    const hmacSignature = context.headers['x-openpix-signature'];
    const payload = tryParseJson(rawBody);
    const sourceIp = extractSourceIp(context.headers);

    const signatureValid = typeof signature === 'string'
      ? verifyWooviSignature(rawBody, signature)
      : false;

    const hmacValid = context.config.WEBHOOK_HMAC_SECRET && typeof hmacSignature === 'string'
      ? verifyHmac(rawBody, hmacSignature, context.config.WEBHOOK_HMAC_SECRET)
      : null;

    const ipAllowed = isIpAllowed(sourceIp, context.config.WOOVI_WEBHOOK_IP_ALLOWLIST);

    if (!signatureValid) {
      return context.sendJson(401, {
        error: 'Invalid webhook signature',
      });
    }

    if (!ipAllowed) {
      return context.sendJson(403, {
        error: 'IP not allowed',
        sourceIp,
      });
    }

    const entry = {
      receivedAt: new Date().toISOString(),
      event: payload && payload.event ? payload.event : 'unknown',
      sourceIp,
      ipAllowed,
      signatureValid,
      hmacValid,
      headers: {
        'x-webhook-signature': signature || null,
        'x-openpix-signature': hmacSignature || null,
      },
      payload,
    };

    context.recentWebhooks.unshift(entry);
    context.recentWebhooks.splice(20);
    persistWebhooks(context.config, context.recentWebhooks);

    console.log('Webhook received:', JSON.stringify(entry, null, 2));

    return context.sendJson(200, {
      ok: true,
      signatureValid,
      hmacValid,
    });
  } catch (error) {
    return context.sendJson(500, {
      error: 'Erro ao processar webhook',
      details: error.message,
    });
  }
}

function verifyWooviSignature(payload, signature) {
  const verifier = crypto.createVerify('sha256');
  verifier.write(Buffer.from(payload));
  verifier.end();
  return verifier.verify(WOOVI_PUBLIC_KEY, signature, 'base64');
}

function verifyHmac(payload, signature, secret) {
  const digest = crypto.createHmac('sha1', secret).update(payload).digest('base64');
  const expected = Buffer.from(digest);
  const received = Buffer.from(signature);
  if (expected.length !== received.length) {
    return false;
  }
  return crypto.timingSafeEqual(expected, received);
}

async function readJsonBody(context) {
  const rawBody = await context.readBody();
  const json = tryParseJson(rawBody);

  if (!json) {
    throw new Error('JSON invalido');
  }

  return json;
}

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';

    req.on('data', (chunk) => {
      data += chunk;
    });

    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

async function readVercelBody(req) {
  if (typeof req.body === 'string') {
    return req.body;
  }

  if (req.body && typeof req.body === 'object') {
    return JSON.stringify(req.body);
  }

  return '';
}

function tryParseJson(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function loadEnv(filePath) {
  const loaded = {};

  if (fs.existsSync(filePath)) {
    const lines = fs.readFileSync(filePath, 'utf8').split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) {
        continue;
      }

      const separatorIndex = trimmed.indexOf('=');
      if (separatorIndex === -1) {
        continue;
      }

      const key = trimmed.slice(0, separatorIndex).trim();
      const value = trimmed.slice(separatorIndex + 1).trim();
      loaded[key] = value;
    }
  }

  return {
    ...loaded,
    ...process.env,
  };
}

function parseAmountToCents(input) {
  if (typeof input === 'number' && Number.isFinite(input)) {
    return Number.isInteger(input) ? input : Math.round(input * 100);
  }

  if (typeof input !== 'string') {
    return NaN;
  }

  const normalized = input
    .trim()
    .replace(/^R\$\s*/i, '')
    .replace(/\./g, '')
    .replace(',', '.');

  if (!normalized) {
    return NaN;
  }

  const parsed = Number(normalized);

  if (!Number.isFinite(parsed)) {
    return NaN;
  }

  return Math.round(parsed * 100);
}

function parseIpAllowlist(value) {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function extractSourceIp(headers) {
  const forwardedFor = headers['x-forwarded-for'];
  if (typeof forwardedFor === 'string' && forwardedFor.trim()) {
    return forwardedFor.split(',')[0].trim();
  }

  const realIp = headers['x-real-ip'];
  if (typeof realIp === 'string' && realIp.trim()) {
    return realIp.trim();
  }

  return null;
}

function isIpAllowed(sourceIp, allowlist) {
  if (!allowlist.length) {
    return true;
  }

  if (!sourceIp) {
    return false;
  }

  return allowlist.includes(sourceIp);
}

function loadStoredWebhooks(config) {
  if (!config.persistToDisk) {
    return [];
  }

  ensureDataDir(config);

  if (!fs.existsSync(config.WEBHOOKS_FILE)) {
    return [];
  }

  try {
    const content = fs.readFileSync(config.WEBHOOKS_FILE, 'utf8');
    const parsed = JSON.parse(content);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function persistWebhooks(config, webhooks) {
  if (!config.persistToDisk) {
    return;
  }

  ensureDataDir(config);
  fs.writeFileSync(config.WEBHOOKS_FILE, JSON.stringify(webhooks, null, 2));
}

function ensureDataDir(config) {
  fs.mkdirSync(path.dirname(config.WEBHOOKS_FILE), { recursive: true });
}

module.exports = {
  createApp,
};
