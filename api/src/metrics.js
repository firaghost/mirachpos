const client = require('prom-client');

const register = new client.Registry();

const isTestEnv = () =>
    process.env.NODE_ENV === 'test' ||
    String(process.env.JEST_WORKER_ID || '').trim() !== '' ||
    String(process.env.JEST || '').trim() !== '';

if (!isTestEnv()) {
    client.collectDefaultMetrics({ register });
}

const httpRequestDurationMs = new client.Histogram({
    name: 'http_request_duration_ms',
    help: 'HTTP request duration in ms',
    labelNames: ['method', 'route', 'status_code'],
    buckets: [25, 50, 100, 250, 500, 1000, 2500, 5000, 10000],
    registers: [register],
});

const httpRequestsTotal = new client.Counter({
    name: 'http_requests_total',
    help: 'Total HTTP requests',
    labelNames: ['method', 'route', 'status_code'],
    registers: [register],
});

const httpRequestsErrorsTotal = new client.Counter({
    name: 'http_requests_errors_total',
    help: 'Total HTTP error responses (4xx/5xx)',
    labelNames: ['method', 'route', 'status_code', 'error_class'],
    registers: [register],
});

const getRouteLabel = (req) => {
    const base = req.baseUrl || '';
    const routePath = req.route?.path || '';
    const combined = `${base}${routePath}`.trim();

    if (combined) return combined;
    if (req.path) return req.path;
    return 'unknown';
};

const metricsMiddleware = (req, res, next) => {
    const startNs = process.hrtime.bigint();

    res.on('finish', () => {
        const endNs = process.hrtime.bigint();
        const durationMs = Number(endNs - startNs) / 1e6;

        const method = String(req.method || 'GET');
        const route = getRouteLabel(req);
        const statusCode = String(res.statusCode || 0);

        httpRequestsTotal.inc({ method, route, status_code: statusCode });
        httpRequestDurationMs.observe({ method, route, status_code: statusCode }, durationMs);

        if (res.statusCode >= 400) {
            const errorClass = res.statusCode >= 500 ? '5xx' : '4xx';
            httpRequestsErrorsTotal.inc({ method, route, status_code: statusCode, error_class: errorClass });
        }
    });

    return next();
};

const metricsHandler = async (_req, res) => {
    res.setHeader('Content-Type', register.contentType);
    return res.status(200).send(await register.metrics());
};

module.exports = {
    register,
    metricsMiddleware,
    metricsHandler,
};
