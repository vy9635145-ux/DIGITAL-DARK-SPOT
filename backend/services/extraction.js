const dns = require('node:dns').promises;
const net = require('node:net');
const ipaddr = require('ipaddr.js');
const cheerio = require('cheerio');

const MAX_BYTES = 1_500_000, MAX_TEXT = 60_000, MIN_TEXT = 200, MAX_REDIRECTS = 5;
const TIMEOUT = [5, 10];
const ALLOWED_TYPES = ['text/html', 'application/xhtml+xml', 'text/plain'];
const BLOCKED_HOSTS = new Set(['localhost', 'localhost.localdomain', 'metadata.google.internal']);
const BLOCKED_SUFFIXES = ['.local', '.localhost', '.internal', '.lan', '.home', '.corp', '.intranet'];
const USER_AGENT = 'DigitalDarkSpot/1.0 (+research tool; respects size and time limits)';
const now = () => new Date();
function normalizeUrl(value) {
  try { const u = new URL((value || '').trim()); u.hash = ''; u.hostname = u.hostname.toLowerCase(); u.pathname = u.pathname.replace(/\/+$/, ''); return u.toString().replace(/\/$/, ''); }
  catch { return (value || '').trim(); }
}
function ipBlocked(value) {
  try { let ip = ipaddr.parse(value.replace(/^::ffff:/i, '')); if (ip.kind() === 'ipv6' && ip.isIPv4MappedAddress()) ip = ip.toIPv4Address(); return ip.range() !== 'unicast'; }
  catch { return true; }
}
async function checkUrl(value, resolve = true) {
  const raw = (value || '').trim();
  if (raw.length > 2048) throw new Error('URL is too long');
  let u; try { u = new URL(raw); } catch { throw new Error('Invalid URL'); }
  if (!['http:', 'https:'].includes(u.protocol)) throw new Error('Only http and https URLs are allowed');
  const host = u.hostname.toLowerCase().replace(/\.$/, '').replace(/^\[|\]$/g, '');
  if (!host) throw new Error('URL has no host name');
  if (u.username || u.password) throw new Error('URLs containing credentials are not allowed');
  if (BLOCKED_HOSTS.has(host) || BLOCKED_SUFFIXES.some(s => host.endsWith(s))) throw new Error('Blocked: internal host name');
  if (net.isIP(host)) { if (ipBlocked(host)) throw new Error('Blocked: internal or private address'); return raw; }
  if (!resolve) return raw;
  let addresses;
  try { addresses = await dns.lookup(host, { all: true, verbatim: true }); } catch { throw new Error('Host could not be resolved'); }
  if (!addresses.length) throw new Error('Host could not be resolved');
  if (addresses.some(x => ipBlocked(x.address))) throw new Error('Blocked: internal or private address');
  return raw;
}
async function fetchPage(initialUrl) {
  let url = initialUrl;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    await checkUrl(url, true);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), (TIMEOUT[0] + TIMEOUT[1]) * 1000);
    let response;
    try { response = await fetch(url, { redirect: 'manual', signal: controller.signal, headers: { 'User-Agent': USER_AGENT, Accept: 'text/html,application/xhtml+xml,text/plain;q=0.8' } }); }
    catch (e) { if (e.name === 'AbortError' || e.name === 'TimeoutError') throw Object.assign(new Error('Request timed out'), { kind: 'timeout' }); throw Object.assign(new Error(`Network error: ${String(e.message).slice(0, 200)}`), { kind: 'network' }); }
    finally { clearTimeout(timer); }
    if ([301,302,303,307,308].includes(response.status)) {
      const loc = response.headers.get('location'); if (!loc) throw new Error('Redirect without a Location header');
      if (hop === MAX_REDIRECTS) throw new Error('Too many redirects');
      url = new URL(loc, url).toString(); continue;
    }
    if (!response.ok) throw Object.assign(new Error(`The server answered with HTTP ${response.status}`), { kind: 'http' });
    const type = (response.headers.get('content-type') || 'text/html').split(';')[0].trim().toLowerCase();
    if (!ALLOWED_TYPES.includes(type)) throw Object.assign(new Error(`Unsupported content type: ${type || 'unknown'}`), { kind: 'unsupported' });
    const length = Number(response.headers.get('content-length') || 0);
    if (length > MAX_BYTES * 4) throw new Error('Response is too large');
    const reader = response.body.getReader(); const chunks = []; let size = 0;
    while (size <= MAX_BYTES) { const { done, value } = await reader.read(); if (done) break; chunks.push(Buffer.from(value)); size += value.byteLength; }
    try { await reader.cancel(); } catch {}
    const raw = Buffer.concat(chunks).subarray(0, MAX_BYTES);
    const charset = /charset\s*=\s*['"]?([^;'"\s]+)/i.exec(response.headers.get('content-type') || '')?.[1];
    return { finalUrl: url, text: raw.toString(charset && /^utf-?8$/i.test(charset) ? 'utf8' : 'utf8'), headers: Object.fromEntries(response.headers.entries()) };
  }
  throw new Error('Too many redirects');
}
function parseDate(value) {
  if (!value || typeof value !== 'string') return null;
  const d = new Date(value.trim()); const today = Date.now();
  if (Number.isNaN(d.getTime()) || d.getUTCFullYear() < 1990 || d.getTime() > today + 86400000) return null;
  return d;
}
function classify(domain) {
  const d = (domain || '').toLowerCase();
  if (/\.(gov|mil)(\.[a-z]{2})?$|\.gov\.|\.nic\.in$|europa\.eu$/.test(d)) return ['Official','Government domain suffix'];
  if (/\.edu(\.[a-z]{2})?$|\.ac\.[a-z]{2}$/.test(d)) return ['Educational','Academic domain suffix'];
  if (/(arxiv|nature|science|springer|pubmed|ncbi|doi)\./.test(d)) return ['Research','Known research publisher'];
  if (/(news|times|post|bbc|reuters|cnn|guardian)/.test(d)) return ['News','News-style domain'];
  return ['Other','No category signal in domain; this is not a judgment of accuracy'];
}
function cleanText(text) { return (text || '').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, ' ').replace(/[ \t\u00a0]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim(); }
function parse(html) {
  const $ = cheerio.load(html || '');
  const jsonld = [];
  $('script[type*= "ld+json" i]').each((_, el) => { try { const stack = [JSON.parse($(el).text())]; while(stack.length) { const x = stack.pop(); if (Array.isArray(x)) stack.push(...x); else if (x && typeof x === 'object') { jsonld.push(x); Object.values(x).filter(v => v && typeof v === 'object').forEach(v => stack.push(v)); } } } catch {} });
  const meta = (...keys) => { for (const m of $('meta').toArray()) { const k = String($(m).attr('property') || $(m).attr('name') || $(m).attr('itemprop') || '').toLowerCase(); const v = ($(m).attr('content') || '').trim(); if (keys.includes(k) && v) return v; } return null; };
  const ldval = (...keys) => { for (const o of jsonld) for (const k of keys) { let v = o[k]; if (v && typeof v === 'object' && !Array.isArray(v)) v = v.name; if (Array.isArray(v) && v.length) v = typeof v[0] === 'object' ? v[0].name : v[0]; if (typeof v === 'string' && v.trim()) return v.trim(); } return null; };
  const scriptCount = $('script').length;
  const title = $('title').first().text().trim() || meta('og:title') || $('h1').first().text().trim() || null;
  const timeDate = $('time[datetime]').first().attr('datetime');
  const published = parseDate(meta('article:published_time','datepublished','date','dc.date','dc.date.issued','publishdate','pubdate') || ldval('datePublished','dateCreated') || timeDate);
  const updated = parseDate(meta('article:modified_time','datemodified','last-modified','dc.date.modified','og:updated_time') || ldval('dateModified'));
  let author = meta('author','article:author','dc.creator') || ldval('author') || $('*[rel="author"]').first().text().trim() || null;
  $('script,style,noscript,iframe,form,svg,template,nav,footer,aside').remove();
  const root = $('article').first().length ? $('article').first() : $('main').first().length ? $('main').first() : $('body').first().length ? $('body').first() : $.root();
  let text = root.find('p,li,h1,h2,h3,h4,td,blockquote').toArray().map(el => $(el).text().trim()).filter(Boolean).join('\n');
  text = cleanText(text).slice(0, MAX_TEXT);
  const jsHeavy = text.length < MIN_TEXT && (scriptCount >= 3 || $('#root,#app,#__next,#__nuxt').length > 0);
  return { title: title?.slice(0,500) || null, author: author?.slice(0,300) || null, publishedAt: published, updatedAt: updated, text, jsHeavy };
}
async function collect(src) {
  src.extraction_status = 'Processing'; src.error = null;
  let parsed; try { src.domain = new URL(src.url).hostname.slice(0,255); } catch { src.domain = ''; }
  [src.source_category, src.category_reason] = classify(src.domain);
  try {
    const fetched = await fetchPage(src.url); src.final_url = fetched.finalUrl; parsed = parse(fetched.text);
    if (parsed.text.length < MIN_TEXT) { src.extraction_status = 'Failed'; src.error = parsed.jsHeavy ? 'This page appears to load its content with JavaScript, which is not executed, so its text could not be retrieved.' : 'Little or no readable text was found on this page.'; }
    else { src.title = parsed.title; src.author = parsed.author; src.published_at = parsed.publishedAt; src.updated_at = parsed.updatedAt; src.extracted_content = parsed.text; src.extraction_status = 'Successfully Extracted'; }
  } catch (e) { src.extraction_status = e.kind === 'unsupported' ? 'Unsupported' : 'Failed'; src.error = e.message.slice(0,300); }
  src.extracted_at = now(); return src;
}
module.exports = { MAX_BYTES, MAX_TEXT, MIN_TEXT, MAX_REDIRECTS, TIMEOUT, normalizeUrl, checkUrl, fetchPage, parse, classify, collect };
