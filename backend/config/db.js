'use strict';
const { Pool } = require('pg');
const { config } = require('./index');
const logger = require('../utils/logger');

let pool = null;

function getPool() {
  if (!pool) {
    if (!config.databaseUrl) {
      throw Object.assign(new Error('DATABASE_URL is not set.'), { code: 'DB_CONFIG' });
    }
    pool = new Pool({
      connectionString: config.databaseUrl,
      ssl: config.dbSsl ? { rejectUnauthorized: false } : undefined,
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000
    });
    pool.on('error', (e) => logger.error('PostgreSQL idle client error: %s', e.message));
  }
  return pool;
}

/** Replace the pool (used by tests). */
function setPool(p) { pool = p; }

const query = (text, params = []) => getPool().query(text, params);

async function transaction(fn) {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch (_) { /* connection may already be gone */ }
    throw e;
  } finally {
    client.release();
  }
}

/** Real connection test. Never swallows errors into dummy data. */
async function testConnection() {
  const r = await query('SELECT current_database() AS db, version() AS version');
  return r.rows[0];
}

async function close() {
  if (pool) { const p = pool; pool = null; await p.end(); }
}

module.exports = { getPool, setPool, query, transaction, testConnection, close };
