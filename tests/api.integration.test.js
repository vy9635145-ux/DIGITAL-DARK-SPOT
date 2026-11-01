'use strict';
// Full-stack tests against a REAL PostgreSQL test database. Skipped unless TEST_DATABASE_URL is set.
// SAFETY: the database name must end with "_test"; its public schema is dropped and rebuilt from the migrations.
// Gemini is replaced by a stub at the network boundary (global fetch) so no API key or internet is needed;
// everything else (Express, SQL, validation, PDF) is the real code.
const test = require('node:test');
const { randomUUID } = require('node:crypto');
const assert = require('node:assert/strict');

const TEST_DB = process.env.TEST_DATABASE_URL;
if (!TEST_DB) {
  test('integration tests', { skip: 'TEST_DATABASE_URL is not set (see .env.example)' }, () => {});
  return;
}
const dbName = new URL(TEST_DB).pathname.replace(/^\//, '');
if (!/_test$/.test(dbName)) throw new Error(`Refusing to run: TEST_DATABASE_URL database "${dbName}" must end with "_test".`);

Object.assign(process.env, {
  NODE_ENV: 'test', DATABASE_URL: TEST_DB,
  GEMINI_API_KEY: 'test-key', GEMINI_RETRIES: '0', GEMINI_TIMEOUT: '5'
});

const request = require('supertest');
const db = require('../backend/config/db');
const { migrate } = require('../backend/migrate');
const { makeApp } = require('../backend/app');

const TEXT = 'The scholarship application deadline is 15 March 2027 for all eligible undergraduate students. Applicants must submit a transcript, an identity card and a recommendation letter through the official portal. The award amount is $500 per month and the scholarship can be renewed each year if grades remain above the minimum requirement.';
const realFetch = global.fetch;
let geminiMode = 'ok'; let geminiCalls = 0;
global.fetch = async (url, opts) => {
  if (String(url).includes('generativelanguage.googleapis.com')) {
    geminiCalls++;
    if (geminiMode === 'fail') return new Response('{"error":"boom"}', { status: 500 });
    const prompt = JSON.parse(opts.body).contents[0].parts[0].text;
    const id = Number(/<source id="(\d+)"/.exec(prompt)[1]);
    const payload = {
      summary: 'The pasted text describes a scholarship with a March deadline.',
      claims: [{ source_id: id, claim: 'The application deadline is 15 March 2027', evidence: 'application deadline is 15 March 2027', location: 'paragraph 1', confidence: 'high' },
        { source_id: id, claim: 'The award is 500 dollars per month', evidence: 'award amount is $500 per month', location: 'paragraph 2', confidence: 'high' }],
      questions: [{ question: 'When is the deadline?', status: 'answered', claim_indexes: [0] }, { question: 'What are the renewal conditions?', status: 'unanswered', claim_indexes: [] }],
      gaps: [], conflicts: [], followups: ['Check the official portal for the next cycle']
    };
    return new Response(JSON.stringify({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(payload) }] } }] }), { status: 200, headers: { 'content-type': 'application/json' } });
  }
  throw new TypeError('network access is disabled in tests'); // page fetches fail like an unreachable website
};

let app; let A; let B; let projectId;
const auth = (u) => ({ 'X-Client-Id': u.cid });
const binary = (res, cb) => { const d = []; res.on('data', (c) => d.push(c)); res.on('end', () => cb(null, Buffer.concat(d))); };

test.before(async () => {
  await db.query('DROP SCHEMA public CASCADE'); await db.query('CREATE SCHEMA public');
  const r = await migrate();
  assert.ok(r.applied.length >= 1);
  assert.equal((await migrate()).applied.length, 0); // running the migrations again is safe and changes nothing
  app = makeApp();
});
test.after(async () => { global.fetch = realFetch; await db.close(); });

test('server health and database connection', async () => {
  const r = await request(app).get('/api/health'); assert.equal(r.status, 200);
  const s = await request(app).get('/api/status'); assert.equal(s.body.data.database.connected, true); assert.equal(s.body.data.database.schema_ready, true);
});

test('anonymous identity: no login needed, header required, each client id is its own user', async () => {
  A = { cid: randomUUID() }; B = { cid: randomUUID() };
  assert.equal((await request(app).get('/api/research')).status, 400);
  assert.equal((await request(app).get('/api/research').set({ 'X-Client-Id': 'not-a-uuid' })).status, 400);
  for (const u of [A, A, B]) assert.equal((await request(app).get('/api/research').set(auth(u))).status, 200);
  const rows = (await db.query('SELECT id, client_id FROM users WHERE client_id = ANY($1)', [[A.cid, B.cid]])).rows;
  assert.equal(rows.length, 2); // the same client id reuses its row
  A.id = rows.find((r) => r.client_id === A.cid).id; B.id = rows.find((r) => r.client_id === B.cid).id;
  const cols = (await db.query("SELECT column_name FROM information_schema.columns WHERE table_name='users'")).rows.map((r) => r.column_name);
  assert.ok(!cols.some((c) => /password|email|token/.test(c)), cols.join(','));
  for (const [m, p] of [['post', '/api/auth/login'], ['post', '/api/auth/register'], ['get', '/api/auth/me'], ['get', '/api/profile']]) {
    assert.equal((await request(app)[m](p).set(auth(A))).status, 404, p);
  }
});

test('research creation: validation, SSRF blocking, duplicate URL removal, user association', async () => {
  const h = auth(A);
  assert.equal((await request(app).post('/api/research').set(h).send({ research_question: 'q' })).status, 400);
  assert.equal((await request(app).post('/api/research').set(h).send({ topic: 't', research_question: 'q' })).status, 400); // no sources
  assert.equal((await request(app).post('/api/research').set(h).send({ topic: 't', research_question: 'q', urls: ['http://localhost/admin'] })).status, 400);
  assert.equal((await request(app).post('/api/research').set(h).send({ topic: 't', research_question: 'q', urls: ['http://169.254.169.254/'] })).status, 400);
  assert.equal((await request(app).post('/api/research').set(h).send({ topic: 't', research_question: 'q', text: 'too short' })).status, 400);
  const r = await request(app).post('/api/research').set(h).send({
    topic: 'Scholarship rules', research_question: 'What are the rules?', category: 'Scholarships', description: 'demo', urls: ['https://example.org/a', 'https://EXAMPLE.org/a/'], text: TEXT });
  assert.equal(r.status, 201); assert.equal(r.body.data.user_id, A.id); assert.equal(r.body.data.duplicates_removed.length, 1);
  projectId = r.body.data.id;
  const src = await request(app).get(`/api/research/${projectId}/sources`).set(h);
  assert.equal(src.body.data.length, 2);
});

test('data isolation: another user cannot read, change, analyze, download or delete A\'s research', async () => {
  const h = auth(B);
  for (const [m, p] of [['get', ''], ['delete', ''], ['get', '/sources'], ['get', '/analysis'], ['get', '/gaps'], ['get', '/checklist'], ['post', '/analyze'], ['get', '/report']]) {
    assert.equal((await request(app)[m](`/api/research/${projectId}${p}`).set(h)).status, 404, `${m} ${p}`);
  }
  assert.deepEqual((await request(app).get('/api/research').set(h)).body.data, []);
  const src = (await request(app).get(`/api/research/${projectId}/sources`).set(auth(A))).body.data[0];
  assert.equal((await request(app).get(`/api/sources/${src.id}`).set(h)).status, 404);
  assert.equal((await request(app).delete(`/api/sources/${src.id}`).set(h)).status, 404);
});

test('AI failure: clear error, nothing saved as successful, safe retry works', async () => {
  const h = auth(A);
  geminiMode = 'fail';
  const bad = await request(app).post(`/api/research/${projectId}/analyze`).set(h);
  assert.ok([502, 503].includes(bad.status)); assert.equal(bad.body.success, false);
  const st = (await request(app).get(`/api/research/${projectId}`).set(h)).body.data;
  assert.equal(st.status, 'ai_failed');
  assert.equal((await request(app).get(`/api/research/${projectId}/analysis`).set(h)).body.data.claims.length, 0);
  assert.equal((await request(app).get(`/api/research/${projectId}/report`).set(h)).status, 409); // no report without a completed analysis
  geminiMode = 'ok';
  const good = await request(app).post(`/api/research/${projectId}/analyze`).set(h);
  assert.equal(good.status, 200); assert.equal(good.body.data.status, 'completed');
  assert.equal(good.body.data.failed_sources, 1); // the example.org page could not be fetched: reported honestly
  const failed = good.body.data.sources.find((s) => s.url !== 'pasted-text');
  assert.notEqual(failed.status, 'Successfully Extracted');
});

test('analysis results, evidence and coverage are saved and consistent', async () => {
  const h = auth(A);
  const a = (await request(app).get(`/api/research/${projectId}/analysis`).set(h)).body.data;
  assert.equal(a.claims.length, 2); assert.ok(a.claims.every((c) => c.verification_status === 'Evidence found in source'));
  assert.equal(a.coverage.score, 50); assert.equal(a.coverage.total, 2);
  const ev = (await request(app).get(`/api/research/${projectId}/evidence`).set(h)).body.data;
  assert.ok(ev.every((e) => e.evidence && e.source_id));
  const cd = await request(app).get(`/api/claims/${ev[0].claim_id}`).set(h);
  assert.equal(cd.status, 200); assert.ok(cd.body.data.context);
  assert.equal((await request(app).get(`/api/claims/${ev[0].claim_id}`).set(auth(B))).status, 404);
  assert.ok((await request(app).get(`/api/research/${projectId}/gaps`).set(h)).body.data.length > 0);
  assert.ok((await request(app).get(`/api/research/${projectId}/outdated`).set(h)).body.data.length > 0);
});

test('checklist: generated tasks, toggle persists, progress updates, other users blocked', async () => {
  const h = auth(A);
  const list = await request(app).get(`/api/research/${projectId}/checklist`).set(h);
  assert.ok(list.body.data.length > 0); assert.equal(list.body.progress.completed, 0);
  const t = list.body.data[0];
  const p = await request(app).patch(`/api/research/${projectId}/checklist/${t.id}`).set(h).send({ status: 'Completed' });
  assert.equal(p.status, 200); assert.equal(p.body.data.status, 'Completed');
  const again = await request(app).get(`/api/research/${projectId}/checklist`).set(h); // "refresh"
  assert.equal(again.body.data.find((x) => x.id === t.id).status, 'Completed'); assert.ok(again.body.progress.percent > 0);
  assert.equal((await request(app).patch(`/api/research/${projectId}/checklist/${t.id}`).set(h).send({ status: 'Nope' })).status, 400);
  assert.equal((await request(app).patch(`/api/research/${projectId}/checklist/${t.id}`).set(auth(B)).send({ status: 'Pending' })).status, 404);
  const manual = await request(app).post(`/api/research/${projectId}/checklist`).set(h).send({ task: 'Call the office', priority: 'High' });
  assert.equal(manual.status, 201);
  // re-running the analysis keeps completed state of tasks that still apply
  const rerun = await request(app).post(`/api/research/${projectId}/analyze`).set(h); assert.equal(rerun.status, 200);
  const kept = (await request(app).get(`/api/research/${projectId}/checklist`).set(h)).body.data;
  assert.equal(kept.find((x) => x.task === t.task)?.status, 'Completed');
});

test('PDF report is generated from saved data', async () => {
  const r = await request(app).get(`/api/research/${projectId}/report`).set(auth(A)).buffer(true).parse(binary);
  assert.equal(r.status, 200); assert.match(r.headers['content-type'], /application\/pdf/);
  assert.equal(r.body.subarray(0, 5).toString(), '%PDF-'); assert.ok(r.body.length > 2000);
});

test('history: search, category filter, sort, activity log, dashboard counts only own data', async () => {
  const h = auth(A);
  await request(app).post('/api/research').set(h).send({ topic: 'Solar panels', research_question: 'Efficiency?', category: 'Technology', text: TEXT });
  const all = (await request(app).get('/api/research').set(h)).body.data; assert.equal(all.length, 2);
  assert.equal((await request(app).get('/api/research?q=solar').set(h)).body.data.length, 1);
  assert.equal((await request(app).get('/api/research?q=%25').set(h)).body.data.length, 0); // wildcard is escaped
  assert.equal((await request(app).get('/api/research?category=Technology').set(h)).body.data.length, 1);
  assert.ok(new Date((await request(app).get('/api/research?sort=oldest').set(h)).body.data[0].created_at) <= new Date(all[0].created_at));
  assert.equal((await request(app).get('/api/research?category=Bogus').set(h)).status, 400);
  assert.ok((await request(app).get('/api/history').set(h)).body.data.some((x) => x.action === 'report_generated'));
  const dash = (await request(app).get('/api/dashboard/stats').set(h)).body.data; assert.equal(dash.sessions, 2);
  assert.equal((await request(app).get('/api/dashboard/stats').set(auth(B))).body.data.sessions, 0);
});

test('settings are per browser (client id)', async () => {
  const r = await request(app).patch('/api/settings').set(auth(A)).send({ report_include_checklist: false });
  assert.equal(r.status, 200); assert.equal(r.body.data.settings.report_include_checklist, false);
  assert.equal((await request(app).get('/api/settings').set(auth(B))).body.data.settings.report_include_checklist, true);
  assert.equal((await request(app).patch('/api/settings').set(auth(A)).send({ evil: 1 })).status, 400);
});

test('update research, status filter, dashboard analysis counts and average coverage', async () => {
  const h = auth(A);
  const url = `/api/research/${projectId}`;
  assert.equal((await request(app).patch(url).set(h).send({})).status, 400);
  assert.equal((await request(app).patch(url).set(h).send({ category: 'Nope' })).status, 400);
  assert.equal((await request(app).patch(url).set(h).send({ topic: '   ' })).status, 400);
  const u = await request(app).patch(url).set(h).send({ topic: 'Scholarship rules v2', description: '' });
  assert.equal(u.status, 200); assert.equal(u.body.data.topic, 'Scholarship rules v2'); assert.equal(u.body.data.description, null);
  assert.equal((await request(app).patch(url).set(auth(B)).send({ topic: 'hijack' })).status, 404);
  assert.ok((await request(app).get('/api/history').set(h)).body.data.some((x) => x.action === 'updated'));
  assert.equal((await request(app).get('/api/research?status=bogus').set(h)).status, 400);
  assert.deepEqual((await request(app).get('/api/research?status=completed').set(h)).body.data.map((x) => x.id), [projectId]);
  const d = (await request(app).get('/api/dashboard/stats').set(h)).body.data;
  assert.deepEqual(d.analyses, { completed: 1, pending: 1, failed: 0 });
  assert.equal(d.avg_coverage, 50);
});

test('delete research removes it and its children', async () => {
  const h = auth(A);
  assert.equal((await request(app).delete(`/api/research/${projectId}`).set(h)).status, 200);
  assert.equal((await request(app).get(`/api/research/${projectId}`).set(h)).status, 404);
  for (const t of ['research_sources', 'extracted_claims', 'verification_checklists', 'information_gaps']) {
    const q = t === 'extracted_claims' ? 'SELECT count(*)::int n FROM extracted_claims c JOIN research_sources s ON s.id=c.source_id WHERE s.project_id=$1' : `SELECT count(*)::int n FROM ${t} WHERE project_id=$1`;
    assert.equal((await db.query(q, [projectId])).rows[0].n, 0, t);
  }
});
