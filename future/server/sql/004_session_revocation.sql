-- Dedicated token deny-lists for FUTURE service. No raw bearer token is stored.
-- Identities here are only token subjects and SHA-256 jti digests.
BEGIN;
CREATE TABLE __SCHEMA__.cloud_revoked_backup_tokens (
  subject_id TEXT NOT NULL,
  token_digest TEXT NOT NULL CHECK (token_digest ~ '^[a-f0-9]{64}$'),
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (subject_id,token_digest)
);
CREATE TABLE __SCHEMA__.cloud_revoked_staff_tokens (
  subject_id TEXT NOT NULL,
  token_digest TEXT NOT NULL CHECK (token_digest ~ '^[a-f0-9]{64}$'),
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (subject_id,token_digest)
);
GRANT SELECT,INSERT ON __SCHEMA__.cloud_revoked_backup_tokens TO __BACKUP_ROLE__;
GRANT SELECT,INSERT ON __SCHEMA__.cloud_revoked_staff_tokens TO __ADMIN_ROLE__;
-- Background cleanup of expired entries must use the separate maintenance role;
-- runtime roles may not UPDATE, DELETE or TRUNCATE revocation history.
COMMIT;
