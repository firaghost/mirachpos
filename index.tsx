import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';
import { initializeFaro, getWebInstrumentations } from '@grafana/faro-web-sdk';
import { TracingInstrumentation } from '@grafana/faro-web-tracing';

const getFaroConfig = () => {
  const env = (import.meta as any)?.env || {};
  const url = typeof env.VITE_FARO_COLLECTOR_URL === 'string' ? env.VITE_FARO_COLLECTOR_URL.trim() : '';
  if (!url) return null;
  const version = typeof env.VITE_APP_VERSION === 'string' ? env.VITE_APP_VERSION.trim() : '1.0.0';
  const environment = typeof env.VITE_FARO_ENV === 'string'
    ? env.VITE_FARO_ENV.trim()
    : (env.PROD ? 'production' : 'development');

  return { url, version, environment };
};

const faroConfig = getFaroConfig();
if (faroConfig && faroConfig.environment !== 'development') {
  initializeFaro({
    url: faroConfig.url,
    app: {
      name: 'MirachPos',
      version: faroConfig.version,
      environment: faroConfig.environment,
    },
    instrumentations: [
      ...getWebInstrumentations(),
      new TracingInstrumentation(),
    ],
  });
}

const onError = (ev: any) => {
  try {
    const msg = String(ev?.message || ev?.error?.message || '');
    if (msg.includes('cssRules') && msg.includes('putRootVars')) {
      if (typeof ev?.preventDefault === 'function') ev.preventDefault();
      return;
    }
  } catch {
    // ignore
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
    // ignore
  }
};

window.addEventListener('error', onError as any);
window.addEventListener('unhandledrejection', onRejection as any);

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
