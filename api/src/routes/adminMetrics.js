
const express = require('express');
const { db } = require('../db');
const { requireSuperadmin } = require('../middleware/superadminAuth');

const makeAdminMetricsRouter = () => {
    const r = express.Router();

    r.get('/metrics', requireSuperadmin, async (req, res, next) => {
        try {
            const now = new Date();

            // 1. System Vitals
            const memoryUsage = process.memoryUsage();
            const systemStats = {
                uptimeSeconds: process.uptime(),
                memory: {
                    rss: Math.round(memoryUsage.rss / 1024 / 1024) + ' MB',
                    heapTotal: Math.round(memoryUsage.heapTotal / 1024 / 1024) + ' MB',
                    heapUsed: Math.round(memoryUsage.heapUsed / 1024 / 1024) + ' MB',
                },
                timestamp: now.toISOString(),
            };

            // 2. Database Health
            let dbStatus = 'unknown';
            try {
                await db().raw('SELECT 1');
                dbStatus = 'connected';
            } catch (e) {
                dbStatus = 'disconnected';
            }

            // 3. Job Queue Stats
            const jobStats = await db()
                .from('jobs')
                .select('status')
                .count('id as count')
                .groupBy('status');

            // Convert array [{status: 'pending', count: 5}, ...] to object { pending: 5, ... }
            const jobCounts = jobStats.reduce((acc, row) => {
                acc[row.status] = Number(row.count || 0);
                return acc;
            }, { pending: 0, processing: 0, completed: 0, failed: 0 });

            return res.json({
                ok: true,
                system: systemStats,
                database: { status: dbStatus },
                jobs: jobCounts,
            });
        } catch (e) {
            return next(e);
        }
    });

    return r;
};

module.exports = { makeAdminMetricsRouter };
