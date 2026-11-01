'use strict';
const { body } = require('express-validator');
const { idParam } = require('./common');

const fields = (required) => [
  required
    ? body('task').isString().withMessage('Task is required').bail().trim().notEmpty().withMessage('Task is required').isLength({ max: 1000 }).withMessage('Task must be 1000 characters or fewer')
    : body('task').optional().isString().bail().trim().notEmpty().withMessage('Task cannot be empty').isLength({ max: 1000 }).withMessage('Task must be 1000 characters or fewer'),
  body('description').optional({ values: 'null' }).isString().isLength({ max: 2000 }).withMessage('Description must be 2000 characters or fewer'),
  body('priority').optional().isIn(['High', 'Medium', 'Low']).withMessage('Invalid priority'),
  body('status').optional().isIn(['Pending', 'Completed']).withMessage('Invalid status')
];

const create = [idParam(), ...fields(true), body('related_finding').optional({ values: 'null' }).isString().isLength({ max: 300 })];
const update = [idParam(), idParam('taskId'), ...fields(false)];
const remove = [idParam(), idParam('taskId')];

module.exports = { create, update, remove };
