const ExcelJS = require('exceljs');

const asNumber = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

const toIsoDateOnly = (raw) => {
  const s = String(raw || '').trim();
  if (!s) return '';
  const m = /^\d{4}-\d{2}-\d{2}$/.exec(s);
  if (!m) return '';
  const d = new Date(`${s}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) return '';
  return s;
};

const setColumns = (ws, columns) => {
  ws.columns = columns.map((c) => ({
    key: c.key,
    width: c.width,
    style: c.style || {},
  }));
};

const addMetaBlock = (ws, businessName, reportTitle, fromDate, toDate) => {
  const title = String(reportTitle || 'Report');
  const biz = String(businessName || '');

  ws.addRow([biz]);
  ws.getRow(ws.rowCount).font = { bold: true, size: 14 };

  ws.addRow([title]);
  ws.getRow(ws.rowCount).font = { bold: true, size: 12 };

  const range = `${String(fromDate || '').trim()} → ${String(toDate || '').trim()}`.trim();
  ws.addRow([range]);
  ws.addRow([]);
};

const addTable = (ws, columns, rows) => {
  const cols = Array.isArray(columns) ? columns : [];
  const dataRows = Array.isArray(rows) ? rows : [];

  ws.addRow(cols.map((c) => c.header));
  const headerRow = ws.getRow(ws.rowCount);
  headerRow.font = { bold: true };

  for (const r of dataRows) {
    ws.addRow(cols.map((c) => (r && Object.prototype.hasOwnProperty.call(r, c.key) ? r[c.key] : '')));
  }

  const startRow = ws.rowCount - dataRows.length;
  const endRow = ws.rowCount;

  for (let i = startRow; i <= endRow; i++) {
    const row = ws.getRow(i);
    row.alignment = { vertical: 'middle' };
  }

  ws.views = [{ state: 'frozen', ySplit: 5 }];
};

const buildOwnerReportWorkbook = async ({
  businessName,
  fromDate,
  toDate,
  daily,
  products,
  staff,
  payments,
  voids,
}) => {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'MirachPOS';
  wb.created = new Date();

  const from = toIsoDateOnly(fromDate);
  const to = toIsoDateOnly(toDate);

  const dailySheet = wb.addWorksheet('Summary');
  addMetaBlock(dailySheet, businessName, 'Sales Summary', from || fromDate, to || toDate);
  const dailyCols = [
    { header: 'Date', key: 'date', width: 14 },
    { header: 'Branch', key: 'branchId', width: 18 },
    { header: 'Orders', key: 'orderCount', width: 10 },
    { header: 'Items', key: 'itemCount', width: 10 },
    { header: 'Gross', key: 'grossSales', width: 14, style: { numFmt: '#,##0.00' } },
    { header: 'Discounts', key: 'discounts', width: 14, style: { numFmt: '#,##0.00' } },
    { header: 'Net', key: 'netSales', width: 14, style: { numFmt: '#,##0.00' } },
    { header: 'Tax', key: 'tax', width: 12, style: { numFmt: '#,##0.00' } },
    { header: 'Tips', key: 'tips', width: 12, style: { numFmt: '#,##0.00' } },
    { header: 'Collected', key: 'totalCollected', width: 14, style: { numFmt: '#,##0.00' } },
    { header: 'Avg Ticket', key: 'avgTicket', width: 14, style: { numFmt: '#,##0.00' } },
  ];
  setColumns(dailySheet, dailyCols);

  const dailyRows = (Array.isArray(daily) ? daily : []).map((r) => ({
    date: String(r?.date || ''),
    branchId: String(r?.branchId || ''),
    orderCount: asNumber(r?.orderCount),
    itemCount: asNumber(r?.itemCount),
    grossSales: asNumber(r?.grossSales),
    discounts: asNumber(r?.discounts),
    netSales: asNumber(r?.netSales),
    tax: asNumber(r?.tax),
    tips: asNumber(r?.tips),
    totalCollected: asNumber(r?.totalCollected),
    avgTicket: asNumber(r?.avgTicket),
  }));
  addTable(dailySheet, dailyCols.map((c) => ({ header: c.header, key: c.key })), dailyRows);

  const productsSheet = wb.addWorksheet('Products');
  addMetaBlock(productsSheet, businessName, 'Product Performance', from || fromDate, to || toDate);
  const productCols = [
    { header: 'Product ID', key: 'productId', width: 18 },
    { header: 'Name', key: 'name', width: 32 },
    { header: 'Category', key: 'category', width: 20 },
    { header: 'Qty Sold', key: 'qtySold', width: 12 },
    { header: 'Revenue', key: 'revenue', width: 14, style: { numFmt: '#,##0.00' } },
    { header: 'Cost', key: 'cost', width: 14, style: { numFmt: '#,##0.00' } },
    { header: 'Profit', key: 'profit', width: 14, style: { numFmt: '#,##0.00' } },
    { header: 'Void Qty', key: 'voidQty', width: 10 },
  ];
  setColumns(productsSheet, productCols);

  const prodRows = (Array.isArray(products) ? products : []).map((r) => ({
    productId: String(r?.productId || ''),
    name: String(r?.name || ''),
    category: String(r?.category || ''),
    qtySold: asNumber(r?.qtySold),
    revenue: asNumber(r?.revenue),
    cost: asNumber(r?.cost),
    profit: asNumber(r?.profit),
    voidQty: asNumber(r?.voidQty),
  }));
  addTable(productsSheet, productCols.map((c) => ({ header: c.header, key: c.key })), prodRows);

  const staffSheet = wb.addWorksheet('Staff');
  addMetaBlock(staffSheet, businessName, 'Staff Sales', from || fromDate, to || toDate);
  const staffCols = [
    { header: 'Staff ID', key: 'staffId', width: 18 },
    { header: 'Name', key: 'staffName', width: 28 },
    { header: 'Orders', key: 'orderCount', width: 12 },
    { header: 'Net Sales', key: 'netSales', width: 14, style: { numFmt: '#,##0.00' } },
    { header: 'Gross Sales', key: 'grossSales', width: 14, style: { numFmt: '#,##0.00' } },
    { header: 'Discounts', key: 'discounts', width: 14, style: { numFmt: '#,##0.00' } },
    { header: 'Tax', key: 'tax', width: 12, style: { numFmt: '#,##0.00' } },
    { header: 'Tips', key: 'tips', width: 12, style: { numFmt: '#,##0.00' } },
    { header: 'Collected', key: 'totalCollected', width: 14, style: { numFmt: '#,##0.00' } },
  ];
  setColumns(staffSheet, staffCols);

  const staffRows = (Array.isArray(staff) ? staff : []).map((r) => ({
    staffId: String(r?.staffId || ''),
    staffName: String(r?.staffName || ''),
    orderCount: asNumber(r?.orderCount),
    netSales: asNumber(r?.netSales),
    grossSales: asNumber(r?.grossSales),
    discounts: asNumber(r?.discounts),
    tax: asNumber(r?.tax),
    tips: asNumber(r?.tips),
    totalCollected: asNumber(r?.totalCollected),
  }));
  addTable(staffSheet, staffCols.map((c) => ({ header: c.header, key: c.key })), staffRows);

  const paymentsSheet = wb.addWorksheet('Payments');
  addMetaBlock(paymentsSheet, businessName, 'Payments Breakdown', from || fromDate, to || toDate);
  const paymentCols = [
    { header: 'Method', key: 'method', width: 20 },
    { header: 'Amount', key: 'amount', width: 16, style: { numFmt: '#,##0.00' } },
  ];
  setColumns(paymentsSheet, paymentCols);

  const paymentRows = (Array.isArray(payments) ? payments : [])
    .map((r) => ({
      method: String(r?.method || ''),
      amount: asNumber(r?.amount),
    }))
    .filter((r) => r.method);
  addTable(paymentsSheet, paymentCols.map((c) => ({ header: c.header, key: c.key })), paymentRows);

  const voidsSheet = wb.addWorksheet('Voids');
  addMetaBlock(voidsSheet, businessName, 'Voids & Refunds', from || fromDate, to || toDate);
  const voidCols = [
    { header: 'ID', key: 'id', width: 18 },
    { header: 'Type', key: 'type', width: 10 },
    { header: 'Order', key: 'orderId', width: 18 },
    { header: 'Product', key: 'productName', width: 26 },
    { header: 'Qty', key: 'qty', width: 8 },
    { header: 'Amount', key: 'amount', width: 14, style: { numFmt: '#,##0.00' } },
    { header: 'Reason', key: 'reason', width: 28 },
    { header: 'Authorized By', key: 'authorizedBy', width: 22 },
    { header: 'At', key: 'occurredAt', width: 22 },
  ];
  setColumns(voidsSheet, voidCols);

  const voidRows = (Array.isArray(voids) ? voids : []).map((r) => ({
    id: String(r?.id || ''),
    type: String(r?.type || ''),
    orderId: String(r?.orderId || ''),
    productName: String(r?.productName || ''),
    qty: asNumber(r?.qty),
    amount: asNumber(r?.amount),
    reason: String(r?.reason || ''),
    authorizedBy: String(r?.authorizedBy || ''),
    occurredAt: r?.occurredAt ? new Date(r.occurredAt).toISOString() : '',
  }));
  addTable(voidsSheet, voidCols.map((c) => ({ header: c.header, key: c.key })), voidRows);

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
};

module.exports = { buildOwnerReportWorkbook };
