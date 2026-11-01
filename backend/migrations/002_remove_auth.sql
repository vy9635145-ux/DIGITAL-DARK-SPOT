-- Login was removed: visitors are anonymous. Each browser keeps a random client id (UUID) and sends it in the
-- X-Client-Id header; that id owns its research, settings and history. No passwords, emails or tokens are stored.
-- Rows created by the old account system stay in the database but are no longer reachable (client_id is NULL).

DROP TABLE IF EXISTS revoked_tokens;
DROP INDEX IF EXISTS ux_users_email_lower;
ALTER TABLE users
  DROP COLUMN IF EXISTS name,
  DROP COLUMN IF EXISTS email,
  DROP COLUMN IF EXISTS password_hash,
  DROP COLUMN IF EXISTS token_version;
ALTER TABLE users ADD COLUMN IF NOT EXISTS client_id VARCHAR(36);
CREATE UNIQUE INDEX IF NOT EXISTS ux_users_client_id ON users (client_id);
