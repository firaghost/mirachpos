
const { db } = require('../db');
const { makeId } = require('../utils/ids');
const { logger } = require('../utils/logger');

const handlers = new Map();

/**
 * Register a job handler
 * @param {string} type 
 * @param {function} handler 
 */
const registerHandler = (type, handler) => {
    handlers.set(type, handler);
    logger.info({ type }, 'Registered job handler');
};

/**
 * Enqueue a new job
 * @param {object} params
 * @param {string} params.type
 * @param {object} params.payload
 * @param {Date} params.runAt
 */
const enqueueJob = async ({ type, payload = {}, runAt = new Date() }) => {
    const id = makeId('job');
    const nowIso = new Date().toISOString();

    await db().from('jobs').insert({
        id,
        type,
        payload_json: JSON.stringify(payload),
        status: 'pending',
        attempts: 0,
        run_at: runAt.toISOString(),
        created_at: nowIso,
        updated_at: nowIso,
    });

    logger.info({ id, type }, 'Job enqueued');
    return id;
};

/**
 * Process pending jobs
 */
const processJobs = async () => {
    try {
        const now = new Date().toISOString();

        // Find one pending job
        // Using forUpdate() to lock the row. verification showed skipLocked() availability is uncertain.

        const job = await db().transaction(async (trx) => {
            const candidate = await trx('jobs')
                .select('*')
                .where('status', 'pending')
                .andWhere('run_at', '<=', now)
                .orderBy('run_at', 'asc')
                .first()
                .forUpdate(); // Lock the row

            if (!candidate) return null;

            await trx('jobs')
                .where({ id: candidate.id })
                .update({
                    status: 'processing',
                    updated_at: now,
                    attempts: candidate.attempts + 1
                });

            return { ...candidate, status: 'processing', attempts: candidate.attempts + 1 };
        });

        if (!job) return; // No jobs to process

        const handler = handlers.get(job.type);
        if (!handler) {
            logger.error({ id: job.id, type: job.type }, 'No handler registered for job type');
            await db().from('jobs').where({ id: job.id }).update({
                status: 'failed',
                last_error: 'No handler registered',
                updated_at: new Date().toISOString()
            });
            return;
        }

        logger.info({ id: job.id, type: job.type }, 'Processing job');
        const start = Date.now();

        try {
            const payload = JSON.parse(job.payload_json || '{}');
            await handler(payload, { jobId: job.id });

            await db().from('jobs').where({ id: job.id }).update({
                status: 'completed',
                completed_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
                last_error: null // Clear error if successful retry
            });

            logger.info({ id: job.id, durationMs: Date.now() - start }, 'Job completed');
        } catch (e) {
            logger.error({ id: job.id, error: e.message }, 'Job failed');

            // Simple retry logic: if attempts < 3, reschedule
            // Otherwise fail
            const maxRetries = 3;
            const newStatus = job.attempts < maxRetries ? 'pending' : 'failed';
            // Exponential backoff if retrying
            const nextRun = job.attempts < maxRetries
                ? new Date(Date.now() + Math.pow(2, job.attempts) * 60000).toISOString()
                : job.run_at;

            await db().from('jobs').where({ id: job.id }).update({
                status: newStatus,
                last_error: String(e.message).slice(0, 1000),
                run_at: nextRun,
                updated_at: new Date().toISOString()
            });
        }
    } catch (e) {
        logger.error(e, 'Error in job processor');
    }
};

/**
 * Start the job worker loop
 * @param {number} intervalMs 
 */
const startJobWorker = (intervalMs = 10000) => {
    logger.info('Starting job worker...');
    setInterval(processJobs, intervalMs);
};

module.exports = {
    enqueueJob,
    registerHandler,
    startJobWorker,
    processJobs // Exported for testing
};
