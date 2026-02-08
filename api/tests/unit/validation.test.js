const { validateEmail, validatePassword } = require('../../src/utils/validation');

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
  });
  
  describe('validatePassword', () => {
    it('should require minimum length', () => {
      expect(validatePassword('short')).toBe(false);
      expect(validatePassword('longenoughpassword')).toBe(true);
    });
    
    it('should require uppercase', () => {
      expect(validatePassword('lowercaseonly')).toBe(false);
      expect(validatePassword('HasUppercase')).toBe(true);
    });
    
    it('should require number', () => {
      expect(validatePassword('NoNumbers')).toBe(false);
      expect(validatePassword('Has1Number')).toBe(true);
    });
  });
});
