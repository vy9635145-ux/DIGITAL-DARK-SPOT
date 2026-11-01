'use strict';
const { body, query } = require('express-validator');
const { CATEGORIES, STATUSES, MAX_URLS, MAX_TEXT_CHARS } = require('../utils/constants');
const { idParam } = require('./common');

const createResearch = [
  body('topic').isString().withMessage('Research topic is required').bail().trim().notEmpty().withMessage('Research topic is required').isLength({ max: 200 }).withMessage('Topic must be 200 characters or fewer'),
  body('research_question').isString().withMessage('Research question is required').bail().trim().notEmpty().withMessage('Research question is required').isLength({ max: 2000 }).withMessage('Research question must be 2000 characters or fewer'),
  body('category').optional({ values: 'falsy' }).isIn(CATEGORIES).withMessage('Invalid category'),
  body('description').optional({ values: 'null' }).isString().withMessage('Description must be text').isLength({ max: 5000 }).withMessage('Description must be 5000 characters or fewer'),
  body('urls').optional({ values: 'null' }).isArray({ max: MAX_URLS * 3 }).withMessage('urls must be a list'),
  body('urls.*').isString().withMessage('Every URL must be text').isLength({ max: 2048 }).withMessage('A URL is too long'),
  body('text').optional({ values: 'null' }).isString().withMessage('Pasted text must be text').isLength({ max: MAX_TEXT_CHARS }).withMessage(`Pasted text is limited to ${MAX_TEXT_CHARS} characters`)
];

const UPDATABLE = ['topic', 'research_question', 'category', 'description'];
const updateResearch = [
  idParam(),
  body('topic').optional().isString().withMessage('Topic must be text').bail().trim().notEmpty().withMessage('Research topic cannot be empty').isLength({ max: 200 }).withMessage('Topic must be 200 characters or fewer'),
  body('research_question').optional().isString().withMessage('Research question must be text').bail().trim().notEmpty().withMessage('Research question cannot be empty').isLength({ max: 2000 }).withMessage('Research question must be 2000 characters or fewer'),
  body('category').optional().isIn(CATEGORIES).withMessage('Invalid category'),
  body('description').optional({ values: 'null' }).isString().withMessage('Description must be text').isLength({ max: 5000 }).withMessage('Description must be 5000 characters or fewer'),
  body().custom((v) => v && UPDATABLE.some((k) => v[k] !== undefined)).withMessage(`Send at least one of: ${UPDATABLE.join(', ')}`)
];

const listResearch = [
  query('q').optional().isString().isLength({ max: 200 }).withMessage('Search text is too long'),
  query('category').optional({ values: 'falsy' }).isIn(CATEGORIES).withMessage('Invalid category'),
  query('status').optional({ values: 'falsy' }).isIn(STATUSES).withMessage(`status must be one of: ${STATUSES.join(', ')}`),
  query('sort').optional({ values: 'falsy' }).isIn(['newest', 'oldest']).withMessage('sort must be newest or oldest')
];

const addSource = [idParam(), body('url').isString().withMessage('url is required').bail().trim().notEmpty().withMessage('url is required').isLength({ max: 2048 }).withMessage('URL is too long')];
const reviewSource = [idParam(), body('reviewed').isBoolean({ strict: true }).withMessage('reviewed must be true or false')];

module.exports = { createResearch, updateResearch, UPDATABLE, listResearch, addSource, reviewSource };
