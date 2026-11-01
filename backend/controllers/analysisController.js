'use strict';
const db = require('../config/db');
const projects = require('../models/projects');
const runner = require('../services/analysisRunner');
const snapshot = require('../services/snapshot');
const { ok } = require('../utils/response');
const { notFound } = require('../utils/errors');
const asyncHandler = require('../utils/asyncHandler');

async function ownedProject(req) {
  const p = await projects.getOwned(req.user.id, req.params.id);
  if (!p) throw notFound('Research project not found');
  return p;
}
const rows = async (sql, params) => (await db.query(sql, params)).rows;

const analyze = asyncHandler(async (req, res) => {
  const p = await ownedProject(req);
  return ok(res, await runner.run(p));
});

const getAnalysis = asyncHandler(async (req, res) => {
  const p = await ownedProject(req);
  const [sources, claims, coverage] = await Promise.all([
    rows('SELECT * FROM research_sources WHERE project_id=$1 ORDER BY id', [p.id]),
    snapshot.claimsForProject(p.id),
    snapshot.coverageOf(p.id)
  ]);
  return ok(res, {
    project: p,
    claims,
    followups: p.followups || [],
    coverage,
    sources: sources.map((x) => ({ id: x.id, title: x.title, url: x.url, domain: x.domain, status: x.extraction_status, error: x.error, category: x.source_category }))
  });
});

const gaps = asyncHandler(async (req, res) => {
  const p = await ownedProject(req);
  return ok(res, await rows('SELECT * FROM information_gaps WHERE project_id=$1 ORDER BY id', [p.id]));
});

const conflicts = asyncHandler(async (req, res) => {
  const p = await ownedProject(req);
  return ok(res, await rows(
    `SELECT c.*, a.title AS source_a_title, a.url AS source_a_url, b.title AS source_b_title, b.url AS source_b_url
     FROM source_conflicts c LEFT JOIN research_sources a ON a.id=c.source_a LEFT JOIN research_sources b ON b.id=c.source_b
     WHERE c.project_id=$1 ORDER BY c.id`, [p.id]));
});

const outdated = asyncHandler(async (req, res) => {
  const p = await ownedProject(req);
  return ok(res, await rows(
    `SELECT o.*, COALESCE(s.title,'') AS source_title FROM outdated_signals o LEFT JOIN research_sources s ON s.id=o.source_id
     WHERE o.project_id=$1 ORDER BY o.id`, [p.id]));
});

const evidence = asyncHandler(async (req, res) => {
  const p = await ownedProject(req);
  return ok(res, await rows(
    `SELECT c.id AS claim_id, c.claim AS finding, c.source_id, s.title AS source_title, s.url AS source_url, c.evidence, c.confidence,
            c.verification_status AS status, s.published_at, s.updated_at
     FROM extracted_claims c JOIN research_sources s ON s.id=c.source_id WHERE s.project_id=$1 ORDER BY c.id`, [p.id]));
});

const coverage = asyncHandler(async (req, res) => {
  const p = await ownedProject(req);
  return ok(res, await snapshot.coverageOf(p.id));
});

const claimDetail = asyncHandler(async (req, res) => {
  const r = await rows(
    `SELECT c.*, s.id AS sid, s.title AS stitle, s.url AS surl, s.domain AS sdomain, s.author AS sauthor, s.source_category AS scategory,
            s.extraction_status AS sstatus, s.published_at AS spublished, s.updated_at AS supdated, s.extracted_content
     FROM extracted_claims c JOIN research_sources s ON s.id=c.source_id JOIN research_projects p ON p.id=s.project_id
     WHERE c.id=$1 AND p.user_id=$2`, [Number(req.params.id), req.user.id]);
  const x = r[0];
  if (!x) throw notFound('Claim not found');
  const ref = (await rows('SELECT * FROM evidence_references WHERE claim_id=$1 ORDER BY id LIMIT 1', [x.id]))[0];
  let context = null;
  if (ref && ref.char_start !== null && x.extracted_content) {
    const a = ref.char_start; const b = a + ref.quote.length;
    if (x.extracted_content.slice(a, b) === ref.quote) {
      context = { before: x.extracted_content.slice(Math.max(0, a - 300), a), quote: ref.quote, after: x.extracted_content.slice(b, b + 300) };
    }
  }
  return ok(res, {
    claim: { id: x.id, source_id: x.source_id, claim: x.claim, evidence: x.evidence, evidence_location: x.evidence_location, confidence: x.confidence, verification_status: x.verification_status, created_at: x.created_at },
    source: { id: x.sid, title: x.stitle, url: x.surl, domain: x.sdomain, author: x.sauthor, category: x.scategory, status: x.sstatus, published_at: x.spublished, updated_at: x.supdated },
    context
  });
});

module.exports = { analyze, getAnalysis, gaps, conflicts, outdated, evidence, coverage, claimDetail };
