'use strict';
// Needs `npm install` (express, supertest, ...) but NO database: every case below is rejected before any query runs.
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://nobody:nothing@127.0.0.1:1/none';

const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const extraction = require('../backend/services/extraction');
const { config, assertConfig } = require('../backend/config');
const { makeApp } = require('../backend/app');

const app = makeApp();

test('SSRF: non-http(s), credentials, localhost, private, link-local and internal hosts are rejected', async () => {
  const bad = ['ftp://example.com', 'file:///etc/passwd', 'javascript:alert(1)', 'http://user:pw@example.com/', 'http://localhost/admin', 'http://127.0.0.1/x',
    'http://2130706433/', 'http://0.0.0.0/', 'http://[::1]/', 'http://[::ffff:127.0.0.1]/', 'http://169.254.169.254/latest/meta-data', 'http://10.0.0.5/', 'http://172.16.0.1/',
    'http://192.168.0.1/x', 'http://service.local/', 'http://db.internal/', 'http://metadata.google.internal/', 'not a url'];
  for (const url of bad) await assert.rejects(() => extraction.checkUrl(url, false), undefined, `should reject ${url}`);
  assert.equal(await extraction.checkUrl('https://example.org/research', false), 'https://example.org/research');
});
test('URL normalization removes host case, trailing slash and fragments (duplicate detection)', () => {
  assert.equal(extraction.normalizeUrl('HTTPS://Example.org/a/#section'), 'https://example.org/a');
  assert.equal(extraction.normalizeUrl('https://example.org/a'), extraction.normalizeUrl('https://EXAMPLE.org/a/'));
});
test('HTML parser extracts text and dates without executing scripts', () => {
  const d = extraction.parse('<html><head><title>Grant</title><meta name="author" content="A. Writer"><meta property="article:published_time" content="2025-03-10"></head><body><nav>menu</nav><main><h1>Grant terms</h1><p>This is a sufficiently long research source containing useful scholarship deadline details and amount information for applicants. It should be extracted safely.</p></main><script>bad()</script></body></html>');
  assert.equal(d.title, 'Grant'); assert.equal(d.author, 'A. Writer'); assert.equal(d.publishedAt.toISOString().slice(0, 10), '2025-03-10');
  assert.match(d.text, /scholarship deadline/); assert.doesNotMatch(d.text, /bad\(\)/);
});
test('source classification', () => {
  assert.equal(extraction.classify('www.education.gov.in')[0], 'Official');
  assert.equal(extraction.classify('cs.stanford.edu')[0], 'Educational');
  assert.equal(extraction.classify('example.com')[0], 'Other');
});

test('configuration validation refuses a missing or non-PostgreSQL DATABASE_URL', () => {
  const saved = { ...config };
  try {
    Object.assign(config, { databaseUrl: '' });
    assert.throws(assertConfig, /DATABASE_URL/);
    Object.assign(config, { databaseUrl: 'mysql://u:p@h/db' });
    assert.throws(assertConfig, /PostgreSQL URL/);
    Object.assign(config, { databaseUrl: 'postgresql://u:p@h/db' });
    assert.doesNotThrow(assertConfig);
  } finally { Object.assign(config, saved); }
});

test('research routes reject requests without a valid X-Client-Id (400, before any database query)', async () => {
  for (const [m, p] of [['get', '/api/research'], ['post', '/api/research'], ['get', '/api/research/1'], ['delete', '/api/research/1'], ['patch', '/api/research/1'], ['post', '/api/research/1/analyze'],
    ['get', '/api/research/1/analysis'], ['get', '/api/research/1/sources'], ['get', '/api/research/1/checklist'], ['patch', '/api/research/1/checklist/1'],
    ['get', '/api/research/1/report'], ['get', '/api/dashboard/stats'], ['get', '/api/history'], ['get', '/api/settings'], ['get', '/api/claims/1'], ['get', '/api/sources/1']]) {
    for (const headers of [{}, { 'X-Client-Id': 'garbage' }, { 'X-Client-Id': '1; DROP TABLE users' }]) {
      const r = await request(app)[m](p).set(headers);
      assert.equal(r.status, 400, `${m.toUpperCase()} ${p}`);
      assert.equal(r.body.success, false);
    }
  }
});
test('login, register, profile and password endpoints no longer exist', async () => {
  for (const [m, p] of [['post', '/api/auth/login'], ['post', '/api/auth/register'], ['get', '/api/auth/me'], ['post', '/api/auth/logout'], ['get', '/api/profile'], ['patch', '/api/profile/password']]) {
    assert.equal((await request(app)[m](p)).status, 404, `${m.toUpperCase()} ${p}`);
  }
});
test('invalid JSON body returns a clean 400', async () => {
  const r = await request(app).post('/api/research').set('Content-Type', 'application/json').send('{"email":');
  assert.equal(r.status, 400); assert.equal(r.body.success, false);
});
test('unknown API routes return a JSON 404 and security headers are set', async () => {
  const r = await request(app).get('/api/does-not-exist');
  assert.equal(r.status, 404); assert.equal(r.body.success, false);
  assert.ok(r.headers['content-security-policy']); assert.equal(r.headers['x-powered-by'], undefined); assert.equal(r.headers['x-content-type-options'], 'nosniff');
});
test('static pages are served and link to existing assets', async () => {
  for (const p of ['/', '/css/style.css', '/js/api.js', '/js/app.js']) assert.equal((await request(app).get(p)).status, 200, p);
  for (const p of ['/login.html', '/register.html', '/js/auth.js']) assert.equal((await request(app).get(p)).status, 404, p);
});
