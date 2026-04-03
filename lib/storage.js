const { neon } = require('@neondatabase/serverless');

let initPromise = null;
let sqlClient = null;

function getSql(config) {
  if (!sqlClient) {
    sqlClient = neon(config.DATABASE_URL);
  }

  return sqlClient;
}

function hasDatabase(config) {
  return Boolean(config.DATABASE_URL);
}

function getPersistenceMode(config) {
  if (hasDatabase(config)) {
    return 'postgres';
  }

  if (config.persistToDisk) {
    return 'disk';
  }

  return 'memory';
}

async function ensureSchema(config) {
  if (!hasDatabase(config)) {
    return;
  }

  if (!initPromise) {
    const sql = getSql(config);
    initPromise = (async () => {
      await sql`
        CREATE TABLE IF NOT EXISTS webhook_events (
          id BIGSERIAL PRIMARY KEY,
          event TEXT NOT NULL,
          received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          source_ip TEXT,
          signature_valid BOOLEAN NOT NULL,
          ip_allowed BOOLEAN NOT NULL,
          correlation_id TEXT,
          transaction_id TEXT,
          charge_status TEXT,
          payload JSONB NOT NULL,
          headers JSONB
        )
      `;

      await sql`
        CREATE INDEX IF NOT EXISTS webhook_events_event_idx
          ON webhook_events (event, received_at DESC)
      `;

      await sql`
        CREATE INDEX IF NOT EXISTS webhook_events_correlation_idx
          ON webhook_events (correlation_id)
      `;

      await sql`
        CREATE INDEX IF NOT EXISTS webhook_events_transaction_idx
          ON webhook_events (transaction_id)
      `;
    })();
  }

  await initPromise;
}

async function insertWebhookEvent(config, entry) {
  if (!hasDatabase(config)) {
    return;
  }

  await ensureSchema(config);

  const sql = getSql(config);
  const correlationId = entry.payload?.charge?.correlationID || entry.payload?.pix?.charge?.correlationID || null;
  const transactionId = entry.payload?.charge?.transactionID || entry.payload?.pix?.transactionID || null;
  const chargeStatus = entry.payload?.charge?.status || null;

  await sql`
    INSERT INTO webhook_events (
      event,
      received_at,
      source_ip,
      signature_valid,
      ip_allowed,
      correlation_id,
      transaction_id,
      charge_status,
      payload,
      headers
    ) VALUES (
      ${entry.event},
      ${entry.receivedAt},
      ${entry.sourceIp},
      ${entry.signatureValid},
      ${entry.ipAllowed},
      ${correlationId},
      ${transactionId},
      ${chargeStatus},
      ${JSON.stringify(entry.payload)},
      ${JSON.stringify(entry.headers)}
    )
  `;
}

async function listWebhookEvents(config, event) {
  if (!hasDatabase(config)) {
    return null;
  }

  await ensureSchema(config);

  const sql = getSql(config);
  const rows = event
    ? await sql`
        SELECT
          event,
          received_at,
          source_ip,
          signature_valid,
          ip_allowed,
          payload,
          headers
        FROM webhook_events
        WHERE event = ${event}
        ORDER BY received_at DESC
        LIMIT 20
      `
    : await sql`
        SELECT
          event,
          received_at,
          source_ip,
          signature_valid,
          ip_allowed,
          payload,
          headers
        FROM webhook_events
        ORDER BY received_at DESC
        LIMIT 20
      `;

  return rows.map((row) => ({
    receivedAt: row.received_at instanceof Date ? row.received_at.toISOString() : row.received_at,
    event: row.event,
    sourceIp: row.source_ip,
    ipAllowed: row.ip_allowed,
    signatureValid: row.signature_valid,
    hmacValid: null,
    headers: parseJsonValue(row.headers),
    payload: parseJsonValue(row.payload),
  }));
}

function parseJsonValue(value) {
  if (value === null || value === undefined) {
    return value;
  }

  if (typeof value === 'string') {
    try {
      return JSON.parse(value);
    } catch (_error) {
      return value;
    }
  }

  return value;
}

module.exports = {
  getPersistenceMode,
  hasDatabase,
  insertWebhookEvent,
  listWebhookEvents,
};
