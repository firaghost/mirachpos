import { useEffect } from 'react';

type Params = {
  initTabSession: () => void;
  readSession: <T = any>() => T;
  setUserRole: (role: any) => void;
  setCurrentScreen: (screen: any) => void;
  loginScreen: any;
};

export const useSessionEventWiring = ({ initTabSession, readSession, setUserRole, setCurrentScreen, loginScreen }: Params) => {
  useEffect(() => {
    const onError = (ev: any) => {
      try {
        const msg = String(ev?.message || ev?.error?.message || '');
        if (msg.includes('cssRules') && msg.includes('putRootVars')) {
          if (typeof ev?.preventDefault === 'function') ev.preventDefault();
          return;
        }
      } catch {
      }
    };

    const onRejection = (ev: any) => {
      try {
        const msg = String(ev?.reason?.message || ev?.reason || '');
        if (msg.includes('cssRules') && msg.includes('putRootVars')) {
          if (typeof ev?.preventDefault === 'function') ev.preventDefault();
          return;
        }
      } catch {
      }
    };

    window.addEventListener('error', onError as any);
    window.addEventListener('unhandledrejection', onRejection as any);

    initTabSession();

    const onStorage = () => {
      try {
        const s = readSession<any>();
        if (!s?.token) {
          setUserRole(null);
          setCurrentScreen(loginScreen);
        }
      } catch {
      }
    };

    window.addEventListener('storage', onStorage);
    window.addEventListener('mirachpos-session-changed', onStorage as any);

    return () => {
      window.removeEventListener('error', onError as any);
      window.removeEventListener('unhandledrejection', onRejection as any);
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('mirachpos-session-changed', onStorage as any);
    };
  }, [initTabSession, loginScreen, readSession, setCurrentScreen, setUserRole]);
};
