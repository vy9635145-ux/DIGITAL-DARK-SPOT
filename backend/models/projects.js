'use strict';
// Every lookup takes the user id and joins through research_projects.user_id,
// so one user can never read or change another user's records.
const db = require('../config/db');

const isId = (v) => /^\d+$/.test(String(v)) && Number(v) > 0 && Number(v) < 2147483647;

async function getOwned(userId, id) {
  if (!isId(id)) return null;
  return (await db.query('SELECT * FROM research_projects WHERE id=$1 AND user_id=$2', [Number(id), userId])).rows[0] || null;
}

async function getOwnedSource(userId, id) {
  if (!isId(id)) return null;
  return (await db.query('SELECT s.* FROM research_sources s JOIN research_projects p ON p.id=s.project_id WHERE s.id=$1 AND p.user_id=$2', [Number(id), userId])).rows[0] || null;
}

async function getOwnedTask(userId, projectId, taskId) {
  if (!isId(taskId) || !isId(projectId)) return null;
  return (await db.query(
    'SELECT t.* FROM verification_checklists t JOIN research_projects p ON p.id=t.project_id WHERE t.id=$1 AND t.project_id=$2 AND p.user_id=$3',
    [Number(taskId), Number(projectId), userId])).rows[0] || null;
}

async function logHistory(userId, projectId, topic, action, details = null, client = db) {
  await client.query('INSERT INTO research_history(user_id,project_id,topic,action,details) VALUES($1,$2,$3,$4,$5)',
    [userId, projectId, topic ? String(topic).slice(0, 200) : null, action, details ? JSON.stringify(details) : null]);
}

module.exports = { isId, getOwned, getOwnedSource, getOwnedTask, logHistory };
