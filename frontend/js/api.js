// Reusable API helper. Loaded before every other script.
// There is no login: each browser creates a random client id once (kept in localStorage) and sends it in the
// X-Client-Id header, so the server knows which browser's research to show.
(function () {
  const API = "/api", CLIENT_KEY = "dds_client_id";
  let memoryId = null; // used only if localStorage is blocked

  class ApiError extends Error {
    constructor(message, status, details) { super(message); this.status = status; this.details = details; }
  }

  // RFC 4122 version 4 UUID (crypto.randomUUID only exists on https / localhost, so build it by hand as a fallback)
  function uuid() {
    if (crypto.randomUUID) return crypto.randomUUID();
    const b = crypto.getRandomValues(new Uint8Array(16));
    b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
    const h = [...b].map(x => x.toString(16).padStart(2, "0")).join("");
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  }

  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  function clientId() {
    try {
      let id = localStorage.getItem(CLIENT_KEY);
      if (!UUID_RE.test(id || "")) { id = uuid(); localStorage.setItem(CLIENT_KEY, id); }
      return id;
    } catch { return memoryId || (memoryId = uuid()); }
  }

  async function request(path, opts = {}) {
    const headers = { Accept: "application/json", "X-Client-Id": clientId() };
    if (opts.body !== undefined) headers["Content-Type"] = "application/json";
    let r;
    try {
      r = await fetch(API + path, { method: opts.method || "GET", headers, body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined });
    } catch { throw new ApiError("Cannot reach the server. Is the Node.js app running?", 0); }
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j.success === false) throw new ApiError(j.error || r.statusText || "Request failed", r.status, j.details);
    return j;
  }

  // api(path, {method, body}) -> the `data` part of the response envelope
  const api = async (path, opts) => (await request(path, opts)).data;
  api.full = request;

  // File download (a plain <a href> cannot send the X-Client-Id header)
  async function apiDownload(path, fallbackName = "download") {
    let r;
    try { r = await fetch(API + path, { headers: { "X-Client-Id": clientId() } }); }
    catch { throw new ApiError("Cannot reach the server. Is the Node.js app running?", 0); }
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      throw new ApiError(j.error || "Download failed", r.status);
    }
    const name = /filename="?([^";]+)"?/i.exec(r.headers.get("Content-Disposition") || "")?.[1] || fallbackName;
    const url = URL.createObjectURL(await r.blob());
    const a = document.createElement("a"); a.href = url; a.download = name; document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }

  window.API = API; window.ApiError = ApiError; window.api = api; window.apiDownload = apiDownload;
})();
