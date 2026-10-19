/** Synthetic wx.login → token → explicit cloud consent (no real WeChat). */
import assert from 'node:assert/strict'
import {execFileSync} from 'node:child_process'
import {mkdtempSync,mkdirSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join,resolve} from 'node:path'
import {createRequire} from 'node:module'
const root=resolve('.'),temp=mkdtempSync(join(tmpdir(),'cuoshi-wxsession-'))
const require=createRequire(import.meta.url)
let tests=0
const ok=(condition,why)=>{assert.ok(condition,why);tests++}
const throws=(fn,pattern)=>{assert.throws(fn,pattern);tests++}
const rejects=async(fn,pattern)=>{await assert.rejects(fn,pattern);tests++}
try{
  const out=join(temp,'compiled');mkdirSync(out)
  execFileSync(resolve('node_modules/.bin/tsc'),[
    '--strict','--target','ES2022','--module','CommonJS','--moduleResolution','node',
    '--skipLibCheck','--rootDir',root,'--outDir',out,
    'future/cloud/wechatSession.ts','future/cloud/clientAdapters.ts'
  ],{cwd:root,stdio:'inherit'})
  const {createWeChatSessionManager}=require(join(out,'future/cloud/wechatSession.js'))
  const origin='https://backup.example.invalid',deviceId='device0001'
  let account='account0001',time=1800000000,codes=0,authCalls=0,allowed=true
  let enabled=false,hasStoredBackup=false,permitLogin=true
  let throwRequest=false,malformed=false,changeOwner=false
  const received=[]
  const tokens=new Set()
  const platform={
    login({success,fail}){
      codes++
      if(!allowed){fail({errMsg:'wx.login failed'});return}
      success({code:'oneusecode'+String(codes).padStart(6,'0')})
    }
  }
  const http={
    async request(req){
      received.push({...req,header:{...req.header}})
      if(throwRequest)throw Error('network offline')
      if(req.url===origin+'/v1/auth/wechat'){
        authCalls++
        if(!permitLogin)return {statusCode:429,data:{error:'too_many_requests'}}
        if(malformed)return {statusCode:200,data:{wrong:'result'}}
        if(req.data?.deviceId!==deviceId)return {statusCode:400,data:{}}
        const token='z'.repeat(100)+String(authCalls).padStart(4,'0')
        tokens.add(token)
        return {statusCode:200,data:{
          ownerId:changeOwner?'account0002':account,
          deviceId,accessToken:token,expiresInSeconds:300,isNewAccount:authCalls===1
        }}
      }
      if(!req.header.Authorization||
         !tokens.has(req.header.Authorization.slice(7)))
        return {statusCode:401,data:{error:'unauthorized'}}
      if(req.url===origin+'/v1/auth/logout'){
        tokens.delete(req.header.Authorization.slice(7))
        return {statusCode:204,data:null}
      }
      if(req.url===origin+'/v1/backup/status'){
        return {statusCode:200,data:{
          enabled,hasStoredBackup,revision:hasStoredBackup?2:null,
          lastSuccessAt:hasStoredBackup?'2026-10-19T07:00:00.000Z':null
        }}
      }
      if(req.url===origin+'/v1/backup/consent'){
        enabled=req.data.enabled
        return {statusCode:200,data:{
          enabled,hasStoredBackup,revision:hasStoredBackup?2:null,
          lastSuccessAt:hasStoredBackup?'2026-10-19T07:00:00.000Z':null
        }}
      }
      throw Error('unexpected route')
    }
  }
  const build=()=>createWeChatSessionManager({
    origin,deviceId,platform,http,nowSeconds:()=>time
  })
  throws(()=>createWeChatSessionManager({
    origin:'http://backup.example.invalid',deviceId,platform,http,nowSeconds:()=>time
  }),/https_required/)
  throws(()=>createWeChatSessionManager({
    origin,deviceId:'bad',platform,http,nowSeconds:()=>time
  }),/adapter_required/)
  let manager=build()
  const s1=await manager.getVerifiedSession()
  ok(s1.ownerId===account&&s1.accessToken.length>=90,
    'Valid one-time code becomes account-scoped bearer session')
  ok(codes===1&&authCalls===1,'First call uses a single wx.login exchange')
  ok(received[0].method==='POST'&&
     received[0].url===origin+'/v1/auth/wechat',
    'wx.login code sent only to fixed HTTPS backend endpoint')
  ok(!received[0].url.includes('oneusecode')&&!received[0].url.includes(deviceId),
    'Neither temporary code nor device ID leaks in URL')
  ok((await manager.getVerifiedSession()).accessToken===s1.accessToken,
    'Fresh token cached in memory without redundant wx.login calls')
  ok(codes===1,'No extra login before expiration')
  const initial=await manager.getStatus()
  ok(!initial.enabled&&!initial.hasStoredBackup,
    'Logging in does not enable cloud backup')
  const toggled=await manager.setCloudConsent(true,'privacy-v1')
  ok(toggled.enabled===true,'User consent PUT enables cloud backup')
  ok((await manager.getStatus()).enabled===true,'Enabled state read from server')
  hasStoredBackup=true
  const disabled=await manager.setCloudConsent(false,'privacy-v1')
  ok(!disabled.enabled&&disabled.hasStoredBackup,
    'Opt-out retains existing backup rather than erasing cloud data')
  await rejects(()=>manager.setCloudConsent(true,'x'),/invalid_consent/)
  time+=250 // only 50 seconds left, trigger proactive refresh
  const s2=await manager.getVerifiedSession()
  ok(s2.accessToken!==s1.accessToken,
    'Short-lived token refresh obtains new one-use wx.login code')
  ok(codes===2&&authCalls===2,'Proactive refresh does not reuse old WeChat code')
  time+=250
  const concurrent=await Promise.all(Array.from({length:8},
    ()=>manager.getVerifiedSession()))
  ok(concurrent.every(x=>x.accessToken===concurrent[0].accessToken),
    'Concurrent refresh requests share one in-flight login')
  ok(codes===3&&authCalls===3,'Eight callers perform exactly one wx.login exchange')
  time+=250
  changeOwner=true
  await rejects(()=>manager.getVerifiedSession(),/account_changed/)
  ok(codes===4,'Identity conflict only detected after trusted server reply')
  changeOwner=false
  const valid=await manager.getVerifiedSession()
  ok(valid.ownerId===account&&codes===5,
    'Old account remains locked after wrong-account server reply')
  const invalidSession=valid.accessToken
  tokens.delete(invalidSession)
  await rejects(()=>manager.getStatus(),/authorization_required/)
  ok((await manager.getVerifiedSession()).accessToken!==invalidSession,
    'Server-revoked token cleared before next fresh wx.login')
  ok(codes===6,'Revocation reacquires distinct temporary code')
  manager.clearLocalSession()
  const afterClear=await manager.getVerifiedSession()
  ok(afterClear.ownerId===account&&codes===7,
    'Explicit local clear forgets bearer without claiming server token revocation')
  await manager.logoutCurrentDevice()
  ok(received.at(-1).url===origin+'/v1/auth/logout'&&
    received.at(-1).method==='POST',
    'Explicit sign out hits server-side token revocation endpoint')
  ok((await manager.getVerifiedSession()).ownerId===account&&codes===8,
    'After server-confirmed logout, a new wx.login code is required')
  const beforeFailure=codes
  allowed=false
  time+=250
  await rejects(()=>manager.getVerifiedSession(),/wechat_login_unavailable/)
  ok(codes===beforeFailure+1,'Offline wx.login error is returned, not fabricated')
  allowed=true
  ok((await manager.getVerifiedSession()).ownerId===account,
    'Next valid login can recover from temporary platform failure')
  const beforeInvalid=authCalls
  time+=250;malformed=true
  await rejects(()=>manager.getVerifiedSession(),/invalid_response/)
  ok(authCalls===beforeInvalid+1,'Malformed server response rejected')
  malformed=false
  permitLogin=false
  await rejects(()=>manager.getVerifiedSession(),/authentication_failed/)
  permitLogin=true
  ok((await manager.getVerifiedSession()).ownerId===account,
    'Rate-limited login can retry with a new code later')
  // A stale in-flight login must not resurrect bearer credentials after logout.
  let complete
  const blocker=new Promise(resolve=>{complete=resolve})
  let entered
  const seen=new Promise(resolve=>{entered=resolve})
  const slowPlatform={login({success}){entered();void blocker.then(()=>success({code:'slowcode0001'}))}}
  const slow=createWeChatSessionManager({
    origin,deviceId,platform:slowPlatform,http,nowSeconds:()=>time
  })
  const pending=slow.getVerifiedSession()
  await seen
  slow.clearLocalSession()
  complete()
  await rejects(()=>pending,/abandoned/)
  ok((await slow.getVerifiedSession()).ownerId===account,
    'Clear while login pending cannot restore abandoned session')
  console.log('PASS',tests,'WeChat code-to-token client and consent assertions; mock transport only')
}finally{rmSync(temp,{recursive:true,force:true})}
