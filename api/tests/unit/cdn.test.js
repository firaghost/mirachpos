const { resolveCdnUrl } = require('../../src/utils/cdn');
const { config } = require('../../src/config');

describe('utils/cdn', () => {
  const originalCdnBaseUrl = config.cdnBaseUrl;

  beforeEach(() => {
    config.cdnBaseUrl = originalCdnBaseUrl;
  });

  afterAll(() => {
    config.cdnBaseUrl = originalCdnBaseUrl;
  });

  describe('resolveCdnUrl', () => {
    it('returns path as-is when cdnBaseUrl is not configured', () => {
      config.cdnBaseUrl = '';
      expect(resolveCdnUrl('/path/to/file.jpg')).toBe('/path/to/file.jpg');
    });

    it('returns path as-is when path does not start with /', () => {
      config.cdnBaseUrl = 'https://cdn.example.com';
      expect(resolveCdnUrl('path/to/file.jpg')).toBe('path/to/file.jpg');
      expect(resolveCdnUrl('https://other.com/file.jpg')).toBe('https://other.com/file.jpg');
    });

    it('prepends cdnBaseUrl to absolute paths', () => {
      config.cdnBaseUrl = 'https://cdn.example.com';
      expect(resolveCdnUrl('/path/to/file.jpg')).toBe('https://cdn.example.com/path/to/file.jpg');
    });

    it('handles cdnBaseUrl with trailing slash', () => {
      config.cdnBaseUrl = 'https://cdn.example.com/';
      expect(resolveCdnUrl('/path/to/file.jpg')).toBe('https://cdn.example.com/path/to/file.jpg');
    });

    it('handles cdnBaseUrl with multiple trailing slashes', () => {
      config.cdnBaseUrl = 'https://cdn.example.com///';
      expect(resolveCdnUrl('/path/to/file.jpg')).toBe('https://cdn.example.com/path/to/file.jpg');
    });

    it('handles empty path', () => {
      config.cdnBaseUrl = 'https://cdn.example.com';
      expect(resolveCdnUrl('')).toBe('');
    });

    it('handles null path', () => {
      config.cdnBaseUrl = 'https://cdn.example.com';
      expect(resolveCdnUrl(null)).toBe('');
    });

    it('handles undefined path', () => {
      config.cdnBaseUrl = 'https://cdn.example.com';
      expect(resolveCdnUrl(undefined)).toBe('');
    });

    it('handles path with only whitespace', () => {
      config.cdnBaseUrl = 'https://cdn.example.com';
      expect(resolveCdnUrl('   ')).toBe('');
    });

    it('handles whitespace in path', () => {
      config.cdnBaseUrl = 'https://cdn.example.com';
      expect(resolveCdnUrl('  /path/to/file.jpg  ')).toBe('https://cdn.example.com/path/to/file.jpg');
    });

    it('preserves query parameters in path', () => {
      config.cdnBaseUrl = 'https://cdn.example.com';
      expect(resolveCdnUrl('/path/to/file.jpg?w=100&h=200')).toBe('https://cdn.example.com/path/to/file.jpg?w=100&h=200');
    });

    it('handles root path', () => {
      config.cdnBaseUrl = 'https://cdn.example.com';
      expect(resolveCdnUrl('/')).toBe('https://cdn.example.com/');
    });

    it('handles complex nested paths', () => {
      config.cdnBaseUrl = 'https://cdn.example.com/v1';
      expect(resolveCdnUrl('/assets/images/products/item-123/main.jpg')).toBe('https://cdn.example.com/v1/assets/images/products/item-123/main.jpg');
    });
  });
});
