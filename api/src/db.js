const knexLib = require('knex');

const makeKnex = () => {
  const env = process.env.NODE_ENV === 'production' ? 'production' : 'development';
  // eslint-disable-next-line global-require
  const knexfile = require('../knexfile');
  return knexLib(knexfile[env]);
};

let knex;

const db = () => {
  if (!knex) knex = makeKnex();
  return knex;
};

module.exports = { db };
