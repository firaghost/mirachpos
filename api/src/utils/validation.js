/**
 * Validation utilities
 */

const validateEmail = (email) => {
  if (!email || typeof email !== 'string') return false;
  
  // RFC 5322 compliant email regex (simplified)
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
};

const validatePassword = (password) => {
  if (!password || typeof password !== 'string') return false;
  
  // Minimum 8 characters
  if (password.length < 8) return false;
  
  // At least one uppercase letter
  if (!/[A-Z]/.test(password)) return false;
  
  // At least one lowercase letter
  if (!/[a-z]/.test(password)) return false;
  
  // At least one number
  if (!/[0-9]/.test(password)) return false;
  
  return true;
};

const validatePhone = (phone) => {
  if (!phone || typeof phone !== 'string') return false;
  
  // Remove all non-digit characters
  const digits = phone.replace(/\D/g, '');
  
  // Check if valid length (10-15 digits)
  return digits.length >= 10 && digits.length <= 15;
};

const validateUUID = (uuid) => {
  if (!uuid || typeof uuid !== 'string') return false;
  
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuidRegex.test(uuid);
};

const validateRequired = (value, fieldName) => {
  if (value === undefined || value === null || value === '') {
    return { valid: false, error: `${fieldName} is required` };
  }
  return { valid: true };
};

const sanitizeString = (str) => {
  if (!str || typeof str !== 'string') return '';
  
  // Remove potential XSS characters
  return str
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[\s\S])*<\/script>/gi, '')
    .replace(/<script/gi, '')
    .trim();
};

module.exports = {
  validateEmail,
  validatePassword,
  validatePhone,
  validateUUID,
  validateRequired,
  sanitizeString
};
