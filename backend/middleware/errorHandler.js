'use strict';
const logger = require('../utils/logger');
const { fail } = require('../utils/response');

const DB_DOWN = ['ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND', '08000', '08001', '08003', '08006', '57P01', 'DB_CONFIG'];

function notFound(req, res) {
  return fail(res, req.originalUrl.startsWith('/api') ? 'API route not found' : 'Not found', 404);
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  if (res.headersSent) return next(err);
  if (err.type === 'entity.parse.failed' || (err instanceof SyntaxError && err.status === 400)) return fail(res, 'Request body must be valid JSON', 400);
  if (err.type === 'entity.too.large') return fail(res, 'Request body is too large', 413);
  if (err.expose && err.status) {
    if (err.status >= 500) logger.error(err);
    return fail(res, err.message, err.status, err.details);
  }
  logger.error('%s %s failed: %s', req.method, req.originalUrl, err.stack || err.message);
  if (DB_DOWN.includes(err.code)) return fail(res, 'The database is unavailable. Check that PostgreSQL is running and DATABASE_URL is correct.', 503);
  if (err.code === '42P01') return fail(res, 'Database tables are missing. Run `npm run migrate`.', 503);
  if (err.code === '23505') return fail(res, 'That value already exists.', 409);
  return fail(res, 'Unexpected server error.', 500);
}

module.exports = { notFound, errorHandler };
