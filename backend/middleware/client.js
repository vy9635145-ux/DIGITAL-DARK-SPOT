'use strict';
// No login: every browser sends a random UUID in the X-Client-Id header. It decides whose research/settings/history
// a request touches (req.user.id). Anyone without that id cannot see the data, but this is NOT authentication.
const users = require('../models/users');
const { HttpError } = require('../utils/errors');
const asyncHandler = require('../utils/asyncHandler');

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const identify = asyncHandler(async (req, res, next) => {
  const id = req.get('X-Client-Id');
  if (!id || !UUID_V4.test(id)) throw new HttpError(400, 'Missing or invalid X-Client-Id header. Reload the page and try again.');
  req.user = await users.findOrCreateByClientId(id.toLowerCase());
  next();
});

module.exports = { identify };
