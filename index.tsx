import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

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
