'use strict';
const winston = require('winston');
const path = require('node:path');
const fs = require('node:fs');

const level = process.env.LOG_LEVEL || (process.env.NODE_ENV === 'production' ? 'info' : 'debug');
const silent = process.env.NODE_ENV === 'test';

const transports = [
  new winston.transports.Console({
    silent,
    format: winston.format.combine(
      winston.format.colorize(),
      winston.format.timestamp(),
      winston.format.splat(),
      winston.format.printf(({ timestamp, level: l, message, stack }) => `${timestamp} ${l}: ${stack || message}`)
    )
  })
];

if (process.env.NODE_ENV === 'production' || process.env.LOG_TO_FILE === 'true') {
  const dir = path.resolve(__dirname, '..', '..', 'logs');
  try {
    fs.mkdirSync(dir, { recursive: true });
    transports.push(new winston.transports.File({ filename: path.join(dir, 'error.log'), level: 'error', maxsize: 5_000_000, maxFiles: 3 }));
    transports.push(new winston.transports.File({ filename: path.join(dir, 'combined.log'), maxsize: 5_000_000, maxFiles: 3 }));
  } catch (_) { /* file logging is optional */ }
}

module.exports = winston.createLogger({
  level,
  format: winston.format.combine(winston.format.errors({ stack: true }), winston.format.splat(), winston.format.json()),
  transports
});
