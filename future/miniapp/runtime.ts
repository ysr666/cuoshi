import {reactive} from 'vue'
import {createWeChatSessionManager} from '../cloud/wechatSession'
import {createUniRequestTransport} from '../cloud/clientAdapters'
import {createUniCloudHost,type UniCloudPlatform} from '../cloud/uniCloudHost'
import {createCloudRecordActions} from '../cloud/cloudRecordActions'
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
let host:Host|null=null,actions:Actions|null=null,task:Promise<void>|null=null
const foreground=new Set<()=>void>(),pool:string[]=[]
let filling:Promise<void>|null=null
const accepted=()=>uni.getStorageSync(NOTICE)===cloudNoticeVersion
function randomBytes(length:number):Promise<Uint8Array>{
 return new Promise((resolve,reject)=>{
  const api=uni as typeof uni&{getRandomValues?:(o:{
   length:number;success:(x:{randomValues:ArrayBuffer})=>void;fail:(e:unknown)=>void
  })=>void}
  if(!api.getRandomValues){reject(Error('微信安全随机数服务不可用'));return}
  api.getRandomValues({length,success(x){
   if(!x.randomValues||x.randomValues.byteLength!==length){
    reject(Error('安全随机数长度异常'));return
   }
   resolve(new Uint8Array(x.randomValues))
  },fail(){reject(Error('微信安全随机数服务不可用'))}})
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
function update(){
 const data=host?.cloud.state()
 if(!data)return
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
  onState:update,onError(e){state.message=e instanceof Error?e.message:'同步暂不可用'}
 })
 // A separate session inside the host must also verify the same owner
 // BEFORE opening any old private records on screen.
 const confirmed=await host.session.getVerifiedSession()
 if(confirmed.ownerId!==identity.ownerId)throw Error('微信账号在登录期间发生变化')
 actions=createCloudRecordActions({
  ownerId:identity.ownerId,storage:p,store:host.store
 })
 host.start()
 state.stage='ready'
 update()
}
export function start():Promise<void>{
 if(task||state.stage==='ready')return task??Promise.resolve()
 if(!accepted()){state.stage='notice';return Promise.resolve()}
 state.stage='connecting';state.message='正在验证微信账号…'
 task=connect().catch(e=>{
  state.message=e instanceof Error?e.message:String(e)
  state.stage=/network|网络|unavailable|超时/i.test(state.message)?'offline':'blocked'
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
 if(host&&state.stage==='ready'){
  void host.cloud.onNetworkRestored().then(update)
 }else void start()
}
export function settings(){uni.navigateTo({url:'/pages/settings/index'})}
