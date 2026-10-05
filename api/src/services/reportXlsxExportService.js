const ExcelJS = require('exceljs');

const asNumber = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

// Helper to format date without timezone shift
const formatDateOnly = (dateStr) => {
  const s = String(dateStr || '').trim();
  if (!s) return '';
  // If already in YYYY-MM-DD format, return as-is
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  // Try to parse and format without timezone conversion
  try {
    const d = new Date(s);
    if (Number.isNaN(d.getTime())) return s;
    // Format as YYYY-MM-DD using UTC to avoid shift
    return d.toISOString().slice(0, 10);
  } catch {
    return s;
  }
};

const toIsoDateOnly = (raw) => {
  const s = String(raw || '').trim();
  if (!s) return '';
  
  // Extract YYYY-MM-DD directly from the string to avoid ANY Date object parsing
  // which might apply a timezone shift based on the current machine's local time.
  const match = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (match) {
    return `${match[1]}-${match[2]}-${match[3]}`;
  }
  
  // Last resort: if it's a timestamp or other format
  try {
    const d = new Date(s);
    if (Number.isNaN(d.getTime())) return '';
    // Use getUTC* to ensure zero timezone shift
    const year = d.getUTCFullYear();
    const month = String(d.getUTCMonth() + 1).padStart(2, '0');
    const day = String(d.getUTCDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  } catch {
    return '';
  }
};

const setColumns = (ws, columns) => {
  ws.columns = columns.map((c) => ({
    key: c.key,
    width: c.width,
    style: c.style || {},
  }));
};

const addMetaBlock = (ws, businessName, reportTitle, fromDate, toDate, maxCol = 8) => {
  const title = String(reportTitle || 'Report');
  const biz = String(businessName || '');

  // Row 1: Business name - merged and centered
  ws.addRow([biz]);
  const bizRow = ws.getRow(1);
  bizRow.font = { bold: true, size: 16 };
  bizRow.alignment = { horizontal: 'center' };
  ws.mergeCells(1, 1, 1, maxCol);

  // Row 2: Report title - merged and centered
  ws.addRow([title]);
  const titleRow = ws.getRow(2);
  titleRow.font = { bold: true, size: 14 };
  titleRow.alignment = { horizontal: 'center' };
  ws.mergeCells(2, 1, 2, maxCol);

  // Row 3: Date range - merged and centered
  const range = `Period: ${String(fromDate || '').trim()} to ${String(toDate || '').trim()}`.trim();
  ws.addRow([range]);
  const rangeRow = ws.getRow(3);
  rangeRow.font = { size: 11 };
  rangeRow.alignment = { horizontal: 'center' };
  ws.mergeCells(3, 1, 3, maxCol);

  // Row 4: Empty
  ws.addRow([]);
};

const addTable = (ws, columns, rows) => {
  const cols = Array.isArray(columns) ? columns : [];
  const dataRows = Array.isArray(rows) ? rows : [];

  const startRow = ws.rowCount + 1;
  ws.addRow(cols.map((c) => c.header));
  const headerRow = ws.getRow(startRow);
  headerRow.font = { bold: true };
  headerRow.alignment = { horizontal: 'center', vertical: 'middle' };

  for (const r of dataRows) {
    ws.addRow(cols.map((c) => (r && Object.prototype.hasOwnProperty.call(r, c.key) ? r[c.key] : '')));
  }

  const endRow = ws.rowCount;

  for (let i = startRow; i <= endRow; i++) {
    const row = ws.getRow(i);
    row.alignment = { vertical: 'middle' };
  }

  ws.views = [{ state: 'frozen', ySplit: startRow }];
};

const buildOwnerReportWorkbook = async ({
  businessName,
  fromDate,
  toDate,
  daily,
  products,
  staff,
  payments,
  paymentOrders,
  voids,
}) => {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'MirachPOS';
  wb.created = new Date();

  const from = toIsoDateOnly(fromDate);
  const to = toIsoDateOnly(toDate);

  const dailySheet = wb.addWorksheet('Summary');
  addMetaBlock(dailySheet, businessName, 'Sales Summary', from || fromDate, to || toDate, 11);
  const dailyCols = [
    { header: 'Date', key: 'date', width: 14 },
    { header: 'Branch', key: 'branchId', width: 18 },
    { header: 'Orders', key: 'orderCount', width: 10 },
    { header: 'Items', key: 'itemCount', width: 10 },
    { header: 'Gross', key: 'grossSales', width: 14, style: { numFmt: '#,##0.00' } },
    { header: 'Discounts', key: 'discounts', width: 14, style: { numFmt: '#,##0.00' } },
    { header: 'Net', key: 'netSales', width: 14, style: { numFmt: '#,##0.00' } },
    { header: 'Takeaway Fee', key: 'takeawayFee', width: 14, style: { numFmt: '#,##0.00' } },
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
    takeawayFee: asNumber(r?.paymentBreakdown?.['_takeawayFeeTotal']),
    tax: asNumber(r?.tax),
    tips: asNumber(r?.tips),
    totalCollected: asNumber(r?.totalCollected),
    avgTicket: asNumber(r?.avgTicket),
  }));
  addTable(dailySheet, dailyCols.map((c) => ({ header: c.header, key: c.key })), dailyRows);

  const productsSheet = wb.addWorksheet('Products');
  addMetaBlock(productsSheet, businessName, 'Product Performance', from || fromDate, to || toDate, 9);
  const productCols = [
    { header: 'Product ID', key: 'productId', width: 18 },
    { header: 'Name', key: 'name', width: 32 },
    { header: 'Category', key: 'category', width: 20 },
    { header: 'Qty Sold', key: 'qtySold', width: 12 },
    { header: 'Unit Price', key: 'unitPrice', width: 14, style: { numFmt: '#,##0.00' } },
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
    unitPrice: asNumber(r?.qtySold) > 0 ? asNumber(r?.revenue) / asNumber(r?.qtySold) : 0,
    revenue: asNumber(r?.revenue),
    cost: asNumber(r?.cost),
    profit: asNumber(r?.profit),
    voidQty: asNumber(r?.voidQty),
  }));
  addTable(productsSheet, productCols.map((c) => ({ header: c.header, key: c.key })), prodRows);

  const staffSheet = wb.addWorksheet('Staff');
  addMetaBlock(staffSheet, businessName, 'Staff Sales', from || fromDate, to || toDate, 9);
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

  const paymentsSheet = wb.addWorksheet('Payment Methods');
  const pmMaxCol = 8;
  addMetaBlock(paymentsSheet, businessName, 'Payment Methods Report', from || fromDate, to || toDate, pmMaxCol);

  // ── Section 1: Payment Method Totals ──
  const summaryTitleRow = paymentsSheet.addRow(['PAYMENT METHOD SUMMARY']);
  summaryTitleRow.font = { bold: true, size: 13, color: { argb: 'FFFFFF' } };
  summaryTitleRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: '1A365D' } };
  summaryTitleRow.alignment = { horizontal: 'center' };
  paymentsSheet.mergeCells(summaryTitleRow.number, 1, summaryTitleRow.number, pmMaxCol);

  paymentsSheet.addRow([]);

  const pmHeaderRow = paymentsSheet.addRow(['Payment Method', 'Total Amount (ETB)']);
  pmHeaderRow.font = { bold: true, color: { argb: 'FFFFFF' } };
  pmHeaderRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: '2C5282' } };
  pmHeaderRow.alignment = { horizontal: 'center', vertical: 'middle' };
  pmHeaderRow.height = 22;

  let grandMethodTotal = 0;
  const paymentRows = (Array.isArray(payments) ? payments : []).filter((r) => r?.method);
  for (const pm of paymentRows) {
    const amt = asNumber(pm.amount);
    grandMethodTotal += amt;
    const row = paymentsSheet.addRow([String(pm.method), amt]);
    row.getCell(1).font = { bold: true, size: 11 };
    row.getCell(2).numFmt = '#,##0.00';
    row.getCell(2).alignment = { horizontal: 'right' };
  }

  const methodTotalRow = paymentsSheet.addRow(['Total', grandMethodTotal]);
  methodTotalRow.font = { bold: true, size: 12, color: { argb: '1A365D' } };
  methodTotalRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'EBF8FF' } };
  methodTotalRow.getCell(2).numFmt = '#,##0.00';
  methodTotalRow.getCell(2).alignment = { horizontal: 'right' };

  paymentsSheet.getColumn(1).width = 22;
  paymentsSheet.getColumn(2).width = 20;

  // ── Section 2: Paid Orders Detail ──
  if (Array.isArray(paymentOrders) && paymentOrders.length > 0) {
    paymentsSheet.addRow([]);
    paymentsSheet.addRow([]);

    const detailTitleRow = paymentsSheet.addRow(['PAID ORDERS DETAIL']);
    detailTitleRow.font = { bold: true, size: 13, color: { argb: 'FFFFFF' } };
    detailTitleRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: '1A365D' } };
    detailTitleRow.alignment = { horizontal: 'center' };
    paymentsSheet.mergeCells(detailTitleRow.number, 1, detailTitleRow.number, pmMaxCol);

    paymentsSheet.addRow([]);

    const orderHeaders = [
      'Order Name', 'Table', 'Waiter', 'Payment Method',
      'Date & Time', 'Subtotal (ETB)', 'Tax (ETB)', 'Total (ETB)',
    ];
    const orderHeaderRow = paymentsSheet.addRow(orderHeaders);
    orderHeaderRow.font = { bold: true, color: { argb: 'FFFFFF' } };
    orderHeaderRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: '2C5282' } };
    orderHeaderRow.alignment = { horizontal: 'center', vertical: 'middle' };
    orderHeaderRow.height = 22;

    let totalSum = 0;
    let taxSum = 0;
    let subtotalSum = 0;

    for (let i = 0; i < paymentOrders.length; i++) {
      const o = paymentOrders[i];
      const total = asNumber(o.total);
      const tax = asNumber(o.tax);
      const subtotal = total - tax;
      totalSum += total;
      taxSum += tax;
      subtotalSum += subtotal;

      const row = paymentsSheet.addRow([
        o.orderName || o.id,
        o.tableName || '—',
        o.waiter || 'N/A',
        o.method,
        o.paidAt || o.createdAt || '',
        subtotal,
        tax,
        total,
      ]);

      // Alternate row shading
      if (i % 2 === 0) {
        row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'F7FAFC' } };
      }
      row.getCell(6).numFmt = '#,##0.00';
      row.getCell(7).numFmt = '#,##0.00';
      row.getCell(8).numFmt = '#,##0.00';
      row.getCell(6).alignment = { horizontal: 'right' };
      row.getCell(7).alignment = { horizontal: 'right' };
      row.getCell(8).alignment = { horizontal: 'right' };
    }

    // Grand totals row
    const grandRow = paymentsSheet.addRow([
      `Total (${paymentOrders.length} orders)`, '', '', '', '',
      subtotalSum, taxSum, totalSum,
    ]);
    grandRow.font = { bold: true, size: 11, color: { argb: '1A365D' } };
    grandRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'EBF8FF' } };
    grandRow.getCell(6).numFmt = '#,##0.00';
    grandRow.getCell(7).numFmt = '#,##0.00';
    grandRow.getCell(8).numFmt = '#,##0.00';
    grandRow.getCell(6).alignment = { horizontal: 'right' };
    grandRow.getCell(7).alignment = { horizontal: 'right' };
    grandRow.getCell(8).alignment = { horizontal: 'right' };

    // Column widths for detail section
    paymentsSheet.getColumn(1).width = 50;
    paymentsSheet.getColumn(2).width = 16;
    paymentsSheet.getColumn(3).width = 18;
    paymentsSheet.getColumn(4).width = 18;
    paymentsSheet.getColumn(5).width = 24;
    paymentsSheet.getColumn(6).width = 16;
    paymentsSheet.getColumn(7).width = 14;
    paymentsSheet.getColumn(8).width = 16;
  }

  const voidsSheet = wb.addWorksheet('Voids');
  addMetaBlock(voidsSheet, businessName, 'Voids & Refunds', from || fromDate, to || toDate, 9);
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
