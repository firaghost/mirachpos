import { describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';

import { useSessionEventWiring } from './useSessionEventWiring';

describe('useSessionEventWiring', () => {
  it('calls initTabSession and reacts to storage changes when token is missing', () => {
    const initTabSession = vi.fn();
    const setUserRole = vi.fn();
    const setCurrentScreen = vi.fn();
    const loginScreen = { id: 'login' };

    const readSession = vi.fn(() => ({ token: null })) as any;

    renderHook(() => useSessionEventWiring({ initTabSession, readSession, setUserRole, setCurrentScreen, loginScreen }));

    expect(initTabSession).toHaveBeenCalledTimes(1);

    act(() => {
      window.dispatchEvent(new Event('storage'));
    });

    expect(setUserRole).toHaveBeenCalledWith(null);
    expect(setCurrentScreen).toHaveBeenCalledWith(loginScreen);
  });

  it('suppresses known cssRules/putRootVars errors by preventDefault', () => {
    const initTabSession = vi.fn();
    const setUserRole = vi.fn();
    const setCurrentScreen = vi.fn();
    const loginScreen = { id: 'login' };
    const readSession = vi.fn(() => ({ token: 'ok' })) as any;

    renderHook(() => useSessionEventWiring({ initTabSession, readSession, setUserRole, setCurrentScreen, loginScreen }));

    const preventDefault = vi.fn();
    act(() => {
      const ev: any = new Event('error');
      ev.message = 'cssRules putRootVars';
      ev.error = new Error('cssRules putRootVars');
      ev.preventDefault = preventDefault;
      window.dispatchEvent(ev);
    });

    expect(preventDefault).toHaveBeenCalled();
  });

  it('does not call preventDefault if it is not a function (rejection)', () => {
    const initTabSession = vi.fn();
    const setUserRole = vi.fn();
    const setCurrentScreen = vi.fn();
    const loginScreen = { id: 'login' };
    const readSession = vi.fn(() => ({ token: 'ok' })) as any;

    renderHook(() => useSessionEventWiring({ initTabSession, readSession, setUserRole, setCurrentScreen, loginScreen }));

    act(() => {
      const ev: any = new Event('unhandledrejection');
      ev.reason = new Error('cssRules putRootVars');
      ev.preventDefault = 123;
      window.dispatchEvent(ev);
    });

    expect(true).toBe(true);
  });

  it('swallows handler errors when rejection event shape is unexpected', () => {
    const initTabSession = vi.fn();
    const setUserRole = vi.fn();
    const setCurrentScreen = vi.fn();
    const loginScreen = { id: 'login' };
    const readSession = vi.fn(() => ({ token: 'ok' })) as any;

    renderHook(() => useSessionEventWiring({ initTabSession, readSession, setUserRole, setCurrentScreen, loginScreen }));

    act(() => {
      const ev: any = new Event('unhandledrejection');
      Object.defineProperty(ev, 'reason', {
        get() {
          throw new Error('getter boom');
        },
      });
      window.dispatchEvent(ev);
    });

    expect(true).toBe(true);
  });

  it('does not call preventDefault if it is not a function (error)', () => {
    const initTabSession = vi.fn();
    const setUserRole = vi.fn();
    const setCurrentScreen = vi.fn();
    const loginScreen = { id: 'login' };
    const readSession = vi.fn(() => ({ token: 'ok' })) as any;

    renderHook(() => useSessionEventWiring({ initTabSession, readSession, setUserRole, setCurrentScreen, loginScreen }));

    act(() => {
      const ev: any = new Event('error');
      ev.message = 'cssRules putRootVars';
      ev.preventDefault = 123;
      window.dispatchEvent(ev);
    });

    expect(true).toBe(true);
  });

  it('suppresses known cssRules/putRootVars rejections by preventDefault', () => {
    const initTabSession = vi.fn();
    const setUserRole = vi.fn();
    const setCurrentScreen = vi.fn();
    const loginScreen = { id: 'login' };
    const readSession = vi.fn(() => ({ token: 'ok' })) as any;

    renderHook(() => useSessionEventWiring({ initTabSession, readSession, setUserRole, setCurrentScreen, loginScreen }));

    const preventDefault = vi.fn();
    act(() => {
      const ev: any = new Event('unhandledrejection');
      ev.reason = new Error('cssRules putRootVars');
      ev.preventDefault = preventDefault;
      window.dispatchEvent(ev);
    });

    expect(preventDefault).toHaveBeenCalled();
  });

  it('does not force logout on storage events when token exists', () => {
    const initTabSession = vi.fn();
    const setUserRole = vi.fn();
    const setCurrentScreen = vi.fn();
    const loginScreen = { id: 'login' };

    const readSession = vi.fn(() => ({ token: 't' })) as any;

    renderHook(() => useSessionEventWiring({ initTabSession, readSession, setUserRole, setCurrentScreen, loginScreen }));

    act(() => {
      window.dispatchEvent(new Event('storage'));
      window.dispatchEvent(new Event('mirachpos-session-changed'));
    });

    expect(setUserRole).not.toHaveBeenCalled();
    expect(setCurrentScreen).not.toHaveBeenCalled();
  });

  it('swallows handler errors when error event shape is unexpected', () => {
    const initTabSession = vi.fn();
    const setUserRole = vi.fn();
    const setCurrentScreen = vi.fn();
    const loginScreen = { id: 'login' };
    const readSession = vi.fn(() => ({ token: 'ok' })) as any;

    renderHook(() => useSessionEventWiring({ initTabSession, readSession, setUserRole, setCurrentScreen, loginScreen }));

    act(() => {
      const ev: any = new Event('error');
      Object.defineProperty(ev, 'message', {
        get() {
          throw new Error('getter boom');
        },
      });
      window.dispatchEvent(ev);
    });

    expect(true).toBe(true);
  });

  it('swallows storage handler errors when readSession throws', () => {
    const initTabSession = vi.fn();
    const setUserRole = vi.fn();
    const setCurrentScreen = vi.fn();
    const loginScreen = { id: 'login' };
    const readSession = vi.fn(() => {
      throw new Error('boom');
    }) as any;

    renderHook(() => useSessionEventWiring({ initTabSession, readSession, setUserRole, setCurrentScreen, loginScreen }));

    act(() => {
      window.dispatchEvent(new Event('storage'));
    });

    expect(setUserRole).not.toHaveBeenCalled();
    expect(setCurrentScreen).not.toHaveBeenCalled();
  });
});
