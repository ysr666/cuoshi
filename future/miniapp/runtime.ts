import {reactive} from 'vue'
import {createWeChatSessionManager,ACCOUNT_CANCELLATION_CONFIRMATION} from '../cloud/wechatSession'
import {createUniRequestTransport,createDurableJournalStore} from '../cloud/clientAdapters'
import {createUniCloudHost,type UniCloudPlatform} from '../cloud/uniCloudHost'
import {createCloudRecordActions} from '../cloud/cloudRecordActions'
import {createUniAccountRecords} from '../cloud/uniAccountRecords'
import {localDate} from '../../src/core/model'
import {cloudOrigin,cloudNoticeVersion} from './cloudConfig'
type Host=ReturnType<typeof createUniCloudHost>
type Actions=ReturnType<typeof createCloudRecordActions>
export const state=reactive({
 stage:'notice' as 'notice'|'connecting'|'ready'|'blocked'|'offline',
 message:'数字、选填简记和历次修改历史默认自动存入云端。首次使用请确认。',
 sync:'',consentRequired:false,cloudPaused:false,pausePending:false,date:localDate(),revision:0
})
const NOTICE='cuoshi-future-v05-miniapp-disclosure'
const DEVICE='cuoshi-future-v05-miniapp-device-id'
const OFFLINE_OWNER='cuoshi-future-v05-miniapp-last-verified-owner'
const OFFLINE_QUARANTINE='cuoshi-future-v05-miniapp-offline-reverification-required'
const ACCOUNT_CLOSED='cuoshi-future-v05-miniapp-account-closed-confirmed'
const CANCEL_PENDING='cuoshi-future-v05-miniapp-account-cancel-outcome-pending'
type OfflineBinding={version:1;ownerId:string;deviceId:string;noticeVersion:string}
const ownerPattern=/^[A-Za-z0-9_-]{8,128}$/
let host:Host|null=null,actions:Actions|null=null,task:Promise<void>|null=null
let offlineLocal=false
let offlineReconnectListener:((value:{isConnected:boolean})=>void)|null=null
const foreground=new Set<()=>void>(),pool:string[]=[]
let filling:Promise<void>|null=null
const accepted=()=>uni.getStorageSync(NOTICE)===cloudNoticeVersion
function ownerBinding(allowVerifiedLogin=false):OfflineBinding|null{
 const lock=uni.getStorageSync(OFFLINE_QUARANTINE)
 if(lock!==undefined&&lock!==null&&lock!==''&&lock!==true)
  throw Error('本机账号安全状态异常，已停止离线读取')
 if(lock===true&&!allowVerifiedLogin)
  throw Error('微信账号需要重新联网验证，离线记录已锁定')
 const value=uni.getStorageSync(OFFLINE_OWNER)
 if(value===undefined||value===null||value==='')return null
 if(!value||typeof value!=='object'||value.version!==1||
    typeof value.ownerId!=='string'||!ownerPattern.test(value.ownerId)||
    typeof value.deviceId!=='string'||!/^device[a-f0-9]{32}$/.test(value.deviceId)||
    value.noticeVersion!==cloudNoticeVersion)
  throw Error('本机账号归属标记异常，已保护本机记录')
 return value as OfflineBinding
}
function rememberOwner(ownerId:string,deviceId:string){
 if(!ownerPattern.test(ownerId)||!/^device[a-f0-9]{32}$/.test(deviceId))
  throw Error('账号身份未核验')
 const binding:OfflineBinding={version:1,ownerId,deviceId,noticeVersion:cloudNoticeVersion}
 // Only a newly completed, verified cloud cycle can unlock cold offline use.
 uni.removeStorageSync(OFFLINE_QUARANTINE)
 const lock=uni.getStorageSync(OFFLINE_QUARANTINE)
 if(lock!==undefined&&lock!==null&&lock!=='')
  throw Error('账号重新验证已成功，但离线权限解除未成功')
 uni.setStorageSync(OFFLINE_OWNER,binding)
 const saved=ownerBinding()
 if(!saved||saved.ownerId!==ownerId||saved.deviceId!==deviceId)
  throw Error('本机账号归属保存失败')
}
function releaseOfflineNetworkWatch(){
 if(offlineReconnectListener){
  uni.offNetworkStatusChange(offlineReconnectListener)
  offlineReconnectListener=null
 }
}
function installOfflineNetworkWatch(){
 if(offlineReconnectListener)return
 offlineReconnectListener=(event:{isConnected:boolean})=>{
  if(event?.isConnected)void start()
 }
 uni.onNetworkStatusChange(offlineReconnectListener)
}
// wx.getRandomValues is the documented WeChat cryptographic API.
// uni.getRandomValues is not a guaranteed UniApp shim; never silently
// fall back to Math.random or a non-cryptographic source.
declare const wx: {
 getRandomValues?:(options:{
  length:number
  success:(result:{randomValues:ArrayBuffer})=>void
  fail:(error:unknown)=>void
 })=>void
}
function randomBytes(length:number):Promise<Uint8Array>{
 return new Promise((resolve,reject)=>{
  const crypto=typeof wx==='undefined'?undefined:wx.getRandomValues
  if(typeof crypto!=='function'){
   reject(Error('微信安全随机数服务不可用'));return
  }
  try{
   wx.getRandomValues!({length,success(value){
    if(!(value?.randomValues instanceof ArrayBuffer)||
       value.randomValues.byteLength!==length){
     reject(Error('安全随机数长度异常'));return
    }
    resolve(new Uint8Array(value.randomValues))
   },fail(){reject(Error('微信安全随机数服务不可用'))}})
  }catch{reject(Error('微信安全随机数服务不可用'))}
 })
}
const hex=(b:Uint8Array)=>Array.from(b,x=>x.toString(16).padStart(2,'0')).join('')
async function refill(){
 if(filling)return filling
 filling=(async()=>{
  const bytes=await randomBytes(16*64)
  for(let i=0;i<64;i++)pool.push('request'+hex(bytes.slice(i*16,(i+1)*16)))
 })().finally(()=>{filling=null})
 return filling
}
function requestId(){
 if(pool.length<12)void refill().catch(()=>{})
 const item=pool.shift()
 if(!item)throw Error('安全请求编号暂不可用，本机记录已保留')
 return item
}
async function deviceId(){
 const old=uni.getStorageSync(DEVICE)
 if(old){
  if(typeof old!=='string'||!/^device[a-f0-9]{32}$/.test(old))
   throw Error('本机标识异常，已阻止同步')
  return old
 }
 const id='device'+hex(await randomBytes(16))
 uni.setStorageSync(DEVICE,id)
 if(uni.getStorageSync(DEVICE)!==id)throw Error('设备标识保存失败')
 return id
}
function platform():UniCloudPlatform{
 return {
  getStorageSync:k=>uni.getStorageSync(k),
  setStorageSync:(k,v)=>uni.setStorageSync(k,v),
  removeStorageSync:k=>uni.removeStorageSync(k),
  login({success,fail}){uni.login({provider:'weixin',
   success:v=>success({code:v.code}),fail})},
  request(o){uni.request({...o,data:o.data as Record<string,unknown>|undefined,
   success:v=>o.success({statusCode:v.statusCode,data:v.data}),fail:o.fail})},
  onNetworkStatusChange:cb=>uni.onNetworkStatusChange(cb),
  offNetworkStatusChange:cb=>uni.offNetworkStatusChange(cb)
 }
}
// Reject a cached offline owner on any explicit server authentication failure.
// Both the marker and removal are attempted independently: either one being
// durable is enough to reject a cold offline restart without deleting data.
function quarantineOfflineEntitlement():boolean{
 let marked=false,cleared=false
 try{
  uni.setStorageSync(OFFLINE_QUARANTINE,true)
  marked=uni.getStorageSync(OFFLINE_QUARANTINE)===true
 }catch{/* Still attempt to remove the old entitlement. */}
 try{
  uni.removeStorageSync(OFFLINE_OWNER)
  const left=uni.getStorageSync(OFFLINE_OWNER)
  cleared=left===undefined||left===null||left===''
 }catch{/* A durable quarantine marker independently denies offline access. */}
 return marked||cleared
}
function update(){
 const data=host?.cloud.state()
 if(!data)return
 if(data.identityInvalid){
  // Reject live use of a prior owner's data when remote session is revoked
  // or the verified owner changed. Do not delete account-scoped records.
  actions=null
  offlineLocal=false
  releaseOfflineNetworkWatch()
  host?.stop()
  host=null
  state.message=quarantineOfflineEntitlement()?
   '微信账号验证已失效，请重新检查连接；本机记录已保留。':
   '微信账号验证已失效，本机安全锁写入失败；请勿退出程序，先修复本机存储。'
  state.stage='blocked'
  state.consentRequired=false
  state.cloudPaused=false
  state.pausePending=false
  state.sync='账号需要重新验证'
  state.revision++
  return
 }
 const pause=host?.pauseStatus()
 state.cloudPaused=pause!==null
 state.pausePending=pause==='pending'
 state.consentRequired=data.consentRequired===true&&!state.cloudPaused
 state.sync=state.cloudPaused?'云端上传已暂停':data.consentRequired?'需要重新确认云端存储':
  data.phase==='synced'?'已同步':data.phase==='offline'?'暂未同步':
  data.phase==='checking'?'正在同步':data.phase==='notice'?'需要确认云端存储':
  data.phase==='attention'?'部分记录暂未同步':'等待同步'
 state.message=state.cloudPaused?
  state.pausePending?'本机自动上传已暂停，但服务器关闭授权尚未确认；联网后可再试。原有云记录不删除。':
   '已关闭该账号云端上传授权；可以继续在本机记录。重新确认后再自动上传。':
  data.message
 state.revision++
}
async function connect(){
 if(!/^https:\/\/[a-z0-9.-]+(?::\d{2,5})?$/.test(cloudOrigin)||
    /example|localhost/.test(cloudOrigin))
  throw Error('云服务尚未配置，本测试包不会登录或上传私人记录')
 await refill()
 const p=platform(),id=await deviceId()
 const preflight=createWeChatSessionManager({
  origin:cloudOrigin,deviceId:id,platform:p,http:createUniRequestTransport(p),
  nowSeconds:()=>Math.floor(Date.now()/1000)
 })
 const identity=await preflight.getVerifiedSession()
 host=createUniCloudHost({
  platform:p,origin:cloudOrigin,ownerId:identity.ownerId,deviceId:id,
  noticeVersion:cloudNoticeVersion,secureRequestId:requestId,
  nowSeconds:()=>Math.floor(Date.now()/1000),
  onForeground(cb){foreground.add(cb);return ()=>{foreground.delete(cb)}},
  onState(){
   update()
   // Only AFTER cloud consent was validated and a complete first sync
   // succeeded may this device use the last verified account offline.
   if(host?.cloud.state().phase==='synced'){
    try{rememberOwner(identity.ownerId,id)}
    catch(e){state.message=e instanceof Error?e.message:String(e)}
   }
  },
  onError(e){state.message=e instanceof Error?e.message:'同步暂不可用'}
 })
 // A separate session inside the host must also verify the same owner
 // BEFORE opening any old private records on screen.
 const confirmed=await host.session.getVerifiedSession()
 if(confirmed.ownerId!==identity.ownerId)throw Error('微信账号在登录期间发生变化')
 const prior=ownerBinding(true)
 if(prior&&prior.ownerId!==identity.ownerId){
  // A verified account switch instantly revokes the previous account's
  // offline-open permission; its actual private records remain unchanged
  // under its own account-specific key.
  actions=null
  uni.removeStorageSync(OFFLINE_OWNER)
  if(ownerBinding(true))throw Error('无法清除之前账号的离线使用权限')
 }
 actions=createCloudRecordActions({
  ownerId:identity.ownerId,storage:p,store:host.store
 })
 host.start()
 releaseOfflineNetworkWatch()
 offlineLocal=false
 state.stage='ready'
 update()
}
function offlineAfterVerifiedLoginFailure(rateLimited=false):boolean{
 // Offline editing is available only for the previously verified account
 // and only when local consent matches this exact privacy notice version.
 if(!accepted()||!cloudOrigin)return false
 const owner=ownerBinding()
 if(!owner)return false
 const storedDevice=uni.getStorageSync(DEVICE)
 if(storedDevice!==owner.deviceId)
  throw Error('本机账号与设备标识不一致，已暂停访问')
 const p=platform()
 const records=createUniAccountRecords({
  storage:p,ownerId:owner.ownerId,deviceId:owner.deviceId
 })
 // Recover a partially written cloud snapshot before allowing offline edits.
 const journal=createDurableJournalStore({
  storage:p,ownerId:owner.ownerId,deviceId:owner.deviceId
 })
 records.recoverAdoption(journal.load())
 actions=createCloudRecordActions({ownerId:owner.ownerId,storage:p,store:records})
 host?.stop()
 host=null
 offlineLocal=true
 state.stage='ready'
 state.sync='暂未同步'
 state.message=rateLimited?
  '登录请求较频繁，请稍后重新检查；本机记录可继续填写，尚未同步。':
  '网络异常，本机记录可继续填写；联网后会验证账号并自动补传。'
 state.revision++
 installOfflineNetworkWatch()
 return true
}
export function start():Promise<void>{
 if(uni.getStorageSync(ACCOUNT_CLOSED)===true){
  state.stage='blocked';state.sync='账号已注销'
  state.message='当前账号已注销。如需再次使用，请主动选择「重新开始」，创建全新账号；旧账号私人记录不会自动恢复。'
  state.revision++
  return Promise.resolve()
 }
 if(cancellationTask)return cancellationTask
 if(uni.getStorageSync(CANCEL_PENDING)===true){
  actions=null
  state.stage='blocked';state.sync='注销结果待核验'
  state.message='注销请求的结果未能确认。已暂停旧账号记录访问及所有自动登录，避免误建新账号。旧数据仍保留在本机。'
  state.revision++
  return Promise.resolve()
 }
 if(task)return task
 if(state.stage==='ready'&&!offlineLocal)return Promise.resolve()
 if(!accepted()){state.stage='notice';return Promise.resolve()}
 state.stage='connecting';state.message='正在验证微信账号…'
 task=connect().catch(e=>{
  const reason=e instanceof Error?e.message:String(e)
  // Do NOT expose cached identity when server returned an authentication
  // or mismatched-owner error; only connectivity failures permit fallback.
  const rateLimited=reason==='wechat_session_rate_limited'
  const network=rateLimited||/network|网络|unavailable|超时|wechat_login_unavailable|timeout/i.test(reason)
  if(network){
   try{if(offlineAfterVerifiedLoginFailure(rateLimited))return}
   catch(error){
    state.message=error instanceof Error?error.message:String(error)
    state.stage='blocked'
    return
   }
  }
  // Authentication or owner failures must revoke any former offline
  // view as well, even when a previous session was usable offline.
  actions=null
  host?.stop()
  host=null
  offlineLocal=false
  releaseOfflineNetworkWatch()
  const rejected=/^(?:wechat_session_(?:account_changed|authorization_required|access_denied|authentication_failed|invalid_response|status_invalid)|cloud_first_account_changed|微信账号在登录期间发生变化)$/.test(reason)
  const quarantined=rejected?quarantineOfflineEntitlement():true
  state.message=rejected&&!quarantined?
   '微信账号验证被拒绝，本机安全锁写入失败；请勿退出程序，先修复本机存储。':
   rateLimited?'登录请求较频繁，请稍后重试；本机记录已保留。':reason
  state.stage=network?'offline':'blocked'
 }).finally(()=>{task=null})
 return task
}
export async function consent(){
 // Explicit user gesture only. Revoked server consent is NEVER restored by
 // auto-reconnect, foreground refresh, or remembered global notice.
 if(host&&(host.cloud.state().phase==='notice'||
    host.cloud.state().consentRequired===true||host.pauseStatus()!==null)){
  await host.acceptNotice();update();return
 }
 const isFirst=!accepted()
 uni.setStorageSync(NOTICE,cloudNoticeVersion)
 if(!accepted())throw Error('无法保存首次确认')
 await start()
 // One first-use gesture is enough for the first authenticated account.
 // Do not use an old global confirmation to re-enable remotely revoked
 // consent on an account during later automatic launches.
 if(isFirst&&host?.cloud.state().phase==='notice'){
  await host.acceptNotice()
  update()
 }
}
/** Server opt-out is explicit; local upload stops durably first. */
export async function pauseCloudSaving(){
 if(!host||offlineLocal||state.stage!=='ready'||task||cancellationTask)
  throw Error('请先完成联网账号验证后再关闭云端保存')
 await host.pauseUploads()
 update()
}
/** Pending deletion must survive process restarts; the original signed
 * JWT is held in memory only, never put into wx persistent storage. A
 * dropped response must never silently re-register a new WeChat account.
 */
let cancellationTask:Promise<void>|null=null
let pendingCancellationHost:Host|null=null
function markCancellationResultConfirmed():void{
 pendingCancellationHost=null
 const durable=quarantineOfflineEntitlement()
 let closedMarked=false
 try{
  uni.setStorageSync(ACCOUNT_CLOSED,true)
  closedMarked=uni.getStorageSync(ACCOUNT_CLOSED)===true
 }catch{/* Keep pending marker to block cold auto-login. */}
 if(durable&&closedMarked){
  try{uni.removeStorageSync(CANCEL_PENDING)}catch{}
 }
 releaseOfflineNetworkWatch()
 host?.stop()
 host=null
 actions=null
 offlineLocal=false
 state.stage='blocked'
 state.sync='账号已注销'
 state.consentRequired=false
 state.message=durable&&closedMarked?
  '云端已核验账号注销成功，私人云记录与微信身份关联已清除。本机旧记录已锁定；再次使用须主动创建新账号。':
  '云端已核验注销成功，但本机安全标记保存失败；请勿退出或离线重启，先修复本机存储。'
 state.revision++
}
export function cancelAccount(confirmation:string):Promise<void>{
 if(confirmation!==ACCOUNT_CANCELLATION_CONFIRMATION)
  return Promise.reject(Error('请完整输入指定的注销确认语'))
 if(cancellationTask)return cancellationTask
 if(!host||offlineLocal||state.stage!=='ready'||task||
    uni.getStorageSync(CANCEL_PENDING)===true)
   return Promise.reject(Error('请先联网验证账号并处理未核验的注销请求'))
 const current=host
 // Must be durable BEFORE the first irreversible network request.
 try{
  uni.setStorageSync(CANCEL_PENDING,true)
  if(uni.getStorageSync(CANCEL_PENDING)!==true)
    throw Error('pending_not_persisted')
 }catch{
  return Promise.reject(Error('本机无法保存注销待核验标记，已阻止注销请求'))
 }
 state.stage='connecting'
 state.message='正在向云端确认注销，请勿退出…'
 state.revision++
 actions=null
 current.stop()
 cancellationTask=(async()=>{
   try{
     await current.session.cancelCloudAccount(confirmation)
     markCancellationResultConfirmed()
     return
   }catch(error){
     // Recheck the OLD valid bearer, without wx.login. If the server committed
     // but the response was lost, the deleted_at tombstone proves completion.
     let outcome:'closed'|'active'|'unknown'='unknown'
     try{outcome=await current.session.checkCancellationStatus()}catch{}
     if(outcome==='closed'){
       host=current
       markCancellationResultConfirmed()
       return
     }
     // An ACTIVE check cannot prove cancellation did not begin: the original
     // POST could still be in flight and commit just after this GET. Never
     // clear the durable pending barrier merely because a GET says active.
     pendingCancellationHost=current
     releaseOfflineNetworkWatch()
     host?.stop()
     host=null
     actions=null
     offlineLocal=false
     state.stage='blocked'
     state.sync='注销结果待核验'
     state.message='注销结果暂无法核实，已暂停旧账号访问及自动登录；不能视为注销成功。你可以稍后检查或主动选择重新开始。'
     state.revision++
     throw Error('wechat_account_cancellation_outcome_uncertain')
   }
 })().finally(()=>{cancellationTask=null})
 return cancellationTask
}
/** Retry only against the ORIGINAL in-memory JWT; never issue wx.login
 * during ambiguous account deletion. A cold restart intentionally cannot
 * reconstruct the sensitive token from local storage.
 */
export async function recheckCancellationOutcome(){
 if(uni.getStorageSync(CANCEL_PENDING)!==true||
    uni.getStorageSync(ACCOUNT_CLOSED)===true)
  throw Error('当前没有需要重新核验的注销请求')
 if(!pendingCancellationHost)
  throw Error('原注销会话已过期或小程序已重启，无法自动核验；请选择人工核对或自行承担风险重新开始')
 let result:'closed'|'active'|'unknown'
 try{result=await pendingCancellationHost.session.checkCancellationStatus()}
 catch{throw Error('暂时无法核验注销结果，请检查网络后重试')}
 if(result==='closed'){
  host=pendingCancellationHost
  markCancellationResultConfirmed()
  return
 }
 if(result==='active')
  throw Error('此刻账号仍有效，但原注销请求可能尚在处理；为防止误恢复，仍保持待核验状态')
 throw Error('账号状态无法确定，未解除注销待核验锁')
}
/** If an ambiguous cancellation survives process death, its bearer is gone.
 * Never recover that original bearer from storage; the user must consciously
 * accept that deletion may remain incomplete before making a new account.
 */
export async function restartAfterUnconfirmedCancellation(){
 if(uni.getStorageSync(CANCEL_PENDING)!==true||
    uni.getStorageSync(ACCOUNT_CLOSED)===true)
  throw Error('当前没有需要处理的注销待核验状态')
 if(!quarantineOfflineEntitlement())
  throw Error('本机安全锁保存失败，已阻止创建新账号')
 pendingCancellationHost=null
 uni.removeStorageSync(CANCEL_PENDING)
 if(uni.getStorageSync(CANCEL_PENDING)===true)
  throw Error('无法清除待核验状态，已阻止创建新账号')
 state.sync=''
 await start()
}
export function cancellationOutcomePending(){return uni.getStorageSync(CANCEL_PENDING)===true&&
 uni.getStorageSync(ACCOUNT_CLOSED)!==true}
export async function restartAfterCancellation(){
 if(uni.getStorageSync(ACCOUNT_CLOSED)!==true)
  throw Error('当前不存在需要重新开始的已注销账号')
 uni.removeStorageSync(ACCOUNT_CLOSED)
 if(uni.getStorageSync(ACCOUNT_CLOSED)===true)
  throw Error('无法保存重新开始的选择，请检查本机存储')
 // Deliberately leave previous offline quarantine intact until a NEW
 // verified owner explicitly consents and completes its cloud sync.
 state.sync=''
 await start()
}
export function accountWasCancelled(){return uni.getStorageSync(ACCOUNT_CLOSED)===true}
export function onForeground(){
 state.date=localDate()
 for(const fn of foreground)fn()
 state.revision++
}
export function getActions(){return actions}
export function changed(){state.revision++}
export function retry(){
 if(host&&state.stage==='ready'&&!offlineLocal){
  void host.cloud.onNetworkRestored().then(update)
 }else void start()
}
export function settings(){uni.navigateTo({url:'/pages/settings/index'})}
