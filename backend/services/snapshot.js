'use strict';
const db = require('../config/db');
const coverageSvc = require('./coverage');
const settingsModel = require('../models/settings');
const { FRESHNESS_WARNINGS } = require('../utils/constants');

const iso = (d) => (d ? new Date(d).toISOString() : null);
const q = (sql, p) => db.query(sql, p);

async function claimsForProject(projectId) {
  return (await q('SELECT c.* FROM extracted_claims c JOIN research_sources s ON s.id=c.source_id WHERE s.project_id=$1 ORDER BY c.id', [projectId])).rows;
}

async function coverageOf(projectId) {
  const r = await q('SELECT * FROM research_questions WHERE project_id=$1 ORDER BY id', [projectId]);
  return { ...coverageSvc.calculate(r.rows.map((x) => x.answer_status)), questions: r.rows };
}

/** Everything the PDF report needs, read from what is actually saved in PostgreSQL. */
async function build(project) {
  const pid = project.id;
  const st = await settingsModel.getAll(project.user_id);
  const [sources, claims, gaps, conflicts, outdated, tasks, refs, cov] = await Promise.all([
    q('SELECT * FROM research_sources WHERE project_id=$1 ORDER BY id', [pid]),
    claimsForProject(pid),
    q('SELECT * FROM information_gaps WHERE project_id=$1 ORDER BY id', [pid]),
    q('SELECT * FROM source_conflicts WHERE project_id=$1 ORDER BY id', [pid]),
    q('SELECT * FROM outdated_signals WHERE project_id=$1 ORDER BY id', [pid]),
    q('SELECT * FROM verification_checklists WHERE project_id=$1 ORDER BY id', [pid]),
    q('SELECT * FROM evidence_references WHERE project_id=$1 ORDER BY id', [pid]),
    coverageOf(pid)
  ]);
  const byId = new Map(sources.rows.map((x) => [x.id, x]));
  const claimById = new Map(claims.map((x) => [x.id, x]));
  const warnings = outdated.rows.filter((o) => FRESHNESS_WARNINGS.includes(o.signal_type));
  return {
    topic: project.topic,
    question: project.research_question,
    category: project.category,
    summary: project.summary,
    followups: project.followups || [],
    researched_at: iso(project.created_at),
    generated: `${new Date().toISOString().replace('T', ' ').slice(0, 16)} UTC`,
    coverage: cov,
    questions: cov.questions.map((x) => ({ question: x.question, answer_status: x.answer_status })),
    counts: {
      sources: sources.rows.length,
      extracted: sources.rows.filter((x) => x.extraction_status === 'Successfully Extracted').length,
      claims: claims.length,
      gaps: gaps.rows.length,
      conflicts: conflicts.rows.length,
      outdated: warnings.length,
      tasks: tasks.rows.length,
      tasks_done: tasks.rows.filter((x) => x.status === 'Completed').length
    },
    sources: sources.rows.map((x) => ({ id: x.id, title: x.title, domain: x.domain, url: x.url, category: x.source_category, status: x.extraction_status, published_at: iso(x.published_at), updated_at: iso(x.updated_at) })),
    claims: claims.map((c) => ({ claim: c.claim, evidence: c.evidence, source_id: c.source_id, status: c.verification_status, confidence: c.confidence })),
    gaps: gaps.rows.map((g) => ({ title: g.title, reason: g.reason, priority: g.priority, status: g.status, action: g.action })),
    conflicts: conflicts.rows.map((c) => ({ claim_a: c.claim_a, claim_b: c.claim_b, source_a: c.source_a, source_b: c.source_b, explanation: c.explanation, status: c.status })),
    outdated: outdated.rows.map((o) => {
      const s = byId.get(o.source_id);
      return { source_id: o.source_id, source_title: s?.title || s?.url || 'Unknown source', signal_type: o.signal_type, reason: o.reason };
    }),
    evidence: st.report_include_evidence ? refs.rows.map((r) => ({ finding: claimById.get(r.claim_id)?.claim || '', quote: r.quote, url: byId.get(r.source_id)?.url || '' })) : [],
    checklist: st.report_include_checklist ? tasks.rows.map((t) => ({ task: t.task, priority: t.priority, status: t.status })) : [],
    omitted: [...(!st.report_include_evidence ? ['evidence'] : []), ...(!st.report_include_checklist ? ['checklist'] : [])]
  };
}

module.exports = { build, claimsForProject, coverageOf };
