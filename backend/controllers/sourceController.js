'use strict';
const db = require('../config/db');
const projects = require('../models/projects');
const extraction = require('../services/extraction');
const { ok } = require('../utils/response');
const { badRequest, notFound, conflict } = require('../utils/errors');
const asyncHandler = require('../utils/asyncHandler');
const { MAX_URLS } = require('../utils/constants');

const summary = (s) => ({ ...s, content_chars: (s.extracted_content || '').length, extracted_content: null });

async function ownedProject(req) {
  const p = await projects.getOwned(req.user.id, req.params.id);
  if (!p) throw notFound('Research project not found');
  return p;
}

const list = asyncHandler(async (req, res) => {
  const p = await ownedProject(req);
  const rows = (await db.query('SELECT * FROM research_sources WHERE project_id=$1 ORDER BY id', [p.id])).rows;
  return ok(res, rows.map(summary));
});

const add = asyncHandler(async (req, res) => {
  const p = await ownedProject(req);
  const url = req.body.url.trim();
  const existing = (await db.query('SELECT url FROM research_sources WHERE project_id=$1', [p.id])).rows;
  if (existing.filter((x) => x.url !== 'pasted-text').length >= MAX_URLS) throw badRequest(`A maximum of ${MAX_URLS} URLs is allowed`);
  if (existing.some((x) => extraction.normalizeUrl(x.url) === extraction.normalizeUrl(url))) throw conflict('This URL is already in the research project');
  try { await extraction.checkUrl(url, false); } catch (e) { throw badRequest(e.message); }
  const row = (await db.query('INSERT INTO research_sources(project_id,url) VALUES($1,$2) RETURNING *', [p.id, url])).rows[0];
  await projects.logHistory(req.user.id, p.id, p.topic, 'source_added', { url });
  return ok(res, summary(row), 201);
});

const getOne = asyncHandler(async (req, res) => {
  const s = await projects.getOwnedSource(req.user.id, req.params.id);
  if (!s) throw notFound('Source not found');
  return ok(res, s);
});

const review = asyncHandler(async (req, res) => {
  const s = await projects.getOwnedSource(req.user.id, req.params.id);
  if (!s) throw notFound('Source not found');
  const row = (await db.query('UPDATE research_sources SET reviewed=$1 WHERE id=$2 RETURNING *', [req.body.reviewed, s.id])).rows[0];
  return ok(res, summary(row));
});

const remove = asyncHandler(async (req, res) => {
  const s = await projects.getOwnedSource(req.user.id, req.params.id);
  if (!s) throw notFound('Source not found');
  await db.query('DELETE FROM research_sources WHERE id=$1', [s.id]);
  return ok(res, { deleted: s.id });
});

module.exports = { list, add, getOne, review, remove };
