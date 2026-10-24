/** Local 127.0.0.1 account route tests, no WeChat API/real secrets. */
import assert from 'node:assert/strict'
import {createServer} from 'node:http'
import {execFileSync} from 'node:child_process'
import {mkdtempSync,mkdirSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join,resolve} from 'node:path'
import {createRequire} from 'node:module'
import {randomBytes} from 'node:crypto'
let n=0,server
const check=(v,msg)=>{assert.ok(v,msg);n++}
const temp=mkdtempSync(join(tmpdir(),'cuoshi-auth-http-'))
const req=createRequire(import.meta.url)
try{
 const out=join(temp,'compiled');mkdirSync(out)
 execFileSync(resolve('node_modules/.bin/tsc'),[
   '--strict','--target','ES2022','--module','CommonJS','--moduleResolution','node',
   '--skipLibCheck','--rootDir',resolve('.'),'--outDir',out,
   'future/server/src/accountHttp.ts','future/server/src/backupHttp.ts',
   'future/server/src/sessionTokens.ts'
 ],{stdio:'inherit'})
 const {createAccountHttpHandler}=req(join(out,'future/server/src/accountHttp.js'))
 const {issueServerSession}=req(join(out,'future/server/src/sessionTokens.js'))
 const key=randomBytes(32), now=()=>1800000000
 const owner='account0001',device='device0001'
 const fakeAuth={appId:'wxabcdef1234567890',codePepper:randomBytes(32),
   subjectPepper:randomBytes(32),backupSigningKey:key,nowSeconds:now}
 const issuedCode=new Set()
 let allows=true,loginCalls=0,limiterCalls=0,providerCalls=0
 let consent=false,revision=null,lastSuccessAt=null
 let token=null,deletedToken=null
 const account={
   async status(value){
     if(value!==token)throw Error('unauthorized')
     return {enabled:consent,hasStoredBackup:revision!==null,
       revision,lastSuccessAt}
   },
   async logoutUser(value){
     if(value!==token)throw Error('unauthorized')
     token='REVOKED_TOKEN'
   },
   async cancellationStatus(value){
     if(value===deletedToken)return {state:'closed'}
     if(value===token)return {state:'active'}
     throw Error('unauthorized')
   },
   async cancelAccount(value,confirmation){
     if(value!==token)throw Error('unauthorized')
     if(confirmation!=='注销账号并清除云端记录')throw Error('invalid_confirmation')
     deletedToken=token
     token='REVOKED_TOKEN'
     return {deleted:true,privateBackupErased:true,redactedAuditRows:2,
       retainedBackendData:'anonymous_monthly_totals_and_redacted_security_audits'}
   },
   async setConsent(value,enabled,version){
     if(value!==token)throw Error('unauthorized')
     if(enabled&&version!=='privacy-v1')throw Error('invalid_consent')
     consent=enabled
   }
 }
 const backend={
   identityDb:{},
   noticeVersion:'privacy-v1',
   authConfig:fakeAuth,
   exchange:async code=>{
     providerCalls++
     return {openid:'verified_wechat_test_123'}
   },
   permitLogin:async incoming=>{
     limiterCalls++
     // Real owner/rate limiting is host-provided, never uses forwarded IP.
     assert.ok(incoming.socket.remoteAddress)
     return allows
   },
   account,
   async login(_db,code,dev,config,exchange){
     loginCalls++
     assert.equal(config,fakeAuth)
     assert.equal(dev,device)
     if(issuedCode.has(code))throw Error('wechat_code_already_used')
     if(code==='reject00001')throw Error('wechat_exchange_failed')
     const identity=await exchange(code)
     assert.equal(identity.openid,'verified_wechat_test_123')
     issuedCode.add(code)
     token=issueServerSession({aud:'cuoshi-cloud-backup',sub:owner,
       deviceId:dev},config.backupSigningKey,now())
     return {userId:owner,deviceId:dev,accessToken:token,
       isNewAccount:issuedCode.size===1}
   }
 }
 server=createServer(createAccountHttpHandler(backend))
 await new Promise((resolve,reject)=>{
   server.once('error',reject);server.listen(0,'127.0.0.1',resolve)
 })
 const origin='http://127.0.0.1:'+server.address().port
 async function call(path,method='GET',json,headers={}){
   return fetch(origin+path,{
     method,headers:{
       ...(json===undefined?{}:{'Content-Type':'application/json'}),...headers
     },...(json===undefined?{}:{body:typeof json==='string'?json:JSON.stringify(json)})
   })
 }
 check((await call('/v1/auth/wechat','GET')).status===405,
   'WeChat login only permits POST')
 check((await call('/v1/auth/wechat?code=secret','POST',{})).status===404,
   'WeChat code can never appear as query string')
 const invalid=await call('/v1/auth/wechat','POST',{openid:'attackeropenid',
   code:'testauth0001',deviceId:device})
 check(invalid.status===400,'Client cannot select WeChat openid')
 check(loginCalls===0&&providerCalls===0,'Malformed request never calls identity service')
 check((await call('/v1/auth/wechat','POST',
   {code:'bad',deviceId:device})).status===400,'Reject short/malformed login code')
 check((await call('/v1/auth/wechat','POST',{code:'testauth0001',
   deviceId:'invalid'})).status===400,'Reject malformed device ID')
 check((await call('/v1/auth/wechat','POST','{not json')).status===400,
   'Reject invalid login JSON')
 check((await call('/v1/auth/wechat','POST',{code:'x'.repeat(3000),
   deviceId:device})).status===413,'Login body bounded to 2 KiB before parse')
 const blockedCalls=loginCalls
 allows=false
 const rate=await call('/v1/auth/wechat','POST',{code:'testauth0001',deviceId:device})
 check(rate.status===429&&(await rate.json()).error==='too_many_requests',
   'Injected anti-abuse limiter must gate code exchanges')
 check(loginCalls===blockedCalls,'Limited login never invokes identity')
 allows=true
 const login=await call('/v1/auth/wechat','POST',{code:'testauth0001',deviceId:device})
 check(login.status===200,'Valid login returns restricted signed session')
 const body=await login.json()
 check(body.ownerId===owner&&body.deviceId===device&&
   body.accessToken===token&&body.expiresInSeconds===900&&body.isNewAccount,
   'Login returns current signed session and explicit short expiry')
 check(body.cloudBackupEnabled===undefined,
   'Login must not make up cloud consent state of returning user')
 check(!JSON.stringify(body).includes('verified_wechat_test_123'),
   'WeChat openid is never returned to client')
 check(login.headers.get('cache-control')?.includes('no-store'),
   'Login bearer response cannot be cached')
 check(login.headers.get('access-control-allow-origin')===null,
   'No reflection of browser cross-origin access')
 const replay=await call('/v1/auth/wechat','POST',{code:'testauth0001',deviceId:device})
 check(replay.status===401,'Reused temporary code cannot mint another session')
 check(!(await replay.text()).includes('wechat_code_already_used'),
   'Specific identity or replay error not disclosed')
 const failed=await call('/v1/auth/wechat','POST',{code:'reject00001',deviceId:device})
 check(failed.status===401,'Invalid provider code denied without backend stack')
 const statusUnauthorized=await call('/v1/backup/status')
 check(statusUnauthorized.status===401,'Cloud status requires signed bearer')
 const authHeaders={Authorization:'Bearer '+token}
 const status=await call('/v1/backup/status','GET',undefined,authHeaders)
 check(status.status===200&&!(await status.json()).enabled,
   'Fresh WeChat login does not automatically opt in to cloud backup')
 check((await call('/v1/backup/consent','POST',undefined,authHeaders)).status===405,
   'Cloud consent only accepts PUT')
 check((await call('/v1/backup/consent','PUT',
   {enabled:true,noticeVersion:'privacy-v1',ownerId:'account0002'},
   authHeaders)).status===400,'Consent cannot select other account')
 check((await call('/v1/backup/consent','PUT',
   {enabled:true,noticeVersion:'x'},authHeaders)).status===400,
   'Consent requires exact version')
 const outdated=await call('/v1/backup/consent','PUT',
   {enabled:true,noticeVersion:'privacy-old'},authHeaders)
 check(outdated.status===409&&(await outdated.json()).error==='privacy_notice_outdated',
   'Stale privacy revision cannot enable cloud upload')
 check(consent===false,'Outdated notice never mutates database consent')
 const yes=await call('/v1/backup/consent','PUT',
   {enabled:true,noticeVersion:'privacy-v1'},authHeaders)
 check(yes.status===200&&(await yes.json()).enabled===true,
   'Explicitly informed user can enable cloud backup')
 const no=await call('/v1/backup/consent','PUT',
   {enabled:false,noticeVersion:'privacy-old'},authHeaders)
 check(no.status===200&&(await no.json()).enabled===false,
   'Cloud opt-out works with an outdated privacy version and keeps existing data')
 check((await call('/v1/account/cancel','GET',undefined,authHeaders)).status===405,
   'Cancellation only permits POST with authenticated bearer')
 check((await call('/v1/account/cancel','POST',{confirmation:'注销'},authHeaders)).status===400,
   'Cancellation refuses partial typed confirmation')
 check((await call('/v1/account/cancel','POST',{
   confirmation:'注销账号并清除云端记录',ownerId:'account0002'},authHeaders)).status===400,
   'Account erasure never accepts user-selected owner ID')
 check((await call('/v1/account/cancel?ownerId=account0002','POST',{
   confirmation:'注销账号并清除云端记录'},authHeaders)).status===404,
   'Cancellation query parameters cannot select other accounts')
 check((await call('/v1/account/cancel','POST',{confirmation:'注销账号并清除云端记录'})).status===401,
   'Unauthenticated cancellation cannot erase any account')
 const loggedOut=await call('/v1/auth/logout','POST',undefined,authHeaders)
 check(loggedOut.status===204,'Current session revoked through explicit HTTP logout')
 check((await call('/v1/backup/status','GET',undefined,authHeaders)).status===401,
   'A logged-out session cannot read backup status')
 check((await call('/v1/backup/status?ownerId=account0002','GET',
   undefined,authHeaders)).status===404,
   'Status URL cannot select another owner')
 const bad=await call('/v1/backup/consent','PUT',
   {enabled:true,noticeVersion:'privacy-v1'},
   {Authorization:'Bearer '+'b'.repeat(128)})
 check(bad.status===401,'Forged user token cannot change backup consent')
 // A new short-lived session is required after current-device logout.
 const finalLogin=await call('/v1/auth/wechat','POST',
   {code:'finalauth0001',deviceId:device})
 check(finalLogin.status===200,'Fresh verified token obtained for deletion')
 const finalToken=(await finalLogin.json()).accessToken
 check((await call('/v1/account/cancel/status','GET',undefined,
   {Authorization:'Bearer '+finalToken})).status===200,
   'Original bearer can check live cancellation state without wx.login')
 check((await call('/v1/account/cancel/status','GET',undefined,
   {Authorization:'Bearer '+finalToken}).then(x=>x.json())).state==='active',
   'Tombstone endpoint reports active account before deletion')
 check((await call('/v1/account/cancel/status')).status===401,
   'Unauthenticated caller cannot enumerate account deletion outcomes')
 check((await call('/v1/account/cancel/status?ownerId=account0002','GET',undefined,
   {Authorization:'Bearer '+finalToken})).status===404,
   'Cancellation status never accepts arbitrary owner IDs')
 const cancelled=await call('/v1/account/cancel','POST',
   {confirmation:'注销账号并清除云端记录'},
   {Authorization:'Bearer '+finalToken})
 const cancelledJson=await cancelled.json()
 check(cancelled.status===200&&cancelledJson.deleted===true&&
   cancelledJson.privateBackupErased===true&&cancelledJson.redactedAuditRows===2,
   'Correct explicit confirmation returns only verified account erasure receipt')
 const closed=await call('/v1/account/cancel/status','GET',undefined,
   {Authorization:'Bearer '+finalToken})
 check(closed.status===200&&(await closed.json()).state==='closed',
   'Original JWT sees closed tombstone even after backup access revoked')
 check((await call('/v1/backup/status','GET',undefined,
   {Authorization:'Bearer '+finalToken})).status===401,
   'Cancellation revokes the prior session instead of leaving cloud data accessible')
 check(providerCalls===2,'Only accepted unique login codes reach synthetic provider')
 check(limiterCalls>=8,'Login requests are consistently rate gated')
 console.log('PASS',n,'WeChat account HTTP + consent loopback assertions; all identities synthetic')
}finally{
 if(server)await new Promise(resolve=>server.close(resolve))
 rmSync(temp,{recursive:true,force:true})
}
