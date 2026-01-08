const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const path = require('path');

const { config } = require('./config');
const { isAllowedOrigin } = require('./utils/cors');
const { logger, requestLogger } = require('./utils/logger');
const { errorHandler } = require('./utils/errors');
const { requestIdMiddleware, addRequestIdToResponse } = require('./middleware/requestId');
const { globalLimiter, authLimiter } = require('./middleware/rateLimiter');

// Route imports
const { makeAdminRouter } = require('./routes/admin');
const { makeAuthRouter } = require('./routes/auth');
const { makeBranchesRouter } = require('./routes/branches');
const { makePublicRouter } = require('./routes/public');
const { makeOwnerRouter } = require('./routes/owner');
const { makeOwnerStaffRouter } = require('./routes/ownerStaff');
const { makeSupportRouter } = require('./routes/support');
const { makeManagerRouter } = require('./routes/manager');
const { makeSubscriptionRouter } = require('./routes/subscription');
const { makeSuperadminAuthRouter } = require('./routes/superadminAuth');
const { makeSuperadminRouter } = require('./routes/superadmin');
const { makeAdminMetricsRouter } = require('./routes/adminMetrics');
const { makeScheduleRouter } = require('./routes/schedule');
const { makeSyncRouter } = require('./routes/sync');
const { makeWaiterRouter } = require('./routes/waiter');
const { makeStaffRouter } = require('./routes/staff');
const { makeManagerStaffRouter } = require('./routes/managerStaff');
const { makeAuditRouter } = require('./routes/audit');
const { makePosRouter } = require('./routes/pos');
const { makePosCustomersRouter } = require('./routes/posCustomers');
const { makeInventoryRouter } = require('./routes/inventory');
const { makeGuestsRouter } = require('./routes/guests');
const { makeManagerFinanceRouter } = require('./routes/managerFinance');
const { makeManagerMenuRouter } = require('./routes/managerMenu');
const { makeManagerSuppliersRouter } = require('./routes/managerSuppliers');
const { makeManagerPurchaseOrdersRouter } = require('./routes/managerPurchaseOrders');
const { makeManagerAuditRouter } = require('./routes/managerAudit');
const { makeManagerPaymentsRouter } = require('./routes/managerPayments');
const { makeManagerCustomersRouter } = require('./routes/managerCustomers');
const { makeEnhancedReportsRouter } = require('./routes/enhancedReports');
const { makeManagerPrintRouter } = require('./routes/managerPrint');
const { makeTelebirrStandingOrderRouter } = require('./routes/telebirrStandingOrder');


const createApp = () => {
  const app = express();

  // ==========================================================================
  // SECURITY MIDDLEWARE (Order matters!)
  // ==========================================================================

  // Disable x-powered-by header
  app.disable('x-powered-by');

  // Request ID generation (first, for tracing)
  app.use(requestIdMiddleware);
  app.use(addRequestIdToResponse);

  // Security headers with enhanced configuration
  app.use(
    helmet({
      contentSecurityPolicy: false, // API server, not needed
      crossOriginEmbedderPolicy: false,
      crossOriginResourcePolicy: { policy: 'cross-origin' },
      hsts: {
        maxAge: 31536000, // 1 year
        includeSubDomains: true,
        preload: true,
      },
    }),
  );

  // Request body parsing with size limit
  app.use(express.json({
    limit: '10mb',
    verify: (req, res, buf) => {
      req.rawBody = buf; // For webhook signature verification
    }
  }));

  // CORS configuration
  app.use(
    cors({
      origin: (origin, cb) => cb(null, isAllowedOrigin(origin, config.corsOrigins)),
      credentials: true,
    }),
  );

  // Structured request logging
  app.use(requestLogger);

  // Global rate limiting (100 req/min)
  app.use('/api', globalLimiter);

  // Remove CSP headers (API server noise reduction)
  app.use((req, res, next) => {
    res.removeHeader('Content-Security-Policy');
    res.removeHeader('Content-Security-Policy-Report-Only');
    next();
  });

  app.get('/p/:token', (req, res) => {
    const token = String(req.params.token || '').trim();
    const host = req.protocol + '://' + req.get('host');
    const apiBase = `${host}/api`;
    const safeToken = token.replace(/</g, '').replace(/>/g, '');
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(200).send(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>MirachPOS Checkout</title>
    <style>
      :root{
        --bg:#221c11;
        --surface:#2c241b;
        --surface2:#3a2e22;
        --stroke:#483c23;
        --text:#ffffff;
        --text2:#c9b792;
        --brand:#eead2b;
        --brand2:#d49a26;
        --ok:#22c55e;
        --danger:#ef4444;
      }
      *{box-sizing:border-box}
      body{margin:0; font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif; background:radial-gradient(900px 520px at 50% -120px, rgba(238,173,43,.22), transparent 60%), linear-gradient(180deg,#1a1610,var(--bg)); color:var(--text);}
      .shell{min-height:100vh; display:flex; align-items:center; justify-content:center; padding:14px;}
      .phone{width:100%; max-width:480px; min-height:820px; background:var(--surface); border:1px solid rgba(255,255,255,.06); border-radius:18px; overflow:hidden; box-shadow:0 24px 70px rgba(0,0,0,.45); position:relative;}
      .top{position:sticky; top:0; z-index:10; display:flex; align-items:center; justify-content:space-between; padding:14px 16px; background:rgba(44,36,27,.92); backdrop-filter: blur(10px); border-bottom:1px solid var(--stroke);}
      .top .left{display:flex; align-items:center; gap:10px; font-weight:900;}
      .iconbtn{width:34px;height:34px;border-radius:999px;border:1px solid var(--stroke); background:rgba(255,255,255,.04); color:#fff; cursor:pointer; display:flex; align-items:center; justify-content:center;}
      .iconbtn:hover{background:rgba(255,255,255,.07)}
      .brand{font-weight:900; letter-spacing:.2px;}
      .brand span{color:var(--brand)}
      .content{padding-bottom:132px;}
      .headline{padding:18px 18px 8px 18px; text-align:center;}
      .cafe{font-size:26px; font-weight:900; letter-spacing:-.02em;}
      .meta{margin-top:8px; font-size:13px; color:var(--text2); display:flex; gap:8px; align-items:center; justify-content:center; flex-wrap:wrap;}
      .list{padding:10px 14px 0 14px; display:flex; flex-direction:column; gap:10px;}
      .item{display:flex; align-items:flex-start; justify-content:space-between; gap:12px; padding:12px 10px; border-radius:14px; border:1px solid rgba(255,255,255,.04); background:rgba(0,0,0,.14);}
      .item:hover{background:rgba(0,0,0,.18)}
      .itL{display:flex; gap:12px; min-width:0;}
      .ic{width:44px;height:44px;border-radius:12px; background:rgba(238,173,43,.10); border:1px solid rgba(238,173,43,.18); display:flex; align-items:center; justify-content:center; flex:0 0 auto; color:var(--brand); font-weight:900;}
      .itT{min-width:0;}
      .itName{font-weight:900; font-size:15px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:280px;}
      .itSub{font-size:12px; color:var(--text2); margin-top:2px;}
      .itP{font-weight:900; font-variant-numeric: tabular-nums; white-space:nowrap;}
      .divider{height:1px; background:var(--stroke); margin:12px 14px;}
      .section{padding:0 18px 6px 18px;}
      .sectHd{display:flex; align-items:center; justify-content:space-between; margin-top:10px;}
      .sectHd h3{margin:0; font-size:15px; font-weight:900;}
      .pill{font-size:11px; font-weight:900; color:var(--brand); background:rgba(238,173,43,.10); border:1px solid rgba(238,173,43,.22); padding:6px 10px; border-radius:999px;}
      .tipGrid{margin-top:10px; display:grid; grid-template-columns:repeat(4,1fr); gap:10px;}
      .tipBtn{cursor:pointer; border-radius:14px; border:1px solid var(--stroke); background:rgba(255,255,255,.03); color:#fff; padding:10px 8px; text-align:center; font-weight:900;}
      .tipBtn small{display:block; margin-top:4px; font-size:11px; color:var(--text2); font-weight:800;}
      .tipBtn.active{background:rgba(238,173,43,.14); border-color:rgba(238,173,43,.40); box-shadow:0 0 0 3px rgba(238,173,43,.12) inset;}
      .tipBtn.active small{color:#fff; opacity:.9;}
      .tipOther{display:flex; flex-direction:column; align-items:center; justify-content:center; gap:4px;}
      input{width:100%; height:44px; border-radius:14px; border:1px solid var(--stroke); background:rgba(0,0,0,.20); color:#fff; padding:0 12px; outline:none;}
      input:focus{border-color:rgba(238,173,43,.55)}
      .inputs{margin-top:12px; display:grid; grid-template-columns:1fr 1fr; gap:10px;}
      .lab{font-size:12px; color:var(--text2); margin-bottom:6px; font-weight:800;}
      .breakdown{padding:0 18px 10px 18px;}
      .row{display:flex; align-items:center; justify-content:space-between; gap:12px; font-size:13px; color:var(--text2); margin:10px 0;}
      .row strong{color:#fff; font-weight:900; font-variant-numeric: tabular-nums;}
      .dash{border-bottom:2px dashed var(--stroke); margin:12px 0;}
      .total{display:flex; align-items:flex-end; justify-content:space-between;}
      .total .l{font-size:16px; font-weight:900; color:#fff;}
      .total .r{font-size:28px; font-weight:900; color:var(--brand); font-variant-numeric: tabular-nums;}
      .trust{display:flex; justify-content:center; gap:8px; align-items:center; padding:14px 10px 18px 10px; color:rgba(201,183,146,.75); font-size:12px;}
      .msg{padding:0 18px 10px 18px;}
      .err{background:rgba(239,68,68,.12); border:1px solid rgba(239,68,68,.35); border-radius:14px; padding:10px 12px; color:#fee2e2; font-size:13px;}
      .ok{background:rgba(34,197,94,.12); border:1px solid rgba(34,197,94,.35); border-radius:14px; padding:10px 12px; color:#dcfce7; font-size:13px;}
      .bottom{position:absolute; left:0; right:0; bottom:0; padding:18px 18px 16px 18px; background:linear-gradient(180deg, transparent, rgba(44,36,27,.92) 22%, rgba(44,36,27,1)); border-top:1px solid rgba(72,60,35,.65);}
      .payBtn{width:100%; height:54px; border:none; border-radius:16px; background:linear-gradient(180deg,var(--brand),var(--brand2)); color:#221c11; font-weight:900; font-size:16px; display:flex; align-items:center; justify-content:space-between; padding:0 18px; cursor:pointer; box-shadow:0 16px 30px rgba(238,173,43,.18);}
      .payBtn:active{transform:scale(.99)}
      .payBtn:disabled{opacity:.65; cursor:not-allowed;}
      .receiptLink{display:none; margin-top:10px; text-align:center;}
      .receiptLink a{color:var(--brand); font-weight:900; text-decoration:none;}
      .receiptLink a:hover{text-decoration:underline;}
      @media (max-width:520px){ .inputs{grid-template-columns:1fr} .tipGrid{grid-template-columns:repeat(2,1fr)} }
    </style>
  </head>
  <body>
    <div class="shell">
      <div class="phone">
        <header class="top">
          <div class="left">
            <button class="iconbtn" type="button" onclick="try{history.back()}catch{}" aria-label="Back">‹</button>
            <div>Review Order</div>
          </div>
          <div class="brand">Mirach<span>POS</span></div>
        </header>

        <div class="content">
          <div class="headline">
            <div class="cafe" id="cafe">Loading…</div>
            <div class="meta" id="meta"> </div>
          </div>

          <div class="list" id="items"></div>

          <div class="divider"></div>

          <div class="section" id="tipSection">
            <div class="sectHd">
              <h3>Tip the Team</h3>
              <div class="pill">Thank you</div>
            </div>
            <div class="tipGrid" aria-label="Tip percent">
              <button class="tipBtn" type="button" data-pct="10"><span>10%</span><small id="pct10">ETB 0.00</small></button>
              <button class="tipBtn" type="button" data-pct="15"><span>15%</span><small id="pct15">ETB 0.00</small></button>
              <button class="tipBtn" type="button" data-pct="20"><span>20%</span><small id="pct20">ETB 0.00</small></button>
              <button class="tipBtn" id="otherBtn" type="button"><div class="tipOther"><span>Other</span><small>Custom</small></div></button>
            </div>

            <div class="inputs" id="customInputs" style="display:none">
              <div>
                <div class="lab">Custom tip (ETB)</div>
                <input id="tipAmt" inputmode="decimal" placeholder="0.00" />
              </div>
              <div>
                <div class="lab">Custom tip (%)</div>
                <input id="tipPct" inputmode="decimal" placeholder="0" />
              </div>
            </div>
          </div>

          <div class="breakdown">
            <div class="row"><span>Subtotal</span><strong id="subtotal">ETB 0.00</strong></div>
            <div class="row"><span>Tax</span><strong id="tax">ETB 0.00</strong></div>
            <div class="row"><span>Service</span><strong id="service">ETB 0.00</strong></div>
            <div class="row"><span id="tipLabel">Tip</span><strong id="tip">ETB 0.00</strong></div>
            <div class="dash"></div>
            <div class="total"><div class="l">Total</div><div class="r" id="pay">ETB 0.00</div></div>
          </div>

          <div class="msg" id="msg"></div>
          <div class="trust">🔒 Secure checkout powered by MirachPOS</div>
        </div>

        <div class="bottom">
          <button id="payBtn" class="payBtn" type="button"><span>Pay Now</span><span id="payBtnAmt">ETB 0.00</span></button>
          <div class="receiptLink" id="receiptLinkWrap"><a id="receiptLink" href="#">View Receipt</a></div>
          <div id="status" style="display:none"></div>
        </div>
      </div>
    </div>

    <script>
      const TOKEN = ${JSON.stringify(safeToken)};
      const API = ${JSON.stringify(apiBase)};
      const qs = new URLSearchParams(location.search);
      const msg = document.getElementById('msg');
      const status = document.getElementById('status');
      const setMsg = (text, cls) => {
        const safe = String(text || '');
        msg.className = cls || '';
        msg.innerHTML = safe ? '<div class="' + (cls || '') + '">' + safe + '</div>' : '';
      };
      const money = (n) => (Math.round((Number(n)||0)*100)/100).toFixed(2);

      let currency = 'ETB';
      let baseSubtotal = 0;
      let baseTax = 0;
      let baseService = 0;
      let baseBeforeTip = 0;
      let pct = 0;
      let amt = 0;
      let selectedPreset = 0;
      let receiptUrlGlobal = '';

      const recalc = () => {
        const pctAmount = baseBeforeTip * (pct/100);
        const tipVal = pctAmount + amt;
        document.getElementById('subtotal').textContent = currency + ' ' + money(baseSubtotal);
        document.getElementById('tax').textContent = currency + ' ' + money(baseTax);
        document.getElementById('service').textContent = currency + ' ' + money(baseService);
        document.getElementById('tip').textContent = currency + ' ' + money(tipVal);
        const totalPay = baseBeforeTip + tipVal;
        document.getElementById('pay').textContent = currency + ' ' + money(totalPay);
        document.getElementById('payBtnAmt').textContent = currency + ' ' + money(totalPay);

        document.getElementById('pct10').textContent = currency + ' ' + money(baseBeforeTip * 0.10);
        document.getElementById('pct15').textContent = currency + ' ' + money(baseBeforeTip * 0.15);
        document.getElementById('pct20').textContent = currency + ' ' + money(baseBeforeTip * 0.20);
      };

      const applyReceiptLink = (receiptUrl) => {
        if (!receiptUrl) return;
        const a = document.getElementById('receiptLink');
        const w = document.getElementById('receiptLinkWrap');
        if (w) w.style.display = 'block';
        a.style.display = 'inline';
        a.href = receiptUrl;
      };

      const setPaidUi = (receiptUrl) => {
        status.textContent = 'Paid';
        applyReceiptLink(receiptUrl || '');
        const btn = document.getElementById('payBtn');
        if (btn) btn.style.display = 'none';
        const tipSection = document.getElementById('tipSection');
        if (tipSection) tipSection.style.display = 'none';
      };

      const load = async () => {
        const r = await fetch(API + '/public/pos-links/' + encodeURIComponent(TOKEN), { cache: 'no-store' });
        const j = await r.json().catch(()=>null);
        if (!r.ok || !j || !j.ok) throw new Error((j && (j.message || j.error)) || 'Failed to load payment');
        currency = String(j.currency || 'ETB');
        receiptUrlGlobal = String(j.receiptUrl || '');
        document.getElementById('cafe').textContent = j.cafeName || 'MirachPOS';

        const tableLabel = String(j.tableName || '').trim();
        const orderLabel = String(j.orderNumber || j.orderId || '').trim();
        const metaParts = [];
        if (tableLabel) metaParts.push(tableLabel);
        if (orderLabel) metaParts.push('Order ' + orderLabel);
        document.getElementById('meta').textContent = metaParts.join(' • ');

        const itemsEl = document.getElementById('items');
        const rows = Array.isArray(j.items) ? j.items : [];
        itemsEl.innerHTML = rows.map((it) => {
          const name = String(it && it.name ? it.name : 'Item');
          const qty = Number(it && it.qty ? it.qty : 0) || 0;
          const unit = Number(it && (it.unitPrice ?? it.unit_price) ? (it.unitPrice ?? it.unit_price) : 0) || 0;
          const line = unit * qty;
          const note = typeof it?.note === 'string' ? it.note.trim() : '';
          const sub = note ? note : (qty > 0 ? ('x' + qty + ' @ ' + currency + ' ' + money(unit)) : '');
          const initials = name ? name.trim().slice(0, 1).toUpperCase() : '•';
          return '<div class="item"><div class="itL"><div class="ic">' + initials + '</div><div class="itT"><div class="itName">' + name + '</div><div class="itSub">' + sub + '</div></div></div><div class="itP">' + currency + ' ' + money(line) + '</div></div>';
        }).join('');

        baseSubtotal = Number(j.subtotal || 0) || 0;
        baseTax = Number(j.tax || 0) || 0;
        baseService = Number(j.serviceCharge || 0) || 0;
        baseBeforeTip = baseSubtotal + baseTax + baseService;

        if (j.paid) {
          setPaidUi(j.receiptUrl || '');
          setMsg('Payment completed. Opening receipt…', 'ok');
        } else {
          applyReceiptLink(j.receiptUrl || '');
        }

        if (j.paid) {
          const paidTip = Number(j.tip || 0) || 0;
          pct = 0;
          amt = paidTip;
          recalc();
          const paidTotal = Number(j.total || 0) || 0;
          if (paidTotal > 0) {
            document.getElementById('pay').textContent = currency + ' ' + money(paidTotal);
            document.getElementById('payBtnAmt').textContent = currency + ' ' + money(paidTotal);
          }
        } else {
          recalc();
        }
        return j;
      };

      const pollPaid = async () => {
        try {
          const j = await load();
          if (j && j.paid) {
            const receiptUrl = String(j.receiptUrl || '');
            if (receiptUrl) {
              try {
                location.replace(receiptUrl);
                return;
              } catch {
                // ignore
              }
            }
            return;
          }
        } catch {
          // ignore
        }
        setTimeout(pollPaid, 2500);
      };

      const setPreset = (p) => {
        selectedPreset = Number(p || 0) || 0;
        pct = selectedPreset;
        amt = 0;
        try {
          document.getElementById('customInputs').style.display = 'none';
          const ta = document.getElementById('tipAmt');
          const tp = document.getElementById('tipPct');
          if (ta) ta.value = '';
          if (tp) tp.value = '';
        } catch {
          // ignore
        }
        document.querySelectorAll('.tipBtn[data-pct]').forEach((x) => {
          try {
            const v = Number(x.getAttribute('data-pct') || 0);
            if (v === selectedPreset) x.classList.add('active');
            else x.classList.remove('active');
          } catch {
            // ignore
          }
        });
        recalc();
      };

      document.querySelectorAll('.tipBtn[data-pct]').forEach((b) => {
        b.addEventListener('click', () => setPreset(Number(b.getAttribute('data-pct') || 0)));
      });

      document.getElementById('otherBtn').addEventListener('click', () => {
        selectedPreset = 0;
        pct = 0;
        document.querySelectorAll('.tipBtn[data-pct]').forEach((x) => x.classList.remove('active'));
        const c = document.getElementById('customInputs');
        c.style.display = c.style.display === 'none' ? 'grid' : 'none';
      });

      document.getElementById('tipAmt').addEventListener('input', (e) => {
        const v = String(e.target.value || '').replace(/[^0-9.]/g,'');
        e.target.value = v;
        amt = Number(v||0);
        pct = 0;
        document.getElementById('tipPct').value = '';
        recalc();
      });

      document.getElementById('tipPct').addEventListener('input', (e) => {
        const v = String(e.target.value || '').replace(/[^0-9.]/g,'');
        e.target.value = v;
        pct = Number(v||0);
        amt = 0;
        document.getElementById('tipAmt').value = '';
        recalc();
      });

      document.getElementById('payBtn').addEventListener('click', async () => {
        setMsg('', '');
        const btn = document.getElementById('payBtn');
        btn.disabled = true;
        try {
          const r = await fetch(API + '/public/pos-links/' + encodeURIComponent(TOKEN) + '/initiate-chapa', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tipAmount: amt, tipPct: pct }),
          });
          const j = await r.json().catch(()=>null);
          if (!r.ok || !j || !j.ok) throw new Error((j && (j.message || j.error)) || 'Failed to start payment');
          if (!j.checkoutUrl) throw new Error('Missing checkout URL');
          location.href = j.checkoutUrl;
        } catch (e) {
          setMsg(String(e && e.message ? e.message : e), 'err');
          btn.disabled = false;
        }
      });

      if (qs.get('chapa') === 'success') {
        setMsg('Payment submitted. Waiting for confirmation…', 'ok');
        pollPaid();
      }

      load().catch((e)=>setMsg(String(e && e.message ? e.message : e), 'err'));
    </script>
  </body>
</html>`);
  });

  app.get('/r/:token', (req, res) => {
    const token = String(req.params.token || '').trim();
    const host = req.protocol + '://' + req.get('host');
    const apiBase = `${host}/api`;
    const safeToken = token.replace(/</g, '').replace(/>/g, '');
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(200).send(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>MirachPOS Receipt</title>
    <style>
      *{box-sizing:border-box}
      body{font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace; background:#111827; margin:0; padding:14px; color:#111;}
      .paper{max-width:420px; margin:0 auto; background:#fff; border-radius:10px; box-shadow:0 14px 36px rgba(0,0,0,.35); overflow:hidden}
      .pad{padding:12px 12px}
      pre{margin:0; font-size:12px; line-height:1.25; white-space:pre;}
      .err{max-width:420px;margin:0 auto;background:#fee2e2;border:1px solid #fecaca;color:#7f1d1d;padding:10px 12px;border-radius:12px}
      .qr{display:flex; flex-direction:column; align-items:center; gap:8px; margin-top:10px;}
      .qr img{width:160px;height:160px; image-rendering:pixelated;}
      @media print{body{padding:0;background:#fff} .paper{box-shadow:none;border-radius:0}}
    </style>
  </head>
  <body>
    <div id="err" class="err" style="display:none"></div>
    <div class="paper" id="wrap" style="display:none">
      <div class="pad">
        <pre id="rcp">-</pre>
        <div class="qr">
          <div style="font-size:12px;color:#555">Scan to view this receipt</div>
          <img id="qr" alt="Receipt QR" />
          <div style="font-size:11px;color:#555">Powered by MirachPOS</div>
        </div>
      </div>
    </div>
    <script>
      const TOKEN = ${JSON.stringify(safeToken)};
      const API = ${JSON.stringify(apiBase)};
      const money = (n) => (Math.round((Number(n)||0)*100)/100).toFixed(2);
      const showErr = (t) => { const e=document.getElementById('err'); e.style.display='block'; e.textContent=t; };
      const padR = (s,n) => { s=String(s||''); return s.length>=n ? s.slice(0,n) : s + ' '.repeat(n-s.length); };
      const padL = (s,n) => { s=String(s||''); return s.length>=n ? s.slice(s.length-n) : ' '.repeat(n-s.length) + s; };
      const center = (s,n) => { s=String(s||'').trim(); if(!s) return ''; if(s.length>=n) return s.slice(0,n); const left=Math.floor((n-s.length)/2); const right=n-s.length-left; return ' '.repeat(left)+s+' '.repeat(right); };
      const twoCol = (a,b,n) => { a=String(a||'').trim(); b=String(b||'').trim(); if(!b) return padR(a,n); const maxLeft=Math.max(0,n-b.length-1); return padR(a.slice(0,maxLeft),maxLeft) + ' ' + padL(b, n-maxLeft-1); };
      const load = async () => {
        const r = await fetch(API + '/public/pos-receipt/' + encodeURIComponent(TOKEN));
        const j = await r.json().catch(()=>null);
        if (!r.ok || !j || !j.ok) throw new Error((j && (j.message || j.error)) || 'Failed to load receipt');
        document.getElementById('wrap').style.display='block';

        const cols = 32;
        const cur = String(j.currency || 'ETB').toUpperCase();
        const paidAt = j.paidAt ? String(j.paidAt) : '';
        const lines = [];
        lines.push(center(String(j.cafeName || 'MirachPOS'), cols));
        const addr = String(j.address || '').trim();
        const phone = String(j.phone || '').trim();
        const tin = String(j.tin || '').trim();
        if (addr) lines.push(center(addr, cols));
        if (phone) lines.push(center('TEL: ' + phone.replace(/^tel\s*[:\-]?\s*/i,''), cols));
        if (tin) lines.push(center('TIN: ' + tin, cols));
        lines.push('');

        // Try to print date/time from paidAt string if present.
        const dt = paidAt ? new Date(paidAt) : null;
        const dateStr = dt && !Number.isNaN(dt.getTime()) ? dt.toLocaleDateString('en-GB', { year:'numeric', month:'2-digit', day:'2-digit' }) : '';
        const timeStr = dt && !Number.isNaN(dt.getTime()) ? dt.toLocaleTimeString('en-GB', { hour:'2-digit', minute:'2-digit', hour12:false }) : '';
        if (dateStr || timeStr) lines.push(twoCol(dateStr, timeStr, cols));
        lines.push('');

        const orderNo = String(j.orderNumber || j.orderId || '').trim();
        if (orderNo) lines.push(padR('Order: ' + orderNo, cols));
        const ref = String(j.paymentReference || '').trim();
        if (ref) lines.push(padR('Ref: ' + ref, cols));
        const operator = String(j.operatorName || '').trim();
        const waiter = String(j.waiterName || '').trim();
        const table = String(j.tableName || '').trim();
        if (operator) lines.push(padR('Operator: ' + operator, cols));
        if (waiter) lines.push(padR('Waiter: ' + waiter, cols));
        if (table) lines.push(padR('Table: ' + table, cols));

        const dash = '-'.repeat(cols);
        lines.push(dash);
        lines.push(twoCol('Description', 'Amount', cols));
        lines.push(dash);

        const items = Array.isArray(j.items) ? j.items : [];
        const wrap = (s,w) => { s=String(s||'').trim(); if(!s) return ['']; const out=[]; for(let i=0;i<s.length;i+=w) out.push(s.slice(i,i+w)); return out; };
        for (const it of items.slice(0,200)) {
          const name = String(it.name||'').trim();
          const qty = Number(it.qty||0);
          const unit = Number(it.unitPrice||0);
          const amount = qty*unit;
          for (const w of wrap(name || '-', cols)) lines.push(padR(w, cols));
          lines.push(twoCol(String(qty) + ' x ' + money(unit), money(amount), cols));
        }

        const tip = Number(j.tipAmount||0) + Number(j.tipPctAmount||0);
        lines.push(dash);
        lines.push(twoCol('SUBTOTAL', money(j.subtotal), cols));
        if (Number(j.serviceCharge||0) > 0.0001) lines.push(twoCol('SERVICE', money(j.serviceCharge), cols));
        if (Number(j.tax||0) > 0.0001) lines.push(twoCol('TAX', money(j.tax), cols));
        if (tip > 0.0001) lines.push(twoCol('TIP', money(tip), cols));
        lines.push(dash);
        lines.push(twoCol('TOTAL', money(j.total) + ' ' + cur, cols));

        const pm = String(j.paymentMethod || '').trim();
        if (pm) lines.push(padR(pm.toUpperCase(), cols));
        lines.push('');
        lines.push(center('Powered by MirachPOS', cols));

        document.getElementById('rcp').textContent = lines.join('\n');

        const receiptUrl = location.origin + '/r/' + encodeURIComponent(TOKEN);
        const qr = document.getElementById('qr');
        const qrSrc = 'https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=' + encodeURIComponent(receiptUrl);
        qr.src = qrSrc;
      };
      load().catch((e)=>showErr(String(e && e.message ? e.message : e)));
    </script>
  </body>
</html>`);
  });

  // ==========================================================================
  // HEALTH & STATIC ROUTES (No rate limiting)
  // ==========================================================================

  app.get('/.well-known/appspecific/com.chrome.devtools.json', (_req, res) => {
    res.setHeader('Content-Type', 'application/json');
    return res.status(200).send('{}');
  });

  app.get('/', (_req, res) => res.json({ ok: true, name: 'mirachpos-api' }));

  app.get('/health', async (_req, res) => {
    let dbStatus = 'unknown';
    try {
      await require('./db').db().raw('SELECT 1');
      dbStatus = 'up';
    } catch (e) {
      dbStatus = 'down';
    }

    res.json({
      ok: true,
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      db: dbStatus,
    });
  });

  app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads')));
  app.use('/api/uploads', express.static(path.join(__dirname, '..', 'uploads')));

  // ==========================================================================
  // WEBHOOKS (No auth, special handling)
  // ==========================================================================

  const { makeWebhookRouter } = require('./routes/webhook');
  app.use('/api/webhooks', makeWebhookRouter());

  // ==========================================================================
  // AUTH ROUTES (With auth rate limiting)
  // ==========================================================================

  // Apply stricter rate limiting to auth endpoints
  app.use('/api/login', authLimiter);
  app.use('/api/auth/login', authLimiter);
  app.use('/api/superadmin/login', authLimiter);

  // ==========================================================================
  // API ROUTES
  // ==========================================================================

  app.use('/admin', makeAdminRouter({ provisionKey: config.provisionKey }));
  app.use('/api', makePublicRouter());
  app.use('/api', makeSuperadminAuthRouter());
  app.use('/api', makeSuperadminRouter());
  app.use('/api/superadmin', makeAdminMetricsRouter());
  app.use('/api', makeAuthRouter());
  app.use('/api', makeBranchesRouter());
  app.use('/api', makeOwnerRouter());
  app.use('/api', makeOwnerStaffRouter());
  app.use('/api', makeSupportRouter());
  app.use('/api', makeManagerRouter());
  app.use('/api', makeSubscriptionRouter());
  app.use('/api', makeScheduleRouter());
  app.use('/api', makeSyncRouter());
  app.use('/api', makeWaiterRouter());
  app.use('/api', makeStaffRouter());
  app.use('/api', makeManagerStaffRouter());
  app.use('/api', makeAuditRouter());
  app.use('/api', makePosRouter());
  app.use('/api', makePosCustomersRouter());
  app.use('/api', makeInventoryRouter());
  app.use('/api', makeGuestsRouter());
  app.use('/api', makeManagerFinanceRouter());
  app.use('/api', makeManagerMenuRouter());
  app.use('/api', makeManagerSuppliersRouter());
  app.use('/api', makeManagerPurchaseOrdersRouter());
  app.use('/api', makeManagerAuditRouter());
  app.use('/api', makeManagerPaymentsRouter());
  app.use('/api', makeManagerCustomersRouter());
  app.use('/api', makeEnhancedReportsRouter());
  app.use('/api', makeManagerPrintRouter());
  app.use('/api', makeTelebirrStandingOrderRouter());

  // ==========================================================================
  // ERROR HANDLING
  // ==========================================================================

  // 404 handler for API routes
  app.use('/api/*', (req, res) => {
    res.status(404).json({
      error: 'not_found',
      message: `Cannot ${req.method} ${req.path}`,
      requestId: req.requestId,
    });
  });

  // Centralized error handler (must be last)
  app.use(errorHandler);

  // Log startup
  logger.info({ port: config.port, env: config.env }, 'Application created');

  return app;
};

module.exports = { createApp };
