'use strict';
const { config, assertConfig } = require('./config');
const logger = require('./utils/logger');
const db = require('./config/db');

async function start() {
  try { assertConfig(); } catch (e) { logger.error(e.message); process.exit(1); }

  // Fail loudly if PostgreSQL is unreachable: the app never falls back to dummy data.
  try {
    const info = await db.testConnection();
    logger.info('Connected to PostgreSQL database "%s"', info.db);
  } catch (e) {
    logger.error('Cannot connect to PostgreSQL (%s). Check DATABASE_URL and that the server is running.', e.message);
    process.exit(1);
  }
  const { database } = require('./services/status');
  const state = await database();
  if (!state.schema_ready) logger.warn(state.message);
  if (!config.geminiApiKey) logger.warn('GEMINI_API_KEY is not set: research can be saved, but AI analysis will return a configuration error.');

  const { makeApp } = require('./app');
  const server = makeApp().listen(config.port, () => logger.info('Digital Dark Spot listening on http://localhost:%d (%s)', config.port, config.env));

  const shutdown = (signal) => {
    logger.info('%s received, shutting down', signal);
    server.close(async () => { await db.close(); process.exit(0); });
    setTimeout(() => process.exit(1), 10000).unref();
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('unhandledRejection', (r) => logger.error('Unhandled rejection: %s', r && r.stack ? r.stack : r));
}

start();
