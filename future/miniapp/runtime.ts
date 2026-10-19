import {reactive} from 'vue'
import {createWeChatSessionManager} from '../cloud/wechatSession'
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
 sync:'',date:localDate(),revision:0
})
const NOTICE='cuoshi-future-v05-miniapp-disclosure'
const DEVICE='cuoshi-future-v05-miniapp-device-id'
const OFFLINE_OWNER='cuoshi-future-v05-miniapp-last-verified-owner'
const OFFLINE_QUARANTINE='cuoshi-future-v05-miniapp-offline-reverification-required'
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
  state.sync='账号需要重新验证'
  state.revision++
  return
 }
 state.sync=data.phase==='synced'?'已同步':data.phase==='offline'?'暂未同步':
  data.phase==='checking'?'正在同步':data.phase==='notice'?'需要确认云端存储':
  data.phase==='attention'?'部分记录暂未同步':'等待同步'
 state.message=data.message
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
function offlineAfterVerifiedLoginFailure():boolean{
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
 state.message='网络异常，本机记录可继续填写；联网后会验证账号并自动补传。'
 state.revision++
 installOfflineNetworkWatch()
 return true
}
export function start():Promise<void>{
 if(task)return task
 if(state.stage==='ready'&&!offlineLocal)return Promise.resolve()
 if(!accepted()){state.stage='notice';return Promise.resolve()}
 state.stage='connecting';state.message='正在验证微信账号…'
 task=connect().catch(e=>{
  const reason=e instanceof Error?e.message:String(e)
  // Do NOT expose cached identity when server returned an authentication
  // or mismatched-owner error; only connectivity failures permit fallback.
  const network=/network|网络|unavailable|超时|wechat_login_unavailable|timeout/i.test(reason)
  if(network){
   try{if(offlineAfterVerifiedLoginFailure())return}
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
   '微信账号验证被拒绝，本机安全锁写入失败；请勿退出程序，先修复本机存储。':reason
  state.stage=network?'offline':'blocked'
 }).finally(()=>{task=null})
 return task
}
export async function consent(){
 if(host&&host.cloud.state().phase==='notice'){
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
