const path = require('path');

const dotenv = require('dotenv');

// Prefer repo-root .env.local (dev) then fallback to default dotenv behavior.
dotenv.config({ path: path.join(__dirname, '../.env.local') });
dotenv.config();

const cfg = {
  client: 'mysql2',
  connection: {
    host: process.env.DB_HOST,
    port: process.env.DB_PORT ? Number(process.env.DB_PORT) : 3306,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    charset: 'utf8mb4',
  },
  pool: { min: 0, max: 10 },
  migrations: {
    directory: './migrations',
    tableName: 'knex_migrations',
  },
};

module.exports = {
  development: cfg,
  production: cfg,
};
