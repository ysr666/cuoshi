/** Real PostgreSQL integration. Uses ONLY an explicit localhost test database. */
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {execFileSync} from 'node:child_process'
import {mkdtempSync,mkdirSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join,resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {validateMigrationConfig,renderMigration} from '../deploy/render-migrations.mjs'
import {checkRealPostgresRestore} from './check-restore-drill.mjs'
import crypto from 'node:crypto'
import {createServer} from 'node:http'
const root=fileURLToPath(new URL('../../../',import.meta.url))
const require=createRequire(new URL('../package.json',import.meta.url))
const {Pool}=require('pg')
const source=process.env.CUOSHI_TEST_POSTGRES_URL
if(!source)throw Error('Set CUOSHI_TEST_POSTGRES_URL to a disposable local PostgreSQL instance')
const target=new URL(source)
if(!['localhost','127.0.0.1','::1','[::1]'].includes(target.hostname))
  throw Error('Refusing to run integration tests outside localhost')
const schema='cuoshi_it_'+crypto.randomBytes(5).toString('hex')
const temp=mkdtempSync(join(tmpdir(),'cuoshi-real-pg-'))
let checks=0
const check=(x,why)=>{assert.ok(x,why);checks++}
const basePool=new Pool({connectionString:source,max:4})
let pool,backupPool,adminPool,identityPool,deletionPool,maintenancePool,reportingPool
const suffix=schema.slice(-10)
const backupRole='cuoshi_b_'+suffix,adminRole='cuoshi_a_'+suffix
const identityRole='cuoshi_i_'+suffix
const deletionRole='cuoshi_d_'+suffix,maintenanceRole='cuoshi_m_'+suffix
const reportingRole='cuoshi_r_'+suffix
// Exercise the exact same SQL renderer operators will use to deploy:
// synthetic PG integration can no longer pass a hand-substituted template
// while a separate production renderer silently breaks privileges/schema.
const sqlVars=validateMigrationConfig({
 CUOSHI_PG_SCHEMA:schema,
 CUOSHI_PG_BACKUP_ROLE:backupRole,CUOSHI_PG_ADMIN_ROLE:adminRole,
 CUOSHI_PG_AUTH_ROLE:identityRole,CUOSHI_PG_DELETION_ROLE:deletionRole,
 CUOSHI_PG_MAINTENANCE_ROLE:maintenanceRole,
 CUOSHI_PG_REPORTING_ROLE:reportingRole
})
let rolesInstalled=false
try{
  const out=join(temp,'build');mkdirSync(out)
  execFileSync(resolve(root,'node_modules/.bin/tsc'),[
    '--target','ES2022','--module','CommonJS','--moduleResolution','node',
    '--skipLibCheck','--strict','--rootDir',root,'--outDir',out,
    resolve(root,'future/server/src/repository.ts'),
    resolve(root,'future/server/src/adminRepository.ts'),
    resolve(root,'future/server/src/authenticatedService.ts'),
    resolve(root,'future/server/src/wechatIdentity.ts'),
    resolve(root,'future/server/src/accountCancellation.ts'),
    resolve(root,'future/server/src/deletionReporting.ts'),
    resolve(root,'future/server/src/operationalReporting.ts'),
    resolve(root,'future/cloud/initialMigration.ts'),
    resolve(root,'future/cloud/automaticSync.ts'),
    resolve(root,'future/server/src/backupHttp.ts'),
    resolve(root,'future/server/src/accountHttp.ts'),
    resolve(root,'future/server/src/cloudHttpHost.ts'),
    resolve(root,'future/server/src/trustedEdge.ts'),
    resolve(root,'future/server/src/loginRateLimiter.ts'),
    resolve(root,'future/server/src/privateConfig.ts'),
    resolve(root,'future/server/src/privateReadiness.ts'),
    resolve(root,'future/server/src/privateStaffReadiness.ts'),
    resolve(root,'future/server/src/privateMaintenance.ts'),
    resolve(root,'future/server/src/privateHealth.ts')
  ],{cwd:root,stdio:'pipe'})
  const m=require(join(out,'src/core/model.js'))
  const {
    previewInitialMigration,prepareInitialMigration,verifyInitialMigration,
    INITIAL_MIGRATION_CONFIRMATION
  }=require(join(out,'future/cloud/initialMigration.js'))
  const {createLinkedJournal,runAutomaticSyncOnce}=require(join(out,'future/cloud/automaticSync.js'))
  const {createBackupHttpHandler}=require(join(out,'future/server/src/backupHttp.js'))
  const {listenCloudLoopbackForQa,listenPrivateEdgeLoopback}=require(join(out,'future/server/src/cloudHttpHost.js'))
  const {createTrustedEdgeBoundary}=require(join(out,'future/server/src/trustedEdge.js'))
  const {privatePoolConnectionOptions}=require(join(out,'future/server/src/privateConfig.js'))
  const {checkPrivateDatabaseReadiness}=require(join(out,'future/server/src/privateReadiness.js'))
  const {checkPrivateStaffReadiness}=require(join(out,'future/server/src/privateStaffReadiness.js'))
  const {prunePrivateLoginWindows,runPrivateRetentionCycle}=require(join(out,'future/server/src/privateMaintenance.js'))
  const {createPrivateHealthProbe}=require(join(out,'future/server/src/privateHealth.js'))
  const {createPostgresWechatLoginLimiter}=require(join(out,'future/server/src/loginRateLimiter.js'))
  const repository=require(join(out,'future/server/src/repository.js'))
  const admin=require(join(out,'future/server/src/adminRepository.js'))
  const {AuthenticatedCloudService}=require(join(out,'future/server/src/authenticatedService.js'))
  const {issueServerSession,verifyServerSession}=require(join(out,'future/server/src/sessionTokens.js'))
  const {loginWithWechatCode,makeWechatCodeExchanger}=require(join(out,'future/server/src/wechatIdentity.js'))
  const {ACCOUNT_DELETE_CONFIRMATION}=require(join(out,'future/server/src/accountCancellation.js'))
  const {readAnonymousDeletionSummary}=require(join(out,'future/server/src/deletionReporting.js'))
  const {readAnonymousOperationalOverview}=require(join(out,'future/server/src/operationalReporting.js'))
  await basePool.query('CREATE SCHEMA "'+schema+'"')
  pool=new Pool({connectionString:source,options:'-c search_path='+schema,max:14})
  const ddl=renderMigration('001_initial.sql',sqlVars)
  await pool.query(ddl)

  // Every service operation below uses a separate non-owner, non-superuser DB
  // login. Role creation, migrations and seed fixtures remain with test owner.
  // PostgreSQL role password is an SQL utility field: use safely quoted,
  // program-generated hexadecimal test secrets and identifiers only.
  const backupSecret=crypto.randomBytes(24).toString('hex')
  const adminSecret=crypto.randomBytes(24).toString('hex')
  const identitySecret=crypto.randomBytes(24).toString('hex')
  const deletionSecret=crypto.randomBytes(24).toString('hex')
  const maintenanceSecret=crypto.randomBytes(24).toString('hex')
  const reportingSecret=crypto.randomBytes(24).toString('hex')
  for(const [role,secret] of [[backupRole,backupSecret],[adminRole,adminSecret],[identityRole,identitySecret],[deletionRole,deletionSecret],[maintenanceRole,maintenanceSecret],[reportingRole,reportingSecret]]){
    await basePool.query('CREATE ROLE "'+role+'" LOGIN PASSWORD \''+secret+'\'')
  }
  rolesInstalled=true
  // Apply all subsequent SQL in order, using exactly the audited templates.
  for(const name of [
    '002_runtime_permissions.sql','003_wechat_identity.sql',
    '004_session_revocation.sql','005_account_cancellation.sql',
    '006_global_session_revocation.sql','007_login_rate_limits.sql',
    '008_owner_admin_login.sql'
  ]){
    await pool.query(renderMigration(name,sqlVars))
  }
  function roleUrl(role,secret){
    const url=new URL(source)
    url.username=role
    url.password=secret
    return url.toString()
  }
  // Crucial production-startup regression: schemas are isolated, so a
  // runtime pool without an explicit schema cannot see private tables.
  const noSchemaPool=new Pool({connectionString:roleUrl(backupRole,backupSecret),max:1})
  try{
    const plain=await noSchemaPool.query("SELECT to_regclass('cloud_users') AS users")
    check(plain.rows[0]?.users===null,
      'Default PostgreSQL public search_path CANNOT find deployed cloud tables')
  }finally{await noSchemaPool.end()}
  backupPool=new Pool(privatePoolConnectionOptions(roleUrl(backupRole,backupSecret),schema,14))
  adminPool=new Pool(privatePoolConnectionOptions(roleUrl(adminRole,adminSecret),schema,6))
  identityPool=new Pool(privatePoolConnectionOptions(roleUrl(identityRole,identitySecret),schema,10))
  deletionPool=new Pool(privatePoolConnectionOptions(roleUrl(deletionRole,deletionSecret),schema,5))
  for(const selected of [backupPool,adminPool,identityPool,deletionPool]){
    const resolved=await selected.query(
      "SELECT current_schema() AS selected,to_regclass('cloud_users') AS users")
    check(resolved.rows[0]?.selected===schema&&resolved.rows[0]?.users,
      'Actual four production-pattern pools see expected private schema only')
  }
  maintenancePool=new Pool({connectionString:roleUrl(maintenanceRole,maintenanceSecret),
    options:'-c search_path='+schema,max:3})
  reportingPool=new Pool({connectionString:roleUrl(reportingRole,reportingSecret),
    options:'-c search_path='+schema,max:3})
  // Real production startup preflight now executes against genuine isolated
  // PostgreSQL and all four restricted runtime login roles, not test doubles.
  const bounded=await backupPool.query(`SELECT
    current_setting('statement_timeout') AS statement,
    current_setting('lock_timeout') AS lock,
    current_setting('idle_in_transaction_session_timeout') AS idle_tx`)
  check(bounded.rows[0].statement==='15s'&&
    bounded.rows[0].lock==='4s'&&bounded.rows[0].idle_tx==='10s',
    'Real PostgreSQL honors the production deadline, lock and idle transaction caps')
  const liveHealth=createPrivateHealthProbe([
    identityPool,backupPool,adminPool,deletionPool])
  check(await liveHealth()===true,
    'Production /healthz verifies four actual limited PostgreSQL pools')
  const brokenHealth=createPrivateHealthProbe([
    identityPool,backupPool,adminPool,{query:async()=>{throw Error('db unavailable')}}])
  check(await brokenHealth()===false,
    'Real PostgreSQL readiness refuses success if even one backend role goes away')
  const runtimeRoles={identityDb:identityPool,backupDb:backupPool,
    staffDb:adminPool,cancellationDb:deletionPool}
  await checkPrivateDatabaseReadiness(runtimeRoles,schema)
  await checkPrivateStaffReadiness(adminPool,reportingPool,schema)
  check(true,'Staff gateway verifies separated staff/reporting roles on real PostgreSQL')
  await assert.rejects(checkPrivateStaffReadiness(adminPool,adminPool,schema),
    /roles_not_separated/);checks++
  await assert.rejects(checkPrivateStaffReadiness(adminPool,pool,schema),
    /role_unsafe/);checks++
  check(true,'Real production pre-listener readiness approves four correct roles')
  await assert.rejects(checkPrivateDatabaseReadiness(
    {...runtimeRoles,staffDb:backupPool},schema),
    /private_cloud_database_roles_not_separated/);checks++
  await assert.rejects(checkPrivateDatabaseReadiness(
    {...runtimeRoles,identityDb:pool},schema),
    /private_cloud_database_role_unsafe/);checks++
  await assert.rejects(checkPrivateDatabaseReadiness(
    runtimeRoles,'wrong_schema'),
    /private_cloud_database_schema_missing/);checks++
  await assert.rejects(checkPrivateDatabaseReadiness(
    {...runtimeRoles,cancellationDb:null},schema),
    /private_cloud_database_connections_required/);checks++
  const attempt=async(rolePool,sql,params=[])=>{
    const c=await rolePool.connect()
    try{await assert.rejects(c.query(sql,params),/permission denied|must be owner|not owner/i);checks++}
    finally{c.release()}
  }
  await attempt(backupPool,'SELECT * FROM cloud_admin_audit')
  await attempt(backupPool,'SELECT * FROM cloud_staff')
  await attempt(adminPool,'SELECT records FROM cloud_snapshots')
  await attempt(adminPool,'DELETE FROM cloud_admin_audit')
  await attempt(adminPool,'TRUNCATE cloud_admin_audit')
  await attempt(adminPool,'UPDATE cloud_access_grants SET revoked_at=clock_timestamp()')
  await attempt(adminPool,'SELECT * FROM cloud_upload_receipts')
  await attempt(adminPool,'INSERT INTO cloud_admin_audit(staff_id,owner_id,day_key,decision,reason) VALUES(\'x\',\'y\',\'2026-10-16\',\'allow\',\'fake\')')
  await attempt(backupPool,"SELECT * FROM cloud_read_day('support0001',TRUE,'account0001','2026-10-16','ticket0001')")
  await attempt(identityPool,'SELECT * FROM cloud_wechat_login_rate_windows')
  await attempt(backupPool,'SELECT * FROM cloud_wechat_login_rate_windows')
  await attempt(adminPool,'SELECT * FROM cloud_wechat_login_rate_windows')
  await attempt(reportingPool,'SELECT * FROM cloud_wechat_login_rate_windows')
  await attempt(identityPool,'DELETE FROM cloud_wechat_login_rate_windows')
  await attempt(identityPool,'SELECT cloud_prune_wechat_login_windows()')
  await attempt(backupPool,"SELECT cloud_take_wechat_login_slot('"+'f'.repeat(64)+"')")
  await attempt(identityPool,'SELECT * FROM cloud_snapshots')
  await attempt(identityPool,'SELECT * FROM cloud_staff')
  await attempt(identityPool,'SELECT * FROM cloud_admin_audit')
  await attempt(identityPool,"DELETE FROM cloud_users WHERE user_id='account0001'")
  await attempt(identityPool,'SELECT * FROM cloud_revoked_backup_tokens')
  await attempt(backupPool,'SELECT * FROM cloud_revoked_staff_tokens')
  await attempt(adminPool,'SELECT * FROM cloud_revoked_backup_tokens')
  await attempt(backupPool,'DELETE FROM cloud_revoked_backup_tokens')
  await attempt(adminPool,'DELETE FROM cloud_revoked_staff_tokens')
  await attempt(backupPool,'SELECT * FROM cloud_wechat_identities')
  await attempt(adminPool,'SELECT * FROM cloud_wechat_identities')
  await attempt(backupPool,"SELECT * FROM cloud_cancel_account('account0001')")
  await attempt(adminPool,"SELECT * FROM cloud_cancel_account('account0001')")
  await attempt(identityPool,"SELECT * FROM cloud_cancel_account('account0001')")
  await attempt(deletionPool,'SELECT records FROM cloud_snapshots')
  await attempt(deletionPool,'SELECT * FROM cloud_admin_audit')
  await attempt(deletionPool,'SELECT * FROM cloud_account_deletion_totals')
  await attempt(deletionPool,'UPDATE cloud_admin_audit SET owner_id=\'redacted\'')
  await attempt(maintenancePool,'SELECT * FROM cloud_snapshots')
  await attempt(backupPool,'SELECT * FROM cloud_account_deletion_totals')
  await attempt(reportingPool,'SELECT * FROM cloud_snapshots')
  await attempt(reportingPool,'SELECT * FROM cloud_admin_audit')
  await attempt(reportingPool,'SELECT * FROM cloud_wechat_identities')
  await attempt(reportingPool,'SELECT * FROM cloud_users')
  await attempt(reportingPool,'SELECT * FROM cloud_reporting_audit')
  await attempt(adminPool,'SELECT * FROM cloud_reporting_audit')
  await attempt(backupPool,"SELECT * FROM cloud_reporting_overview('reporter01',TRUE)")
  await attempt(adminPool,"SELECT * FROM cloud_reporting_overview('reporter01',TRUE)")
  await attempt(identityPool,"SELECT * FROM cloud_reporting_overview('reporter01',TRUE)")
  await attempt(reportingPool,'SELECT * FROM cloud_revoked_backup_tokens')
  await attempt(deletionPool,'SELECT * FROM cloud_users')
  await attempt(reportingPool,"SELECT * FROM cloud_cancel_account('account0001')")
  await attempt(reportingPool,'DELETE FROM cloud_account_deletion_totals')
  check((await readAnonymousDeletionSummary(reportingPool)).length===0,
    'Reporting role sees no entries before any deletion')
  await pool.query("INSERT INTO cloud_staff(staff_id,role) VALUES('reporter01','auditor')")
  const initialOverview=await readAnonymousOperationalOverview(reportingPool,'reporter01',true)
  check(initialOverview.totalAccounts===0&&initialOverview.storedSnapshots===0,
    'Actual restricted reporting role sees no registered accounts initially')
  await assert.rejects(readAnonymousOperationalOverview(reportingPool,'reporter01',false),
    /operational_reporting_access_denied/);checks++
  await assert.rejects(readAnonymousOperationalOverview(reportingPool,'unknown01',true),
    /operational_reporting_access_denied/);checks++
  const auditRows=await pool.query("SELECT decision FROM cloud_reporting_audit WHERE staff_id='reporter01' ORDER BY id")
  check(auditRows.rows.length===2&&auditRows.rows[0].decision==='allow'&&
    auditRows.rows[1].decision==='deny',
    'Real database atomically audits both allowed and denied reporting requests')
  await assert.rejects(pool.query("DELETE FROM cloud_reporting_audit WHERE staff_id='reporter01'"),
    /append-only/i);checks++
  check(Object.keys(initialOverview).sort().join(',')===
    'accountsCreatedLast7d,cloudEnabledAccounts,snapshotsUpdatedLast7d,storedSnapshots,totalAccounts',
    'Overview exposes only five approved aggregate fields, no identifiers or note bodies')

  check((await pool.query('SELECT count(*) AS n FROM cloud_admin_audit')).rows[0].n==='0',
    'No privilege probing modified audit history')

  // Test-only keys and mocked verified issuer. No real WeChat or phone identity
  // is simulated as a production identity provider or logged to the console.
  const backupSigningKey=crypto.randomBytes(32)
  const staffSigningKey=crypto.randomBytes(32)
  const nowSeconds=()=>Math.floor(Date.now()/1000)
  const service=new AuthenticatedCloudService(backupPool,adminPool,
    {backupKey:backupSigningKey,staffKey:staffSigningKey},nowSeconds,deletionPool)
  const userToken=(userId,deviceId='device0001',issued=nowSeconds(),generation=0)=>
    issueServerSession({aud:'cuoshi-cloud-backup',sub:userId,deviceId,generation},backupSigningKey,issued)
  const staffToken=(staffId,mfaAt=nowSeconds()-10,issued=nowSeconds())=>
    issueServerSession({aud:'cuoshi-staff-admin',sub:staffId,mfaAt},staffSigningKey,issued)
  const tokenA=userToken('account0001')
  const tokenB=userToken('account0002','device0002')
  check((await service.provision(tokenA))===undefined,'Verified session can provision identity')
  check((await service.provision(tokenB))===undefined,'Independent owner provisioned')
  const registeredOverview=await readAnonymousOperationalOverview(reportingPool,'reporter01',true)
  check(registeredOverview.totalAccounts===2&&registeredOverview.accountsCreatedLast7d===2&&
    registeredOverview.cloudEnabledAccounts===0&&registeredOverview.storedSnapshots===0,
    'Overview counts real distinct active accounts, not synthetic dashboard values')
  await assert.rejects(service.provision(null),/unauthorized/);checks++
  await assert.rejects(service.provision('untrusted'),/unauthorized/);checks++
  await assert.rejects(service.provision(staffToken('support0001')),/unauthorized/);checks++
  await assert.rejects(service.provision(userToken('account0001','device0001',nowSeconds()-901)),/unauthorized/);checks++
  check((await service.status(tokenA)).enabled===false,'Cloud off by default on authenticated status')
  check((await service.status(tokenA)).hasStoredBackup===false,'No backup before first upload')
  check((await service.status(tokenB)).hasStoredBackup===false,'Other account starts independently')
  // Mock the official exchange boundary, without real credentials or network.
  // The adapter must ignore session_key and never expose the user's raw openid.
  const wxAppId='wxabcdef1234567890'
  const wxSubjectPepper=crypto.randomBytes(32),wxCodePepper=crypto.randomBytes(32)
  const wxConfig={appId:wxAppId,codePepper:wxCodePepper,
    subjectPepper:wxSubjectPepper,backupSigningKey,nowSeconds}
  const mockExchange=async code=>{
    if(code==='rejectme0001')throw Error('wechat_code_invalid')
    return {openid:code.startsWith('other')?'trusted_other_wechat_02':'trusted_wechat_user_01'}
  }
  await assert.rejects(loginWithWechatCode(identityPool,'rejectme0001','device0001',
    wxConfig,mockExchange),/wechat_code_invalid/);checks++
  await assert.rejects(loginWithWechatCode(identityPool,'bad','device0001',
    wxConfig,mockExchange),/invalid_wechat_login/);checks++
  const wxLogin=await loginWithWechatCode(identityPool,'wecode0001','device0001',
    wxConfig,mockExchange)
  check(wxLogin.isNewAccount&&wxLogin.userId.length===32,'Exchange creates a random internal user')
  const wxClaims=verifyServerSession(wxLogin.accessToken,backupSigningKey,
    'cuoshi-cloud-backup',nowSeconds())
  check(wxClaims?.sub===wxLogin.userId,'Verified provider result enables signed session')
  check(!JSON.stringify(wxLogin).includes('trusted_wechat_user_01'),
    'Never leak raw openid or provider session_key')
  const loginAgain=await loginWithWechatCode(identityPool,'wecode0002','device0002',
    wxConfig,mockExchange)
  check(!loginAgain.isNewAccount&&loginAgain.userId===wxLogin.userId,
    'Same WeChat identity maps to existing account')
  // Cross-worker limiter: independent Node objects share an atomic SQL quota.
  const limitKey=crypto.randomBytes(32)
  const permitLogin=createPostgresWechatLoginLimiter({db:identityPool,peerHmacKey:limitKey})
  const limiter2=createPostgresWechatLoginLimiter({db:identityPool,peerHmacKey:limitKey})
  const fakeRequest=(peer,forwarded='203.0.113.21')=>({
    socket:{remoteAddress:peer},headers:{'x-forwarded-for':forwarded}
  })
  const workerSlots=await Promise.all(Array.from({length:12},(_,index)=>
    (index%2?limiter2:permitLogin)(fakeRequest('192.0.2.42'))))
  check(workerSlots.every(x=>x===true),
    'Two worker instances consume exactly 12 concurrency-safe same-IP DB slots')
  const globalBefore=(await pool.query(`SELECT attempts FROM cloud_wechat_login_rate_windows
    WHERE scope='global'`)).rows[0].attempts
  check(!await permitLogin(fakeRequest('192.0.2.42')),
    'Thirteenth same-IP login is denied under durable database quota')
  const globalAfter=(await pool.query(`SELECT attempts FROM cloud_wechat_login_rate_windows
    WHERE scope='global'`)).rows[0].attempts
  check(globalAfter===globalBefore,
    'Denied peer login atomically rolls back its global quota increment')
  check(await limiter2(fakeRequest('192.0.2.43','192.0.2.42')),
    'Different socket peer still allowed despite forged forwarded header')
  check(!await permitLogin(fakeRequest('invalid-ip')),
    'Malformed remote address never consumes shared limit')
  check((await pool.query('SELECT count(*) AS n FROM cloud_wechat_login_rate_windows'))
    .rows[0].n==='3','Only one shared global and two keyed peer windows persisted')
  check(!JSON.stringify((await pool.query('SELECT * FROM cloud_wechat_login_rate_windows')).rows)
    .includes('192.0.2.42'),'Database never stores raw client IPs')
  check((await prunePrivateLoginWindows(maintenancePool,schema))===0,
    'Production maintenance worker safely retains recent login windows')
  const expiredMinute=Math.floor(Date.now()/60000)-1445
  const recentMinute=Math.floor(Date.now()/60000)-5
  await pool.query(`INSERT INTO cloud_wechat_login_rate_windows
    (scope,peer_digest,minute_window,attempts) VALUES
    ('peer',$1,$2,1),('peer',$3,$4,1)`,
    ['c'.repeat(64),expiredMinute,'d'.repeat(64),recentMinute])
  check(await prunePrivateLoginWindows(maintenancePool,schema)===1,
    'Real restricted maintenance role deletes only stale 24h+ windows')
  check((await pool.query(`SELECT count(*) AS n FROM cloud_wechat_login_rate_windows
    WHERE peer_digest=$1`,['c'.repeat(64)])).rows[0].n==='0',
    'Expired pseudonymous login metadata is no longer retained')
  check((await pool.query(`SELECT count(*) AS n FROM cloud_wechat_login_rate_windows
    WHERE peer_digest=$1`,['d'.repeat(64)])).rows[0].n==='1',
    'Recent window is not erased by privacy maintenance')
  check(await prunePrivateLoginWindows(maintenancePool,schema)===0,
    'Repeated job is idempotent and does not corrupt active limits')
  await assert.rejects(prunePrivateLoginWindows(identityPool,schema),
    /private_cloud_maintenance_scope_unsafe/);checks++
  await assert.rejects(prunePrivateLoginWindows(backupPool,schema),
    /private_cloud_maintenance_scope_unsafe/);checks++
  await assert.rejects(prunePrivateLoginWindows(pool,schema),
    /private_cloud_maintenance_role_unsafe/);checks++
  await assert.rejects(prunePrivateLoginWindows(maintenancePool,'wrong_schema'),
    /private_cloud_maintenance_scope_unsafe/);checks++
  // The rest of this disposable database suite assumes only actual login
  // traffic occupies the in-progress minute windows. Remove synthetic seed.
  await pool.query('DELETE FROM cloud_wechat_login_rate_windows WHERE peer_digest=$1',
    ['d'.repeat(64)])
  // Real signed-login HTTP route through the separate minimal-permission
  // WeChat identity PostgreSQL role and cloud consent service.
  let httpWechatTokenForRedactionCheck
  const qa=await listenCloudLoopbackForQa({
    account:{identityDb:identityPool,authConfig:wxConfig,exchange:mockExchange,
      login:loginWithWechatCode,account:service,
      permitLogin // real role-restricted PostgreSQL shared rate limiter
    },
    backup:service
  },'SYNTHETIC_TEST_ONLY')
  try{
    const target=qa.origin
    check(qa.server.address()?.address==='127.0.0.1',
      'Composed WeChat/backup HTTP QA listener binds loopback only')
    const body=JSON.stringify({code:'wxhttpcode0001',deviceId:'device0099'})
    const authReply=await fetch(target+'/v1/auth/wechat',{
      method:'POST',headers:{'Content-Type':'application/json'},body
    })
    check(authReply.status===200,
      'WeChat HTTP route completes trusted exchange with restricted identity DB')
    const authenticated=await authReply.json()
    httpWechatTokenForRedactionCheck=authenticated.accessToken
    check(authenticated.ownerId===wxLogin.userId&&
      authenticated.isNewAccount===false&&authenticated.deviceId==='device0099',
      'Existing WeChat account resolved from provider identity, not caller owner')
    check(verifyServerSession(authenticated.accessToken,backupSigningKey,
      'cuoshi-cloud-backup',nowSeconds())?.sub===wxLogin.userId,
      'HTTP route only issues service-compatible signed cloud backup token')
    const headers={Authorization:'Bearer '+authenticated.accessToken}
    const statusReply=await fetch(target+'/v1/backup/status',{headers})
    check(statusReply.status===200&&(await statusReply.json()).enabled===false,
      'WeChat HTTP login does not automatically activate cloud backup')
    const consentReply=await fetch(target+'/v1/backup/consent',{
      method:'PUT',headers:{...headers,'Content-Type':'application/json'},
      body:JSON.stringify({enabled:true,noticeVersion:'privacy-v1'})
    })
    check(consentReply.status===200&&(await consentReply.json()).enabled===true,
      'Explicit HTTP consent updates real PostgreSQL account under trusted token')
    // One actual HTTP listener now serves authenticated login, consent and
    // snapshot backed by separate, least-privileged PostgreSQL pools.
    const day=m.localDate(),records=m.fresh()
    m.setCount(records,day,0)
    m.appendNote(records,day,'隔离端到端云记录📝')
    const firstUpload={baseRevision:0,baseDigest:null,
      idempotencyKey:'qahttpcreate001',records}
    const uploadHeaders={...headers,'Content-Type':'application/json'}
    const firstReply=await fetch(target+'/v1/backup/snapshot',{
      method:'PUT',headers:uploadHeaders,body:JSON.stringify(firstUpload)
    })
    const decision=await firstReply.json()
    check(firstReply.status===200&&decision.kind==='accepted'&&decision.receipt.revision===1,
      'One listener runs real WeChat login → consent → PostgreSQL snapshot upload')
    const secondReply=await fetch(target+'/v1/auth/wechat',{
      method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({code:'wxhttpcode0002',deviceId:'device0100'})
    })
    const second=await secondReply.json()
    check(secondReply.status===200&&second.ownerId===authenticated.ownerId&&
      second.deviceId==='device0100'&&second.isNewAccount===false,
      'Second device resolves original WeChat owner via DB identity mapping')
    const readReply=await fetch(target+'/v1/backup/snapshot',{
      headers:{Authorization:'Bearer '+second.accessToken}
    })
    const readback=await readReply.json()
    check(readReply.status===200&&readback.digest===decision.receipt.digest&&
      readback.records.days[day].count===0&&readback.records.days[day].notes.length===1,
      'Device B retrieves explicit zero, note and full history through same listener')
    check((await fetch(target+'/v1/backup/snapshot?ownerId='+authenticated.ownerId,
      {headers})).status===404,
      'Query-string owner injection cannot select the private backup route')
    check((await fetch(target+'/v1/admin/read',{headers})).status===404,
      'Admin/private interfaces remain unexposed by composed public router')
    check((await fetch(target+'/healthz')).status===204,
      'Unauthenticated QA liveness response carries no personal information')
    const offReply=await fetch(target+'/v1/backup/consent',{
      method:'PUT',headers:{...headers,'Content-Type':'application/json'},
      body:JSON.stringify({enabled:false,noticeVersion:'privacy-v1'})
    })
    check(offReply.status===200&&(await offReply.json()).enabled===false,
      'HTTP opt-out reverts database consent without deleting records')
    check((await pool.query('SELECT revision FROM cloud_snapshots WHERE user_id=$1',
      [authenticated.ownerId])).rows[0].revision==='1',
      'Consent opt-out preserves test snapshot in PostgreSQL until explicit erasure')
    check((await fetch(target+'/v1/auth/wechat',{
      method:'POST',headers:{'Content-Type':'application/json'},body
    })).status===401,'Replay of WeChat one-time code fails under actual SQL uniqueness')
    for(let n=0;n<9;n++){
      const blocked=await fetch(target+'/v1/auth/wechat',{
        method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({code:'rejectme0001',deviceId:'device0099'})
      })
      if(blocked.status!==401)throw Error('unexpected_login_limit_before_per_peer_cap')
    }
    check((await fetch(target+'/v1/auth/wechat',{
      method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({code:'rejectme0001',deviceId:'device0099'})
    })).status===429,
      'Real combined HTTP login denies 13th same-peer attempt before WeChat exchange')
    check((await fetch(target+'/v1/backup/status',{
      headers:{Authorization:'Bearer '+staffToken('support0001')}
    })).status===401,'Staff token audience cannot access user backup status')
    const logoutReply=await fetch(target+'/v1/auth/logout',{
      method:'POST',headers
    })
    check(logoutReply.status===204,
      'Real restricted PostgreSQL token revocation confirms current-device logout')
    check((await fetch(target+'/v1/backup/status',{headers})).status===401,
      'Revoked WeChat HTTP session cannot resume cloud access')
    // A separate explicit erasure clears this synthetic fixture before the
    // downstream cancellation tests create their own first cloud revision.
    // A simple consent opt-out above did not erase anything.
    await service.deleteBackup(second.accessToken)
    check((await pool.query('SELECT 1 FROM cloud_snapshots WHERE user_id=$1',
      [authenticated.ownerId])).rows.length===0,
      'Explicit test-only backup erasure resets fixture without cross-account deletion')
  }finally{await qa.close()}

  // Authenticated private reverse-proxy edge + REAL PostgreSQL limiter.
  // The transport is localhost HTTP only, but no path is accessible until
  // the separately configured proxy secret and source-IP proof are verified.
  const edgeSecret=crypto.randomBytes(32)
  const edge=createTrustedEdgeBoundary({sharedSecret:edgeSecret})
  const edgeLimit=createPostgresWechatLoginLimiter({
    db:identityPool,peerHmacKey:limitKey,verifiedPeer:edge.clientIp
  })
  const edgeHost=await listenPrivateEdgeLoopback({
    account:{identityDb:identityPool,authConfig:wxConfig,exchange:mockExchange,
      login:loginWithWechatCode,account:service,permitLogin:edgeLimit},
    backup:service
  },edge,0)
  try{
    const base=edgeHost.origin
    const loginBody=(code)=>JSON.stringify({code,deviceId:'device0099'})
    const metadata={
      'X-Cuoshi-Edge-Proof':crypto.createHash('sha256').update(edgeSecret).digest('hex'),
      'X-Cuoshi-Client-Ip':'192.0.2.120',
      'X-Forwarded-For':'192.0.2.42'
    }
    const request=(code,headers)=>fetch(base+'/v1/auth/wechat',{
      method:'POST',headers:{'Content-Type':'application/json',...headers},
      body:loginBody(code)
    })
    const countBefore=(await pool.query(`SELECT sum(attempts) AS n FROM
      cloud_wechat_login_rate_windows WHERE scope='global'`)).rows[0].n
    check((await request('edgecode0001',{})).status===403,
      'Unprotected direct local request cannot use trusted edge login')
    check((await request('edgecode0001',{...metadata,
      'X-Cuoshi-Edge-Proof':edgeSecret.toString('hex')})).status===403,
      'Raw Node-only shared secret is no longer a valid HTTP edge proof')
    check((await request('edgecode0001',{...metadata,
      'X-Cuoshi-Edge-Proof':'a'.repeat(64)})).status===403,
      'Wrong local proxy credential fails before WeChat code is consumed')
    check((await pool.query(`SELECT sum(attempts) AS n FROM
      cloud_wechat_login_rate_windows WHERE scope='global'`)).rows[0].n===countBefore,
      'Unauthenticated private-edge calls cannot consume PostgreSQL login quota')
    const first=await request('edgecode0001',metadata)
    const firstJson=await first.json()
    check(first.status===200&&firstJson.ownerId===wxLogin.userId,
      'Verified reverse proxy forwards real signed WeChat login to PostgreSQL')
    const second=await request('edgecode0002',{...metadata,
      'X-Cuoshi-Client-Ip':'192.0.2.121',
      'X-Forwarded-For':'192.0.2.120'})
    check(second.status===200&&(await second.json()).ownerId===wxLogin.userId,
      'Independent verified client IP avoids another proxy client rate quota')
    check((await pool.query(`SELECT count(DISTINCT peer_digest) AS n FROM
      cloud_wechat_login_rate_windows WHERE scope='peer'`)).rows[0].n==='5',
      'Real DB stores separate peer buckets for two trusted proxy addresses')
    check((await fetch(base+'/v1/backup/status',{
      headers:{...metadata,Authorization:'Bearer '+firstJson.accessToken}
    })).status===200,
      'Trusted proxy can reach authenticated backup metadata')
    check((await fetch(base+'/v1/backup/status',{
      headers:{Authorization:'Bearer '+firstJson.accessToken}
    })).status===403,
      'Valid user bearer is NOT sufficient to bypass private edge authentication')
  }finally{await edgeHost.close()}

  await assert.rejects(loginWithWechatCode(identityPool,'wecode0001','device0001',
    wxConfig,mockExchange),/wechat_code_already_used/);checks++
  const secondUser=await loginWithWechatCode(identityPool,'othercode0001','device0003',
    wxConfig,mockExchange)
  check(secondUser.userId!==wxLogin.userId,'Different WeChat identity isolated')
  const sameNewIdentity=await Promise.all([
    loginWithWechatCode(identityPool,'wecodeparallel01','device0010',wxConfig,mockExchange),
    loginWithWechatCode(identityPool,'wecodeparallel02','device0011',wxConfig,mockExchange)
  ])
  check(sameNewIdentity.every(x=>x.userId===wxLogin.userId),
    'Parallel code exchanges never create duplicate accounts')
  const parallelCode=await Promise.allSettled([
    loginWithWechatCode(identityPool,'samecodeparallel0001','device0012',wxConfig,mockExchange),
    loginWithWechatCode(identityPool,'samecodeparallel0001','device0013',wxConfig,mockExchange)
  ])
  check(parallelCode.filter(x=>x.status==='fulfilled').length===1,
    'Concurrent replay of same temporary login code issues only one valid session')
  check(parallelCode.filter(x=>x.status==='rejected'&&
    String(x.reason?.message).includes('wechat_code_already_used')).length===1,
    'Other simultaneous code exchange fails closed')
  const dbSubjects=await pool.query('SELECT * FROM cloud_wechat_identities ORDER BY user_id')
  check(dbSubjects.rows.length===2,'Only two mapped WeChat identities')
  check(!JSON.stringify(dbSubjects.rows).includes('trusted_wechat_user_01'),
    'Database stores keyed identity hash, not raw openid')
  const bodySecrets=await pool.query('SELECT * FROM cloud_consumed_wechat_codes')
  check(!JSON.stringify(bodySecrets.rows).includes('wecode0001'),
    'Database stores only keyed code digests')
  const usersBefore=await pool.query('SELECT count(*) AS total FROM cloud_users')
  check(Number(usersBefore.rows[0].total)===4,'Identity sign-in adds only two accounts alongside two earlier test users')
  // Exercise official exchange URL handling with a fake fetch, no network calls.
  const fakeFetch=async (url,options)=>{
    const u=new URL(url)
    check(u.hostname==='api.weixin.qq.com'&&u.pathname==='/sns/jscode2session',
      'Provider exchange strictly targets official HTTPS domain')
    check(u.searchParams.get('grant_type')==='authorization_code'&&
      u.searchParams.get('appid')===wxAppId,
      'Official exchange uses authorization_code for configured AppID')
    return new Response(JSON.stringify({
      openid:'trusted_wechat_user_01',session_key:'secret_should_not_escape'
    }),{status:200})
  }
  const officialAdapter=makeWechatCodeExchanger({
    appId:wxAppId,appSecret:'fake_app_secret_not_real',fetchImpl:fakeFetch
  })
  check((await officialAdapter('freshcode123')).openid==='trusted_wechat_user_01',
    'Successful official response returns only openid')
  const failingAdapter=makeWechatCodeExchanger({appId:wxAppId,
    appSecret:'fake_app_secret_not_real',fetchImpl:async()=>new Response(
      JSON.stringify({errcode:40029,errmsg:'invalid code'}),{status:200})})
  await assert.rejects(failingAdapter('freshcode123'),/wechat_exchange_failed/);checks++
  const invalidOpenid=makeWechatCodeExchanger({
    appId:wxAppId,appSecret:'fake_app_secret_not_real',
    fetchImpl:async()=>new Response(JSON.stringify({openid:'abc'}),{status:200})
  })
  await assert.rejects(invalidOpenid('freshcode123'),/invalid_response/);checks++
  const hugeProvider=makeWechatCodeExchanger({
    appId:wxAppId,appSecret:'fake_app_secret_not_real',
    fetchImpl:async()=>new Response('z'.repeat(5000),{status:200})
  })
  await assert.rejects(hugeProvider('freshcode123'),/invalid_response/);checks++
  await assert.rejects(loginWithWechatCode(identityPool,'freshcode123','device0001',wxConfig,
    async()=>({openid:'bad'})),/wechat_identity_not_verified/);checks++
  const a={userId:'account0001',deviceId:'device0001'}
  const b={userId:'account0002',deviceId:'device0002'}
  const c={...a,deviceId:'device0003'}
  const yesterday=m.dateOffset(m.localDate(),-1),today=m.localDate()
  const state=m.fresh()
  m.setCount(state,yesterday,0)
  m.appendNote(state,yesterday,'专用测试私密文字📝')
  const up=(records,baseRevision,baseDigest,idempotencyKey)=>({records,baseRevision,baseDigest,idempotencyKey})
  await repository.provisionVerifiedUser(backupPool,a)
  await repository.provisionVerifiedUser(backupPool,b)
  check((await repository.uploadCloudSnapshot(backupPool,a,up(state,0,null,'request0001'))).reason==='consent_required','Cloud is opt-in')
  check(await repository.getCloudSnapshot(backupPool,a)===null,'Opted-out user cannot read remote data')
  await repository.setCloudConsent(backupPool,a,true,'privacy-v1')
  await repository.setCloudConsent(backupPool,b,true,'privacy-v1')
  check((await service.status(tokenA)).enabled,'User can view active backup state')
  const first=await service.upload(tokenA,up(state,0,null,'request0001'))
  check(first.kind==='accepted'&&first.receipt.revision===1,'First write revision 1')
  const statusAfter=await service.status(tokenA)
  check(statusAfter.hasStoredBackup&&statusAfter.revision===1,'Upload status reports stored revision')
  check(typeof statusAfter.lastSuccessAt==='string'&&statusAfter.lastSuccessAt.endsWith('Z'),
    'Upload status reports last confirmed server write time')
  check((await service.status(tokenB)).revision===null,'No cross-tenant backup metadata')
  // Same payload under B's identity cannot update A; no owner id is accepted from client.
  check((await service.readBackup(tokenB))===null,'Other signed user cannot read account A')
  check((await repository.uploadCloudSnapshot(backupPool,a,up(state,0,null,'request0001'))).kind==='replayed','Idempotent replay')
  check((await repository.uploadCloudSnapshot(backupPool,c,up(state,0,null,'request0001'))).reason==='idempotency_mismatch','Cannot replay across device')
  check((await repository.uploadCloudSnapshot(backupPool,a,up(state,0,null,'request0002'))).reason==='stale_revision','Stale base rejected')
  check((await repository.uploadCloudSnapshot(backupPool,a,up(state,1,'f'.repeat(64),'request0003'))).reason==='divergent_base','Wrong digest rejected')
  check((await repository.getCloudSnapshot(backupPool,b))===null,'Cross-owner reads isolated')
  const restored=await repository.getCloudSnapshot(backupPool,a)
  check(restored.records.days[yesterday].count===0,'Stored explicit zero')
  check(restored.records.days[yesterday].notes[0].text==='专用测试私密文字📝','Private unicode survives JSONB')
  const changed=m.cloneState(restored.records),competing=m.cloneState(restored.records)
  m.setCount(changed,today,3)
  m.setCount(competing,today,7)
  const race=await Promise.all([
    repository.uploadCloudSnapshot(backupPool,a,up(changed,1,first.receipt.digest,'request0004')),
    repository.uploadCloudSnapshot(backupPool,c,up(competing,1,first.receipt.digest,'request0005'))
  ])
  check(race.filter(x=>x.kind==='accepted').length===1,'Only one competing upload commits')
  check(race.filter(x=>x.kind==='conflict').length===1,'Losing writer receives conflict')
  const latest=await repository.getCloudSnapshot(backupPool,a)
  check(latest.revision===2,'No lost update, revision advanced once')
  check(latest.records.events.length===3,'Count and note history preserved')
  // Simulate JSONB key reordering without semantic mutation.
  const reordered=JSON.parse(JSON.stringify(latest.records),(_key,value)=>
    value&&typeof value==='object'&&!Array.isArray(value)
      ?Object.fromEntries(Object.entries(value).reverse()):value)
  const next=m.cloneState(reordered)
  m.appendNote(next,today,'新一天的简记')
  const third=await repository.uploadCloudSnapshot(backupPool,a,
    up(next,2,latest.digest,'request0006'))
  check(third.kind==='accepted'&&third.receipt.revision===3,
    'Equivalent JSON with reordered keys must not be mistaken for history rewrite')
  const tampered=m.cloneState(next)
  tampered.events[1].newText='被篡改的旧正文'
  check((await repository.uploadCloudSnapshot(backupPool,a,
    up(tampered,3,third.receipt.digest,'request0007'))).kind==='rejected',
    'Tampered old note event blocked')
  const removed=m.cloneState(next)
  removed.events.length=0;removed.days={}
  check((await repository.uploadCloudSnapshot(backupPool,a,
    up(removed,3,third.receipt.digest,'request0008'))).reason==='history_rewrite',
    'Cannot truncate old history')
  // Separate owner has isolated revision 1.
  // Concurrent first writes also serialize correctly when no snapshot row exists.
  const freshUser={userId:'account0003',deviceId:'device0004'}
  await repository.provisionVerifiedUser(backupPool,freshUser)
  await repository.setCloudConsent(backupPool,freshUser,true,'privacy-v1')
  const firstRace=await Promise.all([
    repository.uploadCloudSnapshot(backupPool,freshUser,up(state,0,null,'request0110')),
    repository.uploadCloudSnapshot(backupPool,{...freshUser,deviceId:'device0005'},
      up(state,0,null,'request0111'))
  ])
  check(firstRace.filter(x=>x.kind==='accepted').length===1,
    'Concurrent first snapshots must serialize')
  check(firstRace.filter(x=>x.kind==='conflict').length===1,
    'Initial competing client must not silently overwrite another upload')
  // v0.5 first-link: actual authenticated PostgreSQL path, not only the
  // in-memory CAS simulator. No existing user record may be overwritten.
  const linkUser={userId:'account0004',deviceId:'device0040'}
  const linkToken=userToken(linkUser.userId,linkUser.deviceId)
  await service.provision(linkToken)
  const importedLocal=m.fresh()
  m.setCount(importedLocal,yesterday,0)
  m.appendNote(importedLocal,yesterday,'测试旧简记正文，后来重新看待')
  m.editNote(importedLocal,yesterday,importedLocal.days[yesterday].notes[0].id,
    '重新看待后的简记')
  m.setCount(importedLocal,today,2)
  check((await service.status(linkToken)).enabled===false,
    'Newly linked cloud account requires explicit consent')
  await service.setConsent(linkToken,true,'privacy-v1')
  const firstLinkPreview=previewInitialMigration(importedLocal,
    await service.readBackup(linkToken),linkUser.userId)
  check(firstLinkPreview.status==='upload_local'&&
    !JSON.stringify(firstLinkPreview).includes('简记正文'),
    'First-link preview permits populated local with no cloud and leaks no text')
  const firstLinkPrepared=prepareInitialMigration({
    currentLocal:importedLocal,currentCloud:null,preview:firstLinkPreview,
    authenticatedOwnerId:linkUser.userId,authenticatedDeviceId:linkUser.deviceId,
    cloudConsentEnabled:true,confirmation:INITIAL_MIGRATION_CONFIRMATION,
    idempotencyKey:'firstlink0001'
  })
  check(firstLinkPrepared.request.records.events.length===4,
    'Migration includes every old event and not only current values')
  const linked=await service.upload(linkToken,firstLinkPrepared.request)
  check(linked.kind==='accepted'&&linked.receipt.revision===1,
    'First-link insert-only CAS commits through restricted backup DB role')
  const linkedReadback=await service.readBackup(linkToken)
  check(verifyInitialMigration({
    prepared:firstLinkPrepared,currentLocal:importedLocal,
    receipt:linked.receipt,readback:linkedReadback,
    authenticatedOwnerId:linkUser.userId
  }).status==='synced','Read-back proof confirms complete cloud durability')
  check(linkedReadback.records.days[yesterday].count===0&&
    linkedReadback.records.events[1].newText.includes('旧简记正文'),
    'Postgres JSONB preserved explicit zero and previous private note text')
  if(process.env.CUOSHI_TEST_RESTORE_DRILL==='SYNTHETIC_POSTGRES_ONLY'){
    const testOwner='restorefixture0001'
    // Seed strictly synthetic content, never dump user data or test credentials.
    await pool.query(`INSERT INTO cloud_users
      (user_id,backup_enabled,consent_version,consent_at)
      VALUES ($1,TRUE,'privacy-v1',clock_timestamp())`,[testOwner])
    await pool.query(`INSERT INTO cloud_snapshots (user_id,revision,digest,records)
      VALUES($1,$2,$3,$4::jsonb)`,[testOwner,1,'e'.repeat(64),JSON.stringify(importedLocal)])
    const restoredChecks=await checkRealPostgresRestore({source,schema,
      owner:testOwner,expectedRevision:1,expectedDigest:'e'.repeat(64),
      expectedEvents:importedLocal.events.length,expectedZeroDate:yesterday,
      ack:'SYNTHETIC_POSTGRES_ONLY'})
    check(restoredChecks===7,
      'Official PostgreSQL pg_dump/pg_restore preserved count-zero and full history in a second empty DB')
    await pool.query('DELETE FROM cloud_users WHERE user_id=$1',[testOwner])
  }
  const secondLinkToken=userToken(linkUser.userId,'device0041')
  const lostRace=await service.upload(secondLinkToken,{
    ...firstLinkPrepared.request,idempotencyKey:'firstlink0002'
  })
  check(lostRace.kind==='conflict'&&lostRace.reason==='stale_revision',
    'Second device first-link cannot overwrite version already stored in DB')
  check((await service.readBackup(linkToken)).revision===1,
    'Losing device never increments existing cloud version')
  // First-link subsequent user edits flow through the *real* restricted
  // PostgreSQL backup service using the same opt-in automatic sync port.
  let autoLocal=m.cloneState(importedLocal)
  let autoJournal=createLinkedJournal(linkUser.userId,linkUser.deviceId,
    linkedReadback,autoLocal),syncKeySeq=0
  let loseAutoResponse=false
  const autoPort={
    load(){return JSON.parse(JSON.stringify(autoJournal))},
    save(next){autoJournal=JSON.parse(JSON.stringify(next))},
    readLocal(){return m.cloneState(autoLocal)},
    readCloud:()=>service.readBackup(linkToken),
    newIdempotencyKey:()=>`autoPgReq${String(++syncKeySeq).padStart(8,'0')}`,
    async upload(req){
      const decision=await service.upload(linkToken,req)
      if(loseAutoResponse){loseAutoResponse=false;throw Error('simulated HTTP disconnect')}
      return decision
    }
  }
  const syncArgs={ownerId:linkUser.userId,deviceId:linkUser.deviceId,consentEnabled:true}
  m.appendNote(autoLocal,today,'首次迁移后的新增简记')
  const syncOne=await runAutomaticSyncOnce(autoPort,syncArgs)
  check(syncOne.kind==='synced'&&syncOne.revision===2,
    'PostgreSQL auto-sync accepts new local event after first migration')
  check((await service.readBackup(linkToken)).records.events.length===5,
    'Incremental snapshot preserves complete prior and new note history')
  m.setCount(autoLocal,today,5)
  loseAutoResponse=true
  const lostReply=await runAutomaticSyncOnce(autoPort,syncArgs)
  check(lostReply.kind==='retry_later'&&autoJournal.pending!==null,
    'Network failure AFTER commit keeps same durable pending payload')
  check((await service.readBackup(linkToken)).revision===3,
    'PostgreSQL committed before response was lost')
  const replay=await runAutomaticSyncOnce(autoPort,syncArgs)
  check(replay.kind==='synced'&&replay.revision===3,
    'Automatic queue replays identical idempotency key and verifies readback')
  check((await service.readBackup(linkToken)).revision===3,
    'Idempotent replay cannot create duplicate cloud revision')
  check(autoJournal.pending===null&&autoJournal.cursor.revision===3,
    'Cursor persisted only after complete cloud readback')

  // Real localhost HTTP service + restricted PostgreSQL service; no public
  // listener or unverified user-controlled owner ID.
  const httpServer=createServer(createBackupHttpHandler(service))
  await new Promise((resolve,reject)=>{
    httpServer.once('error',reject)
    httpServer.listen(0,'127.0.0.1',resolve)
  })
  try{
    const address=httpServer.address()
    const url='http://127.0.0.1:'+address.port+'/v1/backup/snapshot'
    const headers={Authorization:'Bearer '+linkToken,'Content-Type':'application/json'}
    const getResponse=await fetch(url,{headers})
    check(getResponse.status===200,
      'Real PostgreSQL snapshot served through authenticated localhost HTTP')
    const httpSnapshot=await getResponse.json()
    check(httpSnapshot.revision===3&&httpSnapshot.ownerId===linkUser.userId,
      'HTTP snapshot bound to verified owner and prior revision')
    check((await fetch(url,{headers:{Authorization:'Bearer bad'}})).status===401,
      'Malformed bearer denied before querying PostgreSQL')
    const nextHttpRecords=m.cloneState(httpSnapshot.records)
    m.appendNote(nextHttpRecords,today,'隔离数据库 HTTP 环回的新增简记')
    const uploadBody={baseRevision:httpSnapshot.revision,baseDigest:httpSnapshot.digest,
      idempotencyKey:'httpDbSync0001',records:nextHttpRecords}
    const send=()=>fetch(url,{method:'PUT',headers,body:JSON.stringify(uploadBody)})
    const acceptedHttp=await send()
    const decision=await acceptedHttp.json()
    check(acceptedHttp.status===200&&decision.kind==='accepted'&&
      decision.receipt.revision===4,
      'HTTP PUT inserts complete snapshot using real limited PostgreSQL role')
    const replayHttp=await send()
    check(replayHttp.status===200&&(await replayHttp.json()).kind==='replayed',
      'HTTP idempotent replay returns existing PostgreSQL receipt')
    const staleHttp=await fetch(url,{method:'PUT',headers,body:JSON.stringify({
      ...uploadBody,idempotencyKey:'httpDbSync0002'
    })})
    check(staleHttp.status===409&&(await staleHttp.json()).reason==='stale_revision',
      'HTTP preserves transactional cross-device revision conflict')
    check((await service.readBackup(linkToken)).revision===4,
      'Replayed and conflicting HTTP requests did not double-increment revision')
  }finally{await new Promise(resolve=>httpServer.close(resolve))}
  const changedDuringUpload=m.cloneState(importedLocal)
  m.appendNote(changedDuringUpload,today,'同步期间新增的本地文字')
  check(verifyInitialMigration({
    prepared:firstLinkPrepared,currentLocal:changedDuringUpload,
    receipt:linked.receipt,readback:linkedReadback,
    authenticatedOwnerId:linkUser.userId
  }).status==='local_changed_after_upload',
    'Local edits while uploading remain pending rather than falsely synced')

  const oldDeviceA=userToken(freshUser.userId,freshUser.deviceId)
  const oldDeviceB=userToken(freshUser.userId,'device0005')
  check((await service.status(oldDeviceB)).enabled,'Second device was initially authorized')
  check((await service.logoutAllUser(oldDeviceA)).allDevicesSignedOut,
    'Account-wide forced logout increments account session generation')
  await assert.rejects(service.status(oldDeviceA),/session_revoked/);checks++
  await assert.rejects(service.status(oldDeviceB),/session_revoked/);checks++
  await assert.rejects(service.upload(oldDeviceB,up(state,1,null,'invalidreq01')),
    /session_revoked/);checks++
  const newDeviceToken=userToken(freshUser.userId,freshUser.deviceId,nowSeconds(),1)
  check((await service.status(newDeviceToken)).enabled,
    'Re-authentication succeeds in the same second with a new generation')
  await assert.rejects(service.logoutAllUser(oldDeviceB),/session_revoked/);checks++
  await assert.rejects(repository.deleteCloudBackup(backupPool,{
    userId:freshUser.userId,deviceId:'device0005',generation:0
  }),/session_revoked/);checks++
  check((await service.status(tokenA)).enabled,'Other account stays signed in')
  const other=await repository.uploadCloudSnapshot(backupPool,b,up(state,0,null,'request0009'))
  check(other.kind==='accepted'&&other.receipt.revision===1,'Second owner independent')
  await repository.setCloudConsent(backupPool,a,false,'privacy-v1')
  check(await repository.getCloudSnapshot(backupPool,a)===null,'Opt-out prevents cloud reads')
  check((await repository.uploadCloudSnapshot(backupPool,a,
    up(next,3,third.receipt.digest,'request0010'))).reason==='consent_required','Opt-out prevents cloud writes')
  await repository.setCloudConsent(backupPool,a,true,'privacy-v1')

  // Metadata tampering without a new edit event is a history rewrite.
  const existingState=(await repository.getCloudSnapshot(backupPool,a)).records
  const manipulated=m.cloneState(existingState)
  manipulated.days[yesterday].notes[0].updatedAt=new Date().toISOString()
  check((await repository.uploadCloudSnapshot(backupPool,a,up(manipulated,3,third.receipt.digest,'request0012'))).reason==='history_rewrite',
    'Hidden metadata change cannot bypass the history ledger')
  // A malicious string is still data, not a SQL identifier or statement.
  const injection=m.cloneState(existingState)
  m.appendNote(injection,today,"'; DROP TABLE cloud_users; --")
  const injected=await repository.uploadCloudSnapshot(backupPool,a,up(injection,3,third.receipt.digest,'request0013'))
  check(injected.kind==='accepted','SQL-injection-looking note treated as text')
  check((await pool.query('SELECT count(*) AS total FROM cloud_users')).rows[0].total==='6',
    'Schema intact after SQL injection probe, including first-link migration account')
  // Seed test-only verified staff and an explicit scoped support ticket.
  for(const [id,role] of [['support0001','support'],['reviewer001','safety_reviewer'],
    ['superadmin1','super_admin'],['auditor0001','auditor']])
    await pool.query('INSERT INTO cloud_staff(staff_id,role) VALUES($1,$2)',[id,role])
  // A single administrator owns the only TOTP challenge; there are no
  // service-worker-local counters and no second-human approval requirement.
  const digestForOwner='e'.repeat(64)
  const slots=[]
  for(let index=0;index<6;index++){
    const result=await adminPool.query('SELECT cloud_take_owner_login_slot($1) AS allowed',[digestForOwner])
    slots.push(result.rows[0].allowed)
  }
  check(slots.slice(0,5).every(Boolean)&&slots[5]===false,
    'Real PostgreSQL atomically blocks sixth login attempt per five-minute peer window')
  const ownerOtp=(id,step)=>adminPool.query(
    'SELECT cloud_consume_owner_totp_step($1,$2) AS accepted',[id,step])
  check((await ownerOtp('superadmin1',50000000)).rows[0].accepted===true,
    'One existing sole-owner administrator consumes the first TOTP step')
  check((await ownerOtp('superadmin1',50000000)).rows[0].accepted===false&&
    (await ownerOtp('superadmin1',49999999)).rows[0].accepted===false,
    'Repeated and older MFA codes cannot create new sessions')
  check((await ownerOtp('superadmin1',50000001)).rows[0].accepted===true,
    'Later MFA step is accepted exactly once')
  check((await ownerOtp('support0001',50000000)).rows[0].accepted===false,
    'A different human role cannot consume the owner MFA step')
  await attempt(backupPool,'SELECT * FROM cloud_owner_login_windows')
  await attempt(reportingPool,'SELECT * FROM cloud_owner_totp_steps')
  await attempt(reportingPool,"SELECT cloud_consume_owner_totp_step('superadmin1',50000009)")
  await assert.rejects(readAnonymousOperationalOverview(reportingPool,'support0001',true),
    /operational_reporting_access_denied/);checks++
  await pool.query(`INSERT INTO cloud_access_cases(case_id,owner_id,purpose,status)
    VALUES('ticket0001',$1,'support_ticket','open')`,[a.userId])
  const staff={staffId:'support0001',mfaVerified:true}
  const read=(identity,day,owner=a.userId,caseId='ticket0001')=>
    admin.readPrivateDayWithAudit(adminPool,identity,owner,day,caseId)
  check(!(await read(staff,yesterday)).allowed,'Case without grant denied')
  const interval=await pool.query(`SELECT clock_timestamp()-interval '1 minute' AS starts,
      clock_timestamp()+interval '29 minutes' AS expires`)
  const {starts,expires}=interval.rows[0]
  await pool.query(`INSERT INTO cloud_access_grants
    (grant_id,staff_id,case_id,owner_id,purpose,day_keys,starts_at,expires_at,approved_by)
    VALUES('grant0001','support0001','ticket0001',$1,'support_ticket',$2,$3,$4,'superadmin1')`,
    [a.userId,[yesterday],starts,expires])
  await assert.rejects(service.readPrivateDay(tokenA,a.userId,yesterday,'ticket0001'),/unauthorized/);checks++
  await assert.rejects(service.readPrivateDay(staffToken('support0001',nowSeconds()-311,nowSeconds()-301),a.userId,yesterday,'ticket0001'),/unauthorized/);checks++
  await assert.rejects(service.readPrivateDay('made-up-staff-token',a.userId,yesterday,'ticket0001'),/unauthorized/);checks++
  const approvedViaSignedStaff=await service.readPrivateDay(staffToken('support0001'),a.userId,yesterday,'ticket0001')
  check(approvedViaSignedStaff.allowed,'Verified short-lived staff token reaches scoped database function')
  const approved=await read(staff,yesterday)
  check(approved.allowed,'Active, independently approved support grant allows one day')
  check(approved.day?.notes[0]?.text==='专用测试私密文字📝','Scoped body returned after audit')
  check(approved.events.every(e=>e.targetDate===yesterday),'Only scoped day history returned')
  check(!(await read(staff,today)).allowed,'Cannot read another day')
  check(!(await read(staff,yesterday,b.userId)).allowed,'Cannot read another user')
  check(!(await read({...staff,mfaVerified:false},yesterday)).allowed,'MFA missing')
  check(!(await read({staffId:'superadmin1',mfaVerified:true},yesterday)).allowed,'Super admin cannot browse body')
  check(!(await read({staffId:'auditor0001',mfaVerified:true},yesterday)).allowed,'Auditor cannot browse body')
  check(!(await read({staffId:'reviewer001',mfaVerified:true},yesterday)).allowed,'Reviewer cannot reuse support grant')
  await pool.query("UPDATE cloud_access_cases SET status='closed' WHERE case_id='ticket0001'")
  check(!(await read(staff,yesterday)).allowed,'Closed ticket denies access in database')
  await pool.query("UPDATE cloud_access_cases SET status='open' WHERE case_id='ticket0001'")
  await pool.query("UPDATE cloud_staff SET active=FALSE WHERE staff_id='support0001'")
  check(!(await read(staff,yesterday)).allowed,'Disabled employee denied')
  await pool.query("UPDATE cloud_staff SET active=TRUE WHERE staff_id='support0001'")
  await pool.query("UPDATE cloud_staff SET active=FALSE WHERE staff_id='superadmin1'")
  check(!(await read(staff,yesterday)).allowed,'Disabled approver invalidates grant')
  await pool.query("UPDATE cloud_staff SET active=TRUE WHERE staff_id='superadmin1'")
  const grantLock=await pool.connect()
  await grantLock.query('BEGIN')
  try{
    await grantLock.query("UPDATE cloud_access_grants SET revoked_at=clock_timestamp() WHERE grant_id='grant0001'")
    const contested=read(staff,yesterday)
    await new Promise(resolve=>setTimeout(resolve,100))
    await grantLock.query('COMMIT')
    check(!(await contested).allowed,'Concurrent grant revocation blocks private read')
  }finally{try{await grantLock.query('ROLLBACK')}catch{}grantLock.release()}
  await pool.query("UPDATE cloud_access_grants SET revoked_at=NULL WHERE grant_id='grant0001'")

  const audit=await pool.query('SELECT * FROM cloud_admin_audit ORDER BY id')
  check(audit.rows.some(x=>x.decision==='allow')&&audit.rows.some(x=>x.decision==='deny'),'All decisions audited')
  check(!JSON.stringify(audit.rows).includes('专用测试私密文字'),'Audit never stores private notes')
  await assert.rejects(pool.query('DELETE FROM cloud_admin_audit'),/append-only/);checks++
  await assert.rejects(pool.query("UPDATE cloud_admin_audit SET reason='overwrite'"),/append-only/);checks++

  // Even an otherwise authorized reader cannot see plaintext when audit is unavailable.
  await pool.query(`CREATE FUNCTION block_audit_test() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN RAISE EXCEPTION 'audit unavailable';END $$`)
  await pool.query(`CREATE TRIGGER simulate_audit_failure BEFORE INSERT ON cloud_admin_audit
    FOR EACH ROW EXECUTE FUNCTION block_audit_test()`)
  await assert.rejects(read(staff,yesterday),/audit unavailable/);checks++
  await pool.query('DROP TRIGGER simulate_audit_failure ON cloud_admin_audit')
  await pool.query('DROP FUNCTION block_audit_test()')
  await pool.query("UPDATE cloud_access_grants SET revoked_at=clock_timestamp() WHERE grant_id='grant0001'")
  check(!(await read(staff,yesterday)).allowed,'Revoked grant cannot read body')

  // Key rotation supports a bounded previous-key grace period without
  // minting permanent sessions or sharing keys between staff and users.
  const nextBackupKey=crypto.randomBytes(32),nextStaffKey=crypto.randomBytes(32)
  const rotatedService=new AuthenticatedCloudService(backupPool,adminPool,{
    backupKey:nextBackupKey,staffKey:nextStaffKey,
    previousBackupKey:backupSigningKey,previousStaffKey:staffSigningKey
  },nowSeconds)
  check((await rotatedService.status(tokenA)).enabled,
    'Old user token works briefly during configured key rotation')
  const nextUserToken=issueServerSession({
    aud:'cuoshi-cloud-backup',sub:a.userId,deviceId:a.deviceId
  },nextBackupKey,nowSeconds())
  check((await rotatedService.status(nextUserToken)).enabled,
    'Newly issued user token validates under current signing key')
  check((await rotatedService.readPrivateDay(
    staffToken('support0001'),a.userId,yesterday,'ticket0001')).reason==='revoked',
    'Previous staff key is accepted through DB policy during rotation')
  const nextStaffToken=issueServerSession({
    aud:'cuoshi-staff-admin',sub:'support0001',mfaAt:nowSeconds()-5
  },nextStaffKey,nowSeconds())
  check((await rotatedService.readPrivateDay(
    nextStaffToken,a.userId,yesterday,'ticket0001')).reason==='revoked',
    'New staff signing key uses the same restricted audit DB path')
  const currentOnly=new AuthenticatedCloudService(backupPool,adminPool,{
    backupKey:nextBackupKey,staffKey:nextStaffKey
  },nowSeconds)
  await assert.rejects(currentOnly.status(tokenA),/unauthorized/);checks++
  await assert.rejects(currentOnly.readPrivateDay(
    staffToken('support0001'),a.userId,yesterday,'ticket0001'),/unauthorized/);checks++
  check((await currentOnly.status(nextUserToken)).enabled,
    'Removing the previous key retires old user tokens')
  assert.throws(()=>new AuthenticatedCloudService(backupPool,adminPool,{
    backupKey:nextBackupKey,staffKey:nextStaffKey,previousStaffKey:nextBackupKey
  },nowSeconds),/distinct_keys/);checks++
  // Logout is durable across new AuthenticatedCloudService instances.
  const tokenToRevoke=userToken('account0002','device0002')
  check((await service.status(tokenToRevoke)).enabled,
    'Valid second-account token can access own backup status')
  await service.logoutUser(tokenToRevoke)
  await assert.rejects(service.status(tokenToRevoke),/session_revoked/);checks++
  await assert.rejects(service.upload(tokenToRevoke,up(state,0,null,'request9990')),
    /session_revoked/);checks++
  const afterRestart=new AuthenticatedCloudService(backupPool,adminPool,
    {backupKey:backupSigningKey,staffKey:staffSigningKey},nowSeconds)
  await assert.rejects(afterRestart.status(tokenToRevoke),/session_revoked/);checks++
  await assert.rejects(rotatedService.status(tokenToRevoke),/session_revoked/);checks++
  check((await rotatedService.status(nextUserToken)).enabled,
    'Key rotation cannot resurrect revoked bearer credentials')
  check((await afterRestart.status(userToken('account0002','device0002'))).enabled,
    'A fresh session can still work after only one token was revoked')
  const staffToRevoke=staffToken('support0001')
  await service.logoutStaff(staffToRevoke)
  await assert.rejects(service.readPrivateDay(staffToRevoke,a.userId,yesterday,'ticket0001'),
    /session_revoked/);checks++
  const afterAuditCount=Number((await pool.query('SELECT count(*) AS n FROM cloud_admin_audit')).rows[0].n)
  await assert.rejects(afterRestart.readPrivateDay(staffToRevoke,a.userId,yesterday,'ticket0001'),
    /session_revoked/);checks++
  check(Number((await pool.query('SELECT count(*) AS n FROM cloud_admin_audit')).rows[0].n)===afterAuditCount,
    'Revoked staff tokens cannot reach private-record SQL function')
  const revokedRows=await pool.query('SELECT * FROM cloud_revoked_backup_tokens')
  check(revokedRows.rows.length===2&&!JSON.stringify(revokedRows.rows).includes(tokenToRevoke)&&
    !JSON.stringify(revokedRows.rows).includes(httpWechatTokenForRedactionCheck),
    'Current-device WeChat HTTP logout and later user logout retain only token nonce digests, never bearer credentials')
  await service.deleteBackup(tokenA)
  check(!(await service.status(tokenA)).enabled,'Deleting cloud backup turns opt-in off')
  check((await service.status(tokenA)).hasStoredBackup===false,'Deleting removes backup metadata')
  check(await repository.getCloudSnapshot(backupPool,a)===null,'Explicit erasure removes snapshot')
  const removedRows=await pool.query('SELECT * FROM cloud_upload_receipts WHERE user_id=$1',[a.userId])
  check(removedRows.rows.length===0,'Erasure removes idempotency receipts')
  check((await repository.uploadCloudSnapshot(backupPool,a,up(state,0,null,'request0011'))).reason==='consent_required',
    'Erasure disables further sync')
  check((await repository.getCloudSnapshot(backupPool,b)).revision===1,'Erasure never deletes another account')
  // Controlled contention against an actual PostgreSQL FOR UPDATE lock.
  // Regardless of whether a waiting upload or account cancellation wins the
  // lock first, cancellation must erase every committed private snapshot.
  for(const order of ['upload_first','cancel_first']){
    const id=order==='upload_first'?'raceuser0001':'raceuser0002'
    const device='racedevice0001'
    const t=userToken(id,device)
    await service.provision(t)
    await service.setConsent(t,true,'privacy-v1')
    const initial=await service.upload(t,up(state,0,null,'raceinit0001'))
    check(initial.kind==='accepted','Race fixture initialized real private snapshot')
    const next=m.cloneState(state)
    m.setCount(next,today,order==='upload_first'?4:5)
    const request=up(next,1,initial.receipt.digest,'racewrite0002')
    const locker=await backupPool.connect()
    let lockActive=false
    let outcomes
    try{
      await locker.query('BEGIN')
      lockActive=true
      await locker.query('SELECT user_id FROM cloud_users WHERE user_id=$1 FOR UPDATE',[id])
      let uploadPromise,cancelPromise
      if(order==='upload_first'){
        uploadPromise=service.upload(t,request)
        await new Promise(resolve=>setTimeout(resolve,25))
        cancelPromise=service.cancelAccount(t,ACCOUNT_DELETE_CONFIRMATION)
      }else{
        cancelPromise=service.cancelAccount(t,ACCOUNT_DELETE_CONFIRMATION)
        await new Promise(resolve=>setTimeout(resolve,25))
        uploadPromise=service.upload(t,request)
      }
      await new Promise(resolve=>setTimeout(resolve,35))
      await locker.query('COMMIT')
      lockActive=false
      outcomes=await Promise.allSettled([uploadPromise,cancelPromise])
    }finally{
      if(lockActive){try{await locker.query('ROLLBACK')}catch{}}
      locker.release()
    }
    check(outcomes[1].status==='fulfilled'&&outcomes[1].value.deleted,
      'Concurrent cancellation commits despite outstanding upload')
    check(outcomes[0].status==='rejected'||outcomes[0].value.kind==='accepted'||
      (outcomes[0].value.kind==='rejected'&&
       outcomes[0].value.reason==='authentication'),
      'Queued upload is either committed before cancellation or refused')
    check((await pool.query('SELECT * FROM cloud_snapshots WHERE user_id=$1',[id])).rows.length===0,
      'No private snapshot survives an upload/delete race')
    check((await pool.query('SELECT * FROM cloud_upload_receipts WHERE user_id=$1',[id])).rows.length===0,
      'No upload receipt survives an upload/delete race')
    await assert.rejects(service.status(t),/account_closed/);checks++
    await assert.rejects(service.upload(t,request),/account_closed/);checks++
  }
  // User-requested account cancellation: preserve only non-identifying
  // backend operational totals and redacted security audit metadata.
  // Build a real WeChat-mapped account with private journal content.
  check((await service.logoutAllUser(wxLogin.accessToken)).allDevicesSignedOut,
    'WeChat account can sign out all devices')
  await assert.rejects(service.status(wxLogin.accessToken),/session_revoked/);checks++
  const wxRelogin=await loginWithWechatCode(
    identityPool,'wxrelogincode0001','device0001',wxConfig,mockExchange
  )
  check(!wxRelogin.isNewAccount&&wxRelogin.userId===wxLogin.userId,
    'New WeChat identity exchange reuses account after global logout')
  check(verifyServerSession(wxRelogin.accessToken,backupSigningKey,
    'cuoshi-cloud-backup',nowSeconds())?.generation===1,
    'New WeChat token uses latest database session generation')
  const wxToken=wxRelogin.accessToken
  await service.setConsent(wxToken,true,'privacy-v1')
  const wxBackup=await service.upload(wxToken,up(state,0,null,'wxupload0001'))
  check(wxBackup.kind==='accepted','WeChat-mapped account has encrypted-transport-ready test backup')
  await pool.query(`INSERT INTO cloud_access_cases(case_id,owner_id,purpose,status)
    VALUES('ticketwx0001',$1,'support_ticket','open')`,[wxLogin.userId])
  const grantTime=(await pool.query(`SELECT clock_timestamp()-interval '1 minute' AS starts,
    clock_timestamp()+interval '20 minutes' AS expires`)).rows[0]
  await pool.query(`INSERT INTO cloud_access_grants
    (grant_id,staff_id,case_id,owner_id,purpose,day_keys,starts_at,expires_at,approved_by)
    VALUES('grantwx0001','support0001','ticketwx0001',$1,'support_ticket',$2,$3,$4,'superadmin1')`,
    [wxLogin.userId,[yesterday],grantTime.starts,grantTime.expires])
  check((await service.readPrivateDay(staffToken('support0001'),wxLogin.userId,
    yesterday,'ticketwx0001')).allowed,'Pre-cancellation scoped audit readable')
  const privateAudits=await pool.query(
    'SELECT count(*) AS total FROM cloud_admin_audit WHERE owner_id=$1',[wxLogin.userId])
  check(Number(privateAudits.rows[0].total)===1,'Sensitive audit linkage exists before deletion')
  await assert.rejects(service.cancelAccount(wxToken,'注销'),/confirmation_required/);checks++
  check((await service.status(wxToken)).enabled,'Incorrect confirmation leaves account active')
  await assert.rejects(service.cancelAccount(staffToken('support0001'),ACCOUNT_DELETE_CONFIRMATION),
    /unauthorized/);checks++
  const extraWxToken=userToken(wxLogin.userId,'device0008',nowSeconds(),1)
  await service.logoutUser(extraWxToken)
  check(Number((await pool.query('SELECT count(*) AS n FROM cloud_revoked_backup_tokens WHERE subject_id=$1',
    [wxLogin.userId])).rows[0].n)===2,'Both HTTP logout and second-device revoked nonces exist before cancellation')
  const beforeStat=await pool.query('SELECT COALESCE(sum(accounts_deleted),0) AS n FROM cloud_account_deletion_totals')
  // The actual composed route must cancel only the JWT owner, using the
  // separate deletion role; no test direct function call on the success path.
  const deletionHttp=await listenCloudLoopbackForQa({
    account:{identityDb:identityPool,authConfig:wxConfig,exchange:mockExchange,
      login:loginWithWechatCode,account:service,permitLogin:()=>true},
    backup:service
  },'SYNTHETIC_TEST_ONLY')
  let result
  try{
    const url=deletionHttp.origin+'/v1/account/cancel'
    const post=(body,bearerToken=wxToken)=>fetch(url,{
      method:'POST',headers:{'Content-Type':'application/json',
        Authorization:'Bearer '+bearerToken},body:JSON.stringify(body)
    })
    const statusUrl=deletionHttp.origin+'/v1/account/cancel/status'
    const status=()=>fetch(statusUrl,{headers:{Authorization:'Bearer '+wxToken}})
    check((await status()).status===200&&
      (await status().then(x=>x.json())).state==='active',
      'PostgreSQL confirms original account is still active before cancellation')
    check((await fetch(statusUrl)).status===401,
      'No unauthenticated access to cancellation outcome')
    const wrong=await post({confirmation:'注销'})
    check(wrong.status===400,'Actual PostgreSQL deletion HTTP requires full typed confirmation')
    const crossed=await post({confirmation:ACCOUNT_DELETE_CONFIRMATION,
      ownerId:'account0002'})
    check(crossed.status===400,'Deletion HTTP rejects attacker-supplied other owner')
    const staff=await post({confirmation:ACCOUNT_DELETE_CONFIRMATION},
      staffToken('support0001'))
    check(staff.status===401,'Staff JWT cannot cancel a user via public HTTP')
    check((await service.status(wxToken)).enabled,
      'Denied HTTP cancellation leaves original account active')
    const deleted=await post({confirmation:ACCOUNT_DELETE_CONFIRMATION})
    result=await deleted.json()
    check(deleted.status===200&&deleted.headers.get('cache-control')?.includes('no-store'),
      'Actual HTTP cancellation gives a non-cacheable confirmed erasure receipt')
    const closed=await status()
    check(closed.status===200&&(await closed.json()).state==='closed',
      'Original signed JWT independently confirms PostgreSQL deleted_at after receipt loss')
    check((await fetch(statusUrl+'?ownerId=account0002',{
      headers:{Authorization:'Bearer '+wxToken}})).status===404,
      'Deletion status query can never select a different account')
  }finally{await deletionHttp.close()}
  check(result.deleted&&result.privateBackupErased&&result.redactedAuditRows===1,
    'Account deletion completes atomically and gives a non-personal receipt')
  check(!JSON.stringify(result).includes(wxLogin.userId)&&!JSON.stringify(result).includes('私人文字'),
    'Cancellation receipt contains no private body or identifying subject')
  const snapshotGone=await pool.query('SELECT * FROM cloud_snapshots WHERE user_id=$1',[wxLogin.userId])
  check(snapshotGone.rows.length===0,'User private cloud snapshot physically deleted')
  check((await pool.query('SELECT * FROM cloud_revoked_backup_tokens WHERE subject_id=$1',
    [wxLogin.userId])).rows.length===0,'Cancellation scrubs account-linked revoked-token records')
  check((await pool.query('SELECT * FROM cloud_upload_receipts WHERE user_id=$1',
    [wxLogin.userId])).rows.length===0,'Backup idempotency history removed')
  check((await pool.query('SELECT * FROM cloud_wechat_identities WHERE user_id=$1',
    [wxLogin.userId])).rows.length===0,'WeChat identity linkage deleted')
  check((await pool.query('SELECT * FROM cloud_access_grants WHERE owner_id=$1',
    [wxLogin.userId])).rows.length===0,'Stale administrator grants removed')
  check((await pool.query('SELECT * FROM cloud_access_cases WHERE owner_id=$1',
    [wxLogin.userId])).rows.length===0,'Old support case no longer links user')
  const scrubbed=await pool.query(
    "SELECT * FROM cloud_admin_audit WHERE owner_id='redacted' AND day_key='redacted'")
  check(scrubbed.rows.length>=1&&scrubbed.rows.every(x=>x.case_id===null&&x.grant_id===null),
    'Security audit retains staff action but irreversibly redacts user/date/case/grant')
  check(!JSON.stringify(scrubbed.rows).includes(wxLogin.userId)&&
    !JSON.stringify(scrubbed.rows).includes('私人文字'),'Retained logs contain no deleted identity/notes')
  const totals=await pool.query(
    'SELECT COALESCE(sum(accounts_deleted),0) AS n,COALESCE(sum(snapshots_erased),0) AS m FROM cloud_account_deletion_totals')
  check(Number(totals.rows[0].n)===Number(beforeStat.rows[0].n)+1&&
    Number(totals.rows[0].m)>=1,'Backend retains aggregate deletion/snapshot operational counts')
  const afterDeletionOverview=await readAnonymousOperationalOverview(reportingPool,'reporter01',true)
  check(afterDeletionOverview.totalAccounts>=2&&
    afterDeletionOverview.cloudEnabledAccounts<=afterDeletionOverview.totalAccounts&&
    afterDeletionOverview.snapshotsUpdatedLast7d<=afterDeletionOverview.storedSnapshots,
    'Aggregate statistics respect deleted-account exclusion and count boundaries')
  check(!JSON.stringify(afterDeletionOverview).includes(wxLogin.userId)&&
    !JSON.stringify(afterDeletionOverview).includes('私人文字'),
    'Aggregates contain no personal identifiers, private notes or history')
  const report=await readAnonymousDeletionSummary(reportingPool)
  check(report.length>=1&&report[0].accountsDeleted>=1&&report[0].snapshotsErased>=1,
    'Restricted operations account can read anonymous deletion totals')
  check(!JSON.stringify(report).includes(wxLogin.userId)&&
    !JSON.stringify(report).includes('私人文字')&&
    !JSON.stringify(report).includes('trusted_wechat_user_01'),
    'Backend reporting response includes no user ID, private content or WeChat identity')
  await assert.rejects(readAnonymousDeletionSummary(reportingPool,999),/invalid_reporting_range/);checks++
  const recordTombstone=await pool.query('SELECT deleted_at,backup_enabled,consent_at FROM cloud_users WHERE user_id=$1',
    [wxLogin.userId])
  check(recordTombstone.rows[0]?.deleted_at&&!recordTombstone.rows[0].backup_enabled&&
    recordTombstone.rows[0].consent_at===null,'Session-safety tombstone blocks old account')
  await assert.rejects(service.status(wxToken),/account_closed/);checks++
  await assert.rejects(service.readBackup(wxToken),/account_closed/);checks++
  await assert.rejects(service.upload(wxToken,up(state,0,null,'wxupload0002')),/account_closed/);checks++
  await assert.rejects(service.provision(wxToken),/account_closed/);checks++
  await assert.rejects(service.cancelAccount(wxToken,ACCOUNT_DELETE_CONFIRMATION),
    /account_closed/);checks++
  await assert.rejects(repository.provisionVerifiedUser(backupPool,{
    userId:wxLogin.userId,deviceId:'device0001'
  }),/account_closed/);checks++
  check((await service.readPrivateDay(staffToken('support0001'),wxLogin.userId,
    yesterday,'ticketwx0001')).allowed===false,'Deleted account body inaccessible to staff')
  // Newly signed tokens for an already cancelled subject are also denied.
  await assert.rejects(service.status(userToken(wxLogin.userId)),/account_closed/);checks++
  check((await service.status(tokenB)).enabled,'Other account remains active')
  // The same real WeChat identity after cancellation must bootstrap a fresh
  // internal account; never re-associate deleted notes from its old user id.
  const recreated=await loginWithWechatCode(identityPool,'wechataftercancel0001',
    'device0020',wxConfig,mockExchange)
  check(recreated.isNewAccount&&recreated.userId!==wxLogin.userId,
    'Former WeChat identity creates a distinct new account after cancellation')
  check((await service.status(recreated.accessToken)).hasStoredBackup===false,
    'Re-registered account has no previous private cloud snapshot')
  check((await service.status(recreated.accessToken)).enabled===false,
    'Re-registered account has no automatic cloud consent')
  check((await pool.query(
    'SELECT count(*) AS n FROM cloud_wechat_identities WHERE user_id=$1',
    [wxLogin.userId])).rows[0].n==='0','Old user identity mapping stays deleted')

  // No early cleanup: only an authorized maintenance account may erase
  // account-id tombstones after they are safely older than bearer-token TTL.
  const justDeletedPurge=await runPrivateRetentionCycle(maintenancePool,schema)
  check(justDeletedPurge.tombstones===0,
    'One real maintenance cycle preserves recent account tombstones and auth digests')
  check((await pool.query('SELECT deleted_at FROM cloud_users WHERE user_id=$1',[wxLogin.userId])).rows.length===1,
    'Account tombstone survives early purge attempt')
  await pool.query("UPDATE cloud_users SET deleted_at=clock_timestamp()-interval '25 hours' WHERE user_id=$1",
    [wxLogin.userId])
  check((await runPrivateRetentionCycle(maintenancePool,schema)).tombstones===1,
    'Production hourly cycle removes old account tombstone after 24h safety delay')
  check((await pool.query('SELECT * FROM cloud_users WHERE user_id=$1',[wxLogin.userId])).rows.length===0,
    'Former internal user ID purged after session expiry window')
  check((await readAnonymousDeletionSummary(reportingPool)).length>=1,
    'Anonymous backend totals survive expired tombstone purge')
  const periodic=await readAnonymousDeletionSummary(reportingPool)
  check(/^\d{4}-\d{2}$/.test(periodic[0].month),
    'Backend account statistics are coarse monthly buckets, not identifiable timestamps')
  const activeCodeCount=Number((await pool.query(
    'SELECT count(*) AS n FROM cloud_consumed_wechat_codes')).rows[0].n)
  check(activeCodeCount>0,'Temporary login-code digests exist before lifecycle cleanup')
  check((await runPrivateRetentionCycle(maintenancePool,schema)).authArtifacts===0,
    'Production hourly cycle retains recent session and one-use code digests')
  await pool.query("UPDATE cloud_consumed_wechat_codes SET used_at=clock_timestamp()-interval '25 hours'")
  await pool.query("UPDATE cloud_revoked_backup_tokens SET expires_at=clock_timestamp()-interval '2 hours'")
  await pool.query("UPDATE cloud_revoked_staff_tokens SET expires_at=clock_timestamp()-interval '2 hours'")
  check((await runPrivateRetentionCycle(maintenancePool,schema)).authArtifacts>=activeCodeCount,
    'Hourly maintenance expires old login codes and revoked-token digests')
  check((await pool.query('SELECT count(*) AS n FROM cloud_consumed_wechat_codes')).rows[0].n==='0',
    'Expired provider login code hashes physically cleared')
  check((await pool.query('SELECT count(*) AS n FROM cloud_revoked_backup_tokens')).rows[0].n==='0',
    'Expired backup-token revocations cleared without storing raw bearer values')
  check((await pool.query('SELECT count(*) AS n FROM cloud_revoked_staff_tokens')).rows[0].n==='0',
    'Expired staff-token revocations cleared')

  await assert.rejects(pool.query("UPDATE cloud_admin_audit SET decision='allow' WHERE owner_id='redacted'"),
    /append-only/);checks++
  await assert.rejects(pool.query("DELETE FROM cloud_admin_audit WHERE owner_id='redacted'"),
    /append-only/);checks++

  console.log('PASS',checks,'real PostgreSQL transactional backup/admin/account deletion integration checks')
}finally{
  if(backupPool)await backupPool.end()
  if(adminPool)await adminPool.end()
  if(identityPool)await identityPool.end()
  if(deletionPool)await deletionPool.end()
  if(maintenancePool)await maintenancePool.end()
  if(reportingPool)await reportingPool.end()
  if(pool)await pool.end()
  await basePool.query('DROP SCHEMA IF EXISTS "'+schema+'" CASCADE')
  if(rolesInstalled){
    await basePool.query('DROP ROLE "'+backupRole+'"')
    await basePool.query('DROP ROLE "'+adminRole+'"')
    await basePool.query('DROP ROLE "'+identityRole+'"')
    await basePool.query('DROP ROLE "'+deletionRole+'"')
    await basePool.query('DROP ROLE "'+maintenanceRole+'"')
    await basePool.query('DROP ROLE "'+reportingRole+'"')
  }
  await basePool.end()
  rmSync(temp,{recursive:true,force:true})
}
