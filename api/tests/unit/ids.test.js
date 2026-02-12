const { makeId, uid } = require('../../src/utils/ids');

describe('utils/ids', () => {
  describe('makeId', () => {
    it('generates unique IDs with prefix', () => {
      const id1 = makeId('test');
      const id2 = makeId('test');

      expect(id1).not.toBe(id2);
      expect(id1).toMatch(/^test_/);
      expect(id2).toMatch(/^test_/);
    });

    it('generates different prefixes', () => {
      const userId = makeId('usr');
      const orderId = makeId('ord');

      expect(userId).toMatch(/^usr_/);
      expect(orderId).toMatch(/^ord_/);
    });

    it('includes timestamp component', () => {
      const before = Date.now();
      const id = makeId('test');
      const after = Date.now();

      const parts = id.split('_');
      expect(parts).toHaveLength(3);

      // Third part should be hex timestamp
      const timestampHex = parts[2];
      const timestamp = parseInt(timestampHex, 16);
      expect(timestamp).toBeGreaterThanOrEqual(before - 1000);
      expect(timestamp).toBeLessThanOrEqual(after + 1000);
    });
  });

  describe('uid', () => {
    it('is alias for makeId', () => {
      const id1 = uid('prefix');
      const id2 = makeId('prefix');

      expect(id1).toMatch(/^prefix_/);
      expect(typeof id1).toBe('string');
      expect(id1.length).toBeGreaterThan('prefix_'.length);
    });
  });
});
