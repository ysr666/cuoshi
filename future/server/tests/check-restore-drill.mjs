/** One-time REAL pg_dump/pg_restore drill on a disposable loopback DB.
 * NEVER executes for production: requires explicit CI-only opt-in, a loopback
 * PostgreSQL origin, synthetic owner marker and official Docker PG client.
 */
import assert from 'node:assert/strict'
import {execFileSync} from 'node:child_process'
import {randomBytes,createHash} from 'node:crypto'
import {mkdtempSync,readFileSync,rmSync,statSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createRequire} from 'node:module'
const require=createRequire(new URL('../package.json',import.meta.url))
const {Pool}=require('pg')
const hostname=new Set(['localhost','127.0.0.1','[::1]'])
export function validateRestoreDrillArgs(source,schema,owner,ack){
 if(ack!=='SYNTHETIC_POSTGRES_ONLY')throw Error('restore_drill_explicit_ci_ack_required')
 let u
 try{u=new URL(source)}catch{throw Error('restore_drill_invalid_test_database')}
 if(!['postgres:','postgresql:'].includes(u.protocol)||!hostname.has(u.hostname)||
   !u.username||!u.password||!u.pathname||u.pathname==='/'||u.search||u.hash||
   !/^cuoshi_it_[a-f0-9]{10}$/.test(schema)||
   !/^restorefixture[0-9]{4}$/.test(owner))
   throw Error('restore_drill_invalid_test_database')
 return u
}
const run=(command,args,env)=>execFileSync(command,args,{
 env:{...process.env,PGPASSWORD:env},encoding:'utf8',stdio:['ignore','pipe','pipe'],
 timeout:45000,maxBuffer:1024*1024
})
function dockerClient(executable,params,folder,password){
 // Direct pg client entrypoint. Network host is strictly CI loopback-only.
 // Neither PostgreSQL password nor private backup contents are logged.
 const args=['run','--rm','--network','host','--read-only','--cap-drop','ALL',
  '--security-opt','no-new-privileges',
  '--user',`${process.getuid()}:${process.getgid()}`,
  '--tmpfs','/tmp:rw,nosuid,noexec,size=16m',
  '-e','PGPASSWORD','-v',`${folder}:/backup:rw`,
  '--entrypoint',executable,'postgres:16-alpine',...params]
 return run('docker',args,password)
}
export async function checkRealPostgresRestore({source,schema,owner,expectedDigest,
 expectedRevision,expectedEvents,expectedZeroDate,ack}){
 const uri=validateRestoreDrillArgs(source,schema,owner,ack)
 if(process.env.GITHUB_ACTIONS!=='true'||process.env.CI!=='true')
   throw Error('restore_drill_ci_runner_required')
 if(!Number.isSafeInteger(expectedRevision)||expectedRevision<1||
    !Number.isSafeInteger(expectedEvents)||expectedEvents<1||
    !/^\d{4}-\d{2}-\d{2}$/.test(expectedZeroDate)||
    !/^[a-f0-9]{64}$/.test(expectedDigest))throw Error('restore_drill_invalid_fixture')
 const suffix=randomBytes(6).toString('hex')
 const restoreDb='cs_restore_'+suffix
 const folder=mkdtempSync(join(tmpdir(),'cuoshi-disposable-restore-'))
 const dumpFile=join(folder,'synthetic-backup.dump')
 let checks=0,created=false,restored=null
 const ownerUrl=new URL(source)
 const originalDb=decodeURIComponent(ownerUrl.pathname.slice(1))
 const pool=new Pool({connectionString:source,max:1})
 try{
  if(originalDb!== 'postgres')throw Error('restore_drill_wrong_ci_database')
  const opts=['--host','127.0.0.1','--port',uri.port||'5432',
    '--username',decodeURIComponent(uri.username)]
  dockerClient('pg_dump',[...opts,'--dbname',originalDb,
    '--format','custom','--schema',schema,'--file','/backup/synthetic-backup.dump'],
    folder,decodeURIComponent(uri.password))
  const info=statSync(dumpFile)
  assert.ok(info.isFile()&&info.size>1024,'Synthetic custom-format PG dump missing')
  checks++
  const content=readFileSync(dumpFile)
  assert.equal(content.subarray(0,5).toString('utf8'),'PGDMP',
    'Backup format must be official PostgreSQL custom archive, not SQL/plaintext')
  checks++
  const before=createHash('sha256').update(content).digest('hex')
  assert.match(before,/^[a-f0-9]{64}$/);checks++
  // The restored DB must be a new empty CI-only database. The original is
  // never truncated, replaced or modified by this disaster-recovery drill.
  await pool.query(`CREATE DATABASE "${restoreDb}"`)
  created=true
  dockerClient('pg_restore',[...opts,'--dbname',restoreDb,
    '--no-owner','--exit-on-error','--format','custom',
    '/backup/synthetic-backup.dump'],folder,decodeURIComponent(uri.password))
  assert.equal(createHash('sha256').update(readFileSync(dumpFile)).digest('hex'),before)
  checks++
  ownerUrl.pathname='/'+restoreDb
  restored=new Pool({connectionString:ownerUrl.toString(),max:1})
  const probe=await restored.query(`SELECT revision,digest,records
    FROM "${schema}".cloud_snapshots WHERE user_id=$1`,[owner])
  const snap=probe.rows[0]
  assert.ok(snap&&Number(snap.revision)===expectedRevision&&
    snap.digest===expectedDigest&&snap.records?.events?.length===expectedEvents&&
    snap.records?.days?.[expectedZeroDate]?.count===0,
  'Restored custom-format snapshot lost count, revision, digest or complete edit history')
  checks++
  const row=await restored.query(`SELECT backup_enabled,deleted_at FROM "${schema}".cloud_users
    WHERE user_id=$1`,[owner])
  assert.ok(row.rows[0]?.backup_enabled===true&&row.rows[0].deleted_at===null,
    'Restore must include a linked active consented owner')
  checks++
  const original=await pool.query(`SELECT revision FROM "${schema}".cloud_snapshots
    WHERE user_id=$1`,[owner])
  assert.ok(Number(original.rows[0]?.revision)===expectedRevision,
    'Original CI database remains unchanged by restore')
  checks++
  return checks
 }finally{
  if(restored)await restored.end()
  if(created){
   // pg_restore failure must not strand a second DB or block cleanup of roles.
   await pool.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1',[restoreDb])
   await pool.query(`DROP DATABASE IF EXISTS "${restoreDb}"`)
  }
  await pool.end()
  rmSync(folder,{recursive:true,force:true})
 }
}
