/** Real localhost HTTP request path; all WeChat identities/DB results synthetic. */
import assert from 'node:assert/strict'
import {execFileSync} from 'node:child_process'
import {createRequire} from 'node:module'
import {mkdtempSync,mkdirSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join,resolve} from 'node:path'
import {randomBytes} from 'node:crypto'
const root=resolve('.'),temp=mkdtempSync(join(tmpdir(),'cuoshi-private-edge-'))
const require=createRequire(import.meta.url)
let count=0
const check=(x,description)=>{assert.ok(x,description);count++}
try{
 const out=join(temp,'dist');mkdirSync(out)
 execFileSync(resolve('node_modules/.bin/tsc'),[
  '--strict','--target','ES2022','--module','CommonJS','--moduleResolution','node',
  '--skipLibCheck','--rootDir',root,'--outDir',out,
  'future/server/src/cloudHttpHost.ts','future/server/src/trustedEdge.ts',
  'future/server/src/loginRateLimiter.ts'
 ],{cwd:root,stdio:'inherit'})
 const {listenPrivateEdgeLoopback}=require(join(out,'future/server/src/cloudHttpHost.js'))
 const {createTrustedEdgeBoundary}=require(join(out,'future/server/src/trustedEdge.js'))
 const {createPostgresWechatLoginLimiter}=require(join(out,'future/server/src/loginRateLimiter.js'))
 const secret=randomBytes(32),key=randomBytes(32),edge=createTrustedEdgeBoundary({sharedSecret:secret})
 assert.throws(()=>createTrustedEdgeBoundary({sharedSecret:randomBytes(8)}),/not_configured/);count++
 assert.throws(()=>edge.protect(null),/route_required/);count++
 let loginCount=0,dbQueries=[],released=0,cloudCalls=0,dbError=false
 const db={async connect(){if(dbError)throw Error('database_down');return {
  async query(sql,values){dbQueries.push({sql,values});return {rows:[{allowed:true}]}},
  release(){released++}
 }}}
 // A leaked proxy proof must NOT authorize sockets from outside loopback.
 const fakeRoute={called:0}
 const fakeReq={socket:{remoteAddress:'203.0.113.9'},headers:{
  'x-cuoshi-edge-proof':secret.toString('hex'),
  'x-cuoshi-client-ip':'192.0.2.42'
 }}
 const fakeRes={status:0,setHeader(){},writeHead(status){this.status=status},end(){}}
 await edge.protect(async()=>{fakeRoute.called++})(fakeReq,fakeRes)
 check(fakeRes.status===403&&fakeRoute.called===0,
  'Even valid edge proof is refused if request arrives on a public socket')
 check(edge.clientIp(fakeReq)===null,
  'Denied remote socket cannot leave a forged verified-peer identity')
 const limiter=createPostgresWechatLoginLimiter({db,peerHmacKey:key,verifiedPeer:edge.clientIp})
 const service={
  async status(){return {enabled:true,hasStoredBackup:false}},
  async setConsent(){},async logoutUser(){},
  async readBackup(){cloudCalls++;return null},
  async upload(){cloudCalls++;return {kind:'rejected',reason:'consent_required'}}
 }
 const deps={account:{identityDb:{},authConfig:{},exchange:async()=>({openid:'synthetic'}),
  account:service,
  permitLogin:limiter,
  login:async(_,code,deviceId)=>{loginCount++;return {
   userId:'account0001',deviceId,accessToken:'z'.repeat(128),isNewAccount:false
  }}
 },backup:service}
 await assert.rejects(()=>listenPrivateEdgeLoopback(deps,edge,-1),/edge_required/);count++
 await assert.rejects(()=>listenPrivateEdgeLoopback(deps,null,0),/edge_required/);count++
 const host=await listenPrivateEdgeLoopback(deps,edge,0)
 try{
  const origin=host.origin
  check(host.server.address().address==='127.0.0.1',
   'Private listener cannot bind a public interface')
  const good={
   'X-Cuoshi-Edge-Proof':secret.toString('hex'),
   'X-Cuoshi-Client-Ip':'192.0.2.42',
   'X-Forwarded-For':'203.0.113.20'
  }
  const json={'Content-Type':'application/json'}
  const loginBody=JSON.stringify({code:'code00001',deviceId:'device0001'})
  const call=(headers,options={})=>fetch(origin+'/v1/auth/wechat',{
   method:'POST',headers:{...json,...headers},body:loginBody,...options
  })
  const unauth=await call({})
  check(unauth.status===403,'Direct unauthenticated requests are denied before login')
  check(unauth.headers.get('cache-control')==='no-store, private',
   'Denied reverse-proxy requests are never cacheable')
  check((await call({'X-Cuoshi-Client-Ip':'192.0.2.42'})).status===403,
   'Untrusted forwarded IP is not sufficient')
  check((await call({...good,'X-Cuoshi-Edge-Proof':'a'.repeat(64)})).status===403,
   'Wrong proxy credential does not unlock routing')
  check((await call({...good,'X-Cuoshi-Client-Ip':'invalid'})).status===403,
   'Non-IP proxy peer fails closed')
  check((await call({...good,'X-Cuoshi-Client-Ip':'192.0.2.42, 192.0.2.43'})).status===403,
   'IP lists are refused: caller may not choose forwarded-for chain')
  check((await fetch(origin+'/healthz')).status===403,
   'Even private health metadata is protected from direct callers')
  check(dbQueries.length===0&&loginCount===0&&cloudCalls===0,
   'Denied edge requests never reach WeChat, DB, or cloud actions')
  const first=await call(good)
  check(first.status===200&&(await first.json()).ownerId==='account0001',
   'Authorized local edge successfully forwards to trusted login handler')
  check(loginCount===1&&dbQueries.length===1,
   'Authorized request invokes shared Postgres rate limiter exactly once')
  const firstDigest=dbQueries[0].values[0]
  check(/^[a-f0-9]{64}$/.test(firstDigest)&&!JSON.stringify(dbQueries).includes('192.0.2.42'),
   'Database receives only an HMAC of verified client peer')
  await call({...good,'X-Forwarded-For':'198.51.100.1','X-Real-Ip':'198.51.100.2'})
  check(dbQueries[1].values[0]===firstDigest,
   'Untrusted X-Forwarded-For/X-Real-IP cannot alter verified limiter identity')
  await call({...good,'X-Cuoshi-Client-Ip':'192.0.2.43'})
  check(dbQueries[2].values[0]!==firstDigest,
   'Distinct authenticated edge client receives independent limiter identity')
  check(released===dbQueries.length,'Each authorized DB check releases its connection')
  check((await fetch(origin+'/healthz',{headers:good})).status===204,
   'Authorized private liveness check is available to local proxy')
  check((await fetch(origin+'/v1/admin/read',{headers:good})).status===404,
   'Even trusted proxy cannot expose any administrator endpoints')
  dbError=true
  check((await call(good)).status===503,
   'Database failure is not bypassed by otherwise valid edge credentials')
  check(loginCount===3,'Database fail-closed behavior stops further WeChat exchanges')
 }finally{await host.close()}
 check(!host.server.listening,'Secure local listener releases its TCP port')
 console.log('PASS',count,'real localhost trusted-edge + PostgreSQL limiter contracts')
}finally{rmSync(temp,{recursive:true,force:true})}
