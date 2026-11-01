'use strict';
const db = require('../config/db');
const projects = require('../models/projects');
const { ok } = require('../utils/response');
const { notFound } = require('../utils/errors');
const asyncHandler = require('../utils/asyncHandler');

async function ownedProject(req) {
  const p = await projects.getOwned(req.user.id, req.params.id);
  if (!p) throw notFound('Research project not found');
  return p;
}

const list = asyncHandler(async (req, res) => {
  const p = await ownedProject(req);
  let sql = 'SELECT * FROM verification_checklists WHERE project_id=$1'; const params = [p.id];
  if (['High', 'Medium', 'Low'].includes(req.query.priority)) { params.push(req.query.priority); sql += ` AND priority=$${params.length}`; }
  if (['Pending', 'Completed'].includes(req.query.status)) { params.push(req.query.status); sql += ` AND status=$${params.length}`; }
  const tasks = (await db.query(`${sql} ORDER BY id`, params)).rows;
  const all = (await db.query('SELECT status, count(*)::int AS n FROM verification_checklists WHERE project_id=$1 GROUP BY status', [p.id])).rows;
  const done = all.find((r) => r.status === 'Completed')?.n || 0;
  const total = all.reduce((a, r) => a + r.n, 0);
  res.json({ success: true, data: tasks, progress: { completed: done, total, percent: total ? Math.round((100 * done) / total) : 0 } });
});

const create = asyncHandler(async (req, res) => {
  const p = await ownedProject(req);
  const b = req.body;
  const row = (await db.query(
    "INSERT INTO verification_checklists(project_id,origin,related_finding,task,description,priority,status) VALUES($1,'manual',$2,$3,$4,$5,$6) RETURNING *",
    [p.id, String(b.related_finding || 'Added manually').slice(0, 300), b.task.trim(), b.description ? String(b.description).trim() : null, b.priority || 'Medium', b.status || 'Pending'])).rows[0];
  return ok(res, row, 201);
});

const update = asyncHandler(async (req, res) => {
  const t = await projects.getOwnedTask(req.user.id, req.params.id, req.params.taskId);
  if (!t) throw notFound('Task not found');
  const b = req.body; const sets = []; const params = [];
  const add = (col, val) => { params.push(val); sets.push(`${col}=$${params.length}`); };
  if (b.task !== undefined) add('task', String(b.task).trim());
  if (b.description !== undefined) add('description', b.description ? String(b.description).trim() : null);
  if (b.priority !== undefined) add('priority', b.priority);
  if (b.status !== undefined) add('status', b.status);
  if (!sets.length) return ok(res, t);
  params.push(t.id);
  const row = (await db.query(`UPDATE verification_checklists SET ${sets.join(', ')}, updated_at=now() WHERE id=$${params.length} RETURNING *`, params)).rows[0];
  return ok(res, row);
});

const remove = asyncHandler(async (req, res) => {
  const t = await projects.getOwnedTask(req.user.id, req.params.id, req.params.taskId);
  if (!t) throw notFound('Task not found');
  await db.query('DELETE FROM verification_checklists WHERE id=$1', [t.id]);
  return ok(res, { deleted: t.id });
});

module.exports = { list, create, update, remove };
