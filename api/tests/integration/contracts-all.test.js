const request = require('supertest');
const { createApp } = require('../../src/app');

const normalizePath = (p) => {
  const s = String(p || '').trim();
  if (!s) return '';
  return s.startsWith('/') ? s : `/${s}`;
};

const joinPaths = (base, child) => {
  const b = normalizePath(base);
  const c = normalizePath(child);
  if (!b) return c || '/';
  if (!c || c === '/') return b;
  return `${b.replace(/\/+$/, '')}/${c.replace(/^\/+/, '')}`;
};

const regexpToMountPath = (re) => {
  if (!re || !(re instanceof RegExp)) return '';
  const src = String(re.source || '');
  if (!src || src === '^\\/?$') return '';

  // Express stores mount paths in a regexp that usually includes escaped slashes, e.g.
  // ^\\/api\\/?(?=\\/|$)
  // ^\\/payment\\/?(?=\\/|$)
  // ^\\/public\\/?(?=\\/|$)
  // We'll parse segments from "\\/segment" occurrences and join them.
  const segments = [];
  for (let i = 0; i < src.length - 1; i += 1) {
    if (src[i] !== '\\' || src[i + 1] !== '/') continue;
    let j = i + 2;
    let seg = '';
    while (j < src.length) {
      const ch = src[j];
      if (ch === '\\' || ch === '$' || ch === '(' || ch === ')' || ch === '?' || ch === '|') break;
      if (ch === '/') break;
      seg += ch;
      j += 1;
    }
    if (seg) segments.push(seg);
    // Keep scanning from the last processed position without skipping the next '\/' token.
    i = Math.max(i, j - 1);
  }

  if (!segments.length) return '';
  return `/${segments.join('/')}`;
};

const replaceParams = (p) => {
  const s = String(p || '');
  return s
    .replace(/:token\b/g, 'test-token')
    .replace(/:id\b/g, 'test-id')
    .replace(/:orderId\b/g, 'order-123')
    .replace(/:branchId\b/g, 'b_1')
    .replace(/:staffId\b/g, 's_test')
    .replace(/:tenantId\b/g, 't_test')
    .replace(/:slug\b/g, 'test')
    .replace(/:name\b/g, 'test')
    .replace(/:\w+/g, 'test');
};

const extractEndpointsFromStack = (stack, prefix = '') => {
  const endpoints = [];
  if (!Array.isArray(stack)) return endpoints;

  for (const layer of stack) {
    if (!layer) continue;

    if (layer.route && layer.route.path) {
      const routePath = joinPaths(prefix, layer.route.path);
      const methods = Object.keys(layer.route.methods || {})
        .filter((m) => layer.route.methods[m])
        .map((m) => m.toUpperCase());

      for (const method of methods) {
        endpoints.push({ method, path: routePath });
      }
      continue;
    }

    if (layer.name === 'router' && layer.handle && Array.isArray(layer.handle.stack)) {
      const mount = regexpToMountPath(layer.regexp);
      const nextPrefix = joinPaths(prefix, mount);
      endpoints.push(...extractEndpointsFromStack(layer.handle.stack, nextPrefix));
    }
  }

  return endpoints;
};

const uniqueEndpoints = (eps) => {
  const seen = new Set();
  const out = [];
  for (const e of eps) {
    const key = `${e.method} ${e.path}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(e);
  }
  return out;
};

describe('API Contracts (Strict Baseline) - All Endpoints', () => {
  let app;

  beforeAll(() => {
    app = createApp();
  });

  it('every discovered endpoint should be reachable and follow baseline response contract', async () => {
    const stack = app && app._router && Array.isArray(app._router.stack) ? app._router.stack : [];
    const endpoints = uniqueEndpoints(extractEndpointsFromStack(stack, ''))
      .filter((e) => String(e.path).startsWith('/api/'))
      .filter((e) => !String(e.path).startsWith('/api/uploads'));

    expect(endpoints.length).toBeGreaterThan(0);

    const failures = [];

    for (const ep of endpoints) {
      const method = ep.method;
      const rawPath = ep.path;
      const path = replaceParams(rawPath);

      const r = request(app);
      const req = (() => {
        switch (method) {
          case 'GET':
            return r.get(path);
          case 'POST':
            return r.post(path);
          case 'PUT':
            return r.put(path);
          case 'PATCH':
            return r.patch(path);
          case 'DELETE':
            return r.delete(path);
          default:
            return null;
        }
      })();

      if (!req) continue;

      const isApi = path.startsWith('/api');
      const isWebhook = path.startsWith('/api/webhooks');
      const isPublic = path.startsWith('/api/public');

      if (isApi && !isWebhook) {
        req.set('X-Tenant', 'test-tenant-id');
      }

      if (isApi && !isPublic && !isWebhook) {
        req.set('Authorization', 'Bearer test-token');
      }

      if (method !== 'GET' && method !== 'DELETE') {
        req.send({});
      }

      let res;
      try {
        res = await req;
      } catch (e) {
        const msg = e && typeof e === 'object' && typeof e.message === 'string' ? e.message : String(e || '');
        failures.push({ method, path: rawPath, error: msg });
        continue;
      }

      const contentType = String((res.headers && res.headers['content-type']) || '');
      const isJson = contentType.includes('application/json');

      const isMissingRoute404 =
        res.status === 404 &&
        isJson &&
        res.body &&
        typeof res.body === 'object' &&
        res.body.error === 'not_found' &&
        typeof res.body.message === 'string' &&
        res.body.message.indexOf('Cannot ') === 0;

      if (isMissingRoute404) {
        failures.push({ method, path: rawPath, status: res.status, body: res.body });
        continue;
      }

      if (isJson && isApi) {
        const body = res.body;
        if (!body || typeof body !== 'object') {
          failures.push({ method, path: rawPath, status: res.status, issue: 'json_body_not_object' });
          continue;
        }

        if (typeof body.requestId !== 'string' || !body.requestId.trim()) {
          failures.push({ method, path: rawPath, status: res.status, issue: 'missing_requestId' });
          continue;
        }

        if (!isWebhook) {
          const hasOk = Object.prototype.hasOwnProperty.call(body, 'ok');
          const hasError = Object.prototype.hasOwnProperty.call(body, 'error');
          if (!hasOk && !hasError) {
            failures.push({ method, path: rawPath, status: res.status, issue: 'missing_ok_or_error', bodyKeys: Object.keys(body) });
            continue;
          }
        }
      }
    }

    if (failures.length) {
      const preview = failures.slice(0, 30);
      throw new Error(`Baseline contract failures: ${failures.length}\n${JSON.stringify(preview, null, 2)}`);
    }
  }, 60000);
});
