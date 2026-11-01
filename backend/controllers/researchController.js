'use strict';
const db = require('../config/db');
const projects = require('../models/projects');
const settingsModel = require('../models/settings');
const extraction = require('../services/extraction');
const coverageSvc = require('../services/coverage');
const { ok } = require('../utils/response');
const { badRequest, notFound } = require('../utils/errors');
const asyncHandler = require('../utils/asyncHandler');
const { MAX_URLS, MIN_TEXT_CHARS } = require('../utils/constants');
const { UPDATABLE } = require('../validators/research');

async function statsFor(ids) {
  const out = {};
  if (!ids.length) return out;
  const count = async (table) => new Map((await db.query(`SELECT project_id, count(*)::int AS n FROM ${table} WHERE project_id = ANY($1::int[]) GROUP BY project_id`, [ids])).rows.map((r) => [r.project_id, r.n]));
  const [src, gap, conf, qs] = await Promise.all([
    count('research_sources'), count('information_gaps'), count('source_conflicts'),
    db.query('SELECT project_id, answer_status FROM research_questions WHERE project_id = ANY($1::int[])', [ids])
  ]);
  const byProject = new Map();
  for (const r of qs.rows) { if (!byProject.has(r.project_id)) byProject.set(r.project_id, []); byProject.get(r.project_id).push(r.answer_status); }
  for (const id of ids) {
    const c = coverageSvc.calculate(byProject.get(id) || []);
    out[id] = { sources: src.get(id) || 0, gaps: gap.get(id) || 0, conflicts: conf.get(id) || 0, coverage: c.score, questions: c.total };
  }
  return out;
}

const create = asyncHandler(async (req, res) => {
  const b = req.body;
  const settings = await settingsModel.getAll(req.user.id);
  const category = b.category || settings.default_category;
  const text = String(b.text || '').trim();

  // Remove duplicate URLs (same address after normalisation) and tell the user which ones were dropped.
  const urls = []; const seen = new Set(); const duplicates = [];
  for (const raw of b.urls || []) {
    const u = String(raw || '').trim();
    if (!u) continue;
    const key = extraction.normalizeUrl(u);
    if (seen.has(key)) { duplicates.push(u); continue; }
    seen.add(key); urls.push(u);
  }
  if (urls.length > MAX_URLS) throw badRequest(`A maximum of ${MAX_URLS} URLs is allowed`);
  for (const u of urls) {
    try { await extraction.checkUrl(u, false); } catch (e) { throw badRequest(`${u}: ${e.message}`); }
  }
  if (text && text.length < MIN_TEXT_CHARS) throw badRequest(`Pasted text must be at least ${MIN_TEXT_CHARS} characters`);
  if (!urls.length && !text) throw badRequest(`Add at least one URL or paste ${MIN_TEXT_CHARS}+ characters of text`);

  const created = await db.transaction(async (c) => {
    const p = (await c.query(
      'INSERT INTO research_projects(user_id,topic,research_question,category,description) VALUES($1,$2,$3,$4,$5) RETURNING *',
      [req.user.id, b.topic.trim(), b.research_question.trim(), category, String(b.description || '').trim() || null])).rows[0];
    for (const u of urls) await c.query('INSERT INTO research_sources(project_id,url) VALUES($1,$2)', [p.id, u]);
    if (text) {
      await c.query(
        `INSERT INTO research_sources(project_id,url,domain,title,extracted_content,extraction_status,source_category,category_reason,extracted_at)
         VALUES($1,'pasted-text','pasted','Pasted text',$2,'Successfully Extracted','Other','Text supplied by the user',now())`, [p.id, text]);
    }
    await projects.logHistory(req.user.id, p.id, p.topic, 'created', { urls: urls.length, pasted_text: !!text }, c);
    return p;
  });
  return ok(res, { ...created, duplicates_removed: duplicates }, 201);
});

const list = asyncHandler(async (req, res) => {
  const term = String(req.query.q || '').trim();
  const params = [req.user.id]; const where = ['user_id=$1'];
  if (term) {
    params.push(`%${term.replace(/[\\%_]/g, '\\$&')}%`);
    where.push(`(topic ILIKE $${params.length} ESCAPE '\\' OR research_question ILIKE $${params.length} ESCAPE '\\')`);
  }
  if (req.query.category) { params.push(req.query.category); where.push(`category=$${params.length}`); }
  if (req.query.status) { params.push(req.query.status); where.push(`status=$${params.length}`); }
  const dir = req.query.sort === 'oldest' ? 'ASC' : 'DESC';
  const rows = (await db.query(`SELECT * FROM research_projects WHERE ${where.join(' AND ')} ORDER BY created_at ${dir}, id ${dir}`, params)).rows;
  const stats = await statsFor(rows.map((r) => r.id));
  return ok(res, rows.map((r) => ({ ...r, ...stats[r.id] })));
});

const getOne = asyncHandler(async (req, res) => {
  const p = await projects.getOwned(req.user.id, req.params.id);
  if (!p) throw notFound('Research project not found');
  return ok(res, { ...p, ...(await statsFor([p.id]))[p.id] });
});

const update = asyncHandler(async (req, res) => {
  const p = await projects.getOwned(req.user.id, req.params.id);
  if (!p) throw notFound('Research project not found');
  const b = req.body; const sets = []; const params = []; const changed = [];
  for (const k of UPDATABLE) {
    if (b[k] === undefined) continue;
    const v = k === 'description' ? (String(b[k] || '').trim() || null) : (k === 'category' ? b[k] : String(b[k]).trim());
    params.push(v); sets.push(`${k}=$${params.length}`); changed.push(k);
  }
  params.push(p.id, req.user.id);
  const row = await db.transaction(async (c) => {
    const r = (await c.query(`UPDATE research_projects SET ${sets.join(', ')}, updated_at=now() WHERE id=$${params.length - 1} AND user_id=$${params.length} RETURNING *`, params)).rows[0];
    await projects.logHistory(req.user.id, r.id, r.topic, 'updated', { fields: changed }, c);
    return r;
  });
  return ok(res, { ...row, ...(await statsFor([row.id]))[row.id] });
});

const remove = asyncHandler(async (req, res) => {
  const p = await projects.getOwned(req.user.id, req.params.id);
  if (!p) throw notFound('Research project not found');
  await db.transaction(async (c) => {
    await projects.logHistory(req.user.id, p.id, p.topic, 'deleted', null, c);
    await c.query('DELETE FROM research_projects WHERE id=$1 AND user_id=$2', [p.id, req.user.id]);
  });
  return ok(res, { deleted: p.id });
});

const history = asyncHandler(async (req, res) => {
  const rows = (await db.query('SELECT id, project_id, topic, action, details, created_at FROM research_history WHERE user_id=$1 ORDER BY created_at DESC, id DESC LIMIT 200', [req.user.id])).rows;
  return ok(res, rows);
});

module.exports = { create, list, getOne, update, remove, history, statsFor };
