const { 
  formatCurrency, 
  formatDate, 
  generateOrderNumber,
  generateReceiptId,
  slugify,
  truncate
} = require('../../src/utils/helpers');

describe('Helper Utilities', () => {
  describe('formatCurrency', () => {
    it('should format ETB correctly', () => {
      expect(formatCurrency(100)).toBe('ETB 100.00');
      expect(formatCurrency(1000.50)).toBe('ETB 1,000.50');
      expect(formatCurrency(0)).toBe('ETB 0.00');
    });
    
    it('should handle negative amounts', () => {
      expect(formatCurrency(-100)).toBe('-ETB 100.00');
    });
    
    it('should handle decimals', () => {
      expect(formatCurrency(99.999)).toBe('ETB 100.00');
    });

    it('should handle non-finite values', () => {
      expect(formatCurrency(NaN)).toBe('');
      expect(formatCurrency(Infinity)).toBe('');
      expect(formatCurrency(-Infinity)).toBe('');
    });

    it('should handle other currencies', () => {
      expect(formatCurrency(100, 'USD')).toBe('USD 100.00');
      expect(formatCurrency(50, 'EUR')).toBe('EUR 50.00');
    });
  });
  
  describe('formatDate', () => {
    it('should format date correctly', () => {
      const date = new Date('2024-01-15');
      expect(formatDate(date)).toMatch(/2024/);
      expect(formatDate(date)).toMatch(/01-15/);
    });
    
    it('should format datetime correctly', () => {
      const date = new Date('2024-01-15T14:30:00');
      expect(formatDate(date, true)).toMatch(/14:30/);
    });
    
    it('should handle invalid dates', () => {
      expect(formatDate(null)).toBe('');
      expect(formatDate('invalid')).toBe('');
      expect(formatDate('')).toBe('');
    });

    it('should handle date string input', () => {
      expect(formatDate('2024-03-25')).toMatch(/2024/);
      expect(formatDate('2024-03-25T10:00:00Z')).toMatch(/2024/);
    });
  });
  
  describe('generateOrderNumber', () => {
    it('should generate unique order numbers', () => {
      const order1 = generateOrderNumber();
      const order2 = generateOrderNumber();
      
      expect(order1).not.toBe(order2);
      expect(order1).toMatch(/^ORD-\d+$/);
    });
    
    it('should include prefix', () => {
      const orderNum = generateOrderNumber('TEST');
      expect(orderNum).toMatch(/^TEST-\d+$/);
    });
  });
  
  describe('generateReceiptId', () => {
    it('should generate receipt IDs', () => {
      const receipt = generateReceiptId();
      expect(receipt).toMatch(/^RCP-\d+$/);
    });
  });
  
  describe('slugify', () => {
    it('should convert to slug', () => {
      expect(slugify('Hello World')).toBe('hello-world');
      expect(slugify('Test Item 123')).toBe('test-item-123');
    });
    
    it('should handle special characters', () => {
      expect(slugify('Item & Test')).toBe('item-test');
      expect(slugify('Test--Item')).toBe('test-item');
    });
    
    it('should handle empty strings', () => {
      expect(slugify('')).toBe('');
    });
  });
  
  describe('truncate', () => {
    it('should truncate long strings', () => {
      expect(truncate('Hello World', 5)).toBe('Hello...');
    });
    
    it('should not truncate short strings', () => {
      expect(truncate('Hi', 10)).toBe('Hi');
    });
    
    it('should handle custom suffix', () => {
      expect(truncate('Hello World', 5, '>>')).toBe('Hello>>');
    });
  });
});

// Test error utilities
const { 
  AppError, 
  ValidationError, 
  NotFoundError,
  UnauthorizedError 
} = require('../../src/utils/errors');

describe('Error Classes', () => {
  describe('AppError', () => {
    it('should create error with status code', () => {
      const error = new AppError('Test error', 400);
      expect(error.message).toBe('Test error');
      expect(error.statusCode).toBe(400);
    });
  });
  
  describe('ValidationError', () => {
    it('should create validation error', () => {
      const error = new ValidationError('Invalid input');
      expect(error.statusCode).toBe(400);
    });
  });
  
  describe('NotFoundError', () => {
    it('should create not found error', () => {
      const error = new NotFoundError('Resource not found');
      expect(error.statusCode).toBe(404);
    });
  });
  
  describe('UnauthorizedError', () => {
    it('should create unauthorized error', () => {
      const error = new UnauthorizedError('Not authorized');
      expect(error.statusCode).toBe(401);
    });
  });
});
