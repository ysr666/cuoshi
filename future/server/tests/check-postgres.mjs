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
let pool
try{
  const out=join(temp,'build');mkdirSync(out)
  execFileSync(resolve(root,'node_modules/.bin/tsc'),[
    '--target','ES2022','--module','CommonJS','--moduleResolution','node',
    '--skipLibCheck','--strict','--rootDir',root,'--outDir',out,
    resolve(root,'future/server/src/repository.ts'),
    resolve(root,'future/server/src/adminRepository.ts')
  ],{cwd:root,stdio:'pipe'})
  const m=require(join(out,'src/core/model.js'))
  const repository=require(join(out,'future/server/src/repository.js'))
  const admin=require(join(out,'future/server/src/adminRepository.js'))
  await basePool.query('CREATE SCHEMA "'+schema+'"')
  pool=new Pool({connectionString:source,options:'-c search_path='+schema,max:14})
  const ddl=readFileSync(new URL('../sql/001_initial.sql',import.meta.url),'utf8')
  await pool.query(ddl)

  const a={userId:'account0001',deviceId:'device0001'}
  const b={userId:'account0002',deviceId:'device0002'}
  const c={...a,deviceId:'device0003'}
  const yesterday=m.dateOffset(m.localDate(),-1),today=m.localDate()
  const state=m.fresh()
  m.setCount(state,yesterday,0)
  m.appendNote(state,yesterday,'专用测试私密文字📝')
  const up=(records,baseRevision,baseDigest,idempotencyKey)=>({records,baseRevision,baseDigest,idempotencyKey})
  await repository.provisionVerifiedUser(pool,a)
  await repository.provisionVerifiedUser(pool,b)
  check((await repository.uploadCloudSnapshot(pool,a,up(state,0,null,'request0001'))).reason==='consent_required','Cloud is opt-in')
  check(await repository.getCloudSnapshot(pool,a)===null,'Opted-out user cannot read remote data')
  await repository.setCloudConsent(pool,a,true,'privacy-v1')
  await repository.setCloudConsent(pool,b,true,'privacy-v1')
  const first=await repository.uploadCloudSnapshot(pool,a,up(state,0,null,'request0001'))
  check(first.kind==='accepted'&&first.receipt.revision===1,'First write revision 1')
  check((await repository.uploadCloudSnapshot(pool,a,up(state,0,null,'request0001'))).kind==='replayed','Idempotent replay')
  check((await repository.uploadCloudSnapshot(pool,c,up(state,0,null,'request0001'))).reason==='idempotency_mismatch','Cannot replay across device')
  check((await repository.uploadCloudSnapshot(pool,a,up(state,0,null,'request0002'))).reason==='stale_revision','Stale base rejected')
  check((await repository.uploadCloudSnapshot(pool,a,up(state,1,'f'.repeat(64),'request0003'))).reason==='divergent_base','Wrong digest rejected')
  check((await repository.getCloudSnapshot(pool,b))===null,'Cross-owner reads isolated')
  const restored=await repository.getCloudSnapshot(pool,a)
  check(restored.records.days[yesterday].count===0,'Stored explicit zero')
  check(restored.records.days[yesterday].notes[0].text==='专用测试私密文字📝','Private unicode survives JSONB')
  const changed=m.cloneState(restored.records),competing=m.cloneState(restored.records)
  m.setCount(changed,today,3)
  m.setCount(competing,today,7)
  const race=await Promise.all([
    repository.uploadCloudSnapshot(pool,a,up(changed,1,first.receipt.digest,'request0004')),
    repository.uploadCloudSnapshot(pool,c,up(competing,1,first.receipt.digest,'request0005'))
  ])
  check(race.filter(x=>x.kind==='accepted').length===1,'Only one competing upload commits')
  check(race.filter(x=>x.kind==='conflict').length===1,'Losing writer receives conflict')
  const latest=await repository.getCloudSnapshot(pool,a)
  check(latest.revision===2,'No lost update, revision advanced once')
  check(latest.records.events.length===3,'Count and note history preserved')
  // Simulate JSONB key reordering without semantic mutation.
  const reordered=JSON.parse(JSON.stringify(latest.records),(_key,value)=>
    value&&typeof value==='object'&&!Array.isArray(value)
      ?Object.fromEntries(Object.entries(value).reverse()):value)
  const next=m.cloneState(reordered)
  m.appendNote(next,today,'新一天的简记')
  const third=await repository.uploadCloudSnapshot(pool,a,
    up(next,2,latest.digest,'request0006'))
  check(third.kind==='accepted'&&third.receipt.revision===3,
    'Equivalent JSON with reordered keys must not be mistaken for history rewrite')
  const tampered=m.cloneState(next)
  tampered.events[1].newText='被篡改的旧正文'
  check((await repository.uploadCloudSnapshot(pool,a,
    up(tampered,3,third.receipt.digest,'request0007'))).kind==='rejected',
    'Tampered old note event blocked')
  const removed=m.cloneState(next)
  removed.events.length=0;removed.days={}
  check((await repository.uploadCloudSnapshot(pool,a,
    up(removed,3,third.receipt.digest,'request0008'))).reason==='history_rewrite',
    'Cannot truncate old history')
  // Separate owner has isolated revision 1.
  // Concurrent first writes also serialize correctly when no snapshot row exists.
  const freshUser={userId:'account0003',deviceId:'device0004'}
  await repository.provisionVerifiedUser(pool,freshUser)
  await repository.setCloudConsent(pool,freshUser,true,'privacy-v1')
  const firstRace=await Promise.all([
    repository.uploadCloudSnapshot(pool,freshUser,up(state,0,null,'request0110')),
    repository.uploadCloudSnapshot(pool,{...freshUser,deviceId:'device0005'},
      up(state,0,null,'request0111'))
  ])
  check(firstRace.filter(x=>x.kind==='accepted').length===1,
    'Concurrent first snapshots must serialize')
  check(firstRace.filter(x=>x.kind==='conflict').length===1,
    'Initial competing client must not silently overwrite another upload')
  const other=await repository.uploadCloudSnapshot(pool,b,up(state,0,null,'request0009'))
  check(other.kind==='accepted'&&other.receipt.revision===1,'Second owner independent')
  await repository.setCloudConsent(pool,a,false,'privacy-v1')
  check(await repository.getCloudSnapshot(pool,a)===null,'Opt-out prevents cloud reads')
  check((await repository.uploadCloudSnapshot(pool,a,
    up(next,3,third.receipt.digest,'request0010'))).reason==='consent_required','Opt-out prevents cloud writes')
  await repository.setCloudConsent(pool,a,true,'privacy-v1')

  // Metadata tampering without a new edit event is a history rewrite.
  const existingState=(await repository.getCloudSnapshot(pool,a)).records
  const manipulated=m.cloneState(existingState)
  manipulated.days[yesterday].notes[0].updatedAt=new Date().toISOString()
  check((await repository.uploadCloudSnapshot(pool,a,up(manipulated,3,third.receipt.digest,'request0012'))).reason==='history_rewrite',
    'Hidden metadata change cannot bypass the history ledger')
  // A malicious string is still data, not a SQL identifier or statement.
  const injection=m.cloneState(existingState)
  m.appendNote(injection,today,"'; DROP TABLE cloud_users; --")
  const injected=await repository.uploadCloudSnapshot(pool,a,up(injection,3,third.receipt.digest,'request0013'))
  check(injected.kind==='accepted','SQL-injection-looking note treated as text')
  check((await pool.query('SELECT count(*) AS total FROM cloud_users')).rows[0].total==='3',
    'Schema intact after SQL injection probe')
  // Seed test-only verified staff and an explicit scoped support ticket.
  for(const [id,role] of [['support0001','support'],['reviewer001','safety_reviewer'],
    ['superadmin1','super_admin'],['auditor0001','auditor']])
    await pool.query('INSERT INTO cloud_staff(staff_id,role) VALUES($1,$2)',[id,role])
  await pool.query(`INSERT INTO cloud_access_cases(case_id,owner_id,purpose,status)
    VALUES('ticket0001',$1,'support_ticket','open')`,[a.userId])
  const staff={staffId:'support0001',mfaVerified:true}
  const read=(identity,day,owner=a.userId,caseId='ticket0001')=>
    admin.readPrivateDayWithAudit(pool,identity,owner,day,caseId)
  check(!(await read(staff,yesterday)).allowed,'Case without grant denied')
  const interval=await pool.query(`SELECT clock_timestamp()-interval '1 minute' AS starts,
      clock_timestamp()+interval '29 minutes' AS expires`)
  const {starts,expires}=interval.rows[0]
  await pool.query(`INSERT INTO cloud_access_grants
    (grant_id,staff_id,case_id,owner_id,purpose,day_keys,starts_at,expires_at,approved_by)
    VALUES('grant0001','support0001','ticket0001',$1,'support_ticket',$2,$3,$4,'superadmin1')`,
    [a.userId,[yesterday],starts,expires])
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

  await repository.deleteCloudBackup(pool,a)
  check(await repository.getCloudSnapshot(pool,a)===null,'Explicit erasure removes snapshot')
  const removedRows=await pool.query('SELECT * FROM cloud_upload_receipts WHERE user_id=$1',[a.userId])
  check(removedRows.rows.length===0,'Erasure removes idempotency receipts')
  check((await repository.uploadCloudSnapshot(pool,a,up(state,0,null,'request0011'))).reason==='consent_required',
    'Erasure disables further sync')
  check((await repository.getCloudSnapshot(pool,b)).revision===1,'Erasure never deletes another account')
  console.log('PASS',checks,'real PostgreSQL transactional backup/admin integration checks')
}finally{
  if(pool)await pool.end()
  await basePool.query('DROP SCHEMA IF EXISTS "'+schema+'" CASCADE')
  await basePool.end()
  rmSync(temp,{recursive:true,force:true})
}
