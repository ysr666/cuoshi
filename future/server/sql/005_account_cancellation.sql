-- Account cancellation and privacy-preserving operational retention.
-- Isolated FUTURE backend: no public route, live login or live user data.
-- Migration owner renders validated SQL identifiers __SCHEMA__ / __DELETION_ROLE__
-- / __MAINTENANCE_ROLE__ / __REPORTING_ROLE__. Neither role is a superuser nor owns this schema.
BEGIN;

ALTER TABLE __SCHEMA__.cloud_users ADD COLUMN deleted_at TIMESTAMPTZ;
CREATE INDEX cloud_users_deleted_at_idx ON __SCHEMA__.cloud_users(deleted_at)
  WHERE deleted_at IS NOT NULL;

-- Retain ONLY non-identifying backend operational totals, never a user ID,
-- original note, exact history, raw openid, phone or authenticated session.
CREATE TABLE __SCHEMA__.cloud_account_deletion_totals (
  period DATE PRIMARY KEY,
  accounts_deleted BIGINT NOT NULL DEFAULT 0 CHECK (accounts_deleted>=0),
  snapshots_erased BIGINT NOT NULL DEFAULT 0 CHECK (snapshots_erased>=0)
);

-- This existing append-only audit table is scrubbed during account deletion.
-- Only an irreversible redaction of identifying fields is allowed, and only
-- the protected SQL function is granted to the separate deletion role.
CREATE OR REPLACE FUNCTION __SCHEMA__.forbid_cloud_audit_mutation()
RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $fn$
BEGIN
  IF TG_OP='UPDATE'
    AND OLD.owner_id<>'redacted'
    AND NEW.owner_id='redacted'
    AND NEW.day_key='redacted'
    AND NEW.case_id IS NULL
    AND NEW.grant_id IS NULL
    AND NEW.id=OLD.id
    AND NEW.staff_id=OLD.staff_id
    AND NEW.action=OLD.action
    AND NEW.decision=OLD.decision
    AND NEW.reason=OLD.reason
    AND NEW.at=OLD.at
  THEN RETURN NEW;
  END IF;
  RAISE EXCEPTION 'Audit history is append-only except irreversible owner redaction';
END;
$fn$;

CREATE FUNCTION __SCHEMA__.cloud_cancel_account(p_user_id TEXT)
RETURNS TABLE(deleted BOOLEAN, redacted_audits INTEGER, had_snapshot BOOLEAN)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,pg_temp AS $fn$
DECLARE
  v_deleted TIMESTAMPTZ;
  v_found BOOLEAN;
  v_count INTEGER := 0;
  v_had_snapshot BOOLEAN := FALSE;
BEGIN
  IF p_user_id IS NULL OR p_user_id !~ '^[A-Za-z0-9_-]{8,128}$'
    THEN RAISE EXCEPTION 'invalid_account_identity';
  END IF;

  -- Lock against concurrent uploads and opt-in/out; no soft-deleted account
  -- may be restored by reusing its old signed JWT.
  SELECT TRUE,u.deleted_at INTO v_found,v_deleted
  FROM __SCHEMA__.cloud_users AS u WHERE u.user_id=p_user_id FOR UPDATE;
  IF v_found IS DISTINCT FROM TRUE OR v_deleted IS NOT NULL
    THEN RAISE EXCEPTION 'account_already_closed';
  END IF;

  SELECT EXISTS(SELECT 1 FROM __SCHEMA__.cloud_snapshots WHERE user_id=p_user_id)
    INTO v_had_snapshot;

  UPDATE __SCHEMA__.cloud_users SET
    backup_enabled=FALSE, consent_version=NULL, consent_at=NULL,
    deleted_at=clock_timestamp()
    WHERE user_id=p_user_id;

  -- Referencing cases use RESTRICT foreign keys: revoke grants before cases.
  DELETE FROM __SCHEMA__.cloud_access_grants WHERE owner_id=p_user_id;
  DELETE FROM __SCHEMA__.cloud_access_cases WHERE owner_id=p_user_id;
  DELETE FROM __SCHEMA__.cloud_wechat_identities WHERE user_id=p_user_id;
  DELETE FROM __SCHEMA__.cloud_upload_receipts WHERE user_id=p_user_id;
  DELETE FROM __SCHEMA__.cloud_revoked_backup_tokens WHERE subject_id=p_user_id;
  DELETE FROM __SCHEMA__.cloud_snapshots WHERE user_id=p_user_id;

  -- No owner identifier or private date remains in operational audit entries.
  -- The staff's accountability, action, reason and result are retained.
  UPDATE __SCHEMA__.cloud_admin_audit
    SET owner_id='redacted',day_key='redacted',case_id=NULL,grant_id=NULL
    WHERE owner_id=p_user_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;

  INSERT INTO __SCHEMA__.cloud_account_deletion_totals
    (period,accounts_deleted,snapshots_erased)
  VALUES (date_trunc('month',clock_timestamp() AT TIME ZONE 'UTC')::date,1,
          CASE WHEN v_had_snapshot THEN 1 ELSE 0 END)
  ON CONFLICT (period) DO UPDATE SET
    accounts_deleted=__SCHEMA__.cloud_account_deletion_totals.accounts_deleted+1,
    snapshots_erased=__SCHEMA__.cloud_account_deletion_totals.snapshots_erased+
      EXCLUDED.snapshots_erased;

  RETURN QUERY SELECT TRUE,v_count,v_had_snapshot;
END;
$fn$;

REVOKE ALL ON FUNCTION __SCHEMA__.cloud_cancel_account(TEXT) FROM PUBLIC;
GRANT USAGE ON SCHEMA __SCHEMA__ TO __DELETION_ROLE__;
GRANT EXECUTE ON FUNCTION __SCHEMA__.cloud_cancel_account(TEXT)
  TO __DELETION_ROLE__;

-- A separately authorized maintenance task may erase minimal old-user
-- tombstones once all 15m bearer sessions have expired. 24h is a safety
-- interval, NOT a legal retention period for user content (content already
-- erased in the same cancellation transaction).
CREATE FUNCTION __SCHEMA__.cloud_purge_old_tombstones()
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,pg_temp AS $fn$
DECLARE v_count INTEGER := 0;
BEGIN
  DELETE FROM __SCHEMA__.cloud_users
  WHERE deleted_at IS NOT NULL AND
        deleted_at < clock_timestamp()-interval '24 hours';
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$fn$;
REVOKE ALL ON FUNCTION __SCHEMA__.cloud_purge_old_tombstones() FROM PUBLIC;
GRANT USAGE ON SCHEMA __SCHEMA__ TO __MAINTENANCE_ROLE__;
GRANT EXECUTE ON FUNCTION __SCHEMA__.cloud_purge_old_tombstones()
  TO __MAINTENANCE_ROLE__;

-- A separate read-only reporting login may see coarse monthly counts, never
-- account IDs, private notes, WeChat mappings or per-user security audits.
GRANT USAGE ON SCHEMA __SCHEMA__ TO __REPORTING_ROLE__;
GRANT SELECT ON __SCHEMA__.cloud_account_deletion_totals TO __REPORTING_ROLE__;

-- One aggregate row for the operations dashboard. The reporting login gets
-- EXECUTE only, NOT SELECT on cloud_users, snapshots, identity or note JSON.
-- "Recently updated" is NOT a proven upload success rate or daily activity.
CREATE FUNCTION __SCHEMA__.cloud_reporting_overview()
RETURNS TABLE (
  total_accounts BIGINT,
  cloud_enabled_accounts BIGINT,
  stored_snapshots BIGINT,
  snapshots_updated_7d BIGINT,
  accounts_created_7d BIGINT
)
LANGUAGE sql SECURITY DEFINER
SET search_path=pg_catalog,pg_temp
AS $fn$
  SELECT
    (SELECT count(*) FROM __SCHEMA__.cloud_users u WHERE u.deleted_at IS NULL),
    (SELECT count(*) FROM __SCHEMA__.cloud_users u
     WHERE u.deleted_at IS NULL AND u.backup_enabled IS TRUE),
    (SELECT count(*) FROM __SCHEMA__.cloud_snapshots s
     JOIN __SCHEMA__.cloud_users u ON u.user_id=s.user_id
     WHERE u.deleted_at IS NULL),
    (SELECT count(*) FROM __SCHEMA__.cloud_snapshots s
     JOIN __SCHEMA__.cloud_users u ON u.user_id=s.user_id
     WHERE u.deleted_at IS NULL AND s.updated_at>=clock_timestamp()-interval '7 days'),
    (SELECT count(*) FROM __SCHEMA__.cloud_users u
     WHERE u.deleted_at IS NULL AND u.created_at>=clock_timestamp()-interval '7 days');
$fn$;
REVOKE ALL ON FUNCTION __SCHEMA__.cloud_reporting_overview() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION __SCHEMA__.cloud_reporting_overview()
  TO __REPORTING_ROLE__;

-- Expired opaque authentication artifacts have no indefinite retention.
CREATE FUNCTION __SCHEMA__.cloud_purge_expired_auth_artifacts()
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,pg_temp AS $fn$
DECLARE v_one INTEGER := 0;v_two INTEGER := 0;v_three INTEGER := 0;
BEGIN
  DELETE FROM __SCHEMA__.cloud_consumed_wechat_codes
    WHERE used_at<clock_timestamp()-interval '24 hours';
  GET DIAGNOSTICS v_one=ROW_COUNT;
  DELETE FROM __SCHEMA__.cloud_revoked_backup_tokens
    WHERE expires_at<clock_timestamp()-interval '1 hour';
  GET DIAGNOSTICS v_two=ROW_COUNT;
  DELETE FROM __SCHEMA__.cloud_revoked_staff_tokens
    WHERE expires_at<clock_timestamp()-interval '1 hour';
  GET DIAGNOSTICS v_three=ROW_COUNT;
  RETURN v_one+v_two+v_three;
END;
$fn$;
REVOKE ALL ON FUNCTION __SCHEMA__.cloud_purge_expired_auth_artifacts() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION __SCHEMA__.cloud_purge_expired_auth_artifacts()
  TO __MAINTENANCE_ROLE__;

-- The deletion role can execute cancellation only; it cannot query private
-- records or statistics or alter the audit. The schema owner remains trusted.
COMMIT;
