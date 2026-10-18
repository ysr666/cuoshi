/**
 * Future v0.5 WeChat login + explicit cloud opt-in HTTP boundary.
 *
 * No listener, no credentials, no real provider traffic. Host is responsible
 * for TLS, origin/host policy, distributed rate limits and trusted secrets.
 */
import type {IncomingMessage,ServerResponse} from 'node:http'
import type {WechatAuthConfig,WechatExchange,WechatLogin} from './wechatIdentity'
import type {DbPool} from './repository'
import type {AuthenticatedCloudService} from './authenticatedService'
import {
  HttpFailure,answer,bearer,collectJson,errorResponse
} from './backupHttp'

type AccountService=Pick<AuthenticatedCloudService,'status'|'setConsent'>
type LoginFn=(
  pool:DbPool,code:string,deviceId:string,config:WechatAuthConfig,
  exchange:WechatExchange
)=>Promise<WechatLogin>
type Limiter=(request:IncomingMessage)=>Promise<boolean>|boolean

export type AccountHttpDependencies={
  identityDb:DbPool
  authConfig:WechatAuthConfig
  exchange:WechatExchange
  login:LoginFn
  account:AccountService
  /** Required, backend-managed anti-abuse gate; no trust in X-Forwarded-For. */
  permitLogin:Limiter
}
const textId=(x:unknown):x is string=>
  typeof x==='string'&&/^[A-Za-z0-9_-]{8,128}$/.test(x)

function hasExactKeys(obj:unknown,names:string[]):obj is Record<string,unknown>{
  if(!obj||typeof obj!=='object'||Array.isArray(obj))return false
  const keys=Object.keys(obj).sort()
  return keys.length===names.length&&keys.every((k,i)=>k===names[i])
}
function validateLoginPayload(input:unknown):{code:string;deviceId:string}{
  if(!hasExactKeys(input,['code','deviceId']))throw new HttpFailure(400,'bad_request')
  const {code,deviceId}=input
  if(typeof code!=='string'||!/^[A-Za-z0-9_-]{8,512}$/.test(code)||!textId(deviceId))
    throw new HttpFailure(400,'bad_request')
  return {code,deviceId}
}
function validateConsentPayload(input:unknown):{enabled:boolean;noticeVersion:string}{
  if(!hasExactKeys(input,['enabled','noticeVersion']))throw new HttpFailure(400,'bad_request')
  const {enabled,noticeVersion}=input
  if(typeof enabled!=='boolean'||typeof noticeVersion!=='string'||
     !/^[-.a-zA-Z0-9_]{3,64}$/.test(noticeVersion))
    throw new HttpFailure(400,'bad_request')
  return {enabled,noticeVersion}
}
function safeLoginError(error:unknown):HttpFailure{
  if(error instanceof HttpFailure)return error
  if(error instanceof Error){
    // The user must never learn whether a WeChat identity/account exists.
    if(['wechat_code_already_used','invalid_login_code','wechat_code_invalid',
       'wechat_exchange_failed','wechat_identity_not_verified'].includes(error.message))
      return new HttpFailure(401,'unauthorized')
    if(error.message==='wechat_account_closed')return new HttpFailure(403,'access_denied')
  }
  return new HttpFailure(503,'cloud_temporarily_unavailable')
}
export function createAccountHttpHandler(deps:AccountHttpDependencies){
  if(!deps?.identityDb||typeof deps.login!=='function'||
     typeof deps.exchange!=='function'||!deps.authConfig||
     typeof deps.account?.status!=='function'||
     typeof deps.account?.setConsent!=='function'||
     typeof deps.permitLogin!=='function')
    throw Error('account_http_dependencies_required')
  return async (req:IncomingMessage,res:ServerResponse):Promise<void>=>{
    try{
      const path=req.url??''
      if(path==='/v1/auth/wechat'){
        if(req.method!=='POST'){
          res.setHeader('Allow','POST')
          throw new HttpFailure(405,'method_not_allowed')
        }
        // Refuse login if no backend rate limiter; do not use user-supplied
        // Forwarded headers as the IP/account abuse key.
        if(!await deps.permitLogin(req))
          return answer(res,429,{error:'too_many_requests'})
        const {code,deviceId}=validateLoginPayload(await collectJson(req,2048))
        let login:WechatLogin
        try{
          login=await deps.login(deps.identityDb,code,deviceId,
            deps.authConfig,deps.exchange)
        }catch(e){throw safeLoginError(e)}
        if(!textId(login.userId)||login.deviceId!==deviceId||
           typeof login.accessToken!=='string'||login.accessToken.length<90||
           typeof login.isNewAccount!=='boolean')
          throw new HttpFailure(503,'cloud_temporarily_unavailable')
        return answer(res,200,{
          ownerId:login.userId,
          deviceId:login.deviceId,
          accessToken:login.accessToken,
          isNewAccount:login.isNewAccount,
          // JWT maximum 15 minutes; a client should renew by fresh wx.login.
          expiresInSeconds:900 // Existing account consent is read via /status.
        })
      }
      if(path==='/v1/backup/status'){
        if(req.method!=='GET'){
          res.setHeader('Allow','GET')
          throw new HttpFailure(405,'method_not_allowed')
        }
        return answer(res,200,await deps.account.status(bearer(req)))
      }
      if(path==='/v1/backup/consent'){
        if(req.method!=='PUT'){
          res.setHeader('Allow','PUT')
          throw new HttpFailure(405,'method_not_allowed')
        }
        const token=bearer(req)
        const {enabled,noticeVersion}=validateConsentPayload(await collectJson(req,1024))
        await deps.account.setConsent(token,enabled,noticeVersion)
        return answer(res,200,await deps.account.status(token))
      }
      throw new HttpFailure(404,'not_found')
    }catch(error){
      const safe=errorResponse(error)
      if(!res.headersSent)answer(res,safe.status,{error:safe.code})
      else res.end()
    }
  }
}
