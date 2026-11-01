'use strict';
const { param } = require('express-validator');

const idParam = (name = 'id') => param(name).isInt({ min: 1, max: 2147483646 }).withMessage(`${name} must be a positive whole number`).toInt();

module.exports = { idParam };
