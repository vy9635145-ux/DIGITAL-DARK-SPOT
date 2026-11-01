'use strict';
const db = require('../config/db');
const coverageSvc = require('../services/coverage');
const { ok } = require('../utils/response');
const asyncHandler = require('../utils/asyncHandler');
const { FRESHNESS_WARNINGS } = require('../utils/constants');
const { statsFor } = require('./researchController');

const stats = asyncHandler(async (req, res) => {
  const uid = req.user.id;
  const days = Array.from({ length: 7 }, (_, k) => { const d = new Date(); d.setUTCDate(d.getUTCDate() - (6 - k)); return d; });
  const cutoff = new Date(days[0]); cutoff.setUTCHours(0, 0, 0, 0);
  const q = (sql, p = [uid]) => db.query(sql, p);
  const mine = 'project_id IN (SELECT id FROM research_projects WHERE user_id=$1)';
  const [totals, statuses, priorities, covRows, last, categories, gapP, activity] = await Promise.all([
    q(`SELECT (SELECT count(*)::int FROM research_projects WHERE user_id=$1) AS projects,
              (SELECT count(*)::int FROM research_sources WHERE ${mine}) AS sources,
              (SELECT count(*)::int FROM information_gaps WHERE ${mine}) AS gaps,
              (SELECT count(*)::int FROM source_conflicts WHERE ${mine}) AS conflicts,
              (SELECT count(*)::int FROM outdated_signals WHERE ${mine} AND signal_type = ANY($2::text[])) AS outdated`, [uid, FRESHNESS_WARNINGS]),
    q(`SELECT status, count(*)::int AS n FROM verification_checklists WHERE ${mine} GROUP BY status`),
    q(`SELECT priority, count(*)::int AS n FROM verification_checklists WHERE ${mine} AND status='Pending' GROUP BY priority`),
    q(`SELECT answer_status FROM research_questions WHERE ${mine}`),
    q('SELECT * FROM research_projects WHERE user_id=$1 ORDER BY created_at DESC LIMIT 5'),
    q(`SELECT source_category, count(*)::int AS n FROM research_sources WHERE ${mine} GROUP BY source_category`),
    q(`SELECT priority, count(*)::int AS n FROM information_gaps WHERE ${mine} GROUP BY priority`),
    q("SELECT to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD') AS d, count(*)::int AS n FROM research_projects WHERE user_id=$1 AND created_at >= $2 GROUP BY 1", [uid, cutoff])
  ]);
  // Analysis states and the average coverage across projects that have an evaluated score.
  const allP = (await q('SELECT id, status FROM research_projects WHERE user_id=$1')).rows;
  const analyses = { completed: 0, pending: 0, failed: 0 };
  for (const x of allP) {
    if (x.status === 'completed') analyses.completed++;
    else if (x.status === 'failed' || x.status === 'ai_failed') analyses.failed++;
    else analyses.pending++;
  }
  const per = await statsFor(allP.map((x) => x.id));
  const scores = Object.values(per).map((x) => x.coverage).filter((x) => typeof x === 'number');
  const avgCoverage = scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null;
  const sm = Object.fromEntries(statuses.rows.map((x) => [x.status, x.n]));
  const byDay = Object.fromEntries(activity.rows.map((x) => [x.d, x.n]));
  const t = totals.rows[0];
  return ok(res, {
    sessions: t.projects, analyses, avg_coverage: avgCoverage, sources: t.sources, gaps: t.gaps, conflicts: t.conflicts, outdated: t.outdated,
    tasks_done: sm.Completed || 0, tasks_pending: sm.Pending || 0, tasks_total: (sm.Completed || 0) + (sm.Pending || 0),
    coverage: coverageSvc.calculate(covRows.rows.map((x) => x.answer_status)),
    activity: { labels: days.map((d) => d.toLocaleDateString('en-US', { weekday: 'short', day: '2-digit', timeZone: 'UTC' })), values: days.map((d) => byDay[d.toISOString().slice(0, 10)] || 0) },
    recent: last.rows,
    priorities: Object.fromEntries(priorities.rows.map((x) => [x.priority, x.n])),
    categories: Object.fromEntries(categories.rows.map((x) => [x.source_category || 'Unknown', x.n])),
    gap_priorities: Object.fromEntries(gapP.rows.map((x) => [x.priority, x.n]))
  });
});

module.exports = { stats };
