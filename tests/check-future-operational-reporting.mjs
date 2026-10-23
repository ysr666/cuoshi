/** No real user data; verifies pure reporting contract and fail-closed validation. */
import assert from 'node:assert/strict'
import {mkdtempSync,mkdirSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join,resolve} from 'node:path'
import {execFileSync} from 'node:child_process'
import {createRequire} from 'node:module'
const root=resolve('.'),temp=mkdtempSync(join(tmpdir(),'cuoshi-ops-report-'))
const require=createRequire(import.meta.url)
let checks=0
const check=(v,m)=>{assert.ok(v,m);checks++}
try{
 const out=join(temp,'compiled');mkdirSync(out)
 execFileSync(resolve('node_modules/.bin/tsc'),[
  '--strict','--target','ES2022','--module','CommonJS','--moduleResolution','node',
  '--skipLibCheck','--rootDir',root,'--outDir',out,
  'future/server/src/operationalReporting.ts'
 ],{cwd:root,stdio:'inherit'})
 const {readAnonymousOperationalOverview}=require(
   join(out,'future/server/src/operationalReporting.js'))
 let released=0,queries=0
 const row={total_accounts:'6',cloud_enabled_accounts:'3',stored_snapshots:'2',
   snapshots_updated_7d:'1',accounts_created_7d:'4'}
 const pool={async connect(){return {async query(sql){
   queries++;check(sql.trim().startsWith('SELECT total_accounts'),
     'Only anonymous reporting function selected')
   check(sql.includes('FROM cloud_reporting_overview()'),
     'Never read raw cloud_users or snapshot JSON')
   return {rows:[row]}
 },release(){released++}}}}
 const result=await readAnonymousOperationalOverview(pool)
 check(result.totalAccounts===6&&result.cloudEnabledAccounts===3&&
   result.storedSnapshots===2&&result.snapshotsUpdatedLast7d===1&&
   result.accountsCreatedLast7d===4,'Five metrics correctly parsed')
 check(queries===1&&released===1,'Exactly one query and released connection')
 check(!JSON.stringify(result).includes('userId')&&!JSON.stringify(result).includes('notes'),
   'No personal identifiers or private body in result')
 await assert.rejects(readAnonymousOperationalOverview(null),/reporting_pool_required/);checks++
 for(const invalid of ['-1','NaN','9007199254740993','1.5',null]){
   const p={connect:async()=>({query:async()=>({rows:[{...row,total_accounts:invalid}]}),release(){released++}})}
   await assert.rejects(readAnonymousOperationalOverview(p),/invalid_operational_overview/);checks++
 }
 const p={connect:async()=>({query:async()=>({rows:[]}),release(){released++}})}
 await assert.rejects(readAnonymousOperationalOverview(p),/invalid_operational_overview/);checks++
 check(released===7,'Every invalid-result path releases the reporting connection')
 console.log('PASS '+checks+' minimal anonymous PostgreSQL ops reporting contract checks')
}finally{rmSync(temp,{recursive:true,force:true})}
