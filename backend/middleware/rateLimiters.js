'use strict';
const rateLimit = require('express-rate-limit');
const { config } = require('../config');
const { fail } = require('../utils/response');

const skip = () => config.isTest && process.env.ENABLE_RATE_LIMIT_IN_TESTS !== 'true';

const make = (windowMs, limit, message, keyGenerator) =>
  rateLimit({
    windowMs,
    limit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    skip,
    ...(keyGenerator ? { keyGenerator } : {}),
    handler: (req, res) => fail(res, message, 429)
  });

// All API traffic, per IP
const apiLimiter = make(15 * 60 * 1000, 600, 'Too many requests. Please slow down and try again later.');
// Expensive work (page fetching + Gemini + PDF), per browser (client id)
const heavyLimiter = make(60 * 1000, 6, 'Too many analysis or report requests. Wait a minute and try again.', (req) => `client:${req.user ? req.user.id : "anon"}`);

module.exports = { apiLimiter, heavyLimiter };
