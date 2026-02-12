import { describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';

import { usePosIdleTimeout } from './usePosIdleTimeout';

describe('usePosIdleTimeout', () => {
  it('logs out when idle exceeds configured timeout', async () => {
    vi.useFakeTimers();

    const apiFetch = vi.fn(async () => {
      return {
        ok: true,
        json: async () => ({ security: { sessionTimeoutMins: 1 } }),
      } as any;
    });

    const logoutAndReload = vi.fn();
    const isPosRole = (role: string | null) => role === 'Waiter';
    const safeSessionTimeoutMs = (mins: unknown) => {
      const n = Number(mins);
      return Number.isFinite(n) ? n * 60 * 1000 : 0;
    };

    renderHook(() =>
      usePosIdleTimeout({
        userRole: 'Waiter',
        currentScreen: 'POS',
        isPosRole,
        safeSessionTimeoutMs,
        apiFetch,
        logoutAndReload,
      }),
    );

    await act(async () => {
      await vi.runAllTicks();
    });

    act(() => {
      vi.advanceTimersByTime(75 * 1000);
    });

    expect(logoutAndReload).toHaveBeenCalled();

    vi.useRealTimers();
  });

  it('does nothing for non-POS roles', () => {
    vi.useFakeTimers();

    const apiFetch = vi.fn(async () => {
      return { ok: true, json: async () => ({ security: { sessionTimeoutMins: 1 } }) } as any;
    });
    const logoutAndReload = vi.fn();

    renderHook(() =>
      usePosIdleTimeout({
        userRole: 'Cafe Owner',
        currentScreen: 'Owner',
        isPosRole: (r) => r === 'Waiter',
        safeSessionTimeoutMs: () => 60000,
        apiFetch,
        logoutAndReload,
      }),
    );

    act(() => {
      vi.advanceTimersByTime(5 * 60 * 1000);
    });

    expect(apiFetch).not.toHaveBeenCalled();
    expect(logoutAndReload).not.toHaveBeenCalled();

    vi.useRealTimers();
  });

  it('does not start timeout when settings fetch returns non-ok', async () => {
    vi.useFakeTimers();

    const apiFetch = vi.fn(async () => {
      return { ok: false, json: async () => ({}) } as any;
    });
    const logoutAndReload = vi.fn();

    renderHook(() =>
      usePosIdleTimeout({
        userRole: 'Waiter',
        currentScreen: 'POS',
        isPosRole: (r) => r === 'Waiter',
        safeSessionTimeoutMs: () => 60000,
        apiFetch,
        logoutAndReload,
      }),
    );

    await act(async () => {
      await vi.runAllTicks();
    });

    act(() => {
      vi.advanceTimersByTime(5 * 60 * 1000);
    });

    expect(logoutAndReload).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('handles json parse failures gracefully', async () => {
    vi.useFakeTimers();

    const apiFetch = vi.fn(async () => {
      return {
        ok: true,
        json: async () => {
          throw new Error('bad json');
        },
      } as any;
    });
    const logoutAndReload = vi.fn();

    renderHook(() =>
      usePosIdleTimeout({
        userRole: 'Waiter',
        currentScreen: 'POS',
        isPosRole: (r) => r === 'Waiter',
        safeSessionTimeoutMs: () => 0,
        apiFetch,
        logoutAndReload,
      }),
    );

    await act(async () => {
      await vi.runAllTicks();
    });

    act(() => {
      vi.advanceTimersByTime(5 * 60 * 1000);
    });

    expect(logoutAndReload).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('does not start timeout when settings fetch throws', async () => {
    vi.useFakeTimers();

    const apiFetch = vi.fn(async () => {
      throw new Error('network');
    });
    const logoutAndReload = vi.fn();

    renderHook(() =>
      usePosIdleTimeout({
        userRole: 'Waiter',
        currentScreen: 'POS',
        isPosRole: (r) => r === 'Waiter',
        safeSessionTimeoutMs: () => 60000,
        apiFetch,
        logoutAndReload,
      }),
    );

    await act(async () => {
      await vi.runAllTicks();
    });

    act(() => {
      vi.advanceTimersByTime(5 * 60 * 1000);
    });

    expect(logoutAndReload).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('ignores late successful settings responses after unmount', async () => {
    vi.useFakeTimers();

    let resolveFetch: ((v: any) => void) | null = null;
    const apiFetch: any = vi.fn(
      () =>
        new Promise((resolve) => {
          resolveFetch = resolve;
        }),
    );

    const logoutAndReload = vi.fn();

    const { unmount } = renderHook(() =>
      usePosIdleTimeout({
        userRole: 'Waiter',
        currentScreen: 'POS',
        isPosRole: (r) => r === 'Waiter',
        safeSessionTimeoutMs: () => 60000,
        apiFetch,
        logoutAndReload,
      }),
    );

    unmount();
    resolveFetch?.({ ok: true, json: async () => ({ security: { sessionTimeoutMins: 1 } }) });

    await act(async () => {
      await vi.runAllTicks();
    });

    act(() => {
      vi.advanceTimersByTime(5 * 60 * 1000);
    });

    expect(logoutAndReload).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('ignores late failed settings responses after unmount', async () => {
    vi.useFakeTimers();

    let rejectFetch: ((e: any) => void) | null = null;
    const apiFetch: any = vi.fn(
      () =>
        new Promise((_resolve, reject) => {
          rejectFetch = reject;
        }),
    );

    const logoutAndReload = vi.fn();

    const { unmount } = renderHook(() =>
      usePosIdleTimeout({
        userRole: 'Waiter',
        currentScreen: 'POS',
        isPosRole: (r) => r === 'Waiter',
        safeSessionTimeoutMs: () => 60000,
        apiFetch,
        logoutAndReload,
      }),
    );

    unmount();
    rejectFetch?.(new Error('late'));

    await act(async () => {
      await vi.runAllTicks();
    });

    expect(logoutAndReload).not.toHaveBeenCalled();
    vi.useRealTimers();
  });
});
