'use strict';
const { validationResult } = require('express-validator');
const { HttpError } = require('../utils/errors');

/** Runs after express-validator chains. Responds 400 with a readable message and per-field details. */
module.exports = (req, res, next) => {
  const result = validationResult(req);
  if (result.isEmpty()) return next();
  const details = result.array({ onlyFirstError: true }).map((e) => ({ field: e.path, message: e.msg }));
  const message = details.map((d) => d.message).join(' ');
  return next(new HttpError(400, message || 'Invalid input', details));
};
