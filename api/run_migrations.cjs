
const { db } = require('./src/db');
const path = require('path');

(async () => {
    try {
        const knex = db();
        console.log('Running migrations...');
        await knex.migrate.latest({
            directory: path.join(__dirname, 'migrations')
        });
        console.log('Migrations complete.');
        process.exit(0);
    } catch (e) {
        console.error('Migration failed:', e);
        process.exit(1);
    }
})();
