'use strict';
// Consistent envelope: success -> { success: true, data }, failure -> { success: false, error, details? }
const ok = (res, data, status = 200) => res.status(status).json({ success: true, data });
const fail = (res, message, status = 400, details) =>
  res.status(status).json({ success: false, error: message, ...(details ? { details } : {}) });
module.exports = { ok, fail };
