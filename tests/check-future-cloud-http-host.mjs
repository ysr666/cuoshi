/** Fully synthetic end-to-end localhost HTTP composition, no real database/provider. */
import assert from 'node:assert/strict'
import {execFileSync} from 'node:child_process'
import {mkdtempSync,mkdirSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join,resolve} from 'node:path'
import {createRequire} from 'node:module'
const root=resolve('.'),temp=mkdtempSync(join(tmpdir(),'cuoshi-cloud-http-host-'))
const require=createRequire(import.meta.url)
let n=0
const check=(value,reason)=>{assert.ok(value,reason);n++}
try{
 const out=join(temp,'compiled');mkdirSync(out)
 execFileSync(resolve('node_modules/.bin/tsc'),[
  '--strict','--target','ES2022','--module','CommonJS','--moduleResolution','node',
  '--skipLibCheck','--rootDir',root,'--outDir',out,
  'future/server/src/cloudHttpHost.ts'
 ],{cwd:root,stdio:'inherit'})
 const {listenCloudLoopbackForQa,createCloudHttpRouter}=require(
  join(out,'future/server/src/cloudHttpHost.js'))
 const jwt='a'.repeat(128)
 let consent=false,changed=false,readCalls=0,limitCalls=0,loginCalls=0,logoutCalls=0
 const service={
  async status(token){assert.equal(token,jwt);return {
   enabled:consent,hasStoredBackup:changed,revision:changed?1:null,lastSuccessAt:null
  }},
  async setConsent(token,enabled){assert.equal(token,jwt);consent=enabled},
  async logoutUser(token){assert.equal(token,jwt);logoutCalls++},
  async readBackup(token){assert.equal(token,jwt);readCalls++;return changed?{
   ownerId:'account0001',revision:1,digest:'0'.repeat(64),records:{testOnly:true}
  }:null},
  async upload(token,req){assert.equal(token,jwt);assert.equal(req.baseRevision,0)
   changed=true;return {kind:'rejected',reason:'consent_required'}
  }
 }
 const deps={account:{identityDb:{},authConfig:{},exchange:async()=>({openid:'fakevalue'}),
   login:async (_pool,code,deviceId)=>{loginCalls++;assert.equal(code,'testcode0001');return {
    userId:'account0001',deviceId,isNewAccount:true,accessToken:jwt
   }},account:service,permitLogin:()=>{limitCalls++;return true}
  },backup:service}
 assert.throws(()=>createCloudHttpRouter({account:deps.account,backup:null}),/dependencies_required/);n++
 await assert.rejects(()=>listenCloudLoopbackForQa(deps,'NOT_ALLOWED'),/public_listener_forbidden/);n++
 const local=await listenCloudLoopbackForQa(deps,'SYNTHETIC_TEST_ONLY')
 try{
  const target=local.origin
  check(local.server.address().address==='127.0.0.1',
   'QA server cannot bind a public address')
  const live=await fetch(target+'/healthz')
  check(live.status===204&&live.headers.get('cache-control')==='no-store, private',
   'Health only confirms listener liveness, never database readiness')
  for(const path of ['/v1/admin/read','/v1/backup/snapshot?ownerId=account0001',
    '/v1/auth/wechat/','/v1/auth/%252e%252e/wechat','/v1/backup/consent?enabled=true']){
   const response=await fetch(target+path,{redirect:'manual'})
   check(response.status===404,'Unexpected routes are refused: '+path)
  }
  check(readCalls===0&&limitCalls===0,
   'Unknown paths never touch identity, backup, or login limiter')
  const wrongMethod=await fetch(target+'/v1/auth/wechat',{method:'PUT'})
  check(wrongMethod.status===405&&wrongMethod.headers.get('allow')==='POST',
   'Exact route retains method restrictions')
  const login=await fetch(target+'/v1/auth/wechat',{method:'POST',
   headers:{'Content-Type':'application/json'},
   body:JSON.stringify({code:'testcode0001',deviceId:'device0001'})})
  const logged=await login.json()
  check(login.status===200&&logged.ownerId==='account0001'&&
    loginCalls===1&&limitCalls===1,
   'Login flows through limiter and trusted login dependency')
  check(!login.headers.has('access-control-allow-origin')&&
    login.headers.get('cache-control')==='no-store, private',
   'Never wildcard CORS or cache bearer response')
  const headers={Authorization:'Bearer '+logged.accessToken}
  const status=await fetch(target+'/v1/backup/status',{headers})
  check(status.status===200&&(await status.json()).enabled===false,
   'Signed session reaches status via composed router')
  const consentReply=await fetch(target+'/v1/backup/consent',{
   method:'PUT',headers:{...headers,'Content-Type':'application/json'},
   body:JSON.stringify({enabled:true,noticeVersion:'privacy-v1'})
  })
  check(consentReply.status===200&&(await consentReply.json()).enabled===true,
   'Consent travels through the same bound listener')
  const snapshot=await fetch(target+'/v1/backup/snapshot',{headers})
  check(snapshot.status===204&&readCalls===1,
   'Backup GET routes to authenticated snapshot service')
  const backup=await fetch(target+'/v1/backup/snapshot',{method:'PUT',
   headers:{...headers,'Content-Type':'application/json'},
   body:JSON.stringify({baseRevision:0,baseDigest:null,
    idempotencyKey:'request0001',records:{days:{},events:[],theme:'paper'}})
  })
  check(backup.status===403&&(await backup.json()).reason==='consent_required',
   'Upload still uses backend decision, not public router authorization bypass')
  const logout=await fetch(target+'/v1/auth/logout',{method:'POST',headers})
  check(logout.status===204&&logoutCalls===1,'Logout shares exact routing boundary')
 }finally{await local.close()}
 check(!local.server.listening,'Local QA listener closes and releases port')
 console.log('PASS',n,'synthetic composed local HTTP host, routes and auth isolation assertions')
}finally{rmSync(temp,{recursive:true,force:true})}
