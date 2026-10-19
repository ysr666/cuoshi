/**
 * v0.5 WeChat/uni-app host: complete dependency wiring, NOT a release entrypoint.
 *
 * Imports no global uni or wx. A future app supplies the platform only after
 * first-use cloud notice and production URL, approved privacy policy and
 * audited stable device identity are configured.
 *
 * v0.4 cannot reach this file: src/main.ts and src/App.vue do not import it.
 */
import type {CloudState} from './cloudFirst'
import {createCloudFirst} from './cloudFirst'
import {bindCloudFirstLifecycle} from './cloudFirstLifecycle'
import {
  createAuthenticatedBackupHttpBridge,createFutureSyncPort,
  createUniRequestTransport,createDurableJournalStore,type UniRequestApi
} from './clientAdapters'
import {createWeChatSessionManager,type WechatLoginApi} from './wechatSession'
import {createUniAccountRecords,type AccountRecordStorage} from './uniAccountRecords'
import {sha256} from '../../src/core/backup'
import {stableJson} from './stableJson'

type Connected={isConnected:boolean}
export type UniCloudPlatform=AccountRecordStorage&UniRequestApi&WechatLoginApi&{
  onNetworkStatusChange(callback:(result:Connected)=>void):void
  offNetworkStatusChange(callback:(result:Connected)=>void):void
}
export type UniCloudHostOptions={
  platform:UniCloudPlatform
  origin:string
  ownerId:string
  deviceId:string
  noticeVersion:string
  secureRequestId:()=>string
  onForeground:(callback:()=>void)=>()=>void
  nowSeconds:()=>number
  onState?:(state:CloudState)=>void
  onError?:(error:unknown)=>void
}
const noticeKey=(ownerId:string,version:string)=>
  'cuoshi-future-v05-cloud-consent-v1:'+sha256(stableJson([ownerId,version]))
export function createUniCloudHost(options:UniCloudHostOptions){
  const {platform,ownerId,deviceId,noticeVersion}=options
  if(typeof options.onForeground!=='function'||
     typeof options.secureRequestId!=='function'||
     typeof platform?.onNetworkStatusChange!=='function'||
     typeof platform?.offNetworkStatusChange!=='function')
    throw Error('cloud_host_dependencies_required')
  const storage:AccountRecordStorage={
    getStorageSync:key=>platform.getStorageSync(key),
    setStorageSync:(key,value)=>platform.setStorageSync(key,value),
    removeStorageSync:key=>platform.removeStorageSync?.(key)
  }
  const records=createUniAccountRecords({storage,ownerId,deviceId})
  // Crash repair happens before exposing any account-scoped records or
  // connecting background event callbacks.
  records.recoverAdoption(createDurableJournalStore({storage,ownerId,deviceId}).load())
  const remembered=noticeKey(ownerId,noticeVersion)
  const lastChoice=platform.getStorageSync(remembered)
  const approved=lastChoice===noticeVersion
  const consentPending=lastChoice===noticeVersion+':pending'
  if(lastChoice!==undefined&&lastChoice!==null&&lastChoice!==''&&
     lastChoice!==noticeVersion&&
     lastChoice!==noticeVersion+':pending')throw Error('cloud_host_notice_corrupt')
  const transport=createUniRequestTransport(platform)
  const session=createWeChatSessionManager({
    origin:options.origin,deviceId,platform,http:transport,
    nowSeconds:options.nowSeconds
  })
  const bridge=createAuthenticatedBackupHttpBridge({
    origin:options.origin,ownerId,http:transport,authentication:session
  })
  const sync=createFutureSyncPort({
    ownerId,deviceId,storage,currentRecords:records.read,http:bridge,
    secureRequestId:options.secureRequestId
  })
  const cloud=createCloudFirst({
    ownerId,deviceId,auth:session,port:{...sync,storage},
    noticeVersion,previouslyAcknowledged:approved,
    pendingFirstConsent:consentPending,
    onServerConsentConfirmed(){
      platform.setStorageSync(remembered,noticeVersion)
      if(platform.getStorageSync(remembered)!==noticeVersion)
        throw Error('cloud_host_consent_ack_not_durable')
    },
    replaceCleanLocal:records.replaceCleanLocal,
    finishCloudAdoption:records.finalizeAdoption,
    onChange:options.onState
  })
  let off:()=>void=()=>{}
  let started=false
  function start(){
    if(started)throw Error('cloud_host_already_started')
    started=true
    off=bindCloudFirstLifecycle({
      onRecordSaved:records.onRecordSaved,
      onForeground:options.onForeground,
      onNetworkStatusChange(listener){
        const handler=(result:Connected)=>listener(result?.isConnected===true)
        platform.onNetworkStatusChange(handler)
        return ()=>platform.offNetworkStatusChange(handler)
      }
    },cloud,options.onError)
    // Reopen triggers cloud refresh; no network before the initial notice.
    void cloud.onForeground()
    return stop
  }
  function stop(){
    if(!started)return
    started=false
    off()
    off=()=>{}
  }
  async function acceptNotice(){
    // User sees an explicit disclosure explaining cloud storage and history.
    // The legacy v0.4 records are NOT imported from an unrelated account.
    // Legacy storage is unscoped. Never inherit another account's history,
    // and do not prevent an unrelated account from using its empty partition.
    try{records.claimLegacyOnce()}
    catch(e){
      if(!(e instanceof Error&&
        e.message==='cloud_records_legacy_owned_by_another_account'))throw e
    }
    platform.setStorageSync(remembered,noticeVersion+':pending')
    if(platform.getStorageSync(remembered)!==noticeVersion+':pending')
      throw Error('cloud_host_notice_not_durable')
    return cloud.acceptCloudNotice()
  }
  return {
    store:records,
    cloud,
    session,
    acceptNotice,
    start,
    stop
  }
}
