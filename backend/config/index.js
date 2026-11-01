'use strict';
// Load the project-root .env no matter which folder the process was started from.
require('dotenv').config({ path: require('node:path').join(__dirname, '..', '..', '.env') });

const int = (value, fallback) => {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
};

const env = process.env.NODE_ENV || 'development';

const config = {
  env,
  isProd: env === 'production',
  isTest: env === 'test',
  port: int(process.env.PORT, 3000),
  frontendUrl: (process.env.FRONTEND_URL || '').trim(),
  trustProxy: process.env.TRUST_PROXY || '',
  databaseUrl: (process.env.DATABASE_URL || '').trim(),
  dbSsl: process.env.DATABASE_SSL === 'true',
  geminiApiKey: process.env.GEMINI_API_KEY || '',
  geminiModel: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
  geminiTimeout: int(process.env.GEMINI_TIMEOUT, 90),
  geminiRetries: int(process.env.GEMINI_RETRIES, 2),
  geminiMaxOutputTokens: int(process.env.GEMINI_MAX_OUTPUT_TOKENS, 8192),
  maxCharsPerSource: int(process.env.MAX_CHARS_PER_SOURCE, 12000),
  logLevel: process.env.LOG_LEVEL || (env === 'production' ? 'info' : 'debug')
};

/** Throws a readable error when the environment is unsafe or incomplete. */
function assertConfig() {
  const problems = [];
  if (!config.databaseUrl) problems.push('DATABASE_URL is not set (example: postgresql://user:pass@localhost:5432/digital_dark_spot).');
  else if (!/^postgres(ql)?:\/\//.test(config.databaseUrl)) problems.push('DATABASE_URL must be a PostgreSQL URL.');
  if (problems.length) {
    const err = new Error('Invalid configuration:\n - ' + problems.join('\n - '));
    err.code = 'CONFIG_INVALID';
    throw err;
  }
}

module.exports = { config, assertConfig };
