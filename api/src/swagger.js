const swaggerUi = require('swagger-ui-express');
const fs = require('fs');
const path = require('path');
const { config } = require('./config');

// Load the OpenAPI spec
const openApiSpec = JSON.parse(fs.readFileSync(path.join(__dirname, '../openapi.json'), 'utf8'));

// Swagger UI options
const swaggerOptions = {
  explorer: true,
  customSiteTitle: 'MirachPOS API Documentation',
  customCss: '.swagger-ui .topbar { display: none }',
};

// Setup function for the Express app
const setupSwagger = (app) => {
  const key = String(process.env.SWAGGER_KEY || '').trim();

  const requireKey = (req, res, next) => {
    if (!key) return next();
    const provided = String(req.query?.key || req.headers['x-swagger-key'] || '').trim();
    if (!provided || provided !== key) return res.status(403).json({ error: 'forbidden' });
    return next();
  };

  const effectiveServers = (() => {
    const base = String(config?.app?.apiPublicUrl || '').trim();
    if (!base) return openApiSpec.servers;
    const normalized = base.endsWith('/api') ? base : `${base.replace(/\/+$/, '')}/api`;
    return [{ url: normalized, description: 'API Base' }];
  })();

  const spec = { ...openApiSpec, servers: effectiveServers };

  // Serve Swagger UI at /api-docs
  app.use('/api-docs', requireKey, swaggerUi.serve, swaggerUi.setup(spec, swaggerOptions));
  
  // Also serve the raw OpenAPI spec at /api-spec.json
  app.get('/api-spec.json', requireKey, (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.send(spec);
  });
  
  console.log('[Swagger] API documentation available at: /api-docs');
};

module.exports = { setupSwagger };
