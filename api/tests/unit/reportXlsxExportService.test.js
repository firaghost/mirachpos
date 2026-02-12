describe('services/reportXlsxExportService', () => {
  it('buildOwnerReportWorkbook returns a Buffer and creates expected worksheets', async () => {
    const worksheets = [];

    await jest.isolateModulesAsync(async () => {
      jest.doMock('exceljs', () => {
        class Worksheet {
          constructor(name) {
            this.name = name;
            this._rows = [];
            this.columns = [];
            this.views = [];
            worksheets.push(this);
          }

          get rowCount() {
            return this._rows.length;
          }

          addRow(values) {
            this._rows.push(values);
            return {};
          }

          getRow() {
            return { font: {}, alignment: {} };
          }

          mergeCells() {}
        }

        class Workbook {
          constructor() {
            this.creator = '';
            this.created = null;
            this._worksheets = [];
            this.xlsx = {
              writeBuffer: jest.fn(async () => Uint8Array.from([1, 2, 3, 4])),
            };
          }

          addWorksheet(name) {
            const ws = new Worksheet(name);
            this._worksheets.push(ws);
            return ws;
          }
        }

        return { Workbook };
      });

      const { buildOwnerReportWorkbook } = require('../../src/services/reportXlsxExportService');

      const buf = await buildOwnerReportWorkbook({
        businessName: 'Biz',
        fromDate: '2026-02-01T12:00:00.000Z',
        toDate: '2026-02-02',
        daily: [{ date: '2026-02-01', branchId: 'br_1', orderCount: '2', itemCount: 3, grossSales: '10' }],
        products: [{ productId: 'p1', name: 'Tea', category: 'Drinks', qtySold: '2', revenue: '10', cost: 4, profit: 6, voidQty: 0 }],
        staff: [{ staffId: 's1', staffName: 'A', orderCount: 1, netSales: 9, grossSales: 10, discounts: 1, tax: 0, tips: 0, totalCollected: 9 }],
        payments: [{ method: 'cash', amount: '9' }],
        voids: [{ id: 'v1', type: 'void', orderId: 'o1', productName: 'Tea', qty: 1, amount: 5, reason: 'x', authorizedBy: 'm', occurredAt: '2026-02-01T00:00:00.000Z' }],
      });

      expect(Buffer.isBuffer(buf)).toBe(true);
      expect([...buf]).toEqual([1, 2, 3, 4]);
    });

    const names = worksheets.map((w) => w.name);
    expect(names).toEqual(['Summary', 'Products', 'Staff', 'Payments', 'Voids']);
  });

  it('buildOwnerReportWorkbook handles empty data gracefully', async () => {
    await jest.isolateModulesAsync(async () => {
      jest.doMock('exceljs', () => {
        class Worksheet {
          constructor(name) {
            this.name = name;
            this._rows = [];
          }
          addRow(values) { this._rows.push(values); }
          get rowCount() { return this._rows.length; }
          getRow() { return { font: {}, alignment: {} }; }
          mergeCells() {}
        }
        class Workbook {
          constructor() {
            this.xlsx = { writeBuffer: jest.fn(async () => Uint8Array.from([1, 2, 3])) };
          }
          addWorksheet(name) { return new Worksheet(name); }
        }
        return { Workbook };
      });

      const { buildOwnerReportWorkbook } = require('../../src/services/reportXlsxExportService');

      const buf = await buildOwnerReportWorkbook({
        businessName: 'Empty Biz',
        fromDate: '2026-02-01',
        toDate: '2026-02-01',
        daily: [],
        products: [],
        staff: [],
        payments: [],
        voids: [],
      });

      expect(Buffer.isBuffer(buf)).toBe(true);
    });
  });

  it('buildOwnerReportWorkbook handles dates in various formats', async () => {
    await jest.isolateModulesAsync(async () => {
      jest.doMock('exceljs', () => {
        class Worksheet {
          constructor(name) { this.name = name; this._rows = []; }
          addRow(values) { this._rows.push(values); }
          get rowCount() { return this._rows.length; }
          getRow() { return { font: {}, alignment: {} }; }
          mergeCells() {}
        }
        class Workbook {
          constructor() { this.xlsx = { writeBuffer: jest.fn(async () => Uint8Array.from([1])) }; }
          addWorksheet(name) { return new Worksheet(name); }
        }
        return { Workbook };
      });

      const { buildOwnerReportWorkbook } = require('../../src/services/reportXlsxExportService');

      // Test with ISO date string
      const buf1 = await buildOwnerReportWorkbook({
        businessName: 'Biz',
        fromDate: '2026-02-01T12:00:00.000Z',
        toDate: '2026-02-02T00:00:00.000Z',
        daily: [], products: [], staff: [], payments: [], voids: [],
      });
      expect(Buffer.isBuffer(buf1)).toBe(true);

      // Test with simple date string
      const buf2 = await buildOwnerReportWorkbook({
        businessName: 'Biz',
        fromDate: '2026-02-01',
        toDate: '2026-02-02',
        daily: [], products: [], staff: [], payments: [], voids: [],
      });
      expect(Buffer.isBuffer(buf2)).toBe(true);
    });
  });
});
