import { describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';

import { usePersistedNullableString, usePersistedState, usePersistedString } from './usePersistedState';

describe('usePersistedState', () => {
  it('uses fallback when localStorage is empty and persists on set', () => {
    localStorage.clear();

    const { result } = renderHook(() => usePersistedState('k1', { a: 1 }));
    expect(result.current[0]).toEqual({ a: 1 });

    act(() => {
      result.current[1]({ a: 2 });
    });

    expect(localStorage.getItem('k1')).toBe(JSON.stringify({ a: 2 }));
  });

  it('validates and falls back on invalid stored value', () => {
    localStorage.clear();
    localStorage.setItem('k2', JSON.stringify({ a: 'bad' }));

    const { result } = renderHook(() =>
      usePersistedState('k2', { a: 1 }, { validate: (v): v is { a: number } => typeof (v as any)?.a === 'number' }),
    );

    expect(result.current[0]).toEqual({ a: 1 });
  });

  it('falls back when stored value parses to null', () => {
    localStorage.clear();
    localStorage.setItem('k_null', 'null');

    const { result } = renderHook(() => usePersistedState('k_null', { a: 1 }));
    expect(result.current[0]).toEqual({ a: 1 });
  });

  it('swallows persistence errors in effect', async () => {
    localStorage.clear();

    const originalSetItem = localStorage.setItem.bind(localStorage);
    const ls: any = localStorage;
    ls.setItem = () => {
      throw new Error('quota');
    };

    const { result } = renderHook(() => usePersistedState('k_err', { a: 1 }));

    expect(result.current[0]).toEqual({ a: 1 });
    act(() => {
      result.current[1]({ a: 2 });
    });

    await act(async () => {
      await Promise.resolve();
    });

    ls.setItem = originalSetItem;
  });

  it('falls back when localStorage.getItem throws', () => {
    const originalGetItem = localStorage.getItem.bind(localStorage);
    const ls: any = localStorage;
    ls.getItem = () => {
      throw new Error('boom');
    };

    const { result } = renderHook(() => usePersistedState('k_get_err', { a: 1 }));
    expect(result.current[0]).toEqual({ a: 1 });

    ls.getItem = originalGetItem;
  });

  it('supports custom serialize/deserialize', () => {
    localStorage.clear();

    const { result } = renderHook(() =>
      usePersistedState('k2b', 1, {
        serialize: (v) => `v:${v}`,
        deserialize: (raw) => Number(String(raw).replace(/^v:/, '')),
        validate: (v): v is number => typeof v === 'number' && Number.isFinite(v),
      }),
    );

    expect(result.current[0]).toBe(1);

    act(() => {
      result.current[1](5);
    });

    expect(localStorage.getItem('k2b')).toBe('v:5');
  });

  it('falls back when deserialize throws', () => {
    localStorage.clear();
    localStorage.setItem('k2c', 'bad');

    const { result } = renderHook(() =>
      usePersistedState('k2c', 123, {
        deserialize: () => {
          throw new Error('boom');
        },
      }),
    );

    expect(result.current[0]).toBe(123);
  });

  it('usePersistedString uses raw serialization and supports removeWhen', () => {
    localStorage.clear();

    const { result } = renderHook(() => usePersistedString('k3', 'x', { removeWhen: (v) => v === '' }));
    expect(result.current[0]).toBe('x');

    act(() => {
      result.current[1]('hello');
    });
    expect(localStorage.getItem('k3')).toBe('hello');

    act(() => {
      result.current[1]('');
    });
    expect(localStorage.getItem('k3')).toBeNull();
  });

  it('usePersistedNullableString stores empty string for null and removes by default', () => {
    localStorage.clear();

    const { result } = renderHook(() => usePersistedNullableString('k4', 'abc'));
    expect(result.current[0]).toBe('abc');

    act(() => {
      result.current[1](null);
    });

    expect(localStorage.getItem('k4')).toBeNull();
  });
});
