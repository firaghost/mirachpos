const express = require('express');
const net = require('net');

const { tenantMiddleware } = require('../middleware/tenant');
const { requireAuth } = require('../middleware/auth');
const { db } = require('../db');

const safeJsonParse = (raw, fallback) => {
  try {
    if (!raw) return fallback;
    const parsed = JSON.parse(String(raw));
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
};

const resolveBranchId = (req) => {
  const role = String(req.auth?.role || '');
  const fromToken = String(req.auth?.branchId || '');
  const q = typeof req.query?.branchId === 'string' ? req.query.branchId.trim() : '';

  if (role === 'Cafe Owner' && (!fromToken || fromToken === 'global')) {
    return q || '';
  }
  return fromToken;
};

const requireManagerOrOwner = (req, res) => {
  if (req.auth?.tenantId !== req.tenant.id) {
    res.status(403).json({ error: 'forbidden' });
    return false;
  }
  const role = String(req.auth?.role || '');
  if (role !== 'Branch Manager' && role !== 'Cafe Owner') {
    res.status(403).json({ error: 'forbidden' });
    return false;
  }
  return true;
};

const loadBranchSettings = async ({ tenantId, branchId }) => {
  const row = await db().select(['settings_json']).from('manager_settings').where({ tenant_id: tenantId, branch_id: branchId }).first();
  const parsed = safeJsonParse(row?.settings_json, {});
  return parsed && typeof parsed === 'object' ? parsed : {};
};

const escInit = Buffer.from([0x1b, 0x40]);
const escAlignCenter = Buffer.from([0x1b, 0x61, 0x01]);
const escAlignLeft = Buffer.from([0x1b, 0x61, 0x00]);
const escBoldOn = Buffer.from([0x1b, 0x45, 0x01]);
const escBoldOff = Buffer.from([0x1b, 0x45, 0x00]);
const escCut = Buffer.from([0x1d, 0x56, 0x00]);

const txt = (s) => Buffer.from(String(s ?? ''), 'utf8');
const nl = () => Buffer.from('\n', 'utf8');

const sendTcp = async ({ host, port, data, timeoutMs }) => {
  const p = Number(port);
  if (!host || !Number.isFinite(p) || p <= 0 || p > 65535) throw new Error('invalid_printer_address');

  return await new Promise((resolve, reject) => {
    const sock = new net.Socket();
    let done = false;

    const finish = (err) => {
      if (done) return;
      done = true;
      try {
        sock.destroy();
      } catch {
        // ignore
      }
      if (err) reject(err);
      else resolve();
    };

    const t = setTimeout(() => finish(new Error('printer_timeout')), Math.max(500, Number(timeoutMs) || 5000));

    sock.once('error', (e) => {
      clearTimeout(t);
      finish(e);
    });

    sock.connect(p, host, () => {
      sock.write(data, (e) => {
        clearTimeout(t);
        if (e) return finish(e);
        try {
          sock.end();
        } catch {
          // ignore
        }
        finish();
      });
    });
  });
};

const makeTestPayload = ({ profile, title }) => {
  const t0 = new Date();
  const header = String(title || 'Test Print');
  const mode = String(profile || 'Receipt');

  const lines = [];
  lines.push(escInit);
  lines.push(escAlignCenter);
  lines.push(escBoldOn);
  lines.push(txt(header));
  lines.push(nl());
  lines.push(escBoldOff);
  lines.push(txt(mode.toUpperCase()));
  lines.push(nl());
  lines.push(nl());

  lines.push(escAlignLeft);
  lines.push(txt(`Time: ${t0.toLocaleString()}`));
  lines.push(nl());
  lines.push(txt('Printer: LAN (TCP 9100)'));
  lines.push(nl());
  lines.push(txt('Status: OK (if you can read this)'));
  lines.push(nl());
  lines.push(nl());

  if (mode === 'Kitchen' || mode === 'Bar') {
    lines.push(escBoldOn);
    lines.push(txt('ORDER #0001'));
    lines.push(nl());
    lines.push(escBoldOff);
    lines.push(txt('Table: 1'));
    lines.push(nl());
    lines.push(txt('Staff: Sarah'));
    lines.push(nl());
    lines.push(nl());
    lines.push(txt('1x Cappuccino'));
    lines.push(nl());
    lines.push(txt('1x Sandwich'));
    lines.push(nl());
  } else {
    lines.push(txt('Item            Qty   Price'));
    lines.push(nl());
    lines.push(txt('----------------------------'));
    lines.push(nl());
    lines.push(txt('Cappuccino       1   120.00'));
    lines.push(nl());
    lines.push(txt('Sandwich         1   180.00'));
    lines.push(nl());
    lines.push(txt('----------------------------'));
    lines.push(nl());
    lines.push(escBoldOn);
    lines.push(txt('TOTAL                300.00'));
    lines.push(escBoldOff);
    lines.push(nl());
  }

  lines.push(nl());
  lines.push(escAlignCenter);
  lines.push(txt('Powered by Mirach POS'));
  lines.push(nl());
  lines.push(nl());
  lines.push(nl());
  lines.push(escCut);

  return Buffer.concat(lines);
};

const makeReceiptPayloadFromOrder = ({ orderRow, profile }) => {
  const payload = safeJsonParse(orderRow?.payload, {});
  const items = Array.isArray(payload?.items) ? payload.items : [];
  const number = String(payload?.number || payload?.orderNumber || orderRow?.id || '').trim();
  const tableName = String(payload?.tableName || payload?.table || '').trim();
  const cashier = String(payload?.createdByName || payload?.cashierName || '').trim();

  const total = Number(orderRow?.total || 0) || 0;
  const tax = Number(orderRow?.tax || 0) || 0;
  const discount = Number(orderRow?.discount || 0) || 0;
  const tip = Number(orderRow?.tip || 0) || 0;

  const paidAt = orderRow?.paid_at ? new Date(orderRow.paid_at) : null;

  const lines = [];
  lines.push(escInit);
  lines.push(escAlignCenter);
  lines.push(escBoldOn);
  lines.push(txt('CASH INVOICE'));
  lines.push(escBoldOff);
  lines.push(nl());
  lines.push(nl());

  lines.push(escAlignLeft);
  lines.push(txt(`Order: ${number || String(orderRow?.id || '')}`));
  lines.push(nl());
  if (tableName) {
    lines.push(txt(`Table: ${tableName}`));
    lines.push(nl());
  }
  if (cashier) {
    lines.push(txt(`Cashier: ${cashier}`));
    lines.push(nl());
  }
  if (paidAt) {
    lines.push(txt(`Paid: ${paidAt.toLocaleString()}`));
    lines.push(nl());
  }
  lines.push(nl());

  if (String(profile || 'Receipt') !== 'Receipt') {
    lines.push(escBoldOn);
    lines.push(txt(String(profile || '').toUpperCase()));
    lines.push(escBoldOff);
    lines.push(nl());
  }

  lines.push(txt('Item            Qty   Price'));
  lines.push(nl());
  lines.push(txt('----------------------------'));
  lines.push(nl());

  for (const it of items.slice(0, 200)) {
    const name = String(it?.name || it?.productName || it?.productId || '').trim();
    const qty = Number(it?.qty ?? 0) || 0;
    const unitPrice = Number(it?.unitPrice ?? it?.price ?? 0) || 0;
    const line = `${name}`.slice(0, 14).padEnd(14) + String(qty).slice(0, 3).padStart(4) + String(unitPrice.toFixed(2)).slice(0, 8).padStart(8);
    lines.push(txt(line));
    lines.push(nl());
  }

  lines.push(txt('----------------------------'));
  lines.push(nl());
  lines.push(txt(`Subtotal            ${(total - tax - tip + discount).toFixed(2)}`));
  lines.push(nl());
  if (discount > 0.0001) {
    lines.push(txt(`Discount            ${discount.toFixed(2)}`));
    lines.push(nl());
  }
  if (tax > 0.0001) {
    lines.push(txt(`Tax                 ${tax.toFixed(2)}`));
    lines.push(nl());
  }
  if (tip > 0.0001) {
    lines.push(txt(`Tip                 ${tip.toFixed(2)}`));
    lines.push(nl());
  }
  lines.push(escBoldOn);
  lines.push(txt(`TOTAL               ${total.toFixed(2)}`));
  lines.push(escBoldOff);
  lines.push(nl());
  lines.push(nl());

  lines.push(escAlignCenter);
  lines.push(txt('Powered by Mirach POS'));
  lines.push(nl());
  lines.push(nl());
  lines.push(nl());
  lines.push(escCut);

  return Buffer.concat(lines);
};

const makeManagerPrintRouter = () => {
  const r = express.Router();

  const mapPrintError = (e) => {
    const msg = String(e?.message || '').trim().toLowerCase();
    const code = String(e?.code || '').trim().toUpperCase();

    if (msg.includes('invalid_printer_address')) {
      return { status: 400, error: 'invalid_printer_address' };
    }
    if (msg.includes('printer_timeout') || code === 'ETIMEDOUT') {
      return { status: 408, error: 'printer_timeout' };
    }
    if (code === 'ECONNREFUSED') {
      return { status: 502, error: 'printer_refused' };
    }
    if (code === 'EHOSTUNREACH' || code === 'ENETUNREACH') {
      return { status: 502, error: 'printer_unreachable' };
    }
    if (code === 'ENOTFOUND') {
      return { status: 400, error: 'printer_host_not_found' };
    }
    return { status: 500, error: 'print_failed' };
  };

  r.get('/manager/print/test', (_req, res) => {
    return res.status(405).json({ error: 'method_not_allowed', allowed: ['POST'] });
  });

  r.options('/manager/print/test', (_req, res) => {
    res.setHeader('Allow', 'POST, OPTIONS');
    return res.status(204).end();
  });

  r.post('/manager/print/test', tenantMiddleware, requireAuth, async (req, res, next) => {
    try {
      if (!requireManagerOrOwner(req, res)) return;

      let branchId = resolveBranchId(req);
      if (!branchId || branchId === 'global') {
        const first = await db().select(['id']).from('branches').where({ tenant_id: req.tenant.id }).orderBy('created_at', 'asc').first();
        branchId = first?.id ? String(first.id) : '';
      }
      if (!branchId || branchId === 'global') return res.status(400).json({ error: 'branch_required' });

      const deviceId = String(req.body?.deviceId || '').trim();
      if (!deviceId) return res.status(400).json({ error: 'device_required' });

      const settings = await loadBranchSettings({ tenantId: req.tenant.id, branchId });
      const devices = Array.isArray(settings?.devices) ? settings.devices : [];
      const device = devices.find((d) => String(d?.id || '') === deviceId);
      if (!device) return res.status(404).json({ error: 'device_not_found' });

      const connection = String(device?.connection || '');
      if (connection !== 'LAN') return res.status(400).json({ error: 'lan_only' });

      const host = String(device?.ip || '').trim();
      const port = String(device?.port || '9100').trim();
      const profile = String(device?.profile || 'Receipt');

      const payload = makeTestPayload({ profile, title: 'Test Print' });
      try {
        await sendTcp({ host, port, data: payload, timeoutMs: 6000 });
      } catch (e) {
        const mapped = mapPrintError(e);
        return res.status(mapped.status).json({ error: mapped.error });
      }

      return res.json({ ok: true });
    } catch (e) {
      return next(e);
    }
  });

  r.post('/manager/print/order/:id', tenantMiddleware, requireAuth, async (req, res, next) => {
    try {
      if (!requireManagerOrOwner(req, res)) return;

      let branchId = resolveBranchId(req);
      if (!branchId || branchId === 'global') {
        const first = await db().select(['id']).from('branches').where({ tenant_id: req.tenant.id }).orderBy('created_at', 'asc').first();
        branchId = first?.id ? String(first.id) : '';
      }
      if (!branchId || branchId === 'global') return res.status(400).json({ error: 'branch_required' });

      const orderId = String(req.params?.id || '').trim();
      if (!orderId) return res.status(400).json({ error: 'order_required' });

      const deviceId = String(req.body?.deviceId || '').trim();
      if (!deviceId) return res.status(400).json({ error: 'device_required' });

      const settings = await loadBranchSettings({ tenantId: req.tenant.id, branchId });
      const devices = Array.isArray(settings?.devices) ? settings.devices : [];
      const device = devices.find((d) => String(d?.id || '') === deviceId);
      if (!device) return res.status(404).json({ error: 'device_not_found' });

      const connection = String(device?.connection || '');
      if (connection !== 'LAN') return res.status(400).json({ error: 'lan_only' });

      const host = String(device?.ip || '').trim();
      const port = String(device?.port || '9100').trim();
      const profile = String(device?.profile || 'Receipt');

      const orderRow = await db()
        .from('orders')
        .where({ tenant_id: req.tenant.id, branch_id: branchId, id: orderId })
        .select(['id', 'status', 'total', 'tax', 'tip', 'discount', 'paid_at', 'created_at', 'payload'])
        .first();

      if (!orderRow) return res.status(404).json({ error: 'order_not_found' });

      const payload = makeReceiptPayloadFromOrder({ orderRow, profile });
      try {
        await sendTcp({ host, port, data: payload, timeoutMs: 8000 });
      } catch (e) {
        const mapped = mapPrintError(e);
        return res.status(mapped.status).json({ error: mapped.error });
      }

      return res.json({ ok: true });
    } catch (e) {
      return next(e);
    }
  });

  return r;
};

module.exports = { makeManagerPrintRouter };
