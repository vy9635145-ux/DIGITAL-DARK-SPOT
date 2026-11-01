'use strict';
const projects = require('../models/projects');
const snapshot = require('../services/snapshot');
const reportGenerator = require('../services/report');
const logger = require('../utils/logger');
const { HttpError, notFound } = require('../utils/errors');
const asyncHandler = require('../utils/asyncHandler');

// GET /api/research/:id/report -> PDF built from the analysis that is saved in PostgreSQL right now.
const download = asyncHandler(async (req, res) => {
  const p = await projects.getOwned(req.user.id, req.params.id);
  if (!p) throw notFound('Research project not found');
  if (p.status !== 'completed') throw new HttpError(409, 'Run a completed analysis before generating a report.');
  const data = await snapshot.build(p);
  let pdf;
  try { pdf = await reportGenerator.buildPdf(data); }
  catch (e) { logger.error('PDF generation failed: %s', e.stack || e.message); throw new HttpError(500, 'PDF generation failed. See the server log.'); }
  await projects.logHistory(req.user.id, p.id, p.topic, 'report_generated', { bytes: pdf.length });
  const slug = String(p.topic || 'report').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50) || 'report';
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="digital-dark-spot-${slug}-${p.id}.pdf"`);
  res.setHeader('Cache-Control', 'no-store');
  return res.send(pdf);
});

module.exports = { download };
