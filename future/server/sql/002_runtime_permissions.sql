-- TEMPLATE: migration owner supplies a trusted schema and pre-created LOGIN roles.
-- Replace __SCHEMA__, __BACKUP_ROLE__, __ADMIN_ROLE__ with validated SQL identifiers.
-- Never use identifiers supplied by an HTTP client.
BEGIN;

-- The application roles do not own any tables, schemas, triggers, or functions.
GRANT USAGE ON SCHEMA __SCHEMA__ TO __BACKUP_ROLE__, __ADMIN_ROLE__;

GRANT SELECT,INSERT ON __SCHEMA__.cloud_users TO __BACKUP_ROLE__;
GRANT UPDATE(backup_enabled,consent_version,consent_at)
  ON __SCHEMA__.cloud_users TO __BACKUP_ROLE__;
GRANT SELECT,INSERT,UPDATE,DELETE ON __SCHEMA__.cloud_snapshots TO __BACKUP_ROLE__;
GRANT SELECT,INSERT,DELETE ON __SCHEMA__.cloud_upload_receipts TO __BACKUP_ROLE__;

-- Admin runtime does not receive SELECT on cloud_snapshots, cloud_users,
-- cloud_access_grants or cloud_admin_audit. No legacy private-note read execution privileges.
CREATE FUNCTION __SCHEMA__.cloud_read_day(
  p_staff_id TEXT, p_mfa_verified BOOLEAN, p_owner_id TEXT,
  p_day_key TEXT, p_case_id TEXT
)
RETURNS TABLE(allowed BOOLEAN, reason TEXT, day JSONB, events JSONB)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  v_role TEXT;
  v_staff_active BOOLEAN := FALSE;
  v_case RECORD;
  v_grant RECORD;
  v_enabled BOOLEAN := FALSE;
  v_reason TEXT := 'approved';
  v_now TIMESTAMPTZ := clock_timestamp();
  v_snapshot JSONB;
BEGIN
  IF p_staff_id IS NULL OR p_owner_id IS NULL OR p_case_id IS NULL
     OR p_day_key !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
     OR length(p_staff_id)>128 OR length(p_owner_id)>128 OR length(p_case_id)>128
  THEN
    RAISE EXCEPTION 'invalid access request';
  END IF;

  SELECT s.role,s.active INTO v_role,v_staff_active
  FROM __SCHEMA__.cloud_staff AS s WHERE s.staff_id=p_staff_id;
  -- Lock cases/grants for the duration of the read to avoid a concurrent revoke
  -- or case closure racing past the policy check.
  SELECT c.case_id,c.owner_id,c.purpose,c.status INTO v_case
  FROM __SCHEMA__.cloud_access_cases AS c
  WHERE c.case_id=p_case_id FOR SHARE;
  SELECT g.grant_id,g.staff_id,g.case_id,g.owner_id,g.purpose,g.day_keys,
         g.starts_at,g.expires_at,g.approved_by,g.revoked_at INTO v_grant
  FROM __SCHEMA__.cloud_access_grants AS g
  WHERE g.staff_id=p_staff_id AND g.owner_id=p_owner_id AND g.case_id=p_case_id
  ORDER BY g.starts_at DESC LIMIT 1 FOR SHARE;
  SELECT u.backup_enabled INTO v_enabled
  FROM __SCHEMA__.cloud_users AS u WHERE u.user_id=p_owner_id FOR SHARE;

  IF v_staff_active IS DISTINCT FROM TRUE OR
     v_role NOT IN ('support','safety_reviewer') OR v_role IS NULL THEN
    v_reason := 'staff_role';
  ELSIF p_mfa_verified IS DISTINCT FROM TRUE THEN
    v_reason := 'mfa_required';
  ELSIF v_case.case_id IS NULL THEN
    v_reason := 'no_case';
  ELSIF v_case.status<>'open' THEN
    v_reason := 'case_closed';
  ELSIF v_case.owner_id<>p_owner_id OR
     (v_role='support' AND v_case.purpose<>'support_ticket') OR
     (v_role='safety_reviewer' AND v_case.purpose<>'necessary_safety_review') THEN
    v_reason := 'case_mismatch';
  ELSIF v_grant.grant_id IS NULL THEN
    v_reason := 'no_grant';
  ELSIF v_grant.revoked_at IS NOT NULL THEN
    v_reason := 'revoked';
  ELSIF v_grant.approved_by=p_staff_id OR NOT EXISTS(
    SELECT 1 FROM __SCHEMA__.cloud_staff AS a
    WHERE a.staff_id=v_grant.approved_by AND a.active AND a.role='super_admin'
  ) THEN
    v_reason := 'self_approved';
  ELSIF v_grant.purpose<>v_case.purpose THEN
    v_reason := 'grant_mismatch';
  ELSIF NOT p_day_key=ANY(v_grant.day_keys) THEN
    v_reason := 'scope_denied';
  ELSIF v_now<v_grant.starts_at THEN
    v_reason := 'not_yet_valid';
  ELSIF v_now>=v_grant.expires_at OR
    v_grant.expires_at>v_grant.starts_at+interval '2 hours' THEN
    v_reason := 'expired';
  ELSIF v_enabled IS DISTINCT FROM TRUE THEN
    v_reason := 'consent_required';
  END IF;

  -- A failed audit INSERT aborts this function's entire statement before any
  -- plaintext is returned. No note body or backup JSON is written to audit.
  INSERT INTO __SCHEMA__.cloud_admin_audit
    (staff_id,owner_id,day_key,case_id,grant_id,decision,reason)
  VALUES (p_staff_id,p_owner_id,p_day_key,p_case_id,v_grant.grant_id,
          CASE WHEN v_reason='approved' THEN 'allow' ELSE 'deny' END,v_reason);

  IF v_reason='approved' THEN
    SELECT s.records INTO v_snapshot
    FROM __SCHEMA__.cloud_snapshots AS s WHERE s.user_id=p_owner_id;
    RETURN QUERY SELECT TRUE,v_reason,
      v_snapshot->'days'->p_day_key,
      COALESCE(
        (SELECT jsonb_agg(e) FROM jsonb_array_elements(v_snapshot->'events') AS e
         WHERE e->>'targetDate'=p_day_key),
        '[]'::jsonb);
  ELSE
    RETURN QUERY SELECT FALSE,v_reason,NULL::jsonb,'[]'::jsonb;
  END IF;
END;
$function$;

-- DEPRECATED historical scoped-day implementation is retained in the
-- migration for audit/reference compatibility, but it MUST NOT be callable
-- by the v0.5 sole-owner runtime role (or any other runtime role). No employee
-- or private-note-read API is available in the v0.5 deployed owner host.
REVOKE ALL ON FUNCTION __SCHEMA__.cloud_read_day(TEXT,BOOLEAN,TEXT,TEXT,TEXT)
  FROM PUBLIC, __ADMIN_ROLE__;

-- No privilege to TRUNCATE, ALTER, DROP, CREATE on the trusted schema or
-- mutate the append-only audit data is given to either runtime account.
COMMIT;
