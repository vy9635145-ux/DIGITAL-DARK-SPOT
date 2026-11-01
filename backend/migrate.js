'use strict';
// Minimal, transactional SQL migration runner: applies backend/migrations/*.sql in filename order.
const fs = require('node:fs/promises');
const path = require('node:path');
const db = require('./config/db');
const logger = require('./utils/logger');

const DIR = path.join(__dirname, 'migrations');

async function migrate() {
  const files = (await fs.readdir(DIR)).filter((f) => /^\d+_.+\.sql$/.test(f)).sort();
  await db.query('CREATE TABLE IF NOT EXISTS schema_migrations (name VARCHAR(200) PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())');
  const applied = [];
  for (const file of files) {
    const sql = await fs.readFile(path.join(DIR, file), 'utf8');
    try {
      await db.transaction(async (c) => {
        // The lock stops two processes (e.g. two deploy instances) from running the same migration at once.
        await c.query('SELECT pg_advisory_xact_lock(7305001)');
        if ((await c.query('SELECT 1 FROM schema_migrations WHERE name=$1', [file])).rowCount) return;
        await c.query(sql);
        await c.query('INSERT INTO schema_migrations(name) VALUES($1)', [file]);
        applied.push(file);
      });
    } catch (e) {
      // The whole file rolled back, so no half-applied migration and no data is lost.
      throw new Error(`Migration ${file} failed and was rolled back: ${e.message}`);
    }
    if (applied.includes(file)) logger.info('Applied migration %s', file);
  }
  return { applied, total: files.length };
}

module.exports = { migrate };

if (require.main === module) {
  require('./config');
  (async () => {
    try {
      const r = await migrate();
      logger.info(r.applied.length ? `Migrations applied: ${r.applied.join(', ')}` : 'Database is already up to date.');
    } catch (e) {
      logger.error('Migration failed: %s', e.message);
      process.exitCode = 1;
    } finally {
      await db.close();
    }
  })();
}
