'use strict';
const { body } = require('express-validator');
const { CATEGORIES } = require('../utils/constants');

const update = [
  body().custom((v) => v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length > 0).withMessage('Send a JSON object of settings to change'),
  body('default_category').optional().isIn(CATEGORIES).withMessage('Invalid value for default_category'),
  body('ai_max_chars_per_source').optional().isInt({ min: 2000, max: 30000 }).withMessage('ai_max_chars_per_source must be a whole number between 2000 and 30000').toInt(),
  body('report_include_evidence').optional().isBoolean({ strict: true }).withMessage('report_include_evidence must be true or false'),
  body('report_include_checklist').optional().isBoolean({ strict: true }).withMessage('report_include_checklist must be true or false')
];
module.exports = { update };
