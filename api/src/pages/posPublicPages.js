const handleCheckoutPage = (req, res) => {
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
};

const handleReceiptPage = (req, res) => {
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
      const HEARTBEAT_KEY = 'mirachpos.customerDisplay.heartbeat.v1';
      const beat = () => {
        try { localStorage.setItem(HEARTBEAT_KEY, String(Date.now())); } catch { }
      };
      beat();
      setInterval(beat, 3000);
      window.addEventListener('beforeunload', () => {
        try { localStorage.removeItem(HEARTBEAT_KEY); } catch { }
      });
      const showErr = (t) => { const e=document.getElementById('err'); if (!e) return; e.classList.remove('hidden'); e.textContent=t; };
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
};

const handleDisplayPage = (req, res) => {
  const token = String(req.params.token || '').trim();
  const xfProto = String(req.header('x-forwarded-proto') || '').split(',')[0].trim().toLowerCase();
  const proto = xfProto || req.protocol;
  const host = proto + '://' + req.get('host');
  const apiBase = `${host}/api`;
  const safeToken = token.replace(/</g, '').replace(/>/g, '');
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  return res.status(200).send(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>MirachPOS Customer Display</title>
    <link href="https://fonts.googleapis.com" rel="preconnect" />
    <link crossorigin="" href="https://fonts.gstatic.com" rel="preconnect" />
    <link href="https://fonts.googleapis.com/css2?family=Work+Sans:wght@400;500;700&display=swap" rel="stylesheet" />
    <link href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&display=swap" rel="stylesheet" />
    <script src="https://cdn.tailwindcss.com?plugins=forms,container-queries"></script>
    <script>
      tailwind.config = {
        darkMode: 'class',
        theme: {
          extend: {
            colors: {
              primary: '#b86614',
              'primary-dark': '#96520f',
              'background-light': '#fcfaf8',
              'background-dark': '#211911',
              'surface-light': '#ffffff',
              'surface-dark': '#2d241b',
              'text-main-light': '#1b140e',
              'text-main-dark': '#f0e6dd',
              'text-sub-light': '#97734e',
              'text-sub-dark': '#bca388',
              'border-light': '#e7dbd0',
              'border-dark': '#4a3b2f',
            },
            fontFamily: {
              display: ['Work Sans', 'sans-serif'],
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
  <body class="bg-background-light text-text-main-light dark:bg-background-dark dark:text-text-main-dark font-display min-h-screen flex flex-col items-center">
    <div class="w-full max-w-[640px] bg-background-light dark:bg-background-dark min-h-screen shadow-2xl flex flex-col">
      <div class="hidden rounded-lg border border-red-500/30 bg-red-500/10 text-red-100 px-4 py-3 text-sm" id="err"></div>

      <div class="flex flex-col" id="paymentView">
        <header class="flex items-center justify-between whitespace-nowrap border-b border-solid border-border-light dark:border-border-dark px-4 py-3 bg-surface-light dark:bg-surface-dark">
          <div class="flex items-center gap-3 text-text-main-light dark:text-text-main-dark">
            <div class="size-6 text-primary">
              <span class="material-symbols-outlined text-2xl">point_of_sale</span>
            </div>
            <h2 class="text-lg font-bold leading-tight tracking-[-0.015em]" id="cafe">MirachPos</h2>
          </div>
          <div class="flex items-center gap-3">
            <div class="rounded-lg border border-border-light dark:border-border-dark bg-background-light dark:bg-background-dark px-3 py-1 text-xs font-bold uppercase tracking-[0.2em] text-text-sub-light dark:text-text-sub-dark" id="status">Pending</div>
          </div>
        </header>

        <main class="flex-1 flex flex-col p-4 gap-4">
          <div>
            <h1 class="text-text-main-light dark:text-text-main-dark text-2xl font-bold leading-tight">Checkout &amp; Payment</h1>
            <p class="text-text-sub-light dark:text-text-sub-dark text-xs mt-1" id="meta">Loading…</p>
            <p class="text-text-sub-light dark:text-text-sub-dark text-[10px] mt-1" id="updated"></p>
          </div>

          <section class="flex flex-col gap-4">
            <h3 class="text-text-main-light dark:text-text-main-dark text-base font-bold leading-tight">Order Summary</h3>
            <div class="overflow-hidden rounded-xl border border-border-light dark:border-border-dark bg-surface-light dark:bg-surface-dark shadow-sm">
              <div class="grid grid-cols-12 gap-2 bg-background-light dark:bg-[#2a2219] px-4 py-3 text-sm font-medium text-text-sub-light dark:text-text-sub-dark border-b border-border-light dark:border-border-dark">
                <div class="col-span-7">Product</div>
                <div class="col-span-2 text-center">Qty</div>
                <div class="col-span-3 text-right">Price</div>
              </div>
              <div class="px-4" id="items"></div>
            </div>
          </section>

          <div class="flex flex-col gap-2 py-2 border-t border-border-light dark:border-border-dark mt-2">
            <div class="flex justify-between items-center py-1">
              <p class="text-text-sub-light dark:text-text-sub-dark text-sm">Subtotal</p>
              <p class="text-text-main-light dark:text-text-main-dark text-sm font-medium" id="subtotal">ETB 0.00</p>
            </div>
            <div class="flex justify-between items-center py-1">
              <p class="text-text-sub-light dark:text-text-sub-dark text-sm">Tax</p>
              <p class="text-text-main-light dark:text-text-main-dark text-sm font-medium" id="tax">ETB 0.00</p>
            </div>
            <div class="flex justify-between items-center py-1">
              <p class="text-text-sub-light dark:text-text-sub-dark text-sm">Service</p>
              <p class="text-text-main-light dark:text-text-main-dark text-sm font-medium" id="service">ETB 0.00</p>
            </div>
          </div>
        </main>

        <footer class="w-full bg-surface-light dark:bg-surface-dark border-t border-border-light dark:border-border-dark p-4 pb-5">
          <div class="flex flex-col items-center gap-6">
            <div class="flex flex-col items-center gap-1">
              <span class="text-text-sub-light dark:text-text-sub-dark text-sm uppercase tracking-wider font-semibold">Total Amount</span>
              <span class="text-3xl font-bold text-[#4a3b2f] dark:text-[#dcc9b6]" id="total">ETB 0.00</span>
            </div>
            <div class="w-full bg-background-light dark:bg-background-dark rounded-xl p-4 border border-border-light dark:border-border-dark flex flex-col items-center gap-3 relative overflow-hidden group" id="paymentDetails">
              <div class="absolute top-4 left-4 w-4 h-4 border-l-2 border-t-2 border-primary"></div>
              <div class="absolute top-4 right-4 w-4 h-4 border-r-2 border-t-2 border-primary"></div>
              <div class="absolute bottom-4 left-4 w-4 h-4 border-l-2 border-b-2 border-primary"></div>
              <div class="absolute bottom-4 right-4 w-4 h-4 border-r-2 border-b-2 border-primary"></div>
              <div class="bg-white p-2 rounded-lg shadow-sm">
                <div class="w-32 h-32 bg-white flex items-center justify-center relative overflow-hidden rounded">
                  <img id="paymentDetailsQr" alt="Payment QR" class="hidden w-32 h-32 object-cover" />
                  <div class="absolute inset-0 flex items-center justify-center" id="paymentDetailsIcon">
                    <div class="bg-white p-1 rounded-full shadow-sm">
                      <span class="material-symbols-outlined text-primary text-2xl">payments</span>
                    </div>
                  </div>
                </div>
              </div>
              <div class="flex items-center gap-2 text-primary font-medium text-sm" id="paymentDetailsTitle">
                <span class="material-symbols-outlined text-lg">qr_code_scanner</span>
                <span>Scan to Pay</span>
              </div>
              <div class="w-full space-y-2 text-xs text-text-sub-light dark:text-text-sub-dark" id="paymentDetailsList"></div>
            </div>
          </div>
        </footer>
      </div>

      <div class="rounded-2xl border border-border-light bg-surface-light shadow-xl shadow-black/10 hidden dark:border-border-dark dark:bg-surface-dark dark:shadow-black/40" id="receiptView">
        <div class="px-6 py-6 space-y-4">
          <div class="text-xl font-extrabold text-slate-900 dark:text-white" id="receiptCafe">MirachPOS</div>
          <div class="text-xs uppercase tracking-[0.3em] text-slate-500 dark:text-text-secondary" id="receiptMeta">Receipt</div>
          <div class="space-y-2" id="receiptItems"></div>
          <div class="border-t border-dashed border-slate-200 pt-3 text-lg font-extrabold dark:border-surface-highlight" id="receiptTotal">ETB 0.00</div>
          <div class="text-xs text-slate-500 dark:text-text-secondary" id="receiptPay"></div>
        </div>
      </div>

      <div class="rounded-2xl border border-border-light bg-surface-light shadow-xl shadow-black/10 hidden dark:border-border-dark dark:bg-surface-dark dark:shadow-black/40" id="menuView">
        <div class="flex items-center justify-between border-b border-slate-200 px-6 py-4 dark:border-surface-highlight">
          <div>
            <div class="text-2xl font-extrabold tracking-tight text-slate-900 dark:text-white" id="menuCafe">MirachPOS</div>
            <div class="text-sm text-slate-500 dark:text-text-secondary" id="menuMeta">Menu</div>
          </div>
        </div>
        <div class="px-6 py-6">
          <div class="space-y-6" id="menuGrid"></div>
        </div>
      </div>
    </div>
    <script>
      const TOKEN = ${JSON.stringify(safeToken)};
      const API = ${JSON.stringify(apiBase)};
      const money = (n) => (Math.round((Number(n) || 0) * 100) / 100).toFixed(2);
      const showErr = (t) => { const e=document.getElementById('err'); if (!e) return; e.classList.remove('hidden'); e.textContent=t; };
      const setText = (id, val) => { const el=document.getElementById(id); if (el) el.textContent = val; };
      const renderItems = (items, currency) => {
        const wrap = document.getElementById('items');
        if (!wrap) return;
        if (!items || !items.length) {
          wrap.innerHTML = '<div class="py-6 text-center text-slate-500 dark:text-text-secondary">No items</div>';
          return;
        }
        wrap.innerHTML = items.map((it) => {
          const name = String(it.name || '-');
          const qty = Number(it.qty || 0) || 0;
          const unit = Number(it.unitPrice || 0) || 0;
          const amount = qty * unit;
          return '<div class="grid grid-cols-12 gap-2 py-4 border-b border-border-light dark:border-border-dark items-center">' +
            '<div class="col-span-7 text-text-main-light dark:text-text-main-dark text-sm font-medium">' + name + '</div>' +
            '<div class="col-span-2 text-center text-text-sub-light dark:text-text-sub-dark text-sm">' + qty + '</div>' +
            '<div class="col-span-3 text-right text-text-main-light dark:text-text-main-dark text-sm font-medium">' + currency + ' ' + money(amount) + '</div>' +
            '</div>';
        }).join('');
      };
      const renderReceiptItems = (items, currency) => {
        const wrap = document.getElementById('receiptItems');
        if (!wrap) return;
        if (!items || !items.length) {
          wrap.innerHTML = '<div class="py-6 text-center text-slate-500 dark:text-text-secondary">No items</div>';
          return;
        }
        wrap.innerHTML = items.map((it) => {
          const name = String(it.name || '-');
          const qty = Number(it.qty || 0) || 0;
          const unit = Number(it.unitPrice || 0) || 0;
          const amount = qty * unit;
          const img = String(it.image || '').trim();
          const thumb = img ? '<img src="' + img + '" alt="' + name + '" class="h-10 w-10 rounded-md object-cover border border-slate-200 dark:border-surface-highlight" />' : '<div class="h-10 w-10 rounded-md bg-slate-100 border border-slate-200 dark:bg-surface-highlight/40 dark:border-surface-highlight"></div>';
          return '<div class="flex items-center justify-between gap-3 py-2 border-b border-dashed border-slate-200 last:border-0 dark:border-surface-highlight"><div class="flex items-center gap-3">' + thumb + '<div><div class="text-sm font-semibold text-slate-900 dark:text-white">' + name + '</div><div class="text-xs text-slate-500 dark:text-text-secondary">x' + qty + '</div></div></div><div class="text-sm font-bold text-slate-900 dark:text-white">' + currency + ' ' + money(amount) + '</div></div>';
        }).join('');
      };
      const renderMenu = (menu, currency) => {
        const wrap = document.getElementById('menuGrid');
        if (!wrap) return;
        const products = Array.isArray(menu?.products) ? menu.products : [];
        const categories = Array.isArray(menu?.categories) ? menu.categories : [];
        if (!products.length) {
          wrap.innerHTML = '<div class="py-6 text-center text-slate-500 dark:text-text-secondary">Menu is empty</div>';
          return;
        }
        const byCategory = new Map();
        for (const p of products) {
          const cat = String(p.category || 'Uncategorized');
          if (!byCategory.has(cat)) byCategory.set(cat, []);
          byCategory.get(cat).push(p);
        }
        const orderedCategories = categories.length
          ? categories
          : Array.from(byCategory.keys()).sort((a, b) => a.localeCompare(b));

        const cardHtml = (p) => {
          const name = String(p.name || '-');
          const price = Number(p.price || 0) || 0;
          const desc = String(p.description || '').trim();
          const img = String(p.image || '').trim();
          const status = String(p.status || 'Active');
          const isSoldOut = status.toLowerCase() !== 'active';
          const badgeClass = isSoldOut ? 'bg-red-500/20 text-red-300 border-red-500/30' : 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30';
          const badgeLabel = isSoldOut ? 'Sold Out' : 'Available';
          const imgTag = img ? '<img class="h-32 w-full object-cover" src="' + img + '" alt="' + name + '" />' : '<div class="h-32 w-full bg-slate-100 dark:bg-surface-highlight/40"></div>';
          return '<div class="group bg-white border border-slate-200 rounded-xl overflow-hidden flex flex-col relative dark:bg-surface-dark dark:border-surface-highlight">' +
            '<div class="absolute top-2 right-2 z-10"><span class="text-[10px] font-bold px-2 py-0.5 rounded-full border ' + badgeClass + '">' + badgeLabel + '</span></div>' +
            '<div class="bg-slate-100 dark:bg-surface-highlight/30">' + imgTag + '</div>' +
            '<div class="p-3 flex flex-col gap-1">' +
            '<div class="text-base font-bold text-slate-900 dark:text-white">' + name + '</div>' +
            (desc ? '<div class="text-xs text-slate-500 dark:text-text-secondary">' + desc + '</div>' : '<div class="text-xs text-slate-500 dark:text-text-secondary">&nbsp;</div>') +
            '<div class="mt-2 flex items-center justify-between">' +
            '<span class="text-lg font-bold text-accent-gold">' + currency + ' ' + money(price) + '</span>' +
            '<div class="size-8 rounded-lg flex items-center justify-center shadow-lg ' + (isSoldOut ? 'bg-slate-100 text-slate-500 dark:bg-surface-highlight/40 dark:text-text-secondary' : 'bg-primary text-black shadow-primary/20') + '">+</div>' +
            '</div></div></div>';
        };

        wrap.innerHTML = orderedCategories.map((cat) => {
          const items = byCategory.get(cat) || [];
          if (!items.length) return '';
          return '<section class="space-y-3">' +
            '<div class="flex items-center gap-3">' +
            '<div class="h-px flex-1 bg-slate-200 dark:bg-surface-highlight"></div>' +
            '<div class="text-xs uppercase tracking-[0.3em] text-slate-500 dark:text-text-secondary">' + cat + '</div>' +
            '<div class="h-px flex-1 bg-slate-200 dark:bg-surface-highlight"></div>' +
            '</div>' +
            '<div class="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">' +
            items.map(cardHtml).join('') +
            '</div>' +
            '</section>';
        }).join('');
      };
      let menuTimer = null;
      let cachedMenu = null;
      let autoMenuKey = '';
      let autoMenuActive = false;
      let currentMode = 'payment';
      const clearMenuTimer = () => {
        if (!menuTimer) return;
        clearTimeout(menuTimer);
        menuTimer = null;
      };
      const fetchMenu = async () => {
        try {
          const r = await fetch(API + '/public/pos-display/' + encodeURIComponent(TOKEN) + '?includeMenu=1');
          const j = await r.json().catch(() => null);
          if (!r.ok || !j || !j.ok || !j.menu) return null;
          cachedMenu = j.menu;
          return j.menu;
        } catch {
          return null;
        }
      };
      const scheduleMenu = (currency) => {
        clearMenuTimer();
        menuTimer = setTimeout(() => {
          autoMenuActive = true;
          showView('menu');
          renderMenu(cachedMenu || {}, currency);
        }, 3000);
      };
      const normalizeMode = (raw) => {
        const v = String(raw || '').trim().toLowerCase();
        if (v === 'menu' || v === 'payment' || v === 'receipt') return v;
        return 'payment';
      };
      const showView = (mode) => {
        const paymentView = document.getElementById('paymentView');
        const receiptView = document.getElementById('receiptView');
        const menuView = document.getElementById('menuView');
        if (paymentView) paymentView.classList.toggle('hidden', mode !== 'payment');
        if (receiptView) receiptView.classList.toggle('hidden', mode !== 'receipt');
        if (menuView) menuView.classList.toggle('hidden', mode !== 'menu');
      };
      const renderPaymentDetails = (data) => {
        const wrap = document.getElementById('paymentDetails');
        const title = document.getElementById('paymentDetailsTitle');
        const list = document.getElementById('paymentDetailsList');
        const img = document.getElementById('paymentDetailsQr');
        const icon = document.getElementById('paymentDetailsIcon');
        if (!wrap || !list || !title || !img || !icon) return;

        const methodRaw = String(data?.paymentMethod || '').trim().toLowerCase();
        const details = data?.paymentDetails || {};
        const isCash = !methodRaw || methodRaw === 'cash' || methodRaw === 'loyalty';
        if (isCash) {
          wrap.classList.add('hidden');
          list.innerHTML = '';
          img.classList.add('hidden');
          img.removeAttribute('src');
          icon.classList.remove('hidden');
          return;
        }

        let titleText = 'Payment';
        let imgSrc = '';
        let items = [];

        if (methodRaw === 'telebirr') {
          titleText = 'Telebirr';
          const tele = details?.telebirr || {};
          imgSrc = String(tele.image || '').trim();
          if (tele.accountName) items.push(['Account', tele.accountName]);
          if (tele.phone) items.push(['Phone', tele.phone]);
          if (tele.merchantId) items.push(['Merchant ID', tele.merchantId]);
          if (tele.note) items.push(['Note', tele.note]);
        } else if (methodRaw === 'mobile pay' || methodRaw === 'mobile_pay' || methodRaw === 'mobilepay' || methodRaw === 'chapa') {
          titleText = 'Mobile Pay (Chapa)';
          const payUrl = String(data?.paymentUrl || '').trim();
          if (payUrl) {
            imgSrc = 'https://api.qrserver.com/v1/create-qr-code/?size=240x240&data=' + encodeURIComponent(payUrl);
          }
        } else if (methodRaw === 'bank transfer' || methodRaw === 'bank_transfer' || methodRaw === 'bank') {
          titleText = 'Bank Transfer';
          const bank = details?.bankTransfer || {};
          imgSrc = String(bank.image || '').trim();
          if (bank.bankName) items.push(['Bank', bank.bankName]);
          if (bank.accountName) items.push(['Account', bank.accountName]);
          if (bank.accountNumber) items.push(['Account No.', bank.accountNumber]);
          if (bank.phone) items.push(['Phone', bank.phone]);
          if (bank.note) items.push(['Note', bank.note]);
        }

        if (!imgSrc && !items.length) {
          wrap.classList.add('hidden');
          list.innerHTML = '';
          img.classList.add('hidden');
          img.removeAttribute('src');
          icon.classList.remove('hidden');
          return;
        }

        title.textContent = titleText;
        if (imgSrc) {
          img.src = imgSrc;
          img.classList.remove('hidden');
          icon.classList.add('hidden');
        } else {
          img.classList.add('hidden');
          img.removeAttribute('src');
          icon.classList.remove('hidden');
        }
        list.innerHTML = items.map(([label, value]) => {
          return '<div class="flex items-start justify-between gap-3"><span class="uppercase tracking-[0.2em] text-[10px]">' + label + '</span><span class="text-right text-text-main-light dark:text-text-main-dark font-semibold">' + value + '</span></div>';
        }).join('');
        wrap.classList.remove('hidden');
      };
      const load = async () => {
        const url = API + '/public/pos-display/' + encodeURIComponent(TOKEN) + '?ts=' + Date.now();
        const r = await fetch(url, { cache: 'no-store' });
        const j = await r.json().catch(() => null);
        if (!r.ok || !j || !j.ok) throw new Error((j && (j.message || j.error)) || 'Failed to load display');
        const currency = String(j.currency || 'ETB').toUpperCase();
        const serverMode = normalizeMode(j.mode);
        const overrideRaw = String(j.modeOverride || '').trim();
        const hasOverride = overrideRaw.length > 0;
        const overrideMode = hasOverride ? normalizeMode(overrideRaw) : 'payment';
        const receiptKey = String(j.orderId || '') + '|' + String(j.paidAt || '');
        let mode = serverMode;
        currentMode = mode;
        if (j.menu) cachedMenu = j.menu;
        if (hasOverride) {
          autoMenuActive = false;
          autoMenuKey = '';
          clearMenuTimer();
          mode = overrideMode;
        } else if (serverMode === 'receipt') {
          if (autoMenuActive && autoMenuKey && autoMenuKey === receiptKey) {
            mode = 'menu';
          } else {
            autoMenuActive = true;
            autoMenuKey = receiptKey;
          }
        } else {
          autoMenuActive = false;
          autoMenuKey = '';
          clearMenuTimer();
        }

        showView(mode);

        if (mode === 'menu') {
          renderPaymentDetails(null);
          setText('menuCafe', String(j.cafeName || 'MirachPOS'));
          if (!cachedMenu) {
            void fetchMenu();
          }
          renderMenu(j.menu || cachedMenu || {}, currency);
          return;
        }

        setText('cafe', String(j.cafeName || 'MirachPOS'));
        setText('meta', 'Order ' + (j.orderNumber || j.orderId || '') + ' • ' + (j.tableName || 'Walk-in'));
        setText('updated', 'Updated ' + new Date().toLocaleTimeString());
        setText('status', String(j.status || 'Pending'));
        renderItems(j.items || [], currency);
        setText('subtotal', currency + ' ' + money(j.subtotal));
        setText('tax', currency + ' ' + money(j.tax));
        setText('service', currency + ' ' + money(j.serviceCharge));
        setText('total', currency + ' ' + money(j.total));
        if (mode === 'payment') {
          renderPaymentDetails(j || {});
        } else {
          renderPaymentDetails(null);
        }

        if (serverMode === 'receipt' && !hasOverride) {
          setText('receiptCafe', String(j.cafeName || 'MirachPOS'));
          setText('receiptMeta', 'Receipt • ' + (j.orderNumber || j.orderId || ''));
          renderReceiptItems(j.items || [], currency);
          setText('receiptTotal', currency + ' ' + money(j.total));
          const payLine = (j.paymentMethod ? String(j.paymentMethod) : 'Payment') + (j.paymentReference ? ' • ' + String(j.paymentReference) : '');
          setText('receiptPay', payLine);
          if (!cachedMenu) {
            void fetchMenu();
          }
          scheduleMenu(currency);
        }
      };
      const poll = () => load().catch((e) => showErr(String(e && e.message ? e.message : e)));
      poll();
      setInterval(poll, 3000);
    </script>
  </body>
</html>`);
};

module.exports = { handleCheckoutPage, handleReceiptPage, handleDisplayPage };
