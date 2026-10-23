/** Fully synthetic loopback operations API; no production staff login. */
import assert from 'node:assert/strict'
import {createServer} from 'node:http'
import {execFileSync} from 'node:child_process'
import {createRequire} from 'node:module'
import {mkdtempSync,mkdirSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join,resolve} from 'node:path'
import {randomBytes} from 'node:crypto'
const root=resolve('.'),temp=mkdtempSync(join(tmpdir(),'cuoshi-staff-ops-'))
const require=createRequire(import.meta.url)
let server,checks=0
const ok=(v,msg)=>{assert.ok(v,msg);checks++}
try{
 const out=join(temp,'compiled');mkdirSync(out)
 execFileSync(resolve('node_modules/.bin/tsc'),[
   '--strict','--target','ES2022','--module','CommonJS','--moduleResolution','node',
   '--skipLibCheck','--rootDir',root,'--outDir',out,
   'future/server/src/operationalHttp.ts'
 ],{cwd:root,stdio:'inherit'})
 const {createPrivateOperationalHttpHandler}=require(join(out,'future/server/src/operationalHttp.js'))
 const {createStaffOperationalService}=require(join(out,'future/server/src/operationalService.js'))
 const {issueServerSession}=require(join(out,'future/server/src/sessionTokens.js'))
 const staffKey=randomBytes(32),userKey=randomBytes(32),now=()=>1800000000
 const staffToken=(sub)=>issueServerSession({aud:'cuoshi-staff-admin',sub,mfaAt:now()-15},staffKey,now())
 const userToken=issueServerSession({aud:'cuoshi-cloud-backup',sub:'account0001',deviceId:'device0001'},userKey,now())
 const privileged=staffToken('superadmin1'),support=staffToken('support0001')
 let revoke=false,reportCalls=0,revocationCalls=0
 const staffDb={async connect(){return {async query(sql){
   revocationCalls++;ok(sql.includes('cloud_revoked_staff_tokens'),
     'Staff revocation check uses staff-only table')
   return {rows:revoke?[{one:1}]:[]}
 },release(){}}}}
 const reportingDb={async connect(){return {async query(sql,params){
   reportCalls++;ok(sql.includes('cloud_reporting_overview($1,$2)'),
     'Dashboard reads only audited/scoped aggregate function')
   return {rows:params[0]==='superadmin1'&&params[1]===true?[{
     total_accounts:'8',cloud_enabled_accounts:'5',stored_snapshots:'4',
     snapshots_updated_7d:'3',accounts_created_7d:'2'
   }]:[]}
 },release(){}}}}
 const ops=createStaffOperationalService(staffDb,reportingDb,staffKey,now)
 const handler=createPrivateOperationalHttpHandler(ops)
 server=createServer((req,res)=>{void handler(req,res)})
 await new Promise(r=>server.listen(0,'127.0.0.1',r))
 const url='http://127.0.0.1:'+server.address().port
 const get=(path='/internal/admin/overview',token,method='GET')=>fetch(url+path,{
   method,headers:token?{Authorization:'Bearer '+token}:{}
 })
 ok((await get('/v1/backup/snapshot',privileged)).status===404,
   'No public backup or user data path on staff-only handler')
 ok((await get('/internal/admin/overview?owner=other',privileged)).status===404,
   'No URL query, pagination, account selection or export')
 ok((await get('/internal/admin/overview',privileged,'POST')).status===405,
   'Operations overview is immutable GET only')
 ok((await get()).status===401,'No session denied')
 ok((await get('/internal/admin/overview','not-a-token')).status===401,
   'Unverified token denied')
 ok((await get('/internal/admin/overview',userToken)).status===401,
   'User-account bearer cannot query staff operations')
 ok(reportCalls===0,'Unauthorized token never reaches reporting SQL')
 const denied=await get('/internal/admin/overview',support)
 ok(denied.status===403&&(await denied.json()).error==='access_denied',
   'Signed support worker has no aggregate reporting permission')
 const response=await get('/internal/admin/overview',privileged)
 const data=await response.json()
 ok(response.status===200&&data.totalAccounts===8&&data.storedSnapshots===4,
   'Approved staff sees only validated aggregate values')
 ok(!JSON.stringify(data).includes('notes')&&!JSON.stringify(data).includes('userId'),
   'No private content or user IDs in operational response')
 ok(response.headers.get('cache-control')==='no-store, private'&&
   response.headers.get('access-control-allow-origin')===null,
   'Cannot cache private operations API or wildcard CORS')
 revoke=true
 ok((await get('/internal/admin/overview',privileged)).status===401,
   'Staff revocation checked every time')
 ok(revocationCalls===3&&reportCalls===2,
   'Only verified, non-revoked staff invoke reporting DB')
 console.log('PASS '+checks+' staff-only reporting HTTP and signed MFA boundaries')
}finally{if(server)await new Promise(r=>server.close(r));rmSync(temp,{recursive:true,force:true})}
