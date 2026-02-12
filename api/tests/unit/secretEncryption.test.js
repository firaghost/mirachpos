const {
  ENC_PREFIX,
  encryptString,
  decryptString,
  encryptConfigFields,
  decryptConfigFields,
} = require('../../src/utils/secretEncryption');

describe('utils/secretEncryption', () => {
  const originalKey = process.env.TENANT_GATEWAY_SECRETS_KEY;

  beforeEach(() => {
    // Set a valid 32-byte base64 key for testing
    process.env.TENANT_GATEWAY_SECRETS_KEY = Buffer.from('a'.repeat(32)).toString('base64');
  });

  afterAll(() => {
    process.env.TENANT_GATEWAY_SECRETS_KEY = originalKey;
  });

  describe('ENC_PREFIX', () => {
    it('exports the encryption prefix', () => {
      expect(ENC_PREFIX).toBe('enc:v1:');
    });
  });

  describe('encryptString', () => {
    it('encrypts plaintext and returns prefixed string', () => {
      const encrypted = encryptString('hello world');
      expect(encrypted).toMatch(/^enc:v1:/);
    });

    it('returns empty string for empty input', () => {
      expect(encryptString('')).toBe('');
      expect(encryptString(null)).toBe('');
      expect(encryptString(undefined)).toBe('');
    });

    it('returns input as-is if already encrypted', () => {
      const alreadyEncrypted = 'enc:v1:some:existing:value';
      expect(encryptString(alreadyEncrypted)).toBe(alreadyEncrypted);
    });

    it('throws error when master key is missing', () => {
      delete process.env.TENANT_GATEWAY_SECRETS_KEY;
      expect(() => encryptString('test')).toThrow('tenant_gateway_secrets_key_missing');
    });
  });

  describe('decryptString', () => {
    it('decrypts encrypted string back to original', () => {
      const original = 'hello world';
      const encrypted = encryptString(original);
      const decrypted = decryptString(encrypted);
      expect(decrypted).toBe(original);
    });

    it('returns empty string for empty input', () => {
      expect(decryptString('')).toBe('');
      expect(decryptString(null)).toBe('');
      expect(decryptString(undefined)).toBe('');
    });

    it('returns input as-is if not encrypted (no prefix)', () => {
      const plaintext = 'plain text value';
      expect(decryptString(plaintext)).toBe(plaintext);
    });

    it('throws error for invalid encrypted format', () => {
      const invalidEncrypted = 'enc:v1:invalid_format';
      expect(() => decryptString(invalidEncrypted)).toThrow('invalid_encrypted_secret');
    });

    it('throws error when master key is missing', () => {
      const encrypted = encryptString('test');
      delete process.env.TENANT_GATEWAY_SECRETS_KEY;
      expect(() => decryptString(encrypted)).toThrow('tenant_gateway_secrets_key_missing');
    });
  });

  describe('encryptConfigFields', () => {
    it('encrypts specified fields in config object', () => {
      const config = {
        apiKey: 'secret123',
        publicKey: 'public456',
        name: 'Test',
      };
      const encrypted = encryptConfigFields(config, ['apiKey']);

      expect(encrypted.apiKey).toMatch(/^enc:v1:/);
      expect(encrypted.publicKey).toBe('public456');
      expect(encrypted.name).toBe('Test');
    });

    it('returns empty object for null config', () => {
      const result = encryptConfigFields(null, ['apiKey']);
      expect(result).toEqual({});
    });

    it('handles non-string values gracefully', () => {
      const config = {
        count: 42,
        apiKey: 'secret',
        empty: '',
      };
      const encrypted = encryptConfigFields(config, ['apiKey', 'count', 'empty']);

      expect(encrypted.apiKey).toMatch(/^enc:v1:/);
      expect(encrypted.count).toBe(42);
      expect(encrypted.empty).toBe('');
    });

    it('handles missing fields array', () => {
      const config = { apiKey: 'secret' };
      const encrypted = encryptConfigFields(config, null);
      expect(encrypted.apiKey).toBe('secret');
    });
  });

  describe('decryptConfigFields', () => {
    it('decrypts specified fields in config object', () => {
      const original = 'secret123';
      const encrypted = encryptString(original);

      const config = {
        apiKey: encrypted,
        publicKey: 'public456',
      };
      const decrypted = decryptConfigFields(config, ['apiKey']);

      expect(decrypted.apiKey).toBe(original);
      expect(decrypted.publicKey).toBe('public456');
    });

    it('returns empty object for null config', () => {
      const result = decryptConfigFields(null, ['apiKey']);
      expect(result).toEqual({});
    });

    it('returns non-encrypted values as-is', () => {
      const config = {
        apiKey: 'plain-text-value',
        publicKey: 'public456',
      };
      const decrypted = decryptConfigFields(config, ['apiKey']);

      expect(decrypted.apiKey).toBe('plain-text-value');
    });
  });

  describe('encryption round-trip', () => {
    it('correctly encrypts and decrypts various values', () => {
      const testValues = [
        'simple text',
        'text with special chars: !@#$%^&*()',
        'unicode: 你好世界 🌍',
        'a'.repeat(1000),
        '1234567890',
      ];

      testValues.forEach(value => {
        const encrypted = encryptString(value);
        const decrypted = decryptString(encrypted);
        expect(decrypted).toBe(value);
      });
    });
  });
});
