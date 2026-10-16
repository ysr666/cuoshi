-- Future WeChat account bootstrap. Migration credentials are NOT app credentials.
-- This schema stores irreversible keyed digests of WeChat openid and login codes.
-- Runtime auth role has NO private backup records or administrator audit privileges.
BEGIN;

CREATE TABLE __SCHEMA__.cloud_wechat_identities (
  app_id TEXT NOT NULL CHECK (app_id ~ '^wx[A-Za-z0-9]{16}$'),
  subject_digest TEXT NOT NULL CHECK (subject_digest ~ '^[a-f0-9]{64}$'),
  user_id TEXT NOT NULL REFERENCES __SCHEMA__.cloud_users(user_id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (app_id,subject_digest),
  UNIQUE (app_id,user_id)
);

CREATE TABLE __SCHEMA__.cloud_consumed_wechat_codes (
  code_digest TEXT PRIMARY KEY CHECK (code_digest ~ '^[a-f0-9]{64}$'),
  used_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

GRANT USAGE ON SCHEMA __SCHEMA__ TO __AUTH_ROLE__;
GRANT SELECT,INSERT ON __SCHEMA__.cloud_users TO __AUTH_ROLE__;
GRANT SELECT,INSERT ON __SCHEMA__.cloud_wechat_identities TO __AUTH_ROLE__;
GRANT INSERT,SELECT ON __SCHEMA__.cloud_consumed_wechat_codes TO __AUTH_ROLE__;

-- Never GRANT identity role access to cloud_snapshots, cloud_admin_audit, or
-- the security-definer cloud_read_day function.
COMMIT;
