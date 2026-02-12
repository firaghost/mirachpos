const { isAllowedOrigin } = require('../../src/utils/cors');

describe('utils/cors', () => {
  const originalEnv = process.env.NODE_ENV;

  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
  });

  describe('isAllowedOrigin', () => {
    it('allows mirachpos.com domains', () => {
      expect(isAllowedOrigin('https://mirachpos.com', [])).toBe(true);
      expect(isAllowedOrigin('https://www.mirachpos.com', [])).toBe(true);
      expect(isAllowedOrigin('https://apps.mirachpos.com', [])).toBe(true);
      expect(isAllowedOrigin('https://tenant.mirachpos.com', [])).toBe(true);
    });

    it('allows mirach.com domains', () => {
      expect(isAllowedOrigin('https://mirach.com', [])).toBe(true);
      expect(isAllowedOrigin('https://sub.mirach.com', [])).toBe(true);
    });

    it('allows exact matches from allowlist', () => {
      expect(isAllowedOrigin('https://example.com', ['https://example.com'])).toBe(true);
      expect(isAllowedOrigin('https://test.com', ['https://example.com'])).toBe(false);
    });

    it('allows wildcard matches from allowlist', () => {
      expect(isAllowedOrigin('https://sub.example.com', ['*.example.com'])).toBe(true);
      expect(isAllowedOrigin('https://deep.sub.example.com', ['*.example.com'])).toBe(true);
      expect(isAllowedOrigin('https://other.com', ['*.example.com'])).toBe(false);
    });

    it('handles production mode - empty origin not allowed', () => {
      process.env.NODE_ENV = 'production';
      expect(isAllowedOrigin('', [])).toBe(false);
      expect(isAllowedOrigin(null, [])).toBe(false);
      expect(isAllowedOrigin(undefined, [])).toBe(false);
    });

    it('handles non-production mode - empty origin allowed', () => {
      process.env.NODE_ENV = 'development';
      expect(isAllowedOrigin('', [])).toBe(true);
      expect(isAllowedOrigin(null, [])).toBe(true);
    });

    it('handles production mode with allowlist', () => {
      process.env.NODE_ENV = 'production';
      expect(isAllowedOrigin('https://example.com', ['https://example.com'])).toBe(true);
      expect(isAllowedOrigin('https://evil.com', ['https://example.com'])).toBe(false);
    });

    it('handles non-production mode without allowlist', () => {
      process.env.NODE_ENV = 'development';
      expect(isAllowedOrigin('https://any.com', [])).toBe(true);
    });

    it('handles empty allowlist in production', () => {
      process.env.NODE_ENV = 'production';
      expect(isAllowedOrigin('https://any.com', [])).toBe(false);
      expect(isAllowedOrigin('https://any.com', null)).toBe(false);
      expect(isAllowedOrigin('https://any.com', undefined)).toBe(false);
    });

    it('normalizes origins with ports', () => {
      expect(isAllowedOrigin('https://example.com:443', ['https://example.com'])).toBe(true);
      expect(isAllowedOrigin('http://example.com:80', ['http://example.com'])).toBe(true);
    });

    it('handles invalid URLs in allowlist', () => {
      process.env.NODE_ENV = 'production';
      expect(isAllowedOrigin('https://example.com', ['', 'https://example.com'])).toBe(true);
    });

    it('is case insensitive', () => {
      expect(isAllowedOrigin('https://EXAMPLE.COM', ['https://example.com'])).toBe(true);
      expect(isAllowedOrigin('https://MirachPOS.com', [])).toBe(true);
    });
  });
});
