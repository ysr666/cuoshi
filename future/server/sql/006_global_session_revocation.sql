-- FUTURE backend: force all devices to reauthenticate.
-- Must run after migrations 001-005. Never execute from a mini-program.
BEGIN;
ALTER TABLE __SCHEMA__.cloud_users ADD COLUMN session_generation BIGINT
  NOT NULL DEFAULT 0 CHECK(session_generation>=0);
-- Production must add further tenant binding/RLS to prevent a compromised
-- backup-role credential from invalidating unrelated accounts.
GRANT UPDATE(session_generation) ON __SCHEMA__.cloud_users TO __BACKUP_ROLE__;
COMMIT;
