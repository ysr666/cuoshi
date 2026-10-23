-- Sole human administrator: durable SQL rate limiting and one-use TOTP step.
-- No employee creation, extra human approver, password storage or private note reads.
BEGIN;
CREATE TABLE __SCHEMA__.cloud_owner_login_windows (
  scope TEXT NOT NULL CHECK(scope IN ('global','peer')),
  digest TEXT NOT NULL CHECK(digest ~ '^[a-f0-9]{64}$'),
  window_5m BIGINT NOT NULL,
  attempts INTEGER NOT NULL CHECK(attempts BETWEEN 1 AND 30),
  PRIMARY KEY(scope,digest,window_5m)
);
REVOKE ALL ON __SCHEMA__.cloud_owner_login_windows FROM PUBLIC;

CREATE FUNCTION __SCHEMA__.cloud_take_owner_login_slot(p_digest TEXT)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,pg_temp AS $fn$
DECLARE v_window BIGINT;v_count INTEGER;
BEGIN
 IF p_digest IS NULL OR p_digest !~ '^[a-f0-9]{64}$' THEN
   RAISE EXCEPTION 'invalid owner login peer';
 END IF;
 v_window:=floor(extract(epoch FROM clock_timestamp())/300)::BIGINT;
 BEGIN
   INSERT INTO __SCHEMA__.cloud_owner_login_windows(scope,digest,window_5m,attempts)
   VALUES ('global',repeat('0',64),v_window,1)
   ON CONFLICT(scope,digest,window_5m)
     DO UPDATE SET attempts=cloud_owner_login_windows.attempts+1
     WHERE cloud_owner_login_windows.attempts<30
   RETURNING attempts INTO v_count;
   IF v_count IS NULL THEN RAISE EXCEPTION USING ERRCODE='P0801';END IF;
   v_count:=NULL;
   INSERT INTO __SCHEMA__.cloud_owner_login_windows(scope,digest,window_5m,attempts)
   VALUES ('peer',p_digest,v_window,1)
   ON CONFLICT(scope,digest,window_5m)
     DO UPDATE SET attempts=cloud_owner_login_windows.attempts+1
     WHERE cloud_owner_login_windows.attempts<5
   RETURNING attempts INTO v_count;
   IF v_count IS NULL THEN RAISE EXCEPTION USING ERRCODE='P0801';END IF;
 EXCEPTION WHEN SQLSTATE 'P0801' THEN RETURN FALSE;
 END;
 RETURN TRUE;
END;
$fn$;
REVOKE ALL ON FUNCTION __SCHEMA__.cloud_take_owner_login_slot(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION __SCHEMA__.cloud_take_owner_login_slot(TEXT) TO __ADMIN_ROLE__;

CREATE TABLE __SCHEMA__.cloud_owner_totp_steps (
  owner_id TEXT PRIMARY KEY,
  last_step BIGINT NOT NULL,
  consumed_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
REVOKE ALL ON __SCHEMA__.cloud_owner_totp_steps FROM PUBLIC;
CREATE FUNCTION __SCHEMA__.cloud_consume_owner_totp_step(p_owner TEXT,p_step BIGINT)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,pg_temp AS $fn$
DECLARE v_count INTEGER;
BEGIN
 IF p_owner IS NULL OR p_owner !~ '^[A-Za-z0-9_-]{8,128}$'
    OR p_step IS NULL OR p_step<0 THEN RETURN FALSE;END IF;
 IF NOT EXISTS(SELECT 1 FROM __SCHEMA__.cloud_staff s
   WHERE s.staff_id=p_owner AND s.active IS TRUE AND s.role='super_admin')
   THEN RETURN FALSE;END IF;
 INSERT INTO __SCHEMA__.cloud_owner_totp_steps(owner_id,last_step)
 VALUES(p_owner,p_step)
 ON CONFLICT(owner_id) DO UPDATE SET
   last_step=EXCLUDED.last_step,consumed_at=clock_timestamp()
 WHERE cloud_owner_totp_steps.last_step<EXCLUDED.last_step;
 GET DIAGNOSTICS v_count=ROW_COUNT;
 RETURN v_count=1;
END;
$fn$;
REVOKE ALL ON FUNCTION __SCHEMA__.cloud_consume_owner_totp_step(TEXT,BIGINT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION __SCHEMA__.cloud_consume_owner_totp_step(TEXT,BIGINT) TO __ADMIN_ROLE__;

CREATE FUNCTION __SCHEMA__.cloud_prune_owner_login_windows()
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,pg_temp AS $fn$
DECLARE v_deleted INTEGER;
BEGIN
 DELETE FROM __SCHEMA__.cloud_owner_login_windows WHERE window_5m<
   floor(extract(epoch FROM clock_timestamp())/300)::BIGINT-288;
 GET DIAGNOSTICS v_deleted=ROW_COUNT;
 RETURN v_deleted;
END;
$fn$;
REVOKE ALL ON FUNCTION __SCHEMA__.cloud_prune_owner_login_windows() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION __SCHEMA__.cloud_prune_owner_login_windows() TO __MAINTENANCE_ROLE__;
COMMIT;
