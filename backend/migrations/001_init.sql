-- Digital Dark Spot: initial schema (PostgreSQL 13+)

CREATE TABLE users (
  id            SERIAL PRIMARY KEY,
  name          VARCHAR(100) NOT NULL,
  email         VARCHAR(254) NOT NULL,
  password_hash VARCHAR(100) NOT NULL,
  token_version INTEGER      NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX ux_users_email_lower ON users (lower(email));

-- Logged-out tokens (checked on every authenticated request until they expire)
CREATE TABLE revoked_tokens (
  jti        VARCHAR(64) PRIMARY KEY,
  user_id    INTEGER     NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX ix_revoked_tokens_expires_at ON revoked_tokens (expires_at);

CREATE TABLE user_settings (
  user_id    INTEGER     NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key        VARCHAR(50) NOT NULL,
  value      JSONB       NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, key)
);

CREATE TABLE research_projects (
  id                SERIAL PRIMARY KEY,
  user_id           INTEGER      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  topic             VARCHAR(200) NOT NULL,
  research_question TEXT         NOT NULL,
  category          VARCHAR(60)  NOT NULL DEFAULT 'General Research',
  description       TEXT,
  status            VARCHAR(30)  NOT NULL DEFAULT 'created',
  error             TEXT,
  summary           TEXT,
  followups         JSONB,
  created_at        TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE INDEX ix_projects_user_created  ON research_projects (user_id, created_at DESC);
CREATE INDEX ix_projects_user_category ON research_projects (user_id, category);

CREATE TABLE research_sources (
  id                SERIAL PRIMARY KEY,
  project_id        INTEGER      NOT NULL REFERENCES research_projects(id) ON DELETE CASCADE,
  url               TEXT         NOT NULL,
  final_url         TEXT,
  domain            VARCHAR(255),
  title             TEXT,
  author            VARCHAR(300),
  source_category   VARCHAR(30)  DEFAULT 'Other',
  category_reason   TEXT,
  published_at      TIMESTAMPTZ,
  updated_at        TIMESTAMPTZ,
  extracted_content TEXT,
  extraction_status VARCHAR(30)  NOT NULL DEFAULT 'Pending',
  error             TEXT,
  extracted_at      TIMESTAMPTZ,
  reviewed          BOOLEAN      NOT NULL DEFAULT FALSE,
  created_at        TIMESTAMPTZ  NOT NULL DEFAULT now(),
  CONSTRAINT uq_source_project_url UNIQUE (project_id, url)
);
CREATE INDEX ix_sources_project ON research_sources (project_id);

CREATE TABLE extracted_claims (
  id                    SERIAL PRIMARY KEY,
  source_id             INTEGER NOT NULL REFERENCES research_sources(id) ON DELETE CASCADE,
  claim                 TEXT    NOT NULL,
  evidence              TEXT,
  evidence_location     VARCHAR(80),
  confidence            VARCHAR(20),
  verification_status   VARCHAR(40),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ix_claims_source ON extracted_claims (source_id);

CREATE TABLE evidence_references (
  id         SERIAL PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES research_projects(id) ON DELETE CASCADE,
  claim_id   INTEGER NOT NULL REFERENCES extracted_claims(id)  ON DELETE CASCADE,
  source_id  INTEGER NOT NULL REFERENCES research_sources(id)  ON DELETE CASCADE,
  quote      TEXT    NOT NULL,
  char_start INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ix_evidence_project ON evidence_references (project_id);
CREATE INDEX ix_evidence_claim   ON evidence_references (claim_id);

CREATE TABLE information_gaps (
  id                 SERIAL PRIMARY KEY,
  project_id         INTEGER NOT NULL REFERENCES research_projects(id) ON DELETE CASCADE,
  title              TEXT    NOT NULL,
  description        TEXT,
  reason             TEXT,
  question           TEXT,
  priority           VARCHAR(10) NOT NULL DEFAULT 'Medium' CHECK (priority IN ('High','Medium','Low')),
  status             VARCHAR(30) NOT NULL DEFAULT 'Potential Gap'
                     CHECK (status IN ('Potential Gap','Insufficient Evidence','Under Verification','Resolved')),
  action             TEXT,
  related_source_ids JSONB,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ix_gaps_project ON information_gaps (project_id);

CREATE TABLE source_conflicts (
  id          SERIAL PRIMARY KEY,
  project_id  INTEGER NOT NULL REFERENCES research_projects(id) ON DELETE CASCADE,
  claim_a_id  INTEGER REFERENCES extracted_claims(id) ON DELETE SET NULL,
  claim_b_id  INTEGER REFERENCES extracted_claims(id) ON DELETE SET NULL,
  claim_a     TEXT NOT NULL,
  claim_b     TEXT NOT NULL,
  evidence_a  TEXT,
  evidence_b  TEXT,
  source_a    INTEGER REFERENCES research_sources(id) ON DELETE SET NULL,
  source_b    INTEGER REFERENCES research_sources(id) ON DELETE SET NULL,
  kind        VARCHAR(30),
  explanation TEXT,
  status      VARCHAR(30) NOT NULL DEFAULT 'Needs Verification'
              CHECK (status IN ('Possible Conflict','Needs Verification','Contextual Difference')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ix_conflicts_project ON source_conflicts (project_id);

CREATE TABLE outdated_signals (
  id            SERIAL PRIMARY KEY,
  project_id    INTEGER NOT NULL REFERENCES research_projects(id) ON DELETE CASCADE,
  source_id     INTEGER NOT NULL REFERENCES research_sources(id)  ON DELETE CASCADE,
  signal_type   VARCHAR(40) NOT NULL
                CHECK (signal_type IN ('Recently Updated','Potentially Outdated','Expired Information','Undated Source','Date Not Available','Needs Verification')),
  reason        TEXT,
  detected_date TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ix_outdated_project ON outdated_signals (project_id);

CREATE TABLE research_questions (
  id                   SERIAL PRIMARY KEY,
  project_id           INTEGER NOT NULL REFERENCES research_projects(id) ON DELETE CASCADE,
  question             TEXT    NOT NULL,
  answer_status        VARCHAR(20) NOT NULL DEFAULT 'unanswered' CHECK (answer_status IN ('answered','partial','unanswered')),
  supporting_claim_ids JSONB
);
CREATE INDEX ix_questions_project ON research_questions (project_id);

CREATE TABLE verification_checklists (
  id                SERIAL PRIMARY KEY,
  project_id        INTEGER NOT NULL REFERENCES research_projects(id) ON DELETE CASCADE,
  task              TEXT    NOT NULL,
  description       TEXT,
  priority          VARCHAR(10) NOT NULL DEFAULT 'Medium' CHECK (priority IN ('High','Medium','Low')),
  status            VARCHAR(12) NOT NULL DEFAULT 'Pending' CHECK (status IN ('Pending','Completed')),
  related_finding   TEXT,
  suggested_source  TEXT,
  origin            VARCHAR(10) NOT NULL DEFAULT 'manual',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ix_checklist_project ON verification_checklists (project_id);

-- Per-user activity log. project_id is kept as NULL after the project is deleted.
CREATE TABLE research_history (
  id         SERIAL PRIMARY KEY,
  user_id    INTEGER     NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id INTEGER     REFERENCES research_projects(id) ON DELETE SET NULL,
  topic      VARCHAR(200),
  action     VARCHAR(40) NOT NULL,
  details    JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ix_history_user_created ON research_history (user_id, created_at DESC);
CREATE INDEX ix_history_project      ON research_history (project_id);
