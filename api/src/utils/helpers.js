const formatCurrency = (amount, currency = 'ETB') => {
  const n = Number(amount);
  if (!Number.isFinite(n)) return '';
  const abs = Math.abs(n);
  const formatted = abs.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${n < 0 ? '-' : ''}${currency} ${formatted}`;
};

const formatDate = (date, includeTime = false) => {
  try {
    if (!date) return '';
    const d = date instanceof Date ? date : new Date(date);
    if (!Number.isFinite(d.getTime())) return '';

    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');

    if (!includeTime) return `${yyyy}-${mm}-${dd}`;

    const hh = String(d.getHours()).padStart(2, '0');
    const mi = String(d.getMinutes()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd} ${hh}:${mi}`;
  } catch {
    return '';
  }
};

let lastIdTs = 0;
let idSeq = 0;

const nextIdStamp = () => {
  const ts = Date.now();
  if (ts === lastIdTs) {
    idSeq += 1;
  } else {
    lastIdTs = ts;
    idSeq = 0;
  }
  return idSeq ? `${ts}${String(idSeq).padStart(3, '0')}` : String(ts);
};

const generateOrderNumber = (prefix = 'ORD') => {
  const p = String(prefix || '').trim() || 'ORD';
  return `${p}-${nextIdStamp()}`;
};

const generateReceiptId = (prefix = 'RCP') => {
  const p = String(prefix || '').trim() || 'RCP';
  return `${p}-${nextIdStamp()}`;
};

const slugify = (input) => {
  const s = String(input || '').trim().toLowerCase();
  if (!s) return '';
  return s
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
};

const truncate = (input, maxLength, suffix = '...') => {
  const s = String(input ?? '');
  const n = Number(maxLength);
  if (!Number.isFinite(n) || n <= 0) return '';
  if (s.length <= n) return s;
  return `${s.slice(0, n)}${suffix}`;
};

module.exports = {
  formatCurrency,
  formatDate,
  generateOrderNumber,
  generateReceiptId,
  slugify,
  truncate,
};
