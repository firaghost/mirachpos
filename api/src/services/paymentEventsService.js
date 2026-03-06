const crypto = require('crypto');

const { db } = require('../db');
const { uid } = require('../utils/ids');

const readIdempotencyKey = (req) => {
  const h = req?.headers || {};
  const k =
    (typeof h['idempotency-key'] === 'string' ? h['idempotency-key'] : '') ||
    (typeof h['x-idempotency-key'] === 'string' ? h['x-idempotency-key'] : '');
  return String(k || '').trim() || null;
};

const stableStringify = (value) => {
  if (value == null) return 'null';
  if (typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`;
};

const sha256Hex = (s) => crypto.createHash('sha256').update(String(s || ''), 'utf8').digest('hex');

const computeRequestHash = ({ method, path, body }) => {
  return sha256Hex(`${String(method || '').toUpperCase()}|${String(path || '').trim()}|${stableStringify(body)}`);
};

const parseUniqueViolation = (e) => {
  const msg = String(e?.message || '').toLowerCase();
  const code = String(e?.code || '').toUpperCase();
  const dup = code === 'ER_DUP_ENTRY' || code === 'SQLITE_CONSTRAINT' || msg.includes('duplicate');
  return { duplicate: dup };
};

const throwIdempotencyConflict = () => {
  const err = new Error('idempotency_key_conflict');
  err.code = 'idempotency_key_conflict';
  err.status = 409;
  throw err;
};

const appendPaymentEvent = async ({
  trx,
  tenantId,
  branchId,
  domain,
  paymentRef,
  orderId,
  invoiceId,
  operation,
  eventType,
  fromState,
  toState,
  amount,
  currency,
  paymentMethod,
  gateway,
  providerPaymentId,
  providerEventId,
  idempotencyKey,
  requestHash,
  actorType,
  actorId,
  payload,
  nowIso,
}) => {
  const tid = String(tenantId || '').trim();
  const pref = String(paymentRef || '').trim();
  const op = String(operation || '').trim();
  const et = String(eventType || '').trim();
  if (!tid || !pref || !op || !et) {
    const err = new Error('payment_event_invalid');
    err.code = 'payment_event_invalid';
    throw err;
  }

  const q = trx || db();

  if (idempotencyKey) {
    const key = String(idempotencyKey || '').trim();
    if (key) {
      const existing = await q
        .from('payment_events')
        .where({ tenant_id: tid, operation: op, idempotency_key: key })
        .select(['id', 'request_hash'])
        .orderBy('created_at', 'asc')
        .first();

      if (existing?.id) {
        const prevHash = String(existing.request_hash || '').trim();
        const nextHash = String(requestHash || '').trim();
        if (prevHash && nextHash && prevHash !== nextHash) throwIdempotencyConflict();
        return { ok: true, duplicate: true, row: null };
      }
    }
  }

  if (gateway && providerEventId) {
    const g = String(gateway || '').trim();
    const peid = String(providerEventId || '').trim();
    if (g && peid) {
      const existing = await q
        .from('payment_events')
        .where({ tenant_id: tid, gateway: g, provider_event_id: peid })
        .select(['id'])
        .orderBy('created_at', 'asc')
        .first();
      if (existing?.id) return { ok: true, duplicate: true, row: null };
    }
  }

  const row = {
    id: uid('pev'),
    tenant_id: tid,
    branch_id: branchId ? String(branchId) : null,
    domain: String(domain || 'pos').trim() || 'pos',
    payment_ref: pref,
    order_id: orderId ? String(orderId) : null,
    invoice_id: invoiceId ? String(invoiceId) : null,
    operation: op,
    event_type: et,
    from_state: fromState != null ? String(fromState) : null,
    to_state: toState != null ? String(toState) : null,
    amount: amount != null ? Number(amount) : null,
    currency: currency != null ? String(currency) : null,
    payment_method: paymentMethod != null ? String(paymentMethod) : null,
    gateway: gateway != null ? String(gateway) : null,
    provider_payment_id: providerPaymentId != null ? String(providerPaymentId) : null,
    provider_event_id: providerEventId != null ? String(providerEventId) : null,
    idempotency_key: idempotencyKey != null ? String(idempotencyKey) : null,
    request_hash: requestHash != null ? String(requestHash) : null,
    actor_type: actorType != null ? String(actorType) : null,
    actor_id: actorId != null ? String(actorId) : null,
    payload_json: payload != null ? JSON.stringify(payload) : null,
    created_at: nowIso || new Date().toISOString(),
  };

  try {
    await q.from('payment_events').insert(row);
    return { ok: true, duplicate: false, row };
  } catch (e) {
    const { duplicate } = parseUniqueViolation(e);
    if (!duplicate) throw e;
    return { ok: true, duplicate: true, row: null };
  }
};

const findIdempotentEvent = async ({ tenantId, operation, idempotencyKey, trx }) => {
  const tid = String(tenantId || '').trim();
  const op = String(operation || '').trim();
  const key = String(idempotencyKey || '').trim();
  if (!tid || !op || !key) return null;

  const q = trx || db();
  const row = await q
    .from('payment_events')
    .where({ tenant_id: tid, operation: op, idempotency_key: key })
    .select(['id', 'payment_ref', 'event_type', 'to_state', 'request_hash', 'created_at', 'payload_json'])
    .orderBy('created_at', 'asc')
    .first();

  if (!row) return null;

  return {
    id: row.id,
    paymentRef: row.payment_ref,
    eventType: row.event_type,
    toState: row.to_state,
    requestHash: row.request_hash,
    createdAt: row.created_at,
    payload: (() => {
      try {
        return row.payload_json ? JSON.parse(String(row.payload_json)) : null;
      } catch {
        return null;
      }
    })(),
  };
};

const assertIdempotencyOrThrow = ({ existing, requestHash }) => {
  if (!existing) return;
  const prev = String(existing.requestHash || '').trim();
  const next = String(requestHash || '').trim();
  if (prev && next && prev !== next) {
    const err = new Error('idempotency_key_conflict');
    err.code = 'idempotency_key_conflict';
    err.status = 409;
    throw err;
  }
};

module.exports = {
  readIdempotencyKey,
  computeRequestHash,
  sha256Hex,
  stableStringify,
  appendPaymentEvent,
  findIdempotentEvent,
  assertIdempotencyOrThrow,
};
