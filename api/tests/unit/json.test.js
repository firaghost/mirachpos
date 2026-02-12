const { safeJsonParse, safeJsonStringify } = require('../../src/utils/json');

describe('utils/json', () => {
  describe('safeJsonParse', () => {
    it('parses valid JSON string', () => {
      expect(safeJsonParse('{"a":1}')).toEqual({ a: 1 });
      expect(safeJsonParse('[1,2,3]')).toEqual([1, 2, 3]);
      expect(safeJsonParse('"string"')).toBe('string');
      expect(safeJsonParse('123')).toBe(123);
      expect(safeJsonParse('true')).toBe(true);
      expect(safeJsonParse('null')).toBeUndefined();
    });

    it('returns object as-is', () => {
      const obj = { a: 1 };
      expect(safeJsonParse(obj)).toBe(obj);

      const arr = [1, 2, 3];
      expect(safeJsonParse(arr)).toBe(arr);
    });

    it('returns fallback for null/undefined input', () => {
      expect(safeJsonParse(null, {})).toEqual({});
      expect(safeJsonParse(undefined, [])).toEqual([]);
      expect(safeJsonParse(null, 'fallback')).toBe('fallback');
    });

    it('returns fallback for invalid JSON', () => {
      expect(safeJsonParse('invalid', {})).toEqual({});
      expect(safeJsonParse('{', [])).toEqual([]);
      expect(safeJsonParse('}', 'fallback')).toBe('fallback');
      expect(safeJsonParse('', 'empty')).toBe('empty');
    });

    it('returns fallback when parsed value is null', () => {
      expect(safeJsonParse('null', 'fallback')).toBe('fallback');
      expect(safeJsonParse('null', {})).toEqual({});
    });

    it('handles edge cases', () => {
      expect(safeJsonParse('', undefined)).toBeUndefined();
      expect(safeJsonParse('0')).toBe(0);
      expect(safeJsonParse('false')).toBe(false);
      expect(safeJsonParse('""', 'fallback')).toBe('');
    });
  });

  describe('safeJsonStringify', () => {
    it('stringifies valid values', () => {
      expect(safeJsonStringify({ a: 1 })).toBe('{"a":1}');
      expect(safeJsonStringify([1, 2, 3])).toBe('[1,2,3]');
      expect(safeJsonStringify('string')).toBe('"string"');
      expect(safeJsonStringify(123)).toBe('123');
      expect(safeJsonStringify(true)).toBe('true');
      expect(safeJsonStringify(false)).toBe('false');
    });

    it('returns null for null input', () => {
      expect(safeJsonStringify(null)).toBeNull();
    });

    it('returns null for undefined input', () => {
      expect(safeJsonStringify(undefined)).toBeNull();
    });

    it('handles circular references by returning null', () => {
      const obj = {};
      obj.self = obj;
      expect(safeJsonStringify(obj)).toBeNull();

      const arr = [];
      arr.push(arr);
      expect(safeJsonStringify(arr)).toBeNull();
    });

    it('stringifies nested objects', () => {
      expect(safeJsonStringify({ a: { b: 1 } })).toBe('{"a":{"b":1}}');
      expect(safeJsonStringify([{ a: 1 }, { b: 2 }])).toBe('[{"a":1},{"b":2}]');
    });

    it('handles special values', () => {
      expect(safeJsonStringify(0)).toBe('0');
      expect(safeJsonStringify('')).toBe('""');
      expect(safeJsonStringify(NaN)).toBe('null');
      expect(safeJsonStringify(Infinity)).toBe('null');
    });
  });
});
