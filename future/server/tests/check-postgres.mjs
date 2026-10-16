/** Real PostgreSQL integration. Uses ONLY an explicit localhost test database. */
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {execFileSync} from 'node:child_process'
import {mkdtempSync,mkdirSync,rmSync,readFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join,resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import crypto from 'node:crypto'
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
    resolve(root,'future/server/src/deletionReporting.ts')
  ],{cwd:root,stdio:'pipe'})
  const m=require(join(out,'src/core/model.js'))
  const repository=require(join(out,'future/server/src/repository.js'))
  const admin=require(join(out,'future/server/src/adminRepository.js'))
  const {AuthenticatedCloudService}=require(join(out,'future/server/src/authenticatedService.js'))
  const {issueServerSession,verifyServerSession}=require(join(out,'future/server/src/sessionTokens.js'))
  const {loginWithWechatCode,makeWechatCodeExchanger}=require(join(out,'future/server/src/wechatIdentity.js'))
  const {ACCOUNT_DELETE_CONFIRMATION}=require(join(out,'future/server/src/accountCancellation.js'))
  const {readAnonymousDeletionSummary}=require(join(out,'future/server/src/deletionReporting.js'))
  await basePool.query('CREATE SCHEMA "'+schema+'"')
  pool=new Pool({connectionString:source,options:'-c search_path='+schema,max:14})
  const ddl=readFileSync(new URL('../sql/001_initial.sql',import.meta.url),'utf8')
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
  const grants=readFileSync(new URL('../sql/002_runtime_permissions.sql',import.meta.url),'utf8')
    .replaceAll('__SCHEMA__','"'+schema+'"')
    .replaceAll('__BACKUP_ROLE__','"'+backupRole+'"')
    .replaceAll('__ADMIN_ROLE__','"'+adminRole+'"')
  try{await pool.query(grants)}catch(error){console.error('MIGRATION_SQL_ERROR',error.message,error.position,error.where,error.detail);throw error}
  const identityMigration=readFileSync(new URL('../sql/003_wechat_identity.sql',import.meta.url),'utf8')
    .replaceAll('__SCHEMA__','"'+schema+'"')
    .replaceAll('__AUTH_ROLE__','"'+identityRole+'"')
  await pool.query(identityMigration)
  const revocationMigration=readFileSync(new URL('../sql/004_session_revocation.sql',import.meta.url),'utf8')
    .replaceAll('__SCHEMA__','"'+schema+'"')
    .replaceAll('__BACKUP_ROLE__','"'+backupRole+'"')
    .replaceAll('__ADMIN_ROLE__','"'+adminRole+'"')
  await pool.query(revocationMigration)
  const cancellationMigration=readFileSync(new URL('../sql/005_account_cancellation.sql',import.meta.url),'utf8')
    .replaceAll('__SCHEMA__','"'+schema+'"')
    .replaceAll('__DELETION_ROLE__','"'+deletionRole+'"')
    .replaceAll('__MAINTENANCE_ROLE__','"'+maintenanceRole+'"')
    .replaceAll('__REPORTING_ROLE__','"'+reportingRole+'"')
  await pool.query(cancellationMigration)
  function roleUrl(role,secret){
    const url=new URL(source)
    url.username=role
    url.password=secret
    return url.toString()
  }
  backupPool=new Pool({connectionString:roleUrl(backupRole,backupSecret),
    options:'-c search_path='+schema,max:14})
  adminPool=new Pool({connectionString:roleUrl(adminRole,adminSecret),
    options:'-c search_path='+schema,max:6})
  identityPool=new Pool({connectionString:roleUrl(identityRole,identitySecret),
    options:'-c search_path='+schema,max:10})
  deletionPool=new Pool({connectionString:roleUrl(deletionRole,deletionSecret),
    options:'-c search_path='+schema,max:5})
  maintenancePool=new Pool({connectionString:roleUrl(maintenanceRole,maintenanceSecret),
    options:'-c search_path='+schema,max:3})
  reportingPool=new Pool({connectionString:roleUrl(reportingRole,reportingSecret),
    options:'-c search_path='+schema,max:3})
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
  await attempt(reportingPool,'SELECT * FROM cloud_revoked_backup_tokens')
  await attempt(deletionPool,'SELECT * FROM cloud_users')
  await attempt(reportingPool,"SELECT * FROM cloud_cancel_account('account0001')")
  await attempt(reportingPool,'DELETE FROM cloud_account_deletion_totals')
  check((await readAnonymousDeletionSummary(reportingPool)).length===0,
    'Reporting role sees no entries before any deletion')

  check((await pool.query('SELECT count(*) AS n FROM cloud_admin_audit')).rows[0].n==='0',
    'No privilege probing modified audit history')

  // Test-only keys and mocked verified issuer. No real WeChat or phone identity
  // is simulated as a production identity provider or logged to the console.
  const backupSigningKey=crypto.randomBytes(32)
  const staffSigningKey=crypto.randomBytes(32)
  const nowSeconds=()=>Math.floor(Date.now()/1000)
  const service=new AuthenticatedCloudService(backupPool,adminPool,
    {backupKey:backupSigningKey,staffKey:staffSigningKey},nowSeconds,deletionPool)
  const userToken=(userId,deviceId='device0001',issued=nowSeconds())=>
    issueServerSession({aud:'cuoshi-cloud-backup',sub:userId,deviceId},backupSigningKey,issued)
  const staffToken=(staffId,mfaAt=nowSeconds()-10,issued=nowSeconds())=>
    issueServerSession({aud:'cuoshi-staff-admin',sub:staffId,mfaAt},staffSigningKey,issued)
  const tokenA=userToken('account0001')
  const tokenB=userToken('account0002','device0002')
  check((await service.provision(tokenA))===undefined,'Verified session can provision identity')
  check((await service.provision(tokenB))===undefined,'Independent owner provisioned')
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
  check((await pool.query('SELECT count(*) AS total FROM cloud_users')).rows[0].total==='5',
    'Schema intact after SQL injection probe')
  // Seed test-only verified staff and an explicit scoped support ticket.
  for(const [id,role] of [['support0001','support'],['reviewer001','safety_reviewer'],
    ['superadmin1','super_admin'],['auditor0001','auditor']])
    await pool.query('INSERT INTO cloud_staff(staff_id,role) VALUES($1,$2)',[id,role])
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
  check(revokedRows.rows.length===1&&!JSON.stringify(revokedRows.rows).includes(tokenToRevoke),
    'Only a SHA-256 token nonce digest is stored, never a bearer token')
  await service.deleteBackup(tokenA)
  check(!(await service.status(tokenA)).enabled,'Deleting cloud backup turns opt-in off')
  check((await service.status(tokenA)).hasStoredBackup===false,'Deleting removes backup metadata')
  check(await repository.getCloudSnapshot(backupPool,a)===null,'Explicit erasure removes snapshot')
  const removedRows=await pool.query('SELECT * FROM cloud_upload_receipts WHERE user_id=$1',[a.userId])
  check(removedRows.rows.length===0,'Erasure removes idempotency receipts')
  check((await repository.uploadCloudSnapshot(backupPool,a,up(state,0,null,'request0011'))).reason==='consent_required',
    'Erasure disables further sync')
  check((await repository.getCloudSnapshot(backupPool,b)).revision===1,'Erasure never deletes another account')
  // User-requested account cancellation: preserve only non-identifying
  // backend operational totals and redacted security audit metadata.
  // Build a real WeChat-mapped account with private journal content.
  const wxToken=wxLogin.accessToken
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
  const beforeStat=await pool.query('SELECT COALESCE(sum(accounts_deleted),0) AS n FROM cloud_account_deletion_totals')
  const result=await service.cancelAccount(wxToken,ACCOUNT_DELETE_CONFIRMATION)
  check(result.deleted&&result.privateBackupErased&&result.redactedAuditRows===1,
    'Account deletion completes atomically and gives a non-personal receipt')
  check(!JSON.stringify(result).includes(wxLogin.userId)&&!JSON.stringify(result).includes('私人文字'),
    'Cancellation receipt contains no private body or identifying subject')
  const snapshotGone=await pool.query('SELECT * FROM cloud_snapshots WHERE user_id=$1',[wxLogin.userId])
  check(snapshotGone.rows.length===0,'User private cloud snapshot physically deleted')
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
  // No early cleanup: only an authorized maintenance account may erase
  // account-id tombstones after they are safely older than bearer-token TTL.
  const justDeletedPurge=await maintenancePool.query('SELECT cloud_purge_old_tombstones() AS n')
  check(Number(justDeletedPurge.rows[0].n)===0,'Newly deleted user ID retained temporarily to invalidate old tokens')
  check((await pool.query('SELECT deleted_at FROM cloud_users WHERE user_id=$1',[wxLogin.userId])).rows.length===1,
    'Account tombstone survives early purge attempt')
  await pool.query("UPDATE cloud_users SET deleted_at=clock_timestamp()-interval '25 hours' WHERE user_id=$1",
    [wxLogin.userId])
  check(Number((await maintenancePool.query('SELECT cloud_purge_old_tombstones() AS n')).rows[0].n)===1,
    'Authorized maintenance removes old account tombstone after safety delay')
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
  check(Number((await maintenancePool.query('SELECT cloud_purge_expired_auth_artifacts() AS n')).rows[0].n)===0,
    'Recent session hashes and one-use login code digests cannot be erased prematurely')
  await pool.query("UPDATE cloud_consumed_wechat_codes SET used_at=clock_timestamp()-interval '25 hours'")
  await pool.query("UPDATE cloud_revoked_backup_tokens SET expires_at=clock_timestamp()-interval '2 hours'")
  await pool.query("UPDATE cloud_revoked_staff_tokens SET expires_at=clock_timestamp()-interval '2 hours'")
  check(Number((await maintenancePool.query(
    'SELECT cloud_purge_expired_auth_artifacts() AS n')).rows[0].n)>=activeCodeCount,
    'Maintenance role expires old login codes and revoked-token digests')
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
