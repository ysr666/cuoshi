/** Separate synthetic employee ingress behind real loopback trusted edge. */
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {execFileSync} from 'node:child_process'
import {mkdtempSync,mkdirSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join,resolve} from 'node:path'
import {randomBytes,createHash} from 'node:crypto'
const require=createRequire(import.meta.url)
const temp=mkdtempSync(join(tmpdir(),'cuoshi-staff-host-'))
const root=resolve('.');let n=0
const check=(v,m)=>{assert.ok(v,m);n++}
try{
 const out=join(temp,'dist');mkdirSync(out)
 execFileSync(resolve('node_modules/.bin/tsc'),[
   '--strict','--target','ES2022','--module','CommonJS','--moduleResolution','node',
   '--skipLibCheck','--rootDir',root,'--outDir',out,'future/server/src/staffHttpHost.ts'
 ],{cwd:root,stdio:'inherit'})
 const {createStaffHttpRouter,listenStaffPrivateLoopback}=require(join(out,'future/server/src/staffHttpHost.js'))
 const {createTrustedEdgeBoundary}=require(join(out,'future/server/src/trustedEdge.js'))
 const token='a'.repeat(140),secret=randomBytes(32)
 const edge=createTrustedEdgeBoundary({sharedSecret:secret})
 const proof=createHash('sha256').update(secret).digest('hex')
 let opsReads=0,dayReads=0
 const deps={reporting:{async overview(bearer){opsReads++;if(bearer!==token)throw Error('unauthorized');return {totalAccounts:4}}},
   privateDay:{async readPrivateDay(bearer,owner,date,caseId){dayReads++;
     if(bearer!==token)throw Error('unauthorized')
     return {allowed:owner==='account0001'&&date==='2026-10-24'&&caseId==='approved01',reason:'approved',day:null,events:[]}
   }}}
 assert.throws(()=>createStaffHttpRouter({}),/dependencies_required/);n++
 await assert.rejects(()=>listenStaffPrivateLoopback(deps,null,0),/staff_private_edge_required/);n++
 const host=await listenStaffPrivateLoopback(deps,edge,0)
 try{
   check(host.server.address().address==='127.0.0.1','Staff ingress binds only loopback')
   const good={'X-Cuoshi-Edge-Proof':proof,'X-Cuoshi-Client-Ip':'192.0.2.40'}
   const call=(path,extra={},method='GET',body)=>fetch(host.origin+path,{method,
     headers:{...extra,...(body?{'Content-Type':'application/json'}:{})},
     ...(body?{body:JSON.stringify(body)}:{})})
   check((await call('/internal/admin/overview')).status===403,'No direct access to staff-only port')
   check((await call('/internal/admin/overview',{'X-Cuoshi-Client-Ip':'192.0.2.40'})).status===403,
     'IP claim alone cannot authorize operations')
   check((await call('/internal/admin/overview',good)).status===401,'No bearer even behind proxy')
   const access={...good,Authorization:'Bearer '+token}
   const overview=await call('/internal/admin/overview',access)
   check(overview.status===200&&(await overview.json()).totalAccounts===4,
     'Authorized staff path returns aggregate-only response')
   check((await call('/v1/backup/snapshot',access)).status===404,'Staff host has no user backup routes')
   check((await call('/v1/auth/wechat',access)).status===404,'Staff host cannot issue WeChat sessions')
   check((await call('/internal/admin/overview?user=account0001',access)).status===404,
     'No query/pagination/export path on staff host')
   check((await call('/internal/admin/overview',access,'POST')).status===405,
     'Operations metrics cannot be modified')
   const body={ownerId:'account0001',dayKey:'2026-10-24',caseId:'approved01'}
   const day=await call('/internal/admin/read-day',access,'POST',body)
   check(day.status===200&&(await day.json()).events.length===0,
     'Isolated approved case can read only one day')
   check((await call('/internal/admin/read-day',access,'POST',
     {...body,caseId:'badcase00'})).status===403,'SQL-scope denial does not expose private day')
   check(opsReads===1&&dayReads===2,'Only routes passing edge and token reach business services')
 }finally{await host.close()}
 check(!host.server.listening,'Staff server releases listener after QA')
 console.log('PASS '+n+' separate staff ingress, proxy proof and exact route assertions')
}finally{rmSync(temp,{recursive:true,force:true})}
