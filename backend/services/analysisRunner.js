'use strict';
const db = require('../config/db');
const { config } = require('../config');
const logger = require('../utils/logger');
const { HttpError } = require('../utils/errors');
const extraction = require('./extraction');
const ai = require('./ai-analysis');
const gapsSvc = require('./gap-detection');
const conflictsSvc = require('./conflict-detection');
const freshness = require('./freshness');
const checklistSvc = require('./checklist');
const projects = require('../models/projects');
const settingsModel = require('../models/settings');

const STALE_PROCESSING = "interval '10 minutes'";

async function setStatus(projectId, status, error = null) {
  await db.query('UPDATE research_projects SET status=$1, error=$2, updated_at=now() WHERE id=$3', [status, error, projectId]);
}

/** Atomically claim the project so two requests cannot analyze it at once. */
async function claim(projectId) {
  const r = await db.query(
    `UPDATE research_projects SET status='processing', error=NULL, updated_at=now()
     WHERE id=$1 AND (status <> 'processing' OR updated_at < now() - ${STALE_PROCESSING}) RETURNING id`, [projectId]);
  if (!r.rowCount) throw new HttpError(409, 'An analysis is already running for this research project.');
}

async function collectSources(projectId) {
  const sources = (await db.query('SELECT * FROM research_sources WHERE project_id=$1 ORDER BY id', [projectId])).rows;
  const pending = sources.filter((s) => s.extraction_status !== 'Successfully Extracted');
  // collect() never throws; it records the real outcome (Failed / Unsupported / Successfully Extracted) on the object.
  await Promise.all(pending.map((s) => extraction.collect(s)));
  for (const s of pending) {
    await db.query(
      `UPDATE research_sources SET final_url=$1, domain=$2, title=$3, author=$4, source_category=$5, category_reason=$6,
         published_at=$7, updated_at=$8, extracted_content=$9, extraction_status=$10, error=$11, extracted_at=$12 WHERE id=$13`,
      [s.final_url || null, s.domain, s.title || null, s.author || null, s.source_category, s.category_reason, s.published_at || null,
        s.updated_at || null, s.extracted_content || null, s.extraction_status, s.error || null, s.extracted_at, s.id]);
  }
  return sources;
}

async function saveResults(client, project, sources, good, result) {
  const pid = project.id;
  const ids = sources.map((s) => s.id);
  if (ids.length) await client.query('DELETE FROM extracted_claims WHERE source_id = ANY($1::int[])', [ids]);
  for (const t of ['source_conflicts', 'evidence_references', 'information_gaps', 'outdated_signals', 'research_questions']) {
    await client.query(`DELETE FROM ${t} WHERE project_id=$1`, [pid]);
  }

  const inserted = [];
  for (const cl of result.claims) {
    const row = (await client.query(
      'INSERT INTO extracted_claims(source_id,claim,evidence,evidence_location,confidence,verification_status) VALUES($1,$2,$3,$4,$5,$6) RETURNING *',
      [cl.source_id, cl.claim, cl.evidence, cl.location, cl.confidence, cl.supported ? ai.STATUS_OK : ai.STATUS_WEAK])).rows[0];
    inserted.push(row);
    if (cl.supported) {
      await client.query('INSERT INTO evidence_references(project_id,claim_id,source_id,quote,char_start) VALUES($1,$2,$3,$4,$5)', [pid, row.id, row.source_id, cl.evidence, cl.char_start]);
    }
  }
  for (const item of result.questions) {
    await client.query('INSERT INTO research_questions(project_id,question,answer_status,supporting_claim_ids) VALUES($1,$2,$3,$4)',
      [pid, item.question, item.status, JSON.stringify(item.claim_indexes.map((k) => inserted[k].id))]);
  }
  for (const g of gapsSvc.detect(project.category, good, result.gaps, result.questions, result.claims)) {
    await client.query(
      'INSERT INTO information_gaps(project_id,title,description,reason,question,priority,status,action,related_source_ids) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',
      [pid, g.title, g.description, g.reason, g.question, g.priority, g.status, g.action, JSON.stringify(g.source_ids)]);
  }
  for (const cf of conflictsSvc.detect(result.claims, result.conflicts)) {
    const a = inserted[cf.a]; const b = inserted[cf.b];
    await client.query(
      `INSERT INTO source_conflicts(project_id,claim_a_id,claim_b_id,claim_a,claim_b,evidence_a,evidence_b,source_a,source_b,kind,explanation,status)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [pid, a.id, b.id, a.claim, b.claim, a.evidence, b.evidence, a.source_id, b.source_id, cf.kind, cf.explanation, cf.status]);
  }
  for (const src of good) {
    for (const [type, reason] of freshness.signals(project.category, src)) {
      await client.query('INSERT INTO outdated_signals(project_id,source_id,signal_type,reason) VALUES($1,$2,$3,$4)', [pid, src.id, type, reason]);
    }
  }

  // Verification checklist: regenerate, but keep the completed/pending state of tasks that still apply.
  const [gaps, confs, questions, outs] = await Promise.all([
    client.query('SELECT * FROM information_gaps WHERE project_id=$1', [pid]),
    client.query('SELECT * FROM source_conflicts WHERE project_id=$1', [pid]),
    client.query('SELECT * FROM research_questions WHERE project_id=$1', [pid]),
    client.query('SELECT * FROM outdated_signals WHERE project_id=$1', [pid])
  ]);
  const wanted = checklistSvc.build(gaps.rows, confs.rows, questions.rows, outs.rows, good);
  const old = (await client.query("SELECT * FROM verification_checklists WHERE project_id=$1 AND origin='generated'", [pid])).rows;
  const oldByTask = new Map(old.map((t) => [t.task, t]));
  const wantedKeys = new Set(wanted.map((t) => t.task));
  for (const t of old) if (!wantedKeys.has(t.task)) await client.query('DELETE FROM verification_checklists WHERE id=$1', [t.id]);
  for (const t of wanted) {
    if (oldByTask.has(t.task)) continue;
    await client.query(
      "INSERT INTO verification_checklists(project_id,origin,task,description,priority,related_finding,suggested_source) VALUES($1,'generated',$2,$3,$4,$5,$6)",
      [pid, t.task, t.description, t.priority, t.related_finding, t.suggested_source || null]);
  }

  await client.query("UPDATE research_projects SET summary=$1, followups=$2, status='completed', error=NULL, updated_at=now() WHERE id=$3",
    [result.summary, JSON.stringify(result.followups), pid]);
  await projects.logHistory(project.user_id, pid, project.topic, 'analysis_completed',
    { claims: result.claims.length, sources: good.length }, client);
}

/**
 * Full pipeline: collect sources -> Gemini -> validated results saved in ONE transaction.
 * An incomplete analysis is never stored as successful.
 */
async function run(project) {
  await claim(project.id);
  try {
    const sources = await collectSources(project.id);
    const good = sources.filter((s) => s.extraction_status === 'Successfully Extracted');
    const sourceReport = sources.map((s) => ({ id: s.id, url: s.url, status: s.extraction_status, error: s.error || null }));

    if (!good.length) {
      const message = 'No source could be extracted. Open My Sources to see the reason for each one.';
      await setStatus(project.id, 'failed', message);
      await projects.logHistory(project.user_id, project.id, project.topic, 'analysis_failed', { reason: 'no_sources' });
      throw new HttpError(422, message, sourceReport);
    }

    let result;
    try {
      const settings = await settingsModel.getAll(project.user_id);
      result = await ai.analyze(project, good, config, settings.ai_max_chars_per_source);
    } catch (e) {
      if (!(e instanceof ai.AIError)) throw e;
      await setStatus(project.id, 'ai_failed', e.message);
      await projects.logHistory(project.user_id, project.id, project.topic, 'analysis_failed', { reason: e.code });
      logger.warn('AI analysis failed for project %s: %s', project.id, e.message);
      throw new HttpError(e.code === 'not_configured' ? 503 : 502,
        `${e.message}. Your sources were saved, so nothing is lost; fix the problem and run the analysis again.`);
    }

    try {
      await db.transaction((client) => saveResults(client, project, sources, good, result));
    } catch (e) {
      logger.error('Saving analysis for project %s failed: %s', project.id, e.stack || e.message);
      throw new HttpError(500, 'The analysis finished but its results could not be saved. See the server log.');
    }
    return { status: 'completed', failed_sources: sources.length - good.length, sources: sourceReport };
  } catch (e) {
    // Anything not already handled above must not leave the project stuck in "processing".
    if (!(e instanceof HttpError)) {
      try { await setStatus(project.id, 'failed', 'The analysis stopped unexpectedly. Try again.'); } catch (_) { /* ignore */ }
    } else if (e.status === 500) {
      try { await setStatus(project.id, 'failed', e.message); } catch (_) { /* ignore */ }
    }
    throw e;
  }
}

module.exports = { run };
