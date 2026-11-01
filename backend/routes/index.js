'use strict';
const router = require('express').Router();
const { identify } = require('../middleware/client');
const validate = require('../middleware/validate');
const { idParam } = require('../validators/common');
const sv = require('../validators/research');
const settingsV = require('../validators/settings');
const sources = require('../controllers/sourceController');
const analysis = require('../controllers/analysisController');
const dashboard = require('../controllers/dashboardController');
const settings = require('../controllers/settingsController');
const research = require('../controllers/researchController');
const statusSvc = require('../services/status');
const { ok } = require('../utils/response');
const asyncHandler = require('../utils/asyncHandler');

// ---- public ----
router.get('/health', asyncHandler(async (req, res) => {
  const db = await statusSvc.database();
  return res.status(db.connected ? 200 : 503).json({ success: db.connected, data: { status: db.connected ? 'ok' : 'database_unavailable' } });
}));
router.get('/status', asyncHandler(async (req, res) => ok(res, await statusSvc.get())));

// ---- no login: these routes are scoped to the browser's X-Client-Id ----
router.use(['/research', '/history', '/dashboard', '/settings', '/sources', '/claims'], identify);
router.use('/research', require('./research'));

router.get('/history', research.history);
router.get('/dashboard/stats', dashboard.stats);
router.get('/settings', settings.get);
router.patch('/settings', settingsV.update, validate, settings.update);

router.get('/sources/:id', idParam(), validate, sources.getOne);
router.patch('/sources/:id', sv.reviewSource, validate, sources.review);
router.delete('/sources/:id', idParam(), validate, sources.remove);
router.get('/claims/:id', idParam(), validate, analysis.claimDetail);

module.exports = router;
