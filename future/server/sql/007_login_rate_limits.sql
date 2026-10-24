-- Login abuse prevention shared across HTTP worker processes.
-- Apply only as the migration owner. The runtime identity role receives
-- EXECUTE on a bounded atomic gate, never SELECT of peer identifiers.
BEGIN;
CREATE TABLE __SCHEMA__.cloud_wechat_login_rate_windows (
  scope TEXT NOT NULL CHECK (scope IN ('global','peer')),
  peer_digest TEXT NOT NULL CHECK (peer_digest ~ '^[0-9a-f]{64}$'),
  minute_window BIGINT NOT NULL,
  attempts INTEGER NOT NULL CHECK (attempts BETWEEN 1 AND 200),
  PRIMARY KEY(scope,peer_digest,minute_window)
);
REVOKE ALL ON __SCHEMA__.cloud_wechat_login_rate_windows FROM PUBLIC;

CREATE FUNCTION __SCHEMA__.cloud_take_wechat_login_slot(p_digest TEXT)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  v_minute BIGINT;
  v_attempts INTEGER;
BEGIN
  IF p_digest IS NULL OR p_digest !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'invalid login peer digest';
  END IF;
  v_minute := floor(extract(epoch FROM clock_timestamp()) / 60)::BIGINT;
  -- The exception block rolls back BOTH increments when either cap is hit.
  -- PostgreSQL's UPSERT row lock serializes concurrent attempts on each cap;
  -- independent Node workers cannot bypass the database window.
  BEGIN
    INSERT INTO __SCHEMA__.cloud_wechat_login_rate_windows
      (scope,peer_digest,minute_window,attempts)
    VALUES ('global',repeat('0',64),v_minute,1)
    ON CONFLICT(scope,peer_digest,minute_window)
      DO UPDATE SET attempts=cloud_wechat_login_rate_windows.attempts+1
      WHERE cloud_wechat_login_rate_windows.attempts < 200
    RETURNING attempts INTO v_attempts;
    IF v_attempts IS NULL THEN RAISE EXCEPTION USING ERRCODE='P0701'; END IF;
    v_attempts := NULL;
    INSERT INTO __SCHEMA__.cloud_wechat_login_rate_windows
      (scope,peer_digest,minute_window,attempts)
    VALUES ('peer',p_digest,v_minute,1)
    ON CONFLICT(scope,peer_digest,minute_window)
      DO UPDATE SET attempts=cloud_wechat_login_rate_windows.attempts+1
      WHERE cloud_wechat_login_rate_windows.attempts < 12
    RETURNING attempts INTO v_attempts;
    IF v_attempts IS NULL THEN RAISE EXCEPTION USING ERRCODE='P0701'; END IF;
  EXCEPTION WHEN SQLSTATE 'P0701' THEN
    RETURN FALSE;
  END;
  RETURN TRUE;
END;
$function$;
REVOKE ALL ON FUNCTION __SCHEMA__.cloud_take_wechat_login_slot(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION __SCHEMA__.cloud_take_wechat_login_slot(TEXT) TO __AUTH_ROLE__;
-- Retain at most 24 hours of coarse, pseudonymous attempt counts. Auth
-- cannot erase windows; maintenance can execute only this bounded cleanup.
CREATE FUNCTION __SCHEMA__.cloud_prune_wechat_login_windows()
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE v_deleted INTEGER;
BEGIN
  DELETE FROM __SCHEMA__.cloud_wechat_login_rate_windows
  WHERE minute_window < floor(extract(epoch FROM clock_timestamp())/60)::BIGINT - 1440;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$function$;
REVOKE ALL ON FUNCTION __SCHEMA__.cloud_prune_wechat_login_windows() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION __SCHEMA__.cloud_prune_wechat_login_windows()
  TO __MAINTENANCE_ROLE__;
COMMIT;
