const { validateEmail, validatePassword, validatePhone, validateUUID, validateRequired, sanitizeString } = require('../../src/utils/validation');

describe('Validation Utils', () => {
  describe('validateEmail', () => {
    it('should accept valid emails', () => {
      expect(validateEmail('test@example.com')).toBe(true);
      expect(validateEmail('user.name@domain.co.uk')).toBe(true);
    });
    
    it('should reject invalid emails', () => {
      expect(validateEmail('not-an-email')).toBe(false);
      expect(validateEmail('missing@domain')).toBe(false);
      expect(validateEmail('@nodomain.com')).toBe(false);
      expect(validateEmail('')).toBe(false);
    });

    it('should reject null and undefined', () => {
      expect(validateEmail(null)).toBe(false);
      expect(validateEmail(undefined)).toBe(false);
    });

    it('should reject non-string values', () => {
      expect(validateEmail(123)).toBe(false);
      expect(validateEmail({})).toBe(false);
    });
  });
  
  describe('validatePassword', () => {
    it('should require minimum length', () => {
      expect(validatePassword('short')).toBe(false);
      expect(validatePassword('Longenough1')).toBe(true);
    });
    
    it('should require uppercase', () => {
      expect(validatePassword('lowercaseonly1')).toBe(false);
      expect(validatePassword('HasUppercase1')).toBe(true);
    });
    
    it('should require number', () => {
      expect(validatePassword('NoNumbers')).toBe(false);
      expect(validatePassword('Has1Number')).toBe(true);
    });

    it('should require lowercase', () => {
      expect(validatePassword('ALLUPPERCASE1')).toBe(false);
      expect(validatePassword('HasLowercase1')).toBe(true);
    });

    it('should reject null and undefined', () => {
      expect(validatePassword(null)).toBe(false);
      expect(validatePassword(undefined)).toBe(false);
    });
  });

  describe('validatePhone', () => {
    it('should accept valid phone numbers', () => {
      expect(validatePhone('+251900000000')).toBe(true);
      expect(validatePhone('251900000000')).toBe(true);
      expect(validatePhone('0900000000')).toBe(true);
    });

    it('should reject too short phone numbers', () => {
      expect(validatePhone('12345')).toBe(false);
      expect(validatePhone('+251')).toBe(false);
    });

    it('should reject too long phone numbers', () => {
      expect(validatePhone('+251900000000123456789')).toBe(false);
    });

    it('should reject null and undefined', () => {
      expect(validatePhone(null)).toBe(false);
      expect(validatePhone(undefined)).toBe(false);
    });
  });

  describe('validateUUID', () => {
    it('should accept valid UUIDs', () => {
      expect(validateUUID('550e8400-e29b-41d4-a716-446655440000')).toBe(true);
      expect(validateUUID('6ba7b810-9dad-11d1-80b4-00c04fd430c8')).toBe(true);
    });

    it('should reject invalid UUIDs', () => {
      expect(validateUUID('not-a-uuid')).toBe(false);
      expect(validateUUID('550e8400-e29b-41d4-a716')).toBe(false);
      expect(validateUUID('')).toBe(false);
    });

    it('should reject null and undefined', () => {
      expect(validateUUID(null)).toBe(false);
      expect(validateUUID(undefined)).toBe(false);
    });
  });

  describe('validateRequired', () => {
    it('should validate required fields', () => {
      expect(validateRequired('value', 'Field')).toEqual({ valid: true });
      expect(validateRequired(0, 'Field')).toEqual({ valid: true });
      expect(validateRequired(false, 'Field')).toEqual({ valid: true });
    });

    it('should reject empty values', () => {
      expect(validateRequired(undefined, 'Field')).toEqual({ valid: false, error: 'Field is required' });
      expect(validateRequired(null, 'Field')).toEqual({ valid: false, error: 'Field is required' });
      expect(validateRequired('', 'Field')).toEqual({ valid: false, error: 'Field is required' });
    });
  });

  describe('sanitizeString', () => {
    it('should sanitize normal strings', () => {
      expect(sanitizeString('  hello  ')).toBe('hello');
      expect(sanitizeString('test')).toBe('test');
    });

    it('should remove script tags', () => {
      expect(sanitizeString('<script>alert("xss")</script>')).toBe('');
      expect(sanitizeString('<script src="evil.js">')).toBe('src="evil.js">');
    });

    it('should return empty string for null/undefined', () => {
      expect(sanitizeString(null)).toBe('');
      expect(sanitizeString(undefined)).toBe('');
    });

    it('should return empty string for non-strings', () => {
      expect(sanitizeString(123)).toBe('');
      expect(sanitizeString({})).toBe('');
    });
  });
});
