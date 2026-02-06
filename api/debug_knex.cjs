
const knexLib = require('knex');
const path = require('path');
const dotenv = require('dotenv');

// Load env
dotenv.config();

const config = {
    client: 'mysql2',
    connection: {
        host: process.env.DB_HOST,
        port: process.env.DB_PORT ? Number(process.env.DB_PORT) : 3306,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME,
        charset: 'utf8mb4',
    }
};

console.log('--- Knex Debug ---');
console.log('Node Version:', process.version);
console.log('DB_HOST:', process.env.DB_HOST);
console.log('DB_USER:', process.env.DB_USER);
console.log('DB_NAME:', process.env.DB_NAME);

const knex = knexLib(config);

async function debug() {
    try {
        console.log('Testing connection...');
        const result = await knex.raw('SELECT 1 as connected');
        console.log('Connection success:', result[0]);

        console.log('Checking migration status...');
        const status = await knex.migrate.status();
        console.log('Migration status:', status);

        process.exit(0);
    } catch (err) {
        console.error('Debug failed:', err);
        process.exit(1);
    }
}

debug();
