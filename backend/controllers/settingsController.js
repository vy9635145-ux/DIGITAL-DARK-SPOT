'use strict';
const settingsModel = require('../models/settings');
const statusSvc = require('../services/status');
const extraction = require('../services/extraction');
const { ok } = require('../utils/response');
const { badRequest } = require('../utils/errors');
const asyncHandler = require('../utils/asyncHandler');
const { CATEGORIES, SETTING_DEFAULTS, MAX_URLS, MAX_TEXT_CHARS } = require('../utils/constants');

async function payload(userId) {
  return {
    settings: await settingsModel.getAll(userId),
    categories: CATEGORIES,
    info: { ...(await statusSvc.get()), limits: { max_urls: MAX_URLS, max_pasted_chars: MAX_TEXT_CHARS, request_timeout_seconds: extraction.TIMEOUT.reduce((a, b) => a + b, 0) } }
  };
}

const get = asyncHandler(async (req, res) => ok(res, await payload(req.user.id)));

const update = asyncHandler(async (req, res) => {
  const clean = {};
  for (const [k, v] of Object.entries(req.body)) {
    if (!Object.hasOwn(SETTING_DEFAULTS, k)) throw badRequest(`Unknown setting: ${k}`);
    clean[k] = v;
  }
  await settingsModel.setMany(req.user.id, clean);
  return ok(res, await payload(req.user.id));
});

module.exports = { get, update };
