const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const path = require('path');

const { config } = require('./config');
const { isAllowedOrigin } = require('./utils/cors');
const { logger, requestLogger } = require('./utils/logger');
const { errorHandler } = require('./utils/errors');
const { requestIdMiddleware, addRequestIdToResponse } = require('./middleware/requestId');
const { globalLimiter, authLimiter, strictLimiter } = require('./middleware/rateLimiter');

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

  // Trust reverse proxy (cPanel/Cloudflare) so req.protocol uses X-Forwarded-Proto
  app.set('trust proxy', true);

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

  // Prevent caching of authenticated API responses.
  // This avoids stale lists (needing hard refresh) behind browser/proxy/CDN caches.
  app.use('/api', (req, res, next) => {
    try {
      const p = String(req.path || '');
      const isCacheable = p.startsWith('/uploads/') || p.startsWith('/public/');
      if (!isCacheable) {
        res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
        res.set('Pragma', 'no-cache');
        res.set('Expires', '0');
        res.set('Vary', 'Origin, Authorization, X-Tenant');
      }
    } catch {
      // ignore
    }
    return next();
  });

  app.get('/p/:token', (req, res) => {
    const token = String(req.params.token || '').trim();
    const xfProto = String(req.header('x-forwarded-proto') || '').split(',')[0].trim().toLowerCase();
    const proto = xfProto || req.protocol;
    const host = proto + '://' + req.get('host');
    const apiBase = `${host}/api`;
    const safeToken = token.replace(/</g, '').replace(/>/g, '');
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(200).send(`<!doctype html>
<html class="dark" lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>MirachPOS Checkout</title>
    <link href="https://fonts.googleapis.com" rel="preconnect" />
    <link crossorigin="" href="https://fonts.gstatic.com" rel="preconnect" />
    <link href="https://fonts.googleapis.com/css2?family=Manrope:wght@200..800&family=Noto+Sans:ital,wght@0,100..900;1,100..900&display=swap" rel="stylesheet" />
    <link href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&display=swap" rel="stylesheet" />
    <script src="https://cdn.tailwindcss.com?plugins=forms,container-queries"></script>
    <script>
      tailwind.config = {
        darkMode: 'class',
        theme: {
          extend: {
            colors: {
              primary: '#eead2b',
              'accent-gold': '#eead2b',
              'background-light': '#f6f7f8',
              'background-dark': '#101922',
              'surface-dark': '#111a22',
              'surface-highlight': '#233648',
              'text-secondary': '#92adc9',
            },
            fontFamily: {
              display: ['Manrope', 'Noto Sans', 'sans-serif'],
            },
            borderRadius: {
              DEFAULT: '0.25rem',
              lg: '0.5rem',
              xl: '0.75rem',
              full: '9999px',
            },
          },
        },
      };
    </script>
  </head>
  <body class="bg-background-light dark:bg-background-dark font-display text-white overflow-x-hidden antialiased selection:bg-primary/30 selection:text-white">
    <div class="relative flex min-h-screen w-full flex-col items-center justify-center py-4 sm:py-8">
      <div class="flex h-full w-full max-w-[480px] flex-col overflow-hidden bg-surface-dark sm:rounded-2xl sm:shadow-2xl sm:ring-1 sm:ring-white/5 relative min-h-[850px]">
        <button class="absolute top-3 right-3 z-20 flex cursor-pointer items-center justify-center rounded-full size-10 hover:bg-surface-highlight text-white transition-colors" type="button" onclick="try{window.close()}catch{};try{location.replace('about:blank')}catch{};try{setTimeout(()=>window.close(),50)}catch{}" aria-label="Close">
          <span class="material-symbols-outlined text-[22px]">close</span>
        </button>

        <div class="flex-1 overflow-y-auto pb-32 no-scrollbar" id="mainScroll">
          <div class="flex flex-col pt-6 pb-2" id="headline">
            <h2 class="text-white tracking-tight text-[28px] font-bold leading-tight px-6 text-center" id="cafe">Loading…</h2>
            <p class="text-text-secondary text-sm font-medium leading-normal pt-2 px-6 text-center flex items-center justify-center gap-2" id="meta"></p>
          </div>

          <div class="flex flex-col px-4 mt-4 space-y-1" id="items"></div>

          <div class="w-full h-px bg-surface-highlight my-4"></div>

          <div class="px-6 py-2" id="tipSection">
            <div class="flex items-center justify-between mb-4">
              <h3 class="text-white text-base font-bold">Tip the Team</h3>
              <span class="text-xs font-bold text-accent-gold bg-accent-gold/10 px-2 py-1 rounded">Great Service!</span>
            </div>
            <div class="grid grid-cols-4 gap-2 mb-4" aria-label="Tip percent">
              <button class="tipBtn flex flex-col items-center justify-center py-3 rounded-lg border border-surface-highlight bg-surface-highlight/30 text-white hover:bg-surface-highlight transition-all" type="button" data-pct="5">
                <span class="text-sm font-bold">5%</span>
                <span class="tipAmt text-xs text-text-secondary" id="pct5">ETB 0.00</span>
              </button>
              <button class="tipBtn flex flex-col items-center justify-center py-3 rounded-lg border border-surface-highlight bg-surface-highlight/30 text-white hover:bg-surface-highlight transition-all" type="button" data-pct="10">
                <span class="text-sm font-bold">10%</span>
                <span class="tipAmt text-xs text-text-secondary" id="pct10">ETB 0.00</span>
              </button>
              <button class="tipBtn flex flex-col items-center justify-center py-3 rounded-lg border border-surface-highlight bg-surface-highlight/30 text-white hover:bg-surface-highlight transition-all" type="button" data-pct="15">
                <span class="text-sm font-bold">15%</span>
                <span class="tipAmt text-xs text-text-secondary" id="pct15">ETB 0.00</span>
              </button>
              <button class="tipBtn flex flex-col items-center justify-center py-3 rounded-lg border border-surface-highlight bg-surface-highlight/30 text-white hover:bg-surface-highlight transition-all" id="otherBtn" type="button">
                <span class="text-sm font-bold">Other</span>
                <span class="material-symbols-outlined text-[14px] mt-0.5 text-text-secondary">edit</span>
              </button>
            </div>

            <div class="grid grid-cols-2 gap-3" id="customInputs" style="display:none">
              <div>
                <div class="text-xs font-bold text-text-secondary mb-2">Custom tip (ETB)</div>
                <input id="tipAmt" inputmode="decimal" placeholder="0.00" class="bg-surface-dark border-surface-highlight text-white" />
              </div>
              <div>
                <div class="text-xs font-bold text-text-secondary mb-2">Custom tip (%)</div>
                <input id="tipPct" inputmode="decimal" placeholder="0" class="bg-surface-dark border-surface-highlight text-white" />
              </div>
            </div>
          </div>

          <div class="px-6 py-2 space-y-3" id="breakdown">
            <div class="flex items-center justify-between text-sm"><span class="text-text-secondary">Subtotal</span><span class="text-white font-medium" id="subtotal">ETB 0.00</span></div>
            <div class="flex items-center justify-between text-sm"><span class="text-text-secondary">Tax</span><span class="text-white font-medium" id="tax">ETB 0.00</span></div>
            <div class="flex items-center justify-between text-sm"><span class="text-text-secondary">Service</span><span class="text-white font-medium" id="service">ETB 0.00</span></div>
            <div class="flex items-center justify-between text-sm"><span class="text-text-secondary" id="tipLabel">Tip</span><span class="text-white font-medium" id="tip">ETB 0.00</span></div>
            <div class="border-b-2 border-dashed border-surface-highlight my-2"></div>
            <div class="flex items-center justify-between">
              <span class="text-white text-lg font-bold">Total</span>
              <span class="text-white text-2xl font-extrabold tracking-tight" id="pay">ETB 0.00</span>
            </div>
            <div class="pt-3" id="bottomBar">
              <button class="w-full bg-primary hover:bg-primary/90 text-black font-bold text-lg h-14 rounded-xl shadow-lg shadow-primary/20 flex items-center justify-between px-6 transition-transform active:scale-[0.98]" id="payBtn" type="button">
                <span>Pay Now</span>
                <span id="payBtnAmt">ETB 0.00</span>
              </button>
              <div id="status" style="display:none"></div>
            </div>
          </div>

          <div class="px-6 py-2" id="msg"></div>

          <div class="px-4 pb-6" id="receiptWrap" style="display:none">
            <div class="bg-white rounded-xl overflow-hidden">
              <iframe id="receiptFrame" title="Receipt" style="width:100%; border:0; height:780px;"></iframe>
            </div>
          </div>
        </div>

      </div>
    </div>

    <div class="flex justify-center items-center gap-1.5 py-5 opacity-60" id="trust">
      <span class="material-symbols-outlined text-[14px] text-accent-gold">lock</span>
      <span class="text-xs text-text-secondary">Secure checkout powered by MirachPOS</span>
    </div>

    <script>
      const TOKEN = ${JSON.stringify(safeToken)};
      const API = ${JSON.stringify(apiBase)};
      const qs = new URLSearchParams(location.search);
      const msg = document.getElementById('msg');
      const status = document.getElementById('status');
      const setMsg = (text, cls) => {
        const safe = String(text || '');
        msg.className = '';
        msg.innerHTML = safe
          ? '<div class="' + (cls === 'err' ? 'rounded-xl border border-red-500/30 bg-red-500/10 text-red-100 px-4 py-3 text-sm font-medium' : 'rounded-xl border border-emerald-500/30 bg-emerald-500/10 text-emerald-100 px-4 py-3 text-sm font-medium') + '">' + safe + '</div>'
          : '';
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

        document.getElementById('pct5').textContent = currency + ' ' + money(baseBeforeTip * 0.05);
        document.getElementById('pct10').textContent = currency + ' ' + money(baseBeforeTip * 0.10);
        document.getElementById('pct15').textContent = currency + ' ' + money(baseBeforeTip * 0.15);
      };

      const setPaidUi = (receiptUrl) => {
        status.textContent = 'Paid';
        const bottom = document.getElementById('bottomBar');
        if (bottom) bottom.style.display = 'none';
        const tipSection = document.getElementById('tipSection');
        if (tipSection) tipSection.style.display = 'none';
        const headline = document.getElementById('headline');
        if (headline) headline.style.display = 'none';
        const items = document.getElementById('items');
        if (items) items.style.display = 'none';
        const breakdown = document.getElementById('breakdown');
        if (breakdown) breakdown.style.display = 'none';
        const trust = document.getElementById('trust');
        if (trust) trust.style.display = 'none';
        const wrap = document.getElementById('receiptWrap');
        const frame = document.getElementById('receiptFrame');
        if (wrap) wrap.style.display = 'block';
        if (frame && receiptUrl) frame.src = receiptUrl;
      };

      const load = async () => {
        const r = await fetch(API + '/public/pos-links/' + encodeURIComponent(TOKEN), { cache: 'no-store' });
        const j = await r.json().catch(()=>null);
        if (!r.ok || !j || !j.ok) throw new Error((j && (j.message || j.error)) || 'Failed to load payment');
        currency = 'ETB';
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
          const sub = note ? note : (qty > 0 ? ('x' + qty + ' @ ETB ' + money(unit)) : '');
          const icon = '<span class="material-symbols-outlined text-text-secondary">restaurant</span>';
          return '' +
            '<div class="flex items-start gap-4 bg-surface-dark px-2 py-3 justify-between rounded-lg hover:bg-surface-highlight/20 transition-colors">' +
              '<div class="flex gap-4">' +
                '<div class="size-12 rounded-lg bg-surface-highlight flex items-center justify-center shrink-0">' + icon + '</div>' +
                '<div class="flex flex-col justify-center">' +
                  '<p class="text-white text-base font-bold leading-normal">' + name + '</p>' +
                  '<p class="text-text-secondary text-sm font-medium leading-normal">' + sub + '</p>' +
                '</div>' +
              '</div>' +
              '<div class="shrink-0 pt-1"><p class="text-white text-base font-semibold leading-normal">ETB ' + money(line) + '</p></div>' +
            '</div>';
        }).join('');

        baseSubtotal = Number(j.subtotal || 0) || 0;
        baseTax = Number(j.tax || 0) || 0;
        baseService = Number(j.serviceCharge || 0) || 0;
        baseBeforeTip = baseSubtotal + baseTax + baseService;

        if (j.paid) {
          setPaidUi(j.receiptUrl || '');
          setMsg('', 'ok');
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
          try {
            if (qs.get('chapa') === 'success') {
              await fetch(API + '/public/pos-links/' + encodeURIComponent(TOKEN) + '/verify-chapa', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
              }).catch(() => null);
            }
          } catch {
            // ignore
          }
          const j = await load();
          if (j && j.paid) {
            const receiptUrl = String(j.receiptUrl || '');
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
            const selected = v === selectedPreset;
            x.classList.toggle('border-primary', selected);
            x.classList.toggle('bg-primary', selected);
            x.classList.toggle('text-black', selected);
            x.classList.toggle('shadow-[0_0_15px_rgba(238,173,43,0.25)]', selected);
            x.classList.toggle('border-surface-highlight', !selected);
            x.classList.toggle('bg-surface-highlight/30', !selected);
            x.classList.toggle('text-white', !selected);
            const amtEl = x.querySelector('.tipAmt');
            if (amtEl) {
              amtEl.classList.toggle('text-black/80', selected);
              amtEl.classList.toggle('text-text-secondary', !selected);
            }
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
      body{font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace; background:#ffffff; margin:0; color:#111; min-height:100vh; display:flex; flex-direction:column;}
      .topbar{position:sticky; top:0; z-index:10; background:#ffffffcc; backdrop-filter: blur(8px); border-bottom:1px solid #e5e7eb;}
      .topbar-inner{max-width:980px; margin:0 auto; padding:10px 14px; display:flex; align-items:center; justify-content:space-between; gap:10px;}
      .title{font-weight:800; color:#111827; letter-spacing:0.01em;}
      .actions{display:flex; gap:8px; flex-wrap:wrap; justify-content:flex-end;}
      .btn{height:36px; padding:0 12px; border-radius:10px; border:1px solid #e5e7eb; background:#fff; color:#111827; font-weight:700; cursor:pointer;}
      .btn:hover{background:#f9fafb}
      .btn.primary{background:#111827; color:#fff; border-color:#111827}
      .btn.primary:hover{background:#0b1220}
      .page{flex:1; display:flex; justify-content:center; align-items:flex-start; padding:18px 12px 28px}
      .paper{max-width:420px; margin:0 auto; background:#fff; border-radius:14px; box-shadow:0 10px 30px rgba(0,0,0,.12); overflow:hidden; border:1px solid #e5e7eb}
      .pad{padding:14px 14px}
      pre{margin:0; font-size:12px; line-height:1.25; white-space:pre; color:#111827;}
      .err{max-width:420px;margin:16px auto 0;background:#fee2e2;border:1px solid #fecaca;color:#7f1d1d;padding:10px 12px;border-radius:12px}
      .qr{display:flex; flex-direction:column; align-items:center; gap:8px; margin-top:12px; padding-top:12px; border-top:1px dashed #e5e7eb;}
      .qr img{width:168px;height:168px; image-rendering:pixelated; background:#fff; padding:8px; border:1px solid #e5e7eb; border-radius:10px;}
      .muted{color:#6b7280}
      @media print{
        body{background:#fff}
        .topbar{display:none}
        .page{padding:0; display:block}
        .paper{box-shadow:none;border-radius:0;border:0;max-width:100%}
      }
    </style>
  </head>
  <body>
    <div class="topbar">
      <div class="topbar-inner">
        <div class="title">Receipt</div>
        <div class="actions">
          <button id="btnPrint" class="btn">Print</button>
          <button id="btnDownload" class="btn primary">Download PNG</button>
        </div>
      </div>
    </div>
    <div class="page">
      <div id="err" class="err" style="display:none"></div>
      <div class="paper" id="wrap" style="display:none">
        <div class="pad" id="paper">
          <pre id="rcp">-</pre>
          <div class="qr">
            <div class="muted" style="font-size:12px">Scan to view this receipt</div>
            <img id="qr" alt="Receipt QR" crossOrigin="anonymous" />
            <div class="muted" style="font-size:11px">Powered by MirachPOS</div>
          </div>
        </div>
      </div>
    </div>
    <script>
      const TOKEN = ${JSON.stringify(safeToken)};
      const API = ${JSON.stringify(apiBase)};
      const money = (n) => (Math.round((Number(n) || 0) * 100) / 100).toFixed(2);
      const showErr = (t) => { const e=document.getElementById('err'); e.style.display='block'; e.textContent=t; };
      const downloadBlob = (blob, filename) => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 2000);
      };
      const loadImage = (src) => new Promise((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => resolve(img);
        img.onerror = reject;
        img.src = src;
      });
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
        if (phone) lines.push(center('TEL: ' + phone.replace(/^tel\\s*[:\\-]?\\s*/i,''), cols));
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

        document.getElementById('rcp').textContent = lines.join('\\n');

        const receiptUrl = location.origin + '/r/' + encodeURIComponent(TOKEN);
        const qr = document.getElementById('qr');
        const qrSrc = 'https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=' + encodeURIComponent(receiptUrl);
        qr.src = qrSrc;

        // Wire up actions
        const btnPrint = document.getElementById('btnPrint');
        const btnDownload = document.getElementById('btnDownload');
        if (btnPrint) btnPrint.onclick = () => window.print();

        if (btnDownload) {
          btnDownload.onclick = async () => {
            try {
              const pre = document.getElementById('rcp');
              const text = pre ? String(pre.textContent || '') : '';
              const textNorm = text.split('\\r').join('');
              const lines2 = textNorm.split('\\n');

              const dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
              const pad = 16;
              const fontSize = 12;
              const lineHeight = 16;
              const font = fontSize + 'px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace';

              // Measure
              const tmp = document.createElement('canvas');
              const tctx = tmp.getContext('2d');
              if (!tctx) throw new Error('canvas_not_supported');
              tctx.font = font;
              let maxW = 0;
              for (const ln of lines2) maxW = Math.max(maxW, tctx.measureText(ln).width);

              const qrImg = await loadImage(qrSrc);
              const qrSize = 180;
              const gap = 14;
              const width = Math.ceil(Math.max(maxW, qrSize) + pad * 2);
              const height = Math.ceil(pad + lines2.length * lineHeight + gap + 24 + qrSize + 24 + pad);

              const canvas = document.createElement('canvas');
              canvas.width = Math.ceil(width * dpr);
              canvas.height = Math.ceil(height * dpr);
              const ctx = canvas.getContext('2d');
              if (!ctx) throw new Error('canvas_not_supported');

              ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
              ctx.fillStyle = '#ffffff';
              ctx.fillRect(0, 0, width, height);
              ctx.fillStyle = '#111827';
              ctx.font = font;

              let y = pad + fontSize;
              for (const ln of lines2) {
                ctx.fillText(ln, pad, y);
                y += lineHeight;
              }

              y += gap;
              ctx.fillStyle = '#6b7280';
              ctx.font = '12px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace';
              ctx.fillText('Scan to view this receipt', pad, y);
              y += 14;

              // Center QR
              const qx = Math.round((width - qrSize) / 2);
              ctx.fillStyle = '#ffffff';
              ctx.fillRect(qx - 6, y - 6, qrSize + 12, qrSize + 12);
              ctx.strokeStyle = '#e5e7eb';
              ctx.lineWidth = 1;
              ctx.strokeRect(qx - 6, y - 6, qrSize + 12, qrSize + 12);
              ctx.drawImage(qrImg, qx, y, qrSize, qrSize);
              y += qrSize + 18;

              ctx.fillStyle = '#6b7280';
              ctx.fillText('Powered by MirachPOS', pad, y);

              canvas.toBlob((blob) => {
                if (!blob) return;
                const name = 'receipt_' + TOKEN + '.png';
                downloadBlob(blob, name);
              }, 'image/png');
            } catch (e) {
              showErr('Failed to export receipt image');
            }
          };
        }
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
  app.use('/api/auth/forgot-password', authLimiter);
  app.use('/api/auth/forgot-password', strictLimiter);
  app.use('/api/superadmin/login', authLimiter);

  // ==========================================================================
  // API ROUTES
  // ==========================================================================

  app.use('/admin', makeAdminRouter({ provisionKey: config.provisionKey }));
  app.use('/api/admin', makeAdminRouter({ provisionKey: config.provisionKey }));
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
