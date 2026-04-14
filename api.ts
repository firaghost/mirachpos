// MirachPOS API - Odoo Backend Connector
// Replace the original api.ts with this file

import { initTabSession, readSession, clearSession } from './session';

export type ApiFetchOptions = Omit<RequestInit, 'headers'> & {
  headers?: Record<string, string>;
  auth?: boolean;
};

// Odoo Backend Configuration
const apiBase = (): string => {
  // Use Odoo backend - change this to your Odoo URL
  // For local development:
  if (typeof window !== 'undefined') {
    const host = window.location.hostname;
    if (host === 'localhost' || host === '127.0.0.1') {
      return 'http://localhost:8069';
    }
  }
  
  // Production Odoo server
  // return 'https://your-odoo-server.com';
  
  // Default to localhost
  return 'http://localhost:8069';
};

export const resolveAssetUrl = (raw: string): string => {
  const s0 = String(raw || '').trim();
  if (!s0) return '';
  if (s0.startsWith('http://') || s0.startsWith('https://') || s0.startsWith('data:')) return s0;
  
  // Odoo images
  if (s0.startsWith('/web/image/')) {
    return `${apiBase()}${s0}`;
  }
  
  return s0;
};

export const authHeader = (): Record<string, string> => {
  initTabSession();
  const sess = readSession();
  const token = typeof sess?.token === 'string' ? sess.token : '';
  return token ? { Authorization: `Bearer ${token}` } : {};
};

export const logoutAndReload = () => {
  clearSession();
  try {
    window.location.reload();
  } catch {
    // ignore
  }
};

let serverOffsetMs = 0;

export const serverNowMs = () => Date.now() + serverOffsetMs;

export const apiFetch = async (input: RequestInfo | URL, init: ApiFetchOptions = {}) => {
  const { auth = true, headers, ...rest } = init;
  const mergedHeaders: Record<string, string> = { ...(headers || {}) };
  
  if (auth) {
    Object.assign(mergedHeaders, authHeader());
  }
  
  // Add JSON content type for POST requests
  if (!mergedHeaders['Content-Type'] && (init.method === 'POST' || init.method === 'PUT')) {
    mergedHeaders['Content-Type'] = 'application/json';
  }
  
  let finalInput: RequestInfo | URL = input;
  if (typeof input === 'string') {
    const base = apiBase();
    
    // Map mirachpos endpoints to Odoo endpoints
    const odooEndpoint = mapMirachToOdoo(input);
    
    if (input.startsWith('/api/')) {
      finalInput = `${base}${odooEndpoint}`;
    } else {
      finalInput = input;
    }
  }
  
  // Handle method and body for Odoo
  const method = typeof (rest as any)?.method === 'string' 
    ? String((rest as any).method).toUpperCase() 
    : 'GET';
  
  // For Odoo JSON-RPC type endpoints
  let body = (rest as any)?.body;
  if (body && typeof body === 'string' && method === 'POST') {
    try {
      const parsed = JSON.parse(body);
      // Odoo expects wrapped JSON for type='json' routes
      if (!parsed.jsonrpc) {
        // Add jsonrpc wrapper for Odoo
        body = JSON.stringify({
          jsonrpc: '2.0',
          method: 'call',
          params: parsed,
          id: Math.floor(Math.random() * 1000000)
        });
      }
    } catch {
      // Not JSON, keep as is
    }
  }
  
  const res = await fetch(finalInput, { 
    ...rest, 
    headers: mergedHeaders,
    body: body
  });
  
  // Handle Odoo errors
  if (res.status === 401) {
    logoutAndReload();
    return res;
  }
  
  if (res.status === 403) {
    const error = await res.text();
    console.error('Odoo Access Denied:', error);
    return res;
  }
  
  return res;
};

// Map MirachPOS endpoints to Odoo API endpoints
function mapMirachToOdoo(endpoint: string): string {
  // Auth endpoints
  if (endpoint === '/api/auth/login') return '/api/auth/login';
  if (endpoint === '/api/auth/me') return '/api/auth/me';
  if (endpoint === '/api/auth/logout') return '/api/auth/logout';
  
  // POS endpoints
  if (endpoint === '/api/pos/products') return '/api/pos/products';
  if (endpoint === '/api/pos/orders') return '/api/pos/orders';
  if (endpoint.startsWith('/api/pos/orders/')) return endpoint;
  if (endpoint === '/api/pos/tables') return '/api/pos/tables';
  if (endpoint.startsWith('/api/pos/tables/')) return endpoint;
  
  // Categories
  if (endpoint === '/api/pos/categories') return '/api/pos/categories';
  
  // Waiter endpoints
  if (endpoint.startsWith('/api/waiter/')) return endpoint;
  
  // Manager endpoints
  if (endpoint.startsWith('/api/manager/')) return endpoint;
  
  // Fallback - return as-is
  return endpoint;
}

// Export compatibility with existing code
export const superadminAuthHeader = authHeader;
