'use strict';
const db = require('../config/db');
const { config } = require('../config');
const logger = require('../utils/logger');

const VERSION = require('../../package.json').version;
const REQUIRED_TABLES = ['users', 'user_settings', 'research_projects', 'research_sources', 'extracted_claims', 'evidence_references',
  'information_gaps', 'source_conflicts', 'outdated_signals', 'research_questions', 'verification_checklists', 'research_history'];

async function database() {
  try {
    await db.testConnection();
    const r = await db.query("SELECT table_name FROM information_schema.tables WHERE table_schema='public'");
    const have = new Set(r.rows.map((x) => x.table_name));
    const missing = REQUIRED_TABLES.filter((t) => !have.has(t));
    return missing.length
      ? { connected: true, schema_ready: false, message: `Connected to PostgreSQL, but tables are missing: ${missing.join(', ')}. Run npm run migrate.` }
      : { connected: true, schema_ready: true, message: 'Connected to PostgreSQL' };
  } catch (e) {
    logger.warn('Database status check failed: %s', e.message);
    return { connected: false, schema_ready: false, message: 'Could not connect to PostgreSQL. Check that it is running and that DATABASE_URL is correct.' };
  }
}

const ai = () => ({
  configured: !!config.geminiApiKey,
  model: config.geminiModel,
  message: config.geminiApiKey ? 'Gemini API key is configured' : 'GEMINI_API_KEY is not set. Add it to the .env file and restart the server; analysis cannot run without it.'
});

async function get() { return { version: VERSION, database: await database(), ai: ai() }; }

module.exports = { get, database, ai, REQUIRED_TABLES };
