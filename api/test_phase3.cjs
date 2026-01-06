
const { db } = require('./src/db');
const { enqueueJob, registerHandler, processJobs } = require('./src/services/jobService');

process.on('unhandledRejection', (reason, p) => {
    console.error('Unhandled Rejection at:', p, 'reason:', reason);
    process.exit(1);
});

(async () => {
    try {
        console.log('START_TEST');

        // 1. Health
        try {
            await db().raw('SELECT 1');
            console.log('DB_OK');
        } catch (e) {
            console.error('DB_FAIL', e.message);
        }

        // 2. Jobs
        let handlerCalled = false;
        registerHandler('test_job', async (payload) => {
            console.log('HANDLER_CALLED', payload);
            handlerCalled = true;
        });

        const jobId = await enqueueJob({
            type: 'test_job',
            payload: { foo: 'bar' }
        });
        console.log('JOB_ENQUEUED', jobId);

        await processJobs();
        console.log('PROCESS_JOBS_DONE');

        const job = await db().from('jobs').where({ id: jobId }).first();
        console.log('JOB_STATUS', job.status);

        if (job.status === 'completed' && handlerCalled) {
            console.log('TEST_PASS');
        } else {
            console.log('TEST_FAIL');
        }

        process.exit(0);
    } catch (e) {
        console.error('FATAL_ERROR', e);
        process.exit(1);
    }
})();
