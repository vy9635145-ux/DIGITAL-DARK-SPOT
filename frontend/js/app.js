// Digital Dark Spot frontend. One file: helpers, router, and one module per page.
// Served by the Node.js app; every page talks to the /api endpoints through the helper in js/api.js (the browser's anonymous X-Client-Id is added automatically).
const $ = s => document.querySelector(s), $$ = (s, root = document) => [...root.querySelectorAll(s)];
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"}[c]));
const date = d => d ? new Date(d).toLocaleDateString() : "Not available";
const safeUrl = u => /^https?:\/\//i.test(u || "") ? u : "";
const ext = (u, label = "Open original source") => safeUrl(u) ? `<a href="${esc(u)}" target="_blank" rel="noopener noreferrer">${label} <i class="fa-solid fa-arrow-up-right-from-square" aria-hidden="true"></i></a>` : "<small>(pasted text, no original URL)</small>";

function toast(m, bad) { const t = document.createElement("div"); t.className = "toast" + (bad ? " bad" : ""); t.textContent = m; $("#toasts").append(t); setTimeout(() => t.remove(), 5000); }
const sid = () => localStorage.getItem("sid"), skel = () => '<div class="skel"></div>'.repeat(3);
function setSession(id, topic) { localStorage.setItem("sid", id); if (topic) localStorage.setItem("stopic", topic); }
function forgetSession() { localStorage.removeItem("sid"); localStorage.removeItem("stopic"); }
const fail = e => `<div class="error"><b>Something went wrong.</b><p>${esc(e.message)}</p><button data-retry="1">Retry</button></div>`;
const needs = () => sid() ? null : '<div class="empty">Open a research session from History or start a new one first.<br><br><a class="btn" href="#research">New Research</a></div>';
const sel = () => `<p><small>Session: <a href="#history">#${esc(sid())}${localStorage.getItem("stopic") ? " · " + esc(localStorage.getItem("stopic")) : ""}</a></small></p>`;
const go = h => location.hash === "#" + h ? route() : (location.hash = h);
const pending = (btn, label, fn) => async (...a) => {  // disables a button and shows a spinner while an async action runs
  const old = btn.innerHTML; btn.disabled = true; btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> ${label}`;
  try { return await fn(...a); } finally { btn.disabled = false; btn.innerHTML = old; }
};
const RED = ["Failed", "Expired Information", "Unsupported", "High"], GREEN = ["Recently Updated", "Successfully Extracted", "Completed", "Evidence found in source", "answered", "Low", "Resolved", "Contextual Difference", "completed"];
const cls = s => RED.includes(s) ? "High" : GREEN.includes(s) ? "Completed" : "Medium";
const pill = (s, extra = "") => `<span class="pill ${cls(s)} ${extra}">${esc(s)}</span>`;

// ---- modal dialog helpers ----
const dlg = () => $("#dlg");
function openDialog(html) { const d = dlg(); d.innerHTML = html; if (!d.open) d.showModal(); return d; }
function closeDialog() { if (dlg().open) dlg().close(); }
function formDialog(title, fields, submitLabel = "Save") {  // resolves with an object of values, or null if cancelled
  return new Promise(resolve => {
    const d = openDialog(`<form method="dialog" class="dform"><h3>${esc(title)}</h3>${fields.map(f => `<label for="df-${f.name}">${esc(f.label)}</label>` + (f.options
      ? `<select id="df-${f.name}" name="${f.name}">${f.options.map(o => `<option${o === f.value ? " selected" : ""}>${esc(o)}</option>`).join("")}</select>`
      : f.long ? `<textarea id="df-${f.name}" name="${f.name}" rows="3">${esc(f.value || "")}</textarea>` : `<input id="df-${f.name}" name="${f.name}" value="${esc(f.value || "")}" ${f.required ? "required" : ""}>`)).join("")}
      <p class="row"><button type="submit" value="ok">${esc(submitLabel)}</button><button type="button" class="ghost" value="cancel">Cancel</button></p></form>`);
    const form = d.querySelector("form");
    d.querySelector('button[type="button"]').onclick = () => { d.close(); resolve(null); };
    form.onsubmit = e => { e.preventDefault(); const v = Object.fromEntries(new FormData(form)); d.close(); resolve(v); };
    d.addEventListener("close", () => resolve(null), {once: true});
  });
}
async function runAnalysis(btn) {
  if (!sid()) return toast("Open a research session first", 1);
  const run = pending(btn || {disabled: 0, innerHTML: ""}, "Analyzing…", async () => {
    toast("Analysis started. Sources are fetched first, then Gemini analyzes them.");
    const r = await api(`/research/${sid()}/analyze`, {method: "POST"});
    toast(r.failed_sources ? `Analysis completed. ${r.failed_sources} source(s) could not be extracted.` : "Analysis completed");
    go("analysis");
  });
  try { await run(); } catch (e) { toast(e.message, 1); }
}
async function showEvidence(claimId) {
  openDialog(skel());
  try {
    const d = await api("/claims/" + claimId), c = d.claim, s = d.source;
    openDialog(`<div class="dform"><h3>Evidence detail</h3><p><b>Claim:</b> ${esc(c.claim)}</p><p>${pill(c.verification_status)} <span class="pill">confidence: ${esc(c.confidence)}</span></p>
      ${d.context ? `<p><b>Text found in the source:</b></p><blockquote>…${esc(d.context.before)}<mark>${esc(d.context.quote)}</mark>${esc(d.context.after)}…</blockquote>` : "<p class=\"error\">No verbatim supporting text was found in the stored source, so this statement is not treated as evidence.</p>"}
      <p><b>Source #${s.id}:</b> ${esc(s.title || s.domain || s.url)}<br><small>${esc(s.domain || "")} · ${esc(s.category)} · published ${date(s.published_at)} · updated ${date(s.updated_at)} · ${esc(s.status)}</small></p>
      <p class="row">${ext(s.url)} <button class="ghost sm" id="ev-src">Show in My Sources</button> <button class="sm" id="ev-close">Close</button></p></div>`);
    $("#ev-close").onclick = closeDialog; $("#ev-src").onclick = () => { closeDialog(); openSource(s.id); };
  } catch (e) { openDialog(`<div class="dform"><div class="error">${esc(e.message)}</div><p><button class="sm" id="ev-close">Close</button></p></div>`); $("#ev-close").onclick = closeDialog; }
}
function openSource(id) { localStorage.setItem("focusSource", id); go("sources"); }
const srcLink = (id, names) => `<a href="#sources" data-src="${id}">${esc((names[id] || "Source #" + id))}</a>`;
function bindNav(root) {  // claim → evidence dialog, anything with data-src → My Sources
  $$("[data-ev]", root).forEach(b => b.onclick = e => { e.preventDefault(); showEvidence(b.dataset.ev); });
  $$("[data-src]", root).forEach(a => a.onclick = e => { e.preventDefault(); openSource(a.dataset.src); });
}
const V = {};  // page modules, filled below

// ===== dashboard =====
V.dashboard = (() => {
let charts = [];
const chart = (id, cfg) => { if (typeof Chart === "undefined") return; charts.push(new Chart($("#" + id), cfg)); };
async function PAGE() {
  charts.forEach(c => c.destroy()); charts = [];
  const d = await api("/dashboard/stats"), c = d.coverage;
  $("#v-dashboard").innerHTML = `<div class="stats">${[["Research sessions", d.sessions], ["Sources collected", d.sources], ["Information gaps", d.gaps], ["Potential conflicts", d.conflicts], ["Freshness warnings", d.outdated], ["Verification tasks done", `${d.tasks_done}/${d.tasks_total}`]].map(([l, v]) => `<div class="card stat"><b>${v}</b>${l}</div>`).join("")}</div>
  ${typeof Chart === "undefined" ? '<div class="error">Charts could not be loaded (the Chart.js script is blocked or offline). The numbers above are still live.</div>' : ""}
  <div class="cols"><div class="card"><h3>Research coverage</h3>${c.empty ? `<div class="empty">${esc(c.empty_message)}</div>` : '<canvas id="cv" height="200"></canvas>'}<p><small>${esc(c.formula)}. Partially answered questions count as 0.5. ${esc(c.note)}</small></p></div>
  <div class="card"><h3>Totals</h3><canvas id="ov" height="200"></canvas></div>
  <div class="card"><h3>Verification progress</h3>${d.tasks_total ? '<canvas id="vp" height="200"></canvas>' : '<div class="empty">No verification tasks yet.</div>'}</div></div>
  <div class="cols"><div class="card"><h3>Research activity (7 days)</h3><canvas id="ac" height="200"></canvas></div><div class="card"><h3>Source categories</h3>${Object.keys(d.categories).length ? '<canvas id="sc" height="200"></canvas>' : '<div class="empty">No sources yet.</div>'}</div>
  <div class="card"><h3>Gaps by priority</h3>${Object.keys(d.gap_priorities).length ? '<canvas id="gp" height="200"></canvas>' : '<div class="empty">No gaps yet.</div>'}</div></div>
  <div class="cols"><div class="card"><h3>Recent sessions</h3>${d.recent.map(s => `<p><a href="#analysis" data-open="${s.id}" data-topic="${esc(s.topic)}">${esc(s.topic)}</a> ${pill(s.status)}</p>`).join("") || "No sessions yet."}</div>
  <div class="card"><h3>Pending tasks by priority</h3>${Object.entries(d.priorities).map(([k, v]) => `<p>${pill(k)} ${v}</p>`).join("") || "None pending."}</div></div>
  <a class="btn" href="#research">Start research</a>`;
  $$("[data-open]", $("#v-dashboard")).forEach(a => a.onclick = () => setSession(a.dataset.open, a.dataset.topic));
  if (!c.empty) chart("cv", {type: "doughnut", data: {labels: ["Answered", "Partially answered", "Unanswered"], datasets: [{data: [c.answered, c.partial, c.unanswered], backgroundColor: ["#6d4aff", "#2f7bff", "#d9dcef"]}]}, options: {plugins: {title: {display: true, text: `Coverage score: ${c.score}%`}}}});
  chart("ov", {type: "bar", data: {labels: ["Sessions", "Sources", "Gaps", "Conflicts", "Freshness warnings"], datasets: [{data: [d.sessions, d.sources, d.gaps, d.conflicts, d.outdated], backgroundColor: "#2f7bff"}]}, options: {plugins: {legend: {display: false}}, scales: {y: {beginAtZero: true, ticks: {precision: 0}}}}});
  if (d.tasks_total) chart("vp", {type: "doughnut", data: {labels: ["Completed", "Pending"], datasets: [{data: [d.tasks_done, d.tasks_pending], backgroundColor: ["#2fb36b", "#d9dcef"]}]}, options: {plugins: {title: {display: true, text: `${Math.round(100 * d.tasks_done / d.tasks_total)}% of tasks completed`}}}});
  chart("ac", {type: "bar", data: {labels: d.activity.labels, datasets: [{data: d.activity.values, backgroundColor: "#6d4aff"}]}, options: {plugins: {legend: {display: false}}, scales: {y: {beginAtZero: true, ticks: {precision: 0}}}}});
  if (Object.keys(d.categories).length) chart("sc", {type: "pie", data: {labels: Object.keys(d.categories), datasets: [{data: Object.values(d.categories)}]}});
  if (Object.keys(d.gap_priorities).length) chart("gp", {type: "bar", data: {labels: Object.keys(d.gap_priorities), datasets: [{data: Object.values(d.gap_priorities), backgroundColor: "#f0a43a"}]}, options: {plugins: {legend: {display: false}}, scales: {y: {beginAtZero: true, ticks: {precision: 0}}}}});
}
return PAGE;
})();

// ===== research =====
V.research = (() => {
const MAXU = 6;
function addUrl() {
  if ($$(".u").length >= MAXU) return toast("Maximum 6 URLs", 1);
  const r = document.createElement("div"); r.className = "row";
  r.innerHTML = '<input class="u" type="url" placeholder="https://" aria-label="Source URL"><button type="button" class="ghost sm" aria-label="Remove URL">✕</button>';
  r.lastChild.onclick = () => r.remove(); $("#urls").append(r);
}
addUrl(); $("#add").onclick = addUrl;
$("#f").onchange = e => {
  const f = e.target.files[0]; if (!f) return;
  if (f.size > 500000) { toast("File too large (500 KB max)", 1); e.target.value = ""; return; }
  const r = new FileReader(); r.onload = () => $("#tx").value = r.result; r.onerror = () => toast("Could not read the file", 1); r.readAsText(f);
};
$("#rform").onsubmit = async ev => {
  ev.preventDefault();
  const urls = $$(".u").map(i => i.value.trim()).filter(Boolean);
  try { urls.forEach(u => { if (!/^https?:$/.test(new URL(u).protocol)) throw 0; }); } catch { return toast("Every URL must start with http:// or https://", 1); }
  const btn = $("#go"); btn.disabled = true;
  const p = m => $("#prog").innerHTML = `<p><i class="fa-solid fa-spinner fa-spin"></i> ${m}</p>`;
  try {
    p("Creating research session…");
    const s = await api("/research", {method: "POST", body: {topic: $("#t").value, research_question: $("#q").value, category: $("#c").value, description: $("#d").value, urls, text: $("#tx").value}});
    setSession(s.id, s.topic); toast("Research session created");
    if (s.duplicates_removed?.length) toast(`${s.duplicates_removed.length} duplicate URL(s) were ignored`);
    p("Collecting sources and running the AI analysis. This can take a minute…");
    const r = await api(`/research/${s.id}/analyze`, {method: "POST"});
    $("#prog").innerHTML = ""; toast(r.failed_sources ? `Analysis completed. ${r.failed_sources} source(s) could not be extracted.` : "Analysis completed"); go("analysis");
  } catch (e) { $("#prog").innerHTML = `<div class="error">${esc(e.message)}${sid() ? ' <a href="#sources">Check sources</a>' : ""}</div>`; toast(e.message, 1); }
  btn.disabled = false;
};
return async () => { try { const s = await api("/settings"); if (!$("#t").value) $("#c").value = s.settings.default_category; } catch { /* the form still works with the first category */ } };
})();

// ===== sources =====
V.sources = (() => {
async function PAGE() {
  const n = needs(); if (n) return $("#v-sources").innerHTML = n;
  const ss = await api(`/research/${sid()}/sources`), box = $("#v-sources");
  box.innerHTML = sel() + (ss.map(s => `<div class="card" id="src-${s.id}"><b>${esc(s.title || s.domain || s.url)}</b> ${pill(s.extraction_status)} <span class="pill">${esc(s.source_category || "Unknown")}</span> <span class="pill">Source #${s.id}</span>
    <p><small>${esc(s.domain || "")} · published ${date(s.published_at)} · updated ${date(s.updated_at)}${s.author ? " · by " + esc(s.author) : ""} · ${s.content_chars.toLocaleString()} characters extracted<br>Category reason: ${esc(s.category_reason || "n/a")}. A category is not proof of accuracy.</small></p>${s.error ? `<p class="error">${esc(s.error)}</p>` : ""}
    ${ext(s.url, "Open original source")} · <details data-id="${s.id}"><summary>View extracted content</summary><pre>Loading…</pre></details>
    <p class="row"><label class="inline"><input type="checkbox" style="width:auto" ${s.reviewed ? "checked" : ""} data-reviewed="${s.id}"> Marked as reviewed</label><button class="sm danger" data-remove="${s.id}">Remove source</button></p></div>`).join("") || '<div class="empty">No sources in this session.</div>');
  $$("details[data-id]", box).forEach(d => d.ontoggle = async () => { if (d.open) { try { const s = await api("/sources/" + d.dataset.id); d.querySelector("pre").textContent = s.extracted_content || "No content was extracted from this source."; } catch (e) { d.querySelector("pre").textContent = e.message; } } });
  $$("[data-reviewed]", box).forEach(c => c.onchange = () => api("/sources/" + c.dataset.reviewed, {method: "PATCH", body: {reviewed: c.checked}}).catch(e => { toast(e.message, 1); c.checked = !c.checked; }));
  $$("[data-remove]", box).forEach(b => b.onclick = async () => { if (!confirm("Remove this source? Claims taken from it are removed too. Run the analysis again afterwards.")) return; try { await api("/sources/" + b.dataset.remove, {method: "DELETE"}); toast("Source removed"); PAGE(); } catch (e) { toast(e.message, 1); } });
  const f = localStorage.getItem("focusSource");
  if (f) { localStorage.removeItem("focusSource"); const el = $("#src-" + f); if (el) { el.scrollIntoView({behavior: "smooth", block: "center"}); el.classList.add("flash"); } }
}
$("#au").onclick = pending($("#au"), "Adding…", async () => {
  if (!sid()) return toast("Open a research session first", 1);
  try { await api(`/research/${sid()}/sources`, {method: "POST", body: {url: $("#nu").value}}); $("#nu").value = ""; toast("Source added. Re-run the analysis to include it."); PAGE(); } catch (e) { toast(e.message, 1); }
});
$("#rr").onclick = () => runAnalysis($("#rr"));
return PAGE;
})();

// ===== analysis =====
V.analysis = (() => {
async function PAGE() {
  const n = needs(); if (n) return $("#v-analysis").innerHTML = n;
  const [a, ev, out] = await Promise.all([api(`/research/${sid()}/analysis`), api(`/research/${sid()}/evidence`), api(`/research/${sid()}/outdated`)]);
  const s = a.project, cv = a.coverage, names = Object.fromEntries(a.sources.map(x => [x.id, x.title || x.domain || x.url]));
  const failed = a.sources.filter(x => x.status !== "Successfully Extracted");
  localStorage.setItem("stopic", s.topic);
  $("#v-analysis").innerHTML = `<h2>${esc(s.topic)}</h2>${sel()}<p>${pill(s.status)} <span class="pill">${esc(s.category)}</span></p><p><b>Research question:</b> ${esc(s.research_question)}</p>
  ${s.error ? `<div class="error">${esc(s.error)} <button id="retry">Retry analysis</button></div>` : ""}
  <div class="card"><h3>Summary</h3><p>${esc(s.summary || "No summary yet. Run the analysis from My Sources.")}</p></div>
  <div class="card"><h3>Source extraction status</h3>${a.sources.map(x => `<p>${pill(x.status)} <a href="#sources" data-src="${x.id}">${esc(names[x.id])}</a>${x.error ? `<br><small>${esc(x.error)}</small>` : ""}</p>`).join("") || "No sources."}${failed.length ? `<p><small>${failed.length} source(s) could not be extracted. Results below come only from the sources that were extracted.</small></p>` : ""}</div>
  <div class="card"><h3>Research coverage${cv.empty ? "" : `: ${cv.score}%`}</h3>${cv.empty ? `<div class="empty">${esc(cv.empty_message)}</div>` : `<div class="bar"><i style="width:${cv.score}%"></i></div>
  <p><b>${cv.total}</b> questions · <b>${cv.answered}</b> answered · <b>${cv.partial}</b> partially answered · <b>${cv.unanswered}</b> unanswered</p>`}
  <p><small>${esc(cv.formula)}. Partially answered questions count as 0.5. ${esc(cv.note)}</small></p>
  ${cv.questions.map(q => `<details><summary>${esc(q.question)} ${pill(q.answer_status)}</summary>${(q.supporting_claim_ids || []).map(id => { const c = a.claims.find(x => x.id === id); return c ? `<blockquote>${esc(c.claim)} <button class="sm ghost" data-ev="${c.id}">Evidence</button></blockquote>` : ""; }).join("") || "<small>No supporting evidence found in the reviewed sources.</small>"}</details>`).join("")}</div>
  <div class="card"><h3>Claims and evidence map</h3>${ev.map(e => `<div><b>${esc(e.finding)}</b> <span class="pill">${esc(e.confidence)}</span> ${pill(e.status)}${e.evidence ? `<blockquote>${esc(e.evidence)}</blockquote>` : "<p><small>No verbatim evidence located in the source text, so this is not treated as a finding.</small></p>"}
    <small>Source #${e.source_id}: ${esc(e.source_title || "")} · published ${date(e.published_at)} · updated ${date(e.updated_at)} · ${ext(e.source_url)} · <a href="#sources" data-src="${e.source_id}">View in My Sources</a> · <a href="#" data-ev="${e.claim_id}">Evidence detail</a></small><hr></div>`).join("") || "No claims were extracted."}</div>
  <div class="card"><h3>Freshness signals</h3>${out.map(o => `<p>${pill(o.signal_type)} <a href="#sources" data-src="${o.source_id}">${esc(o.source_title)}</a>: ${esc(o.reason)}</p>`).join("") || "None."}<p><small>Dates come from the pages themselves. The date a page was downloaded is never used as its publication date.</small></p></div>
  <div class="card"><h3>Follow-up questions</h3>${a.followups.map((f, i) => `<p>${esc(f)} <button class="sm ghost" data-f="${i}">Add to checklist</button></p>`).join("") || "None."}</div>`;
  const box = $("#v-analysis"); bindNav(box);
  if ($("#retry")) $("#retry").onclick = () => runAnalysis($("#retry"));
  $$("[data-f]", box).forEach(b => b.onclick = async () => { try { await api(`/research/${sid()}/checklist`, {method: "POST", body: {task: a.followups[b.dataset.f], related_finding: "Follow-up question"}}); b.disabled = true; toast("Added to checklist"); } catch (e) { toast(e.message, 1); } });
}
return PAGE;
})();

// ===== gaps =====
V.gaps = (() => {
async function PAGE() {
  const n = needs(); if (n) return $("#v-gaps").innerHTML = n;
  const [g, ss] = await Promise.all([api(`/research/${sid()}/gaps`), api(`/research/${sid()}/sources`)]), names = Object.fromEntries(ss.map(x => [x.id, x.title || x.domain || x.url])), urls = Object.fromEntries(ss.map(x => [x.id, x.url]));
  $("#v-gaps").innerHTML = sel() + (g.map(x => `<div class="card"><b>${esc(x.title)}</b> ${pill(x.priority)} ${pill(x.status)}<p>${esc(x.description)}</p>
    <p><b>Why it matters:</b> ${esc(x.reason)}<br><b>Related research question:</b> ${esc(x.question || "n/a")}<br><b>Verification suggestion:</b> ${esc(x.action)}<br>
    <b>Related sources:</b> ${(x.related_source_ids || []).map(i => srcLink(i, names) + (safeUrl(urls[i]) ? ` (<a href="${esc(urls[i])}" target="_blank" rel="noopener noreferrer">original</a>)` : "")).join(", ") || "none"}</p></div>`).join("") || '<div class="empty">No gaps detected in this session. That does not prove nothing is missing.</div>');
  bindNav($("#v-gaps"));
}
return PAGE;
})();

// ===== conflicts =====
V.conflicts = (() => {
async function PAGE() {
  const n = needs(); if (n) return $("#v-conflicts").innerHTML = n; const c = await api(`/research/${sid()}/conflicts`);
  const side = (x, k) => `<div><b>${esc(x[`source_${k}_title`] || "Source #" + x["source_" + k])}</b><br><small>${x["source_" + k] ? `<a href="#sources" data-src="${x["source_" + k]}">View in My Sources</a> · ` : ""}${ext(x[`source_${k}_url`])}</small>
    <blockquote>${esc(x["claim_" + k])}</blockquote>${x["evidence_" + k] ? `<small>Supporting text:</small><blockquote>${esc(x["evidence_" + k])}</blockquote>` : ""}${x["claim_" + k + "_id"] ? `<button class="sm ghost" data-ev="${x["claim_" + k + "_id"]}">Evidence detail</button>` : ""}</div>`;
  $("#v-conflicts").innerHTML = sel() + (c.map(x => `<div class="card">${pill(x.status)}${x.kind ? ` <span class="pill">${esc(x.kind)} difference</span>` : ""}<div class="versus">${side(x, "a")}${side(x, "b")}</div><p><b>Explanation:</b> ${esc(x.explanation)}</p><p><small>Verification status: ${esc(x.status)}. A difference is not proof that either source is wrong.</small></p></div>`).join("") || '<div class="empty">No possible conflicts found between the reviewed sources.</div>');
  bindNav($("#v-conflicts"));
}
return PAGE;
})();

// ===== checklist =====
V.checklist = (() => {
async function PAGE() {
  const n = needs(); if (n) { $("#v-checklist").innerHTML = n; $("#pt").textContent = ""; $("#pb").style.width = "0"; return; }
  const t = await api(`/research/${sid()}/checklist`), fp = $("#fp").value, fs = $("#fs").value;
  const done = t.filter(x => x.status === "Completed").length, shown = t.filter(x => (!fp || x.priority === fp) && (!fs || x.status === fs));
  $("#pb").style.width = (t.length ? 100 * done / t.length : 0) + "%"; $("#pt").textContent = `${done} of ${t.length} completed`;
  const box = $("#v-checklist");
  box.innerHTML = shown.map(x => `<div class="card row"><input type="checkbox" style="width:auto" ${x.status === "Completed" ? "checked" : ""} data-c="${x.id}" aria-label="Mark ${esc(x.task)} as completed"><div style="flex:1"><b${x.status === "Completed" ? ' class="done"' : ""}>${esc(x.task)}</b> ${pill(x.priority)} ${pill(x.status)} <span class="pill">${x.origin === "generated" ? "From analysis" : "Manual"}</span><br><small>${esc(x.description || "")} · ${esc(x.related_finding || "")}${safeUrl(x.suggested_source) ? ` · <a href="${esc(x.suggested_source)}" target="_blank" rel="noopener noreferrer">suggested source</a>` : ""}</small></div><button class="sm ghost" data-e="${x.id}">Edit</button><button class="sm danger" data-d="${x.id}">Delete</button></div>`).join("") || `<div class="empty">${t.length ? "No tasks match these filters." : "No tasks yet. Run an analysis to generate tasks, or add your own."}</div>`;
  $$("[data-c]", box).forEach(b => b.onchange = async () => { try { await api(`/research/${sid()}/checklist/${b.dataset.c}`, {method: "PATCH", body: {status: b.checked ? "Completed" : "Pending"}}); } catch (e) { toast(e.message, 1); } PAGE(); });
  $$("[data-e]", box).forEach(b => b.onclick = async () => {
    const x = t.find(y => y.id == b.dataset.e), v = await formDialog("Edit task", [{name: "task", label: "Task", value: x.task, required: true}, {name: "description", label: "Description", value: x.description, long: true}, {name: "priority", label: "Priority", value: x.priority, options: ["High", "Medium", "Low"]}]);
    if (v) try { await api(`/research/${sid()}/checklist/${x.id}`, {method: "PATCH", body: v}); toast("Task updated"); PAGE(); } catch (e) { toast(e.message, 1); }
  });
  $$("[data-d]", box).forEach(b => b.onclick = async () => { if (confirm("Delete this task?")) { try { await api(`/research/${sid()}/checklist/${b.dataset.d}`, {method: "DELETE"}); toast("Task deleted"); } catch (e) { toast(e.message, 1); } PAGE(); } });
}
$("#fp").onchange = $("#fs").onchange = () => PAGE().catch(e => toast(e.message, 1));
$("#nt").onclick = async () => {
  if (!sid()) return toast("Open a research session first", 1);
  const v = await formDialog("New task", [{name: "task", label: "Task", required: true}, {name: "description", label: "Description", long: true}, {name: "priority", label: "Priority", value: "Medium", options: ["High", "Medium", "Low"]}], "Add task");
  if (v) try { await api(`/research/${sid()}/checklist`, {method: "POST", body: v}); toast("Task added"); PAGE(); } catch (e) { toast(e.message, 1); }
};
return PAGE;
})();

// ===== reports =====
V.reports = (() => {
async function PAGE() {
  const n = needs(); if (n) { $("#v-reports").innerHTML = n; $("#gr").hidden = true; return; }
  const a = await api(`/research/${sid()}`);
  $("#gr").hidden = false; $("#gr").disabled = a.status !== "completed";
  $("#v-reports").innerHTML = sel() + (a.status === "completed"
    ? `<div class="card">The report contains the saved topic, question, sources, claims, gaps, conflicts, outdated-information signals, coverage score, verification checklist (with its current progress) and recommendations.</div>`
    : '<div class="empty">Run a completed analysis first. The report is built only from saved analysis results.</div>');
}
$("#gr").onclick = pending($("#gr"), "Generating…", async () => {
  if (!sid()) return toast("Open a research session first", 1);
  try { await apiDownload(`/research/${sid()}/report`, "report.pdf"); toast("Report downloaded"); } catch (e) { toast(e.message, 1); }
});
return PAGE;
})();

// ===== history =====
V.history = (() => {
let timer;
async function PAGE() {
  const qs = new URLSearchParams({q: $("#hq").value.trim(), category: $("#hc").value, sort: $("#hs").value});
  const h = await api("/research?" + qs), box = $("#v-history");
  box.innerHTML = h.map(s => `<div class="card"><b>${esc(s.topic)}</b> <span class="pill">${esc(s.category)}</span> ${pill(s.status)}<br><small>${date(s.created_at)} · ${s.sources} sources · coverage ${s.coverage != null ? s.coverage + "%" : "n/a"} · ${s.gaps} gaps · ${s.conflicts} conflicts</small><br>
    <button class="sm" data-o="${s.id}" data-t="${esc(s.topic)}">Open findings</button> <button class="sm ghost" data-rep="${s.id}" data-t="${esc(s.topic)}">Reports</button> <button class="sm danger" data-x="${s.id}">Delete</button></div>`).join("") || '<div class="empty">No research found.<br><br><a class="btn" href="#research">Start research</a></div>';
  api("/history").then(items => { $("#v-activity").innerHTML = items.slice(0, 15).map(x => `<p><small>${date(x.created_at)} · <b>${esc(x.action.replace(/_/g, " "))}</b> · ${esc(x.topic || "")}</small></p>`).join("") || '<p class="muted">No activity yet.</p>'; }).catch(() => { $("#v-activity").innerHTML = ""; });
  $$("[data-o]", box).forEach(b => b.onclick = () => { setSession(b.dataset.o, b.dataset.t); go("analysis"); });
  $$("[data-rep]", box).forEach(b => b.onclick = () => { setSession(b.dataset.rep, b.dataset.t); go("reports"); });
  $$("[data-x]", box).forEach(b => b.onclick = async () => { if (!confirm("Delete this research session and all its sources, findings, tasks and reports? This cannot be undone.")) return; try { await api("/research/" + b.dataset.x, {method: "DELETE"}); if (sid() == b.dataset.x) forgetSession(); toast("Research deleted"); PAGE(); } catch (e) { toast(e.message, 1); } });
}
$("#hq").oninput = () => { clearTimeout(timer); timer = setTimeout(() => PAGE().catch(e => toast(e.message, 1)), 300); };
$("#hc").onchange = $("#hs").onchange = () => PAGE().catch(e => toast(e.message, 1));
return PAGE;
})();

// ===== settings =====
V.settings = (() => {
let cats = [];
$("#sv").onclick = pending($("#sv"), "Saving…", async () => {
  try {
    await api("/settings", {method: "PATCH", body: {default_category: $("#sc-cat").value, ai_max_chars_per_source: parseInt($("#sc-cap").value, 10), report_include_evidence: $("#sc-ev").checked, report_include_checklist: $("#sc-cl").checked}});
    toast("Settings saved");
  } catch (e) { toast(e.message, 1); }
});
async function PAGE() {
  const s = await api("/settings"), v = s.settings, i = s.info;
  $("#sc-cat").innerHTML = s.categories.map(c => `<option${c === v.default_category ? " selected" : ""}>${esc(c)}</option>`).join("");
  $("#sc-cap").value = v.ai_max_chars_per_source; $("#sc-ev").checked = v.report_include_evidence; $("#sc-cl").checked = v.report_include_checklist;
  $("#v-info").innerHTML = `<p>Application version: <b>${esc(i.version)}</b></p>
    <p>Database: <span class="pill ${i.database.connected && i.database.schema_ready ? "Completed" : "High"}">${i.database.connected ? (i.database.schema_ready ? "connected" : "tables missing") : "not connected"}</span><br><small>${esc(i.database.message)}</small></p>
    <p>Gemini AI: <span class="pill ${i.ai.configured ? "Completed" : "High"}">${i.ai.configured ? "configured" : "not configured"}</span> ${i.ai.configured ? `<small>model ${esc(i.ai.model)}</small>` : ""}<br><small>${esc(i.ai.message)}</small></p>
    <p><small>Limits: ${i.limits.max_urls} URLs per session, ${i.limits.max_pasted_chars.toLocaleString()} pasted characters, ${i.limits.request_timeout_seconds}s fetch timeout per source.</small></p>`;
}
return PAGE;
})();

// ===== router =====
const PAGES = Object.keys(V);
async function route() {
  const h = location.hash.slice(1), app = PAGES.includes(h);
  $("#landing").hidden = app; $("#shell").hidden = !app; window.scrollTo(0, 0);
  if (!app) return;
  $$(".page").forEach(p => p.classList.toggle("on", p.id === "p-" + h));
  $$("#nav a").forEach(a => { a.classList.toggle("on", a.dataset.k === h); if (a.dataset.k === h) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current"); });
  $("#side").classList.remove("open");
  const v = $("#v-" + h); if (v) v.innerHTML = skel();
  try { await V[h](); }
  catch (e) {
    if (e.status === 404 && sid()) { forgetSession(); if (v) v.innerHTML = needs(); toast("That research session no longer exists.", 1); }
    else if (v) v.innerHTML = fail(e); else toast(e.message, 1);
  }
}
$$("[data-scroll]").forEach(a => a.onclick = e => { e.preventDefault(); document.getElementById(a.dataset.scroll).scrollIntoView({behavior: "smooth"}); });
$("#collapse").onclick = () => $("#side").classList.toggle("min"); $("#burger").onclick = () => $("#side").classList.toggle("open");
document.addEventListener("click", e => { if (e.target.closest("[data-retry]")) route(); });
addEventListener("hashchange", route);
route();
