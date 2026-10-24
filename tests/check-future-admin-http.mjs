/** Synthetic localhost staff HTTP gate. Real production admin listener is forbidden. */
import assert from 'node:assert/strict'
import {createServer} from 'node:http'
import {execFileSync} from 'node:child_process'
import {mkdtempSync,mkdirSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join,resolve} from 'node:path'
import {createRequire} from 'node:module'
const root=resolve('.'),temp=mkdtempSync(join(tmpdir(),'cuoshi-admin-http-'))
const require=createRequire(import.meta.url)
let n=0
const ok=(v,label)=>{assert.ok(v,label);n++}
let server
try{
 const out=join(temp,'compiled');mkdirSync(out)
 execFileSync(resolve('node_modules/.bin/tsc'),[
  '--strict','--target','ES2022','--module','CommonJS','--moduleResolution','node',
  '--skipLibCheck','--rootDir',root,'--outDir',out,
  'future/server/src/adminHttp.ts'
 ],{cwd:root,stdio:'inherit'})
 const {createPrivateAdminHttpHandler}=require(join(out,'future/server/src/adminHttp.js'))
 assert.throws(()=>createPrivateAdminHttpHandler(null),/staff_service_required/);n++
 const jwt='a'.repeat(140)
 const callLog=[]
 const source={async readPrivateDay(token,owner,day,caseId){
   callLog.push({token,owner,day,caseId})
   if(token!==jwt)throw Error('unauthorized')
   if(caseId!=='approved0001')return {allowed:false,reason:'no_grant',day:null,events:[]}
   return {allowed:true,reason:'approved',day:{count:2,notes:[{text:'synthetic private note'}]},events:[{type:'count'}]}
 }}
 const app=createPrivateAdminHttpHandler(source)
 server=createServer((req,res)=>{void app(req,res)})
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
 const url='http://127.0.0.1:'+server.address().port
 const path='/internal/admin/read-day'
 const payload={ownerId:'account0001',dayKey:'2026-10-24',caseId:'approved0001'}
 const invoke=(where=path,body=payload,auth=jwt,method='POST')=>fetch(url+where,{
   method,headers:{'Content-Type':'application/json',
     ...(auth?{Authorization:'Bearer '+auth}:{})},
   ...(method==='GET'?{}:{body:JSON.stringify(body)})
 })
 ok((await invoke('/v1/backup/snapshot')).status===404,
   'Public backup path not reachable through admin handler')
 ok((await invoke('/internal/admin/read-day?owner=account0001')).status===404,
   'No query string override')
 ok((await invoke(path,payload,jwt,'GET')).status===405,
   'Admin day read requires POST')
 ok((await invoke(path,payload,'')).status===401,
   'Missing staff JWT denied')
 ok(callLog.length===0,'Unauthorized requests never reach private read')
 for(const bad of [
   {...payload,token:jwt},{...payload,staffId:'admin0001'},
   {...payload,ownerId:'anotheruser',caseId:'bad id'},
   {...payload,dayKey:'2099-13-80'},
   {ownerId:'account0001',caseId:'approved0001'}
 ])ok((await invoke(path,bad)).status===400,'Unexpected/synthetic data rejected at boundary')
 ok(callLog.length===0,'Malformed requests never reach audited service')
 const badBearer=await invoke(path,payload,'b'.repeat(140))
 ok(badBearer.status===401,'Invalid staff token rejected by service')
 const denied=await invoke(path,{...payload,caseId:'case00002'})
 ok(denied.status===403&&(await denied.json()).error==='access_denied',
   'Denied grant reveals no case/grant existence and no record')
 const allowed=await invoke()
 const result=await allowed.json()
 ok(allowed.status===200&&result.day.count===2&&result.events.length===1,
   'Only explicitly approved staff case returns precisely scoped audited day')
 ok(allowed.headers.get('cache-control')==='no-store, private'&&
    allowed.headers.get('access-control-allow-origin')===null,
    'Sensitive response cannot be cached or fetched via wildcard CORS')
 ok(JSON.stringify(result).includes('synthetic private note'),
   'Approved scope can show existing fake note without any global browse endpoint')
 ok(callLog.at(-1).owner==='account0001'&&callLog.at(-1).caseId==='approved0001',
   'Server gets exact owner and approved case for SQL audit')
 console.log('PASS '+n+' isolated staff read HTTP permission and audit contracts')
}finally{if(server)await new Promise(done=>server.close(done));rmSync(temp,{recursive:true,force:true})}
