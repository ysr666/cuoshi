/**
 * Future v0.5 trusted WeChat mini-program session bridge.
 * No global uni/wx use, no real AppID, no storage of temporary login code.
 * A session only exists after the server verifies a one-time wx.login code.
 */
import type {
  SyncHttpTransport,SyncAuthentication,SyncHttpResponse
} from './clientAdapters'

type WxLoginResult={code?:string;errMsg?:string}
export type WechatLoginApi={
  login(options:{success(result:WxLoginResult):void;fail(error:unknown):void}):void
}
const id=/^[A-Za-z0-9_-]{8,128}$/
const code=/^[A-Za-z0-9_-]{8,512}$/
const token=/^[A-Za-z0-9_.-]{90,1800}$/
export const ACCOUNT_CANCELLATION_CONFIRMATION='注销账号并清除云端记录'
type Session={ownerId:string;deviceId:string;accessToken:string;expiry:number}
export type FutureCloudStatus={
  enabled:boolean;hasStoredBackup:boolean;revision:number|null;
  lastSuccessAt:string|null
}
const safeOrigin=(value:string):string=>{
  try{
    const url=new URL(value)
    if(url.protocol!=='https:'||url.username||url.password||url.pathname!=='/'||
       url.search||url.hash||!url.hostname.includes('.')||url.hostname==='localhost')
      throw Error('invalid')
    return url.origin
  }catch{throw Error('wechat_session_https_required')}
}

export function createWeChatSessionManager(args:{
  origin:string
  deviceId:string
  platform:WechatLoginApi
  http:SyncHttpTransport
  nowSeconds:()=>number
}):SyncAuthentication&{
  getStatus():Promise<FutureCloudStatus>
  setCloudConsent(enabled:boolean,noticeVersion:string):Promise<FutureCloudStatus>
  clearLocalSession():void
  logoutCurrentDevice():Promise<void>
  cancelCloudAccount(confirmation:string):Promise<{deleted:true;privateBackupErased:boolean;redactedAuditRows:number}>
  checkCancellationStatus():Promise<'closed'|'active'|'unknown'>
}{
  const {deviceId,platform,http,nowSeconds}=args
  const origin=safeOrigin(args.origin)
  if(!id.test(deviceId)||typeof platform?.login!=='function'||
     typeof http?.request!=='function'||typeof nowSeconds!=='function')
    throw Error('wechat_session_adapter_required')
  let session:Session|null=null
  let ownerLock:string|null=null
  let generation=0
  let inProgress:Promise<Session>|null=null
  async function request(codeValue:string):Promise<Session>{
    const resp=await http.request({
      url:origin+'/v1/auth/wechat',method:'POST',
      header:{Accept:'application/json','Content-Type':'application/json'},
      data:{code:codeValue,deviceId}
    })
    // Authentication errors revoke the right to reuse prior verified access.
    // 429 and 5xx are NOT account rejection: fail temporarily without
    // clearing the previously verified offline account entitlement.
    if(resp.statusCode===429)throw Error('wechat_session_rate_limited')
    if(resp.statusCode>=500&&resp.statusCode<=599)
      throw Error('wechat_session_cloud_unavailable')
    if(resp.statusCode!==200)throw Error('wechat_session_authentication_failed')
    const body=resp.data as Record<string,unknown>|null
    if(!body||typeof body!=='object'||typeof body.ownerId!=='string'||!id.test(body.ownerId)||
       body.deviceId!==deviceId||typeof body.accessToken!=='string'||!token.test(body.accessToken)||
       !Number.isSafeInteger(body.expiresInSeconds)||
       Number(body.expiresInSeconds)<30||Number(body.expiresInSeconds)>900)
      throw Error('wechat_session_invalid_response')
    if(ownerLock&&ownerLock!==body.ownerId)
      throw Error('wechat_session_account_changed')
    const now=nowSeconds()
    if(!Number.isSafeInteger(now)||now<0)throw Error('wechat_session_invalid_clock')
    return {ownerId:body.ownerId,deviceId,
      accessToken:body.accessToken,
      expiry:now+Number(body.expiresInSeconds)}
  }
  function wxCode():Promise<string>{
    return new Promise((resolve,reject)=>{
      try{
        platform.login({
          success(result){
            if(typeof result?.code!=='string'||!code.test(result.code)){
              reject(Error('wechat_login_invalid_code'));return
            }
            resolve(result.code!)
          },
          fail(){reject(Error('wechat_login_unavailable'))}
        })
      }catch{reject(Error('wechat_login_unavailable'))}
    })
  }
  async function getVerifiedSession(){
    const now=nowSeconds()
    if(!Number.isSafeInteger(now)||now<0)throw Error('wechat_session_invalid_clock')
    if(session&&session.expiry-now>60)return {
      ownerId:session.ownerId,accessToken:session.accessToken
    }
    if(!inProgress){
      const startedInGeneration=generation
      const flight=(async()=>{
        const verified=await request(await wxCode())
        // An in-flight wx.login is not allowed to resurrect a session after
        // the user explicitly cleared it (logout or account change).
        if(startedInGeneration!==generation)
          throw Error('wechat_session_abandoned')
        ownerLock=verified.ownerId
        session=verified
        return verified
      })()
      inProgress=flight
      const cleanup=()=>{if(inProgress===flight)inProgress=null}
      void flight.then(cleanup,cleanup)
    }
    const verified=await inProgress
    return {ownerId:verified.ownerId,accessToken:verified.accessToken}
  }
  async function userRequest(method:'GET'|'PUT',path:string,data?:unknown):Promise<SyncHttpResponse>{
    const verified=await getVerifiedSession()
    const response=await http.request({
      url:origin+path,method,
      header:{
        Authorization:'Bearer '+verified.accessToken,
        Accept:'application/json',
        'Content-Type':'application/json'
      },
      ...(data===undefined?{}:{data})
    })
    if(response.statusCode===401){
      // A session revoked server-side must be reacquired using a NEW code.
      session=null
      throw Error('wechat_session_authorization_required')
    }
    if(response.statusCode===403)
      throw Error('wechat_session_access_denied')
    if(response.statusCode!==200)throw Error('wechat_session_cloud_unavailable')
    return response
  }
  function validateStatus(raw:unknown):FutureCloudStatus{
    const body=raw as Record<string,unknown>|null
    if(!body||typeof body!=='object'||typeof body.enabled!=='boolean'||
       typeof body.hasStoredBackup!=='boolean'||
       !(body.revision===null||(Number.isSafeInteger(body.revision)&&Number(body.revision)>=1))||
       !(body.lastSuccessAt===null||
         typeof body.lastSuccessAt==='string'&&body.lastSuccessAt.length<100))
      throw Error('wechat_session_status_invalid')
    return body as FutureCloudStatus
  }
  function clear(){
    generation++
    session=null
    ownerLock=null
    inProgress=null
  }
  return {
    getVerifiedSession,
    async getStatus(){
      return validateStatus((await userRequest('GET','/v1/backup/status')).data)
    },
    async setCloudConsent(enabled:boolean,noticeVersion:string){
      if(typeof enabled!=='boolean'||typeof noticeVersion!=='string'||
         !/^[-.a-zA-Z0-9_]{3,64}$/.test(noticeVersion))
        throw Error('wechat_session_invalid_consent')
      const response=await userRequest('PUT','/v1/backup/consent',{
        enabled,noticeVersion
      })
      return validateStatus(response.data)
    },
    async logoutCurrentDevice(){
      // Do NOT conflate locally discarding a bearer with revoking its JWT.
      // Retain the cached session when the network cannot confirm revocation.
      // UI must show failure and must not claim sign-out succeeded.
      const verified=await getVerifiedSession()
      const response=await http.request({
        url:origin+'/v1/auth/logout',method:'POST',
        header:{
          Authorization:'Bearer '+verified.accessToken,
          Accept:'application/json'
        }
      })
      if(response.statusCode!==204)throw Error('wechat_session_logout_not_confirmed')
      clear()
    },
    async checkCancellationStatus(){
      // This endpoint MUST use the original still-valid token. Calling
      // getVerifiedSession here could issue a fresh wx.login and accidentally
      // CREATE a replacement account before deletion was verified.
      if(!session||session.expiry<=nowSeconds())
        throw Error('wechat_cancellation_original_session_expired')
      const response=await http.request({
        url:origin+'/v1/account/cancel/status',method:'GET',
        header:{Authorization:'Bearer '+session.accessToken,Accept:'application/json'}
      })
      if(response.statusCode!==200)
        throw Error('wechat_cancellation_status_unavailable')
      const body=response.data as Record<string,unknown>|null
      if(!body||typeof body!=='object'||
         !['closed','active','unknown'].includes(String(body.state))||
         Object.keys(body).length!==1)
        throw Error('wechat_cancellation_status_invalid')
      return body.state as 'closed'|'active'|'unknown'
    },
    async cancelCloudAccount(confirmation:string){
      if(confirmation!==ACCOUNT_CANCELLATION_CONFIRMATION)
        throw Error('wechat_account_cancellation_confirmation_required')
      const verified=await getVerifiedSession()
      const response=await http.request({
        url:origin+'/v1/account/cancel',method:'POST',
        header:{Authorization:'Bearer '+verified.accessToken,
          Accept:'application/json','Content-Type':'application/json'},
        data:{confirmation}
      })
      if(response.statusCode!==200){
        if(response.statusCode===401||response.statusCode===403){
          session=null
          throw Error('wechat_account_cancellation_authentication_required')
        }
        throw Error('wechat_account_cancellation_not_confirmed')
      }
      const receipt=response.data as Record<string,unknown>|null
      if(!receipt||typeof receipt!=='object'||receipt.deleted!==true||
         typeof receipt.privateBackupErased!=='boolean'||
         !Number.isSafeInteger(receipt.redactedAuditRows)||
         Number(receipt.redactedAuditRows)<0||
         receipt.retainedBackendData!==
           'anonymous_monthly_totals_and_redacted_security_audits')
        throw Error('wechat_account_cancellation_invalid_receipt')
      // Only an exact trusted server receipt confirms irreversible deletion.
      clear()
      return {deleted:true,privateBackupErased:receipt.privateBackupErased,
        redactedAuditRows:Number(receipt.redactedAuditRows)}
    },
    clearLocalSession:clear
  }
}
