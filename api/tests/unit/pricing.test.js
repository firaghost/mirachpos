const { calculateOrderTotal, applyDiscount, calculateTax } = require('../../src/utils/pricing');

describe('Pricing Utils', () => {
  describe('calculateOrderTotal', () => {
    it('should calculate subtotal correctly', () => {
      const items = [
        { qty: 2, unitPrice: 100 },
        { qty: 1, unitPrice: 50 }
      ];
      expect(calculateOrderTotal(items).subtotal).toBe(250);
    });
    
    it('should apply tax correctly', () => {
      const items = [{ qty: 1, unitPrice: 100 }];
      const result = calculateOrderTotal(items, { taxRate: 0.15 });
      expect(result.tax).toBe(15);
      expect(result.total).toBe(115);
    });
    
    it('should handle empty items', () => {
      expect(calculateOrderTotal([]).total).toBe(0);
    });
    
    it('should handle decimal prices', () => {
      const items = [{ qty: 3, unitPrice: 33.33 }];
      const result = calculateOrderTotal(items);
      expect(result.subtotal).toBeCloseTo(99.99, 2);
    });
  });
  
  describe('applyDiscount', () => {
    it('should apply percentage discount', () => {
      expect(applyDiscount(100, { type: 'percentage', value: 10 })).toBe(90);
    });
    
    it('should apply fixed discount', () => {
      expect(applyDiscount(100, { type: 'fixed', value: 20 })).toBe(80);
    });
    
    it('should not discount below zero', () => {
      expect(applyDiscount(10, { type: 'fixed', value: 20 })).toBe(0);
    });
    
    it('should handle 100% discount', () => {
      expect(applyDiscount(100, { type: 'percentage', value: 100 })).toBe(0);
    });
  });
  
  describe('calculateTax', () => {
    it('should calculate tax correctly', () => {
      expect(calculateTax(100, 0.15)).toBe(15);
    });
    
    it('should handle zero tax rate', () => {
      expect(calculateTax(100, 0)).toBe(0);
    });
    
    it('should round to 2 decimals', () => {
      expect(calculateTax(99.99, 0.15)).toBeCloseTo(15, 2);
    });
  });
});
