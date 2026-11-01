# Digital Dark Spot

**AI-assisted information gap detection platform.** Add source URLs and/or pasted text; the app fetches the pages safely, asks Gemini to extract claims with verbatim evidence, then reports information gaps, possible conflicts between sources, outdated information, a research coverage score and a verification checklist, and exports a PDF report. There is **no login**: anyone can open the app and start researching. Each browser gets a random anonymous client id, and its research, settings and history are kept separate from other browsers.

## Technology stack

| Layer | Technology |
|---|---|
| Frontend | HTML5, CSS3, vanilla JavaScript, Fetch API (Chart.js for dashboard charts) |
| Backend | Node.js 20+, Express.js, REST API, `express-validator` |
| Security | `helmet` (CSP + headers), `cors`, `express-rate-limit`, SSRF protection |
| Database | PostgreSQL, `pg` pool, SQL migrations |
| AI | Google Gemini API (JSON responses, validated server-side) |
| Other | `cheerio` (HTML parsing), `pdfkit` (PDF), `winston` (logging), `dotenv` |

No Python, Flask, MongoDB or frontend frameworks. `multer` is not used: the optional `.txt` upload is read in the browser and pasted into the text box.

## Folder structure

```
digital-dark-spot/
├── frontend/                 index.html (landing + app)
│   ├── css/style.css
│   ├── js/api.js             reusable fetch helper (anonymous X-Client-Id header, errors, downloads)
│   ├── js/app.js             pages: dashboard, research, sources, analysis, gaps, conflicts,
│   │                         checklist, reports, history, settings
│   └── assets/
├── backend/
│   ├── server.js app.js migrate.js
│   ├── config/               env config, PostgreSQL pool
│   ├── routes/ controllers/ validators/ middleware/ models/
│   ├── services/             extraction (SSRF-safe), ai-analysis, gap/conflict/freshness/coverage,
│   │                         checklist, analysisRunner, snapshot, report (PDF), status
│   ├── migrations/           001_init.sql ...
│   └── utils/                logger, errors, response envelope, constants
├── database/schema.sql       reference snapshot of the schema
├── fonts/                    DejaVu Sans (PDF text)
├── tests/                    logic, security and integration tests
├── .env.example  .gitignore  package.json  README.md
```

## Setup

1. **Install PostgreSQL 13+** and create a database (and a separate one for tests):
   ```bash
   createdb digital_dark_spot
   createdb digital_dark_spot_test      # optional, for npm test
   ```
2. **Configure the environment**
   ```bash
   cp .env.example .env
   ```
   Edit `.env`: set `DATABASE_URL` and `GEMINI_API_KEY` (get one at https://aistudio.google.com/).
   The server refuses to start if `DATABASE_URL` is missing or unreachable. There is **no dummy-data fallback**: if PostgreSQL is down the API returns 503.
3. **Install, migrate, run**
   ```bash
   npm install
   npm run migrate
   npm run dev          # http://localhost:3000  (use `npm start` in production)
   ```
   Open http://localhost:3000, click **Start Research**, then **New Research**. No account is needed.

If `GEMINI_API_KEY` is missing the research is still saved, but *Analyze* returns a clear configuration error. There is no demo mode; failed analyses are never stored as successful and can be retried.

## Migrations

SQL files in `backend/migrations/` run in filename order, each in a transaction, and are recorded in `schema_migrations`. `npm run migrate` is safe to run repeatedly. Add new changes as `002_description.sql`; never edit an applied file. (`npm run db:init` is an alias.) Data from the earlier version of this project (tables `research_sessions`, `sources`, ...) is not migrated; the new schema uses new table names.

## Tests

```bash
npm test             # everything in tests/
npm run test:unit    # logic + security tests only (no database needed)
```

* `tests/logic.test.js`: coverage formula, AI-output validation (fake sources/evidence), conflicts, gaps, freshness, checklist. No dependencies needed.
* `tests/security.test.js`: SSRF rules, config validation, 400 on every research route without a valid `X-Client-Id`, removed auth endpoints return 404, input validation, headers. Needs `npm install`, no database.
* `tests/api.integration.test.js`: full flow on a real PostgreSQL test database: anonymous client ids, data isolation between browsers, research creation, analysis (Gemini stubbed at the network boundary), coverage, checklist persistence, history filters, PDF, delete. **Runs only when `TEST_DATABASE_URL` is set**, and refuses to run unless the database name ends in `_test` (its schema is dropped and rebuilt).

## How it works

* **Sources** (`services/extraction.js`): http/https only; localhost, private/link-local/reserved IPs, internal host names and URLs with credentials are blocked; DNS results and every redirect hop are re-checked; 15 s timeout, 1.5 MB cap, content-type allow-list. JavaScript is never executed, so pages that need it are marked **Failed**. A source is shown as *Successfully Extracted* only if readable text was actually retrieved.
* **AI** (`services/ai-analysis.js`): Gemini returns JSON that is validated. A claim must reference a real source and its evidence must be found verbatim in that source's stored text; otherwise it is marked *Insufficiently supported* and ignored for coverage and conflicts. Source text is treated as untrusted (prompt-injection guard).
* **Coverage score** = (answered + 0.5 × partially answered) ÷ total research questions × 100. It measures how many questions have supporting evidence in the reviewed sources, not truth or accuracy. No questions evaluated → no score (never a random number).
* **Freshness** uses dates found on the page, never the download date; category-specific age limits.
* **Checklist** is generated from gaps, conflicts, unanswered questions and stale sources; checkbox state is stored in PostgreSQL and survives re-analysis for tasks that still apply.
* **Anonymous identity (no login)**: the browser creates a random UUID once (kept in `localStorage`) and sends it as `X-Client-Id`; the server maps it to a row in `users` and scopes every query to that row. This separates browsers from each other but is **not authentication**: anyone who knows a client id can see that browser's research, and clearing site data starts a new, empty workspace.

## API

Responses use `{ "success": true, "data": ... }` or `{ "success": false, "error": "...", "details": [...] }`. Everything except `/api/health` and `/api/status` needs an `X-Client-Id: <uuid v4>` header (the frontend adds it automatically).

| Method | Route | Purpose |
|---|---|---|
| GET / PATCH | `/api/settings` | per-browser preferences + service status |
| GET / POST | `/api/research` | list (`q`, `category`, `status`, `sort`) / create |
| GET / PATCH / DELETE | `/api/research/:id` | details / update topic, question, category, description / delete |
| GET / POST | `/api/research/:id/sources` | list / add a URL |
| POST | `/api/research/:id/analyze` | collect sources + Gemini analysis (retry-safe) |
| GET | `/api/research/:id/analysis` `/gaps` `/conflicts` `/outdated` `/evidence` `/coverage` | saved results |
| GET / POST | `/api/research/:id/checklist` | list (with progress) / add task |
| PATCH / DELETE | `/api/research/:id/checklist/:taskId` | update / delete task |
| GET | `/api/research/:id/report` | download PDF built from saved data |
| GET / PATCH / DELETE | `/api/sources/:id` | view / mark reviewed / remove |
| GET | `/api/claims/:id` | claim with evidence context |
| GET | `/api/history` | activity log |
| GET | `/api/dashboard/stats` | dashboard numbers (totals, completed / pending / failed analyses, average coverage, recent research) |
| GET | `/api/health` `/api/status` | health / version / DB + AI configuration |

Rate limits: 600 requests / 15 min per IP overall, and 6 / min per browser (client id) for analysis and report generation.

## Deployment

1. Provision PostgreSQL (managed service or your own) and set `DATABASE_URL` (`DATABASE_SSL=true` if the provider requires SSL).
2. Set `NODE_ENV=production`, `PORT`, `GEMINI_API_KEY`, and `FRONTEND_URL` (the public URL).
3. `npm ci --omit=dev && npm run migrate && npm start`, under a process manager (systemd, pm2, Docker).
4. Put a reverse proxy with HTTPS in front (nginx, Caddy, a platform router) and set `TRUST_PROXY=1` so rate limiting sees client IPs. Logs go to the console and, in production, to `logs/`.
5. Back up the database regularly.

## Known limitations

* Anyone can use the app and spend your Gemini quota; the rate limits are the only protection. Add a login or an API gateway again before a public launch.
* The client id is kept in `localStorage`; a CSP and output escaping reduce, but do not eliminate, XSS risk. Do not add inline scripts or untrusted third-party scripts.
* DNS rebinding between the safety check and the actual connection is narrowed (every redirect hop is re-checked) but not eliminated; for hostile networks add an egress firewall.
* Pages that need JavaScript to render cannot be read. Only `text/html`, `application/xhtml+xml` and `text/plain` are collected (no PDF sources).
* Analysis runs inside one HTTP request (10-60 s). For heavy use, add a job queue.
* DejaVu Sans does not cover every script (some Indic/CJK characters may show as boxes in PDFs).
* Gemini model names change over time; set `GEMINI_MODEL` if the default is retired.
