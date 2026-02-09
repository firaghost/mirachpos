/**
 * OpenAPI Spec Generator for MirachPOS API
 * Discovers all Express routes and generates a comprehensive OpenAPI 3.0 spec
 */

const { createApp } = require('../src/app');
const fs = require('fs');
const path = require('path');

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
    i = Math.max(i, j - 1);
  }

  if (!segments.length) return '';
  return `/${segments.join('/')}`;
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

const groupByTag = (path) => {
  const p = String(path || '');
  
  if (p.startsWith('/api/webhooks')) return 'Webhooks';
  if (p.startsWith('/api/public')) return 'Public';
  if (p.startsWith('/api/admin')) return 'Admin';
  if (p.startsWith('/api/superadmin')) return 'Superadmin';
  if (p.startsWith('/api/auth')) return 'Authentication';
  if (p.startsWith('/api/login')) return 'Authentication';
  if (p.startsWith('/api/branches')) return 'Branches';
  if (p.startsWith('/api/owner')) return 'Owner';
  if (p.startsWith('/api/manager')) return 'Manager';
  if (p.startsWith('/api/staff')) return 'Staff';
  if (p.startsWith('/api/waiter')) return 'Waiter';
  if (p.startsWith('/api/pos')) return 'POS';
  if (p.startsWith('/api/inventory')) return 'Inventory';
  if (p.startsWith('/api/subscription')) return 'Subscription';
  if (p.startsWith('/api/billing')) return 'Billing';
  if (p.startsWith('/api/audit')) return 'Audit';
  if (p.startsWith('/api/support')) return 'Support';
  if (p.startsWith('/api/schedule')) return 'Schedule';
  if (p.startsWith('/api/sync')) return 'Sync';
  if (p.startsWith('/api/reports')) return 'Reports';
  if (p.startsWith('/api/metrics')) return 'Metrics';
  if (p.startsWith('/api/integrations')) return 'Integrations';
  if (p.startsWith('/api/guests')) return 'Guests';
  if (p.startsWith('/api/realtime')) return 'Realtime';
  
  return 'General';
};

const generateOpenAPISpec = () => {
  const app = createApp();
  const stack = app && app._router && Array.isArray(app._router.stack) ? app._router.stack : [];
  const endpoints = uniqueEndpoints(extractEndpointsFromStack(stack, ''));

  const paths = {};
  const tags = new Set();

  endpoints.forEach((ep) => {
    const p = ep.path;
    const method = ep.method.toLowerCase();
    const tag = groupByTag(p);
    tags.add(tag);

    const openApiPath = p.replace(/:token/g, '{token}')
      .replace(/:id/g, '{id}')
      .replace(/:orderId/g, '{orderId}')
      .replace(/:branchId/g, '{branchId}')
      .replace(/:staffId/g, '{staffId}')
      .replace(/:tenantId/g, '{tenantId}')
      .replace(/:slug/g, '{slug}')
      .replace(/:name/g, '{name}');

    if (!paths[openApiPath]) {
      paths[openApiPath] = {};
    }

    const operation = {
      tags: [tag],
      summary: `${ep.method} ${ep.path}`,
      operationId: `${method}_${ep.path.replace(/[^a-zA-Z0-9]/g, '_')}`,
      parameters: [],
      responses: {
        '200': {
          description: 'Success',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  ok: { type: 'boolean', example: true },
                  requestId: { type: 'string' }
                }
              }
            }
          }
        },
        '400': {
          description: 'Bad Request',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  error: { type: 'string', example: 'validation_error' },
                  requestId: { type: 'string' }
                }
              }
            }
          }
        },
        '401': {
          description: 'Unauthorized',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  error: { type: 'string', example: 'unauthorized' },
                  requestId: { type: 'string' }
                }
              }
            }
          }
        },
        '403': {
          description: 'Forbidden',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  error: { type: 'string', example: 'forbidden' },
                  requestId: { type: 'string' }
                }
              }
            }
          }
        },
        '404': {
          description: 'Not Found',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  error: { type: 'string', example: 'not_found' },
                  message: { type: 'string' },
                  requestId: { type: 'string' }
                }
              }
            }
          }
        },
        '500': {
          description: 'Internal Server Error',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  error: { type: 'string', example: 'internal_error' },
                  requestId: { type: 'string' }
                }
              }
            }
          }
        }
      }
    };

    // Add auth headers for API routes
    if (openApiPath.startsWith('/api/') && !openApiPath.startsWith('/api/public') && !openApiPath.startsWith('/api/webhooks')) {
      operation.parameters.push(
        {
          name: 'Authorization',
          in: 'header',
          required: true,
          schema: { type: 'string' },
          description: 'Bearer token'
        },
        {
          name: 'X-Tenant',
          in: 'header',
          required: true,
          schema: { type: 'string' },
          description: 'Tenant ID'
        }
      );
    }

    // Add path parameters
    const paramMatches = openApiPath.match(/{([^}]+)}/g);
    if (paramMatches) {
      paramMatches.forEach((match) => {
        const paramName = match.replace(/{|}/g, '');
        if (!operation.parameters.find((p) => p.name === paramName && p.in === 'path')) {
          operation.parameters.push({
            name: paramName,
            in: 'path',
            required: true,
            schema: { type: 'string' }
          });
        }
      });
    }

    // Add request body for POST/PUT/PATCH
    if (['post', 'put', 'patch'].includes(method)) {
      operation.requestBody = {
        content: {
          'application/json': {
            schema: { type: 'object' }
          }
        }
      };
    }

    paths[openApiPath][method] = operation;
  });

  // Add explicit authentication endpoints with full details
  paths['/auth/login'] = {
    post: {
      tags: ['Authentication'],
      summary: 'Login with email and password',
      description: 'Authenticate and receive a JWT token for API access. Use this token in the Authorization header as "Bearer {token}".',
      operationId: 'login',
      security: [],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/LoginRequest' }
          }
        }
      },
      responses: {
        '200': {
          description: 'Login successful - returns JWT token',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/LoginResponse' }
            }
          }
        },
        '400': {
          description: 'Bad Request - Missing email or password',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/ErrorResponse' }
            }
          }
        },
        '401': {
          description: 'Unauthorized - Invalid credentials',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/ErrorResponse' }
            }
          }
        }
      }
    }
  };

  paths['/auth/login-pin'] = {
    post: {
      tags: ['Authentication'],
      summary: 'Login with PIN code',
      description: 'Staff login using PIN code and tenant slug',
      operationId: 'loginPin',
      security: [],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['pin', 'tenantSlug'],
              properties: {
                pin: { type: 'string', example: '1234' },
                tenantSlug: { type: 'string', example: 'my-cafe' }
              }
            }
          }
        }
      },
      responses: {
        '200': {
          description: 'Login successful',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/LoginResponse' }
            }
          }
        },
        '401': {
          description: 'Invalid PIN or tenant'
        }
      }
    }
  };

  paths['/auth/refresh'] = {
    post: {
      tags: ['Authentication'],
      summary: 'Refresh JWT token',
      operationId: 'refreshToken',
      security: [{ bearerAuth: [] }],
      responses: {
        '200': {
          description: 'Token refreshed',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  ok: { type: 'boolean' },
                  token: { type: 'string' }
                }
              }
            }
          }
        }
      }
    }
  };

  paths['/auth/logout'] = {
    post: {
      tags: ['Authentication'],
      summary: 'Logout',
      operationId: 'logout',
      security: [{ bearerAuth: [] }],
      responses: {
        '200': {
          description: 'Logout successful'
        }
      }
    }
  };

  paths['/auth/forgot-password'] = {
    post: {
      tags: ['Authentication'],
      summary: 'Request password reset',
      operationId: 'forgotPassword',
      security: [],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['email'],
              properties: {
                email: { type: 'string', format: 'email' }
              }
            }
          }
        }
      },
      responses: {
        '200': {
          description: 'Password reset email sent'
        }
      }
    }
  };

  tags.add('Authentication');

  const spec = {
    openapi: '3.0.3',
    info: {
      title: 'MirachPOS API',
      description: 'MirachPOS REST API - Point of Sale System',
      version: '1.0.0',
      contact: {
        name: 'MirachPOS Support'
      }
    },
    servers: [
      { url: '/api', description: 'API Base' }
    ],
    tags: Array.from(tags).map((name) => ({ name })),
    paths,
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description: 'JWT token obtained from login endpoint'
        },
        tenantHeader: {
          type: 'apiKey',
          in: 'header',
          name: 'X-Tenant',
          description: 'Tenant ID/slug for multi-tenancy'
        }
      },
      schemas: {
        LoginRequest: {
          type: 'object',
          required: ['email', 'password'],
          properties: {
            email: {
              type: 'string',
              format: 'email',
              example: 'owner@example.com'
            },
            password: {
              type: 'string',
              format: 'password',
              example: 'password123'
            }
          }
        },
        LoginResponse: {
          type: 'object',
          properties: {
            ok: { type: 'boolean', example: true },
            token: {
              type: 'string',
              example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...'
            },
            user: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                email: { type: 'string' },
                name: { type: 'string' },
                role: { type: 'string', example: 'Cafe Owner' },
                tenantId: { type: 'string' }
              }
            }
          }
        },
        ErrorResponse: {
          type: 'object',
          properties: {
            error: { type: 'string' },
            message: { type: 'string' },
            requestId: { type: 'string' }
          }
        }
      }
    },
    security: [
      { bearerAuth: [], tenantHeader: [] }
    ]
  };

  return spec;
};

// Generate and save the spec
const spec = generateOpenAPISpec();
const outputPath = path.join(__dirname, '..', 'openapi.json');
fs.writeFileSync(outputPath, JSON.stringify(spec, null, 2));

console.log(`OpenAPI spec generated: ${path.relative(process.cwd(), outputPath)}`);
console.log(`Total endpoints documented: ${Object.keys(spec.paths).length}`);

module.exports = { generateOpenAPISpec };
