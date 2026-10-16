-- Future Cuoshi cloud backend schema. Run with a trusted migration role only.
-- These tables contain plaintext private records; never expose them to the mini-program.
BEGIN;

CREATE TABLE cloud_users (
  user_id TEXT PRIMARY KEY CHECK (user_id ~ '^[A-Za-z0-9_-]{8,128}$'),
  backup_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  consent_version TEXT,
  consent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT valid_backup_consent CHECK (
    NOT backup_enabled OR (consent_version IS NOT NULL AND consent_at IS NOT NULL)
  )
);

CREATE TABLE cloud_snapshots (
  user_id TEXT PRIMARY KEY REFERENCES cloud_users(user_id) ON DELETE CASCADE,
  revision BIGINT NOT NULL CHECK (revision > 0),
  digest TEXT NOT NULL CHECK (digest ~ '^[0-9a-f]{64}$'),
  records JSONB NOT NULL CHECK (jsonb_typeof(records) = 'object'),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE cloud_upload_receipts (
  user_id TEXT NOT NULL REFERENCES cloud_users(user_id) ON DELETE CASCADE,
  idempotency_key TEXT NOT NULL CHECK (idempotency_key ~ '^[A-Za-z0-9_-]{8,128}$'),
  request_digest TEXT NOT NULL CHECK (request_digest ~ '^[0-9a-f]{64}$'),
  revision BIGINT NOT NULL CHECK (revision > 0),
  digest TEXT NOT NULL CHECK (digest ~ '^[0-9a-f]{64}$'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(user_id,idempotency_key)
);

CREATE TABLE cloud_staff (
  staff_id TEXT PRIMARY KEY CHECK (staff_id ~ '^[A-Za-z0-9_-]{8,128}$'),
  role TEXT NOT NULL CHECK (role IN ('support','safety_reviewer','super_admin','auditor')),
  active BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE cloud_access_cases (
  case_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES cloud_users(user_id) ON DELETE RESTRICT,
  purpose TEXT NOT NULL CHECK (purpose IN ('support_ticket','necessary_safety_review')),
  status TEXT NOT NULL CHECK (status IN ('open','closed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE cloud_access_grants (
  grant_id TEXT PRIMARY KEY,
  staff_id TEXT NOT NULL REFERENCES cloud_staff(staff_id) ON DELETE RESTRICT,
  case_id TEXT NOT NULL REFERENCES cloud_access_cases(case_id) ON DELETE RESTRICT,
  owner_id TEXT NOT NULL REFERENCES cloud_users(user_id) ON DELETE RESTRICT,
  purpose TEXT NOT NULL CHECK (purpose IN ('support_ticket','necessary_safety_review')),
  day_keys TEXT[] NOT NULL CHECK (cardinality(day_keys) BETWEEN 1 AND 31),
  starts_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  approved_by TEXT NOT NULL REFERENCES cloud_staff(staff_id) ON DELETE RESTRICT,
  revoked_at TIMESTAMPTZ,
  CONSTRAINT different_approver CHECK (approved_by <> staff_id),
  CONSTRAINT short_grant CHECK (
    expires_at > starts_at AND expires_at <= starts_at + interval '2 hours'
  )
);

CREATE INDEX cloud_grants_lookup_idx ON cloud_access_grants(staff_id,owner_id,case_id);
CREATE INDEX cloud_grants_by_expiry_idx ON cloud_access_grants(expires_at);

-- No private note text or JSON backup is stored in this table.
CREATE TABLE cloud_admin_audit (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  staff_id TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  day_key TEXT NOT NULL,
  case_id TEXT,
  grant_id TEXT,
  action TEXT NOT NULL DEFAULT 'read_private_record'
    CHECK (action='read_private_record'),
  decision TEXT NOT NULL CHECK (decision IN ('allow','deny')),
  reason TEXT NOT NULL,
  at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX cloud_audit_actor_idx ON cloud_admin_audit(staff_id,at DESC);

-- Additional defense: ordinary SQL UPDATE and DELETE must not alter audit history.
-- A real deployment MUST also use a non-owner/non-superuser runtime role without
-- TRUNCATE / ALTER / DROP privileges and protect off-site audit storage.
CREATE FUNCTION forbid_cloud_audit_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Audit history is append-only';
END;
$$;
CREATE TRIGGER cloud_audit_no_update_delete
BEFORE UPDATE OR DELETE ON cloud_admin_audit
FOR EACH ROW EXECUTE FUNCTION forbid_cloud_audit_mutation();

COMMIT;
