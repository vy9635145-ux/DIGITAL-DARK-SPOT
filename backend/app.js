'use strict';
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const path = require('node:path');
const { config } = require('./config');
const routes = require('./routes');
const { apiLimiter } = require('./middleware/rateLimiters');
const { notFound, errorHandler } = require('./middleware/errorHandler');
const logger = require('./utils/logger');

const FRONTEND_DIR = path.join(__dirname, '..', 'frontend');

function makeApp() {
  const app = express();
  app.disable('x-powered-by');
  if (config.trustProxy) app.set('trust proxy', /^\d+$/.test(config.trustProxy) ? Number(config.trustProxy) : config.trustProxy);

  app.use(helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        'default-src': ["'self'"],
        'script-src': ["'self'", 'https://cdn.jsdelivr.net'],
        'script-src-attr': ["'none'"],
        'style-src': ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com', 'https://cdnjs.cloudflare.com'],
        'font-src': ["'self'", 'https://fonts.gstatic.com', 'https://cdnjs.cloudflare.com'],
        'img-src': ["'self'", 'data:'],
        'connect-src': ["'self'"],
        'object-src': ["'none'"],
        'frame-ancestors': ["'none'"],
        'upgrade-insecure-requests': config.isProd ? [] : null
      }
    }
  }));

  if (config.frontendUrl) app.use('/api', cors({ origin: config.frontendUrl.split(',').map((s) => s.trim()).filter(Boolean), methods: ['GET', 'POST', 'PATCH', 'DELETE'] }));
  app.use(express.json({ limit: '1mb' }));

  app.use('/api', apiLimiter, (req, res, next) => { res.set('Cache-Control', 'no-store'); next(); }, routes);
  app.use('/api', notFound);

  app.use(express.static(FRONTEND_DIR, { index: 'index.html' }));
  app.use((req, res) => notFound(req, res));
  app.use(errorHandler);
  logger.debug('Express app created');
  return app;
}

module.exports = { makeApp };
