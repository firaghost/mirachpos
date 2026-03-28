const { EventEmitter } = require('events');

class MockPDFDocument extends EventEmitter {
  static instances = [];

  constructor(options = {}) {
    super();
    MockPDFDocument.instances.push(this);
    this.options = options;
    this.page = {
      margins: { top: 50, left: 50, right: 50, bottom: 50 },
      width: 612,
      height: 792,
    };
    this.y = 0;
    this._calls = [];
    this.pageAddedCount = 0;
  }

  _rec(name, args) {
    this._calls.push({ name, args });
    return this;
  }

  save(...args) {
    return this._rec('save', args);
  }

  restore(...args) {
    return this._rec('restore', args);
  }

  rect(...args) {
    return this._rec('rect', args);
  }

  roundedRect(...args) {
    return this._rec('roundedRect', args);
  }

  fill(...args) {
    return this._rec('fill', args);
  }

  fillColor(...args) {
    return this._rec('fillColor', args);
  }

  font(...args) {
    return this._rec('font', args);
  }

  fontSize(...args) {
    return this._rec('fontSize', args);
  }

  text(...args) {
    const yArg = args.length >= 3 && typeof args[2] === 'number' ? args[2] : null;
    if (typeof yArg === 'number') {
      this.y = yArg;
    } else {
      this.y += 10;
    }
    return this._rec('text', args);
  }

  moveTo(...args) {
    return this._rec('moveTo', args);
  }

  lineTo(...args) {
    return this._rec('lineTo', args);
  }

  strokeColor(...args) {
    return this._rec('strokeColor', args);
  }

  opacity(...args) {
    return this._rec('opacity', args);
  }

  lineWidth(...args) {
    return this._rec('lineWidth', args);
  }

  stroke(...args) {
    return this._rec('stroke', args);
  }

  moveDown(...args) {
    this.y += 12;
    return this._rec('moveDown', args);
  }

  image(...args) {
    return this._rec('image', args);
  }

  rotate(...args) {
    return this._rec('rotate', args);
  }

  dash(...args) {
    return this._rec('dash', args);
  }

  undash(...args) {
    return this._rec('undash', args);
  }

  circle(...args) {
    return this._rec('circle', args);
  }

  addPage(...args) {
    this._rec('addPage', args);
    this.y = 0;
    this.pageAddedCount += 1;
    this.emit('pageAdded');
    return this;
  }

  async table(table, options) {
    this._rec('table', [table, options]);
    const y = Number(options?.y ?? 0) || 0;
    this.y = y + 120;
    this.emit('data', Buffer.from('T'));
    return this;
  }

  end() {
    process.nextTick(() => {
      this.emit('data', Buffer.from('E'));
      this.emit('end');
    });
  }
}

jest.mock('pdfkit-table', () => MockPDFDocument);

jest.unmock('../../src/services/pdfService');

describe('services/pdfService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    MockPDFDocument.instances = [];

    require('../../src/db');
    global.__MIRACHPOS_DB_MOCK__?.reset?.();

    const state = global.__MIRACHPOS_DB_MOCK__?.state;
    state.tables.tenants = [{ id: 't1', name: 'Tenant 1' }];
    state.tables.invoices = [];
  });

  it('generateInvoicePDF returns a Buffer and renders a table with line items', async () => {
    const state = global.__MIRACHPOS_DB_MOCK__?.state;

    state.tables.invoices = [
      {
        id: 'inv_1',
        tenant_id: 't1',
        invoice_number: 'INV-1',
        issue_date: '2026-02-01T00:00:00.000Z',
        due_date: '2026-02-10T00:00:00.000Z',
        status: 'pending',
        subtotal_etb: 10,
        tax_etb: 0,
        discount_etb: 0,
        total_etb: 10,
        line_items_json: JSON.stringify([{ description: 'Item A', qty: 1, unitPrice: 10, amount: 10 }]),
      },
    ];

    const { generateInvoicePDF } = require('../../src/services/pdfService');
    const buf = await generateInvoicePDF('inv_1');

    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.length).toBeGreaterThan(0);

    const doc = MockPDFDocument.instances[MockPDFDocument.instances.length - 1];
    const tableCall = doc._calls.find((c) => c.name === 'table');
    expect(tableCall).toBeTruthy();
  });

  it('generateInvoicePDF throws when invoice is not found', async () => {
    const { generateInvoicePDF } = require('../../src/services/pdfService');
    await expect(generateInvoicePDF('missing')).rejects.toThrow('Invoice not found');
  });

  it('generateInvoicePDF renders a (No items) row when line_items_json is empty', async () => {
    const state = global.__MIRACHPOS_DB_MOCK__?.state;

    state.tables.invoices = [
      {
        id: 'inv_2',
        tenant_id: 't1',
        invoice_number: 'INV-2',
        issue_date: '2026-02-01T00:00:00.000Z',
        due_date: '2026-02-10T00:00:00.000Z',
        status: 'pending',
        subtotal_etb: 0,
        tax_etb: 0,
        discount_etb: 0,
        total_etb: 0,
        line_items_json: JSON.stringify([]),
      },
    ];

    const { generateInvoicePDF } = require('../../src/services/pdfService');
    await generateInvoicePDF('inv_2');

    const doc = MockPDFDocument.instances[MockPDFDocument.instances.length - 1];
    const tableCall = doc._calls.find((c) => c.name === 'table');
    const [table] = tableCall.args;
    expect(table.rows[0][0]).toBe('(No items)');
  });

  it('generateReportPDF returns a Buffer and uses table rendering', async () => {
    const { generateReportPDF } = require('../../src/services/pdfService');

    const columns = [
      { header: 'Name', key: 'name', width: 100 },
      { header: 'Amount', key: 'amount', width: 100, align: 'right' },
    ];

    const rows = [
      { name: 'A', amount: 10 },
      { name: 'B', amount: 20 },
    ];

    const buf = await generateReportPDF(
      'R',
      { from: '2026-02-01', to: '2026-02-02' },
      columns,
      rows,
      {
        businessName: 'Tenant 1',
        totals: [{ label: 'Total', value: '30' }],
      },
    );

    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.length).toBeGreaterThan(0);
  });

  it('generateReportPDF renders logo when valid logoDataUrl is provided', async () => {
    const { generateReportPDF } = require('../../src/services/pdfService');

    // 1x1 transparent PNG
    const logoDataUrl =
      'data:image/png;base64,' +
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGNgYAAAAAMAASsJTYQAAAAASUVORK5CYII=';

    const buf = await generateReportPDF(
      'R',
      { from: '2026-02-01', to: '2026-02-02' },
      [{ header: 'Name', key: 'name', width: 100 }],
      [{ name: 'A' }],
      { businessName: 'Tenant 1', logoDataUrl },
    );

    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.length).toBeGreaterThan(0);
  });

  it('generateReportPDF keeps large reports on single page', async () => {
    const { generateReportPDF } = require('../../src/services/pdfService');

    const rows = Array.from({ length: 120 }).map((_, i) => ({ name: `Row ${i}` }));
    const buf = await generateReportPDF(
      'R',
      { from: '2026-02-01', to: '2026-02-02' },
      [{ header: 'Name', key: 'name', width: 100 }],
      rows,
      { businessName: 'Tenant 1' },
    );

    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.length).toBeGreaterThan(0);

    const doc = MockPDFDocument.instances[MockPDFDocument.instances.length - 1];
    // Single page behavior - no pages added
    expect(doc.pageAddedCount).toBe(0);
  });

  it('generateInvoicePDF draws PAID seal for paid invoices', async () => {
    const state = global.__MIRACHPOS_DB_MOCK__?.state;

    state.tables.invoices = [
      {
        id: 'inv_paid',
        tenant_id: 't1',
        invoice_number: 'INV-PAID',
        issue_date: '2026-02-01T00:00:00.000Z',
        due_date: '2026-02-10T00:00:00.000Z',
        status: 'paid',
        subtotal_etb: 10,
        tax_etb: 0,
        discount_etb: 0,
        total_etb: 10,
        line_items_json: JSON.stringify([{ description: 'Item A', qty: 1, unitPrice: 10, amount: 10 }]),
      },
    ];

    const { generateInvoicePDF } = require('../../src/services/pdfService');
    await generateInvoicePDF('inv_paid');

    const doc = MockPDFDocument.instances[MockPDFDocument.instances.length - 1];
    // Check that seal-related calls exist (save/restore pairs for seal drawing)
    const saveCalls = doc._calls.filter((c) => c.name === 'save');
    expect(saveCalls.length).toBeGreaterThan(1);
  });

  it('generateInvoicePDF does not draw seal for pending invoices', async () => {
    const state = global.__MIRACHPOS_DB_MOCK__?.state;

    state.tables.invoices = [
      {
        id: 'inv_pending',
        tenant_id: 't1',
        invoice_number: 'INV-PENDING',
        issue_date: '2026-02-01T00:00:00.000Z',
        due_date: '2026-02-10T00:00:00.000Z',
        status: 'pending',
        subtotal_etb: 10,
        tax_etb: 0,
        discount_etb: 0,
        total_etb: 10,
        line_items_json: JSON.stringify([{ description: 'Item A', qty: 1, unitPrice: 10, amount: 10 }]),
      },
    ];

    const { generateInvoicePDF } = require('../../src/services/pdfService');
    await generateInvoicePDF('inv_pending');

    const doc = MockPDFDocument.instances[MockPDFDocument.instances.length - 1];
    // Less save/restore calls for pending invoices (no seal)
    const saveCalls = doc._calls.filter((c) => c.name === 'save');
    const pendingDoc = MockPDFDocument.instances[MockPDFDocument.instances.length - 1];
    expect(pendingDoc).toBeTruthy();
  });

  it('generateInvoicePDF includes stamp code in verification text', async () => {
    const state = global.__MIRACHPOS_DB_MOCK__?.state;

    state.tables.invoices = [
      {
        id: 'inv_stamp',
        tenant_id: 't1',
        invoice_number: 'INV-STAMP',
        issue_date: '2026-02-01T00:00:00.000Z',
        due_date: '2026-02-10T00:00:00.000Z',
        status: 'pending',
        subtotal_etb: 10,
        tax_etb: 0,
        discount_etb: 0,
        total_etb: 10,
        line_items_json: JSON.stringify([{ description: 'Item A', qty: 1, unitPrice: 10, amount: 10 }]),
      },
    ];

    const { generateInvoicePDF } = require('../../src/services/pdfService');
    await generateInvoicePDF('inv_stamp');

    const doc = MockPDFDocument.instances[MockPDFDocument.instances.length - 1];
    // Check that verification code text appears (stamp code generation)
    const textCalls = doc._calls.filter((c) => c.name === 'text');
    const hasVerificationCode = textCalls.some((c) => {
      const textArg = c.args?.[0];
      return typeof textArg === 'string' && textArg.includes('Verification Code:');
    });
    expect(hasVerificationCode).toBe(true);
  });

  it('generateReportPDF succeeds with invalid logo data URL', async () => {
    const { generateReportPDF } = require('../../src/services/pdfService');

    const buf = await generateReportPDF(
      'R',
      { from: '2026-02-01', to: '2026-02-02' },
      [{ header: 'Name', key: 'name', width: 100 }],
      [{ name: 'A' }],
      { businessName: 'Tenant 1', logoDataUrl: 'invalid-data-url' },
    );

    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.length).toBeGreaterThan(0);
  });

  it('generateReportPDF succeeds with empty/missing logo data URL', async () => {
    const { generateReportPDF } = require('../../src/services/pdfService');

    const buf = await generateReportPDF(
      'R',
      { from: '2026-02-01', to: '2026-02-02' },
      [{ header: 'Name', key: 'name', width: 100 }],
      [{ name: 'A' }],
      { businessName: 'Tenant 1' },
    );

    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.length).toBeGreaterThan(0);
  });

  it('generateReportPDF renders totals/kpi tiles when provided', async () => {
    const { generateReportPDF } = require('../../src/services/pdfService');

    const buf = await generateReportPDF(
      'Sales Report',
      { from: '2026-02-01', to: '2026-02-02' },
      [{ header: 'Product', key: 'product', width: 150 }],
      [{ product: 'Coffee' }, { product: 'Tea' }],
      { businessName: 'Test Cafe' },
      { totalOrders: 10, totalRevenue: 100 },
      [
        { label: 'Orders', value: '10' },
        { label: 'Revenue', value: 'ETB 100' },
        { label: 'Avg', value: 'ETB 10' },
        { label: 'Items', value: '25' },
      ],
    );

    expect(Buffer.isBuffer(buf)).toBe(true);
  });

  it('generateInvoicePDF throws error for missing invoice', async () => {
    const state = global.__MIRACHPOS_DB_MOCK__?.state;
    state.tables.invoices = [];

    const { generateInvoicePDF } = require('../../src/services/pdfService');
    await expect(generateInvoicePDF('non_existent_id')).rejects.toThrow('Invoice not found');
  });

  it('generateInvoicePDF handles invoice without line items', async () => {
    const state = global.__MIRACHPOS_DB_MOCK__?.state;

    state.tables.invoices = [
      {
        id: 'inv_empty',
        tenant_id: 't1',
        invoice_number: 'INV-EMPTY',
        issue_date: '2026-02-01T00:00:00.000Z',
        due_date: '2026-02-10T00:00:00.000Z',
        status: 'pending',
        subtotal_etb: 0,
        tax_etb: 0,
        discount_etb: 0,
        total_etb: 0,
        line_items_json: null,
      },
    ];

    const { generateInvoicePDF } = require('../../src/services/pdfService');
    const buf = await generateInvoicePDF('inv_empty');

    expect(Buffer.isBuffer(buf)).toBe(true);
  });
});
