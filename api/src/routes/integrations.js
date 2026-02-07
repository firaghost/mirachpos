/**
 * Integration Routes
 * 
 * API endpoints for integration management and testing
 */

const express = require('express');
const { tenantMiddleware } = require('../middleware/tenant');
const { requireAuth } = require('../middleware/auth');
const { requireRole } = require('../middleware/permissions');
const { db } = require('../db');
const { testIntegration, sendOrderNotification } = require('../services/integrationService');

const safeJsonParse = (raw, fallback) => {
    try {
        if (!raw) return fallback;
        return JSON.parse(String(raw)) ?? fallback;
    } catch {
        return fallback;
    }
};

const makeIntegrationRouter = () => {
    const r = express.Router();

    // Test integration configuration
    r.post(
        '/owner/integrations/:id/test',
        tenantMiddleware,
        requireAuth,
        requireRole('Cafe Owner'),
        async (req, res, next) => {
            try {
                const integrationId = String(req.params?.id || '').trim();
                if (!integrationId) return res.status(400).json({ error: 'id_required' });

                // Get integration details
                const integration = await db()
                    .from({ ti: 'tenant_integrations' })
                    .innerJoin({ ic: 'integrations_catalog' }, 'ic.id', 'ti.integration_id')
                    .where({ 'ti.id': integrationId, 'ti.tenant_id': req.tenant.id })
                    .select(['ti.id', 'ti.config_json', 'ic.code', 'ic.name'])
                    .first();

                if (!integration) {
                    return res.status(404).json({ error: 'integration_not_found' });
                }

                const config = safeJsonParse(integration.config_json, {});

                // Test the integration
                const result = await testIntegration({
                    integrationCode: integration.code,
                    config,
                });

                // Log the test
                await db().from('integration_logs').insert({
                    id: require('../utils/ids').uid('log'),
                    tenant_id: req.tenant.id,
                    integration_id: integrationId,
                    event_type: 'test',
                    status: result.ok ? 'success' : 'failed',
                    response_json: JSON.stringify(result),
                    created_at: new Date().toISOString(),
                });

                return res.json({
                    ok: result.ok,
                    message: result.ok ? 'Test notification sent successfully' : result.error,
                });
            } catch (e) {
                return next(e);
            }
        }
    );

    // Update integration configuration
    r.put(
        '/owner/integrations/:id/config',
        tenantMiddleware,
        requireAuth,
        requireRole('Cafe Owner'),
        async (req, res, next) => {
            try {
                const integrationId = String(req.params?.id || '').trim();
                if (!integrationId) return res.status(400).json({ error: 'id_required' });

                const config = req.body?.config;
                if (!config || typeof config !== 'object') {
                    return res.status(400).json({ error: 'config_required' });
                }

                // Get current integration
                const integration = await db()
                    .from('tenant_integrations')
                    .where({ id: integrationId, tenant_id: req.tenant.id })
                    .first();

                if (!integration) {
                    return res.status(404).json({ error: 'integration_not_found' });
                }

                // Merge with existing config
                const existing = safeJsonParse(integration.config_json, {});
                const merged = { ...existing, ...config };

                // Update
                await db()
                    .from('tenant_integrations')
                    .where({ id: integrationId, tenant_id: req.tenant.id })
                    .update({
                        config_json: JSON.stringify(merged),
                        updated_at: new Date().toISOString(),
                    });

                return res.json({ ok: true, message: 'Configuration updated' });
            } catch (e) {
                return next(e);
            }
        }
    );

    // Get integration logs
    r.get(
        '/owner/integrations/:id/logs',
        tenantMiddleware,
        requireAuth,
        requireRole('Cafe Owner'),
        async (req, res, next) => {
            try {
                const integrationId = String(req.params?.id || '').trim();
                const limit = Math.min(100, Math.max(1, parseInt(req.query?.limit) || 20));

                const logs = await db()
                    .from('integration_logs')
                    .where({ tenant_id: req.tenant.id, integration_id: integrationId })
                    .orderBy('created_at', 'desc')
                    .limit(limit)
                    .select(['id', 'event_type', 'status', 'response_json', 'created_at']);

                return res.json({
                    ok: true,
                    logs: logs.map(l => ({
                        id: l.id,
                        eventType: l.event_type,
                        status: l.status,
                        response: safeJsonParse(l.response_json, {}),
                        createdAt: l.created_at,
                    })),
                });
            } catch (e) {
                return next(e);
            }
        }
    );

    // Trigger manual order notification (for testing)
    r.post(
        '/owner/integrations/trigger-order-notification',
        tenantMiddleware,
        requireAuth,
        requireRole('Cafe Owner'),
        async (req, res, next) => {
            try {
                const { orderId, eventType = 'created' } = req.body || {};
                if (!orderId) return res.status(400).json({ error: 'order_id_required' });

                // Get order details
                const order = await db()
                    .from('orders')
                    .where({ id: orderId, tenant_id: req.tenant.id })
                    .first();

                if (!order) {
                    return res.status(404).json({ error: 'order_not_found' });
                }

                // Send notification
                const result = await sendOrderNotification({
                    tenantId: req.tenant.id,
                    branchId: order.branch_id,
                    order,
                    eventType,
                });

                return res.json(result);
            } catch (e) {
                return next(e);
            }
        }
    );

    return r;
};

module.exports = { makeIntegrationRouter };
