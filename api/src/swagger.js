const swaggerUi = require('swagger-ui-express');
const fs = require('fs');
const path = require('path');

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
  // Serve Swagger UI at /api-docs
  app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(openApiSpec, swaggerOptions));
  
  // Also serve the raw OpenAPI spec at /api-spec.json
  app.get('/api-spec.json', (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.send(openApiSpec);
  });
  
  console.log('[Swagger] API documentation available at: /api-docs');
};

module.exports = { setupSwagger };
