/**
 * Future v0.5 mini-program adapter contracts. This module has NO global
 * uni/wx/browser access, network calls, live credentials or production URL.
 * A future authorized client must explicitly inject each capability.
 * DO NOT import in the v0.4 entrypoint.
 */
import {sha256} from '../../src/core/backup'
import {validate,type Records} from '../../src/core/model'
import {stableJson} from './stableJson'
import type {SyncJournal,SyncPort} from './automaticSync'
import type {CloudSnapshot,UploadRequest,UploadDecision} from './snapshotContract'

const validId=(x:unknown):x is string=>typeof x==='string'&&/^[A-Za-z0-9_-]{8,128}$/.test(x)
const validHash=(x:unknown)=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x)
const copy=<T>(value:T):T=>JSON.parse(JSON.stringify(value)) as T
const KEY_PREFIX='cuoshi_future_v05_sync_journal_v1:'
const MAX_JOURNAL_BYTES=12*1024*1024 // compressed transport is NOT assumed
function utf8Bytes(value:string):number{
  // UTF-8 byte length without requiring browser TextEncoder or Node Buffer.
  let n=0
  for(let i=0;i<value.length;i++){
    const c=value.charCodeAt(i)
    if(c<0x80)n++
    else if(c<0x800)n+=2
    else if(c>=0xd800&&c<=0xdbff&&i+1<value.length&&
            value.charCodeAt(i+1)>=0xdc00&&value.charCodeAt(i+1)<=0xdfff){
      n+=4;i++
    }else n+=3
  }
  return n
}

/** Storage APIs match uni.getStorageSync / uni.setStorageSync. */
export type LocalSyncStorage={
  getStorageSync(key:string):unknown
  setStorageSync(key:string,value:string):void
}
export type SyncHttpRequest={
  url:string
  method:'GET'|'PUT'
  header:Record<string,string>
  data?:unknown
}
export type SyncHttpResponse={statusCode:number;data:unknown}
export type SyncHttpTransport={
  request(input:SyncHttpRequest):Promise<SyncHttpResponse>
}
export type SyncAuthentication={
  /** Trusted client identity manager; the server still independently verifies JWT. */
  getVerifiedSession():Promise<{ownerId:string;accessToken:string}>
}
export type SyncHttpBridgeConfig={
  origin:string
  /** Bound at login, never taken from a request's user-supplied body. */
  ownerId:string
  http:SyncHttpTransport
  authentication:SyncAuthentication
}

/** Contains a hashed account/device partition, never raw user identifiers. */
export function localSyncKey(ownerId:string,deviceId:string):string{
  if(!validId(ownerId)||!validId(deviceId))throw Error('sync_bad_identity')
  return KEY_PREFIX+sha256(stableJson([ownerId,deviceId]))
}

type JournalEnvelope={
  version:1
  checksum:string
  journal:SyncJournal
}
export function createDurableJournalStore(args:{
  storage:LocalSyncStorage
  ownerId:string
  deviceId:string
}){
  const {storage,ownerId,deviceId}=args
  const key=localSyncKey(ownerId,deviceId)
  function read():SyncJournal|null{
    const raw=storage.getStorageSync(key)
    if(raw===undefined||raw===null||raw==='')return null
    if(typeof raw!=='string')throw Error('sync_journal_corrupt')
    let envelope:JournalEnvelope
    try{envelope=JSON.parse(raw) as JournalEnvelope}
    catch{throw Error('sync_journal_corrupt')}
    if(!envelope||envelope.version!==1||!envelope.journal||
       !validHash(envelope.checksum)||
       envelope.checksum!==sha256(stableJson(envelope.journal))||
       envelope.journal.ownerId!==ownerId||envelope.journal.deviceId!==deviceId)
      throw Error('sync_journal_corrupt_or_wrong_identity')
    return copy(envelope.journal)
  }
  function write(journal:SyncJournal):void{
    if(journal?.ownerId!==ownerId||journal?.deviceId!==deviceId)
      throw Error('sync_journal_cross_account_write')
    const snapshot=copy(journal)
    const envelope:JournalEnvelope={
      version:1,checksum:sha256(stableJson(snapshot)),journal:snapshot
    }
    const serialized=JSON.stringify(envelope)
    if(utf8Bytes(serialized)>MAX_JOURNAL_BYTES)throw Error('sync_journal_too_large')
    storage.setStorageSync(key,serialized)
    // Returning normally is not proof the platform actually stored data.
    if(storage.getStorageSync(key)!==serialized)
      throw Error('sync_journal_not_durable')
  }
  return {key,load:read,save:write}
}

function parseOrigin(raw:string):string{
  if(typeof raw!=='string'||!raw.trim())throw Error('sync_cloud_origin_required')
  let parsed:URL
  try{parsed=new URL(raw)}
  catch{throw Error('sync_cloud_origin_invalid')}
  // No userinfo, paths, query, fragments, alternate protocols or IP-literal
  // HTTP endpoints. The platform request whitelist must ALSO enforce this.
  if(parsed.protocol!=='https:'||parsed.username||parsed.password||
     parsed.pathname!=='/'||parsed.search||parsed.hash||
     !parsed.hostname.includes('.')||parsed.hostname==='localhost')
    throw Error('sync_cloud_origin_invalid')
  if(!/^https:\/\/[A-Za-z0-9.-]+(?::[0-9]+)?\/$/.test(parsed.href))
    throw Error('sync_cloud_origin_invalid')
  return parsed.origin
}
const authPattern=/^[A-Za-z0-9_\-\.]+$/
export function createAuthenticatedBackupHttpBridge(config:SyncHttpBridgeConfig){
  const origin=parseOrigin(config.origin)
  if(!validId(config.ownerId))throw Error('sync_http_owner_required')
  if(typeof config.http?.request!=='function'||
     typeof config.authentication?.getVerifiedSession!=='function')
    throw Error('sync_http_adapter_required')
  async function send(method:'GET'|'PUT',data?:unknown):Promise<SyncHttpResponse>{
    const session=await config.authentication.getVerifiedSession()
    // Critical account-switch boundary: a pending account A snapshot must
    // never be sent using account B's otherwise valid cloud JWT.
    if(!session||session.ownerId!==config.ownerId)
      throw Error('sync_session_owner_changed')
    const token=session.accessToken
    if(typeof token!=='string'||token.length<20||token.length>8192||
       !authPattern.test(token))throw Error('sync_access_token_missing')
    const response=await config.http.request({
      url:origin+'/v1/backup/snapshot',
      method,
      header:{
        Authorization:'Bearer '+token,
        Accept:'application/json',
        'Content-Type':'application/json'
      },
      ...(data===undefined?{}:{data:copy(data)})
    })
    if(!Number.isInteger(response?.statusCode))throw Error('sync_http_bad_response')
    return response
  }
  return {
    ownerId:config.ownerId,
    async readCloud():Promise<CloudSnapshot|null>{
      const response=await send('GET')
      if(response.statusCode===204||response.statusCode===404)return null
      if(response.statusCode!==200)throw Error('sync_cloud_read_unavailable')
      if(response.data===null)return null
      const cloud=response.data as CloudSnapshot
      if(!cloud||typeof cloud!=='object'||!validId(cloud.ownerId)||
         !Number.isSafeInteger(cloud.revision)||!validHash(cloud.digest)||
         !cloud.records||typeof cloud.records!=='object')
        throw Error('sync_cloud_read_invalid')
      return copy(cloud)
    },
    async upload(request:UploadRequest):Promise<UploadDecision>{
      if(!request||typeof request!=='object'||
         !Number.isSafeInteger(request.baseRevision)||
         request.baseRevision<0||
         !validId(request.idempotencyKey)||
         !(request.baseDigest===null||validHash(request.baseDigest)))
        throw Error('sync_bad_upload_request')
      validate(request.records)
      const serialized=JSON.stringify(request)
      if(utf8Bytes(serialized)>10*1024*1024)throw Error('sync_upload_too_large')
      const response=await send('PUT',request)
      if(response.statusCode===401||response.statusCode===403)
        return {kind:'rejected',reason:'authentication'}
      if(response.statusCode===422)
        return {kind:'rejected',reason:'validation'}
      const body=response.data as Record<string,any>
      if(response.statusCode===409){
        if(body?.kind!=='conflict'||!Number.isSafeInteger(body.currentRevision)||
           body.currentRevision<0||
           !(body.currentDigest===null||validHash(body.currentDigest))||
           !['stale_revision','divergent_base'].includes(body.reason))
          throw Error('sync_cloud_conflict_invalid')
        return {kind:'conflict',currentRevision:body.currentRevision,
          currentDigest:body.currentDigest,reason:body.reason}
      }
      if(response.statusCode!==200)throw Error('sync_upload_unavailable')
      if(body?.kind==='rejected'){
        if(!['authentication','validation','invalid_request','idempotency_mismatch',
              'consent_required','history_rewrite'].includes(body.reason))
          throw Error('sync_cloud_rejection_invalid')
        return {kind:'rejected',reason:body.reason}
      }
      if(body?.kind!=='accepted'&&body?.kind!=='replayed')
        throw Error('sync_cloud_upload_invalid')
      const receipt=body.receipt as Record<string,unknown>|undefined
      if(!receipt||!validId(receipt.ownerId)||
         !Number.isSafeInteger(receipt.revision)||Number(receipt.revision)<1||
         !validHash(receipt.digest)||!validId(receipt.idempotencyKey))
        throw Error('sync_cloud_receipt_invalid')
      if(body.kind==='accepted')return {
        kind:'accepted',snapshot:copy(body.snapshot) as CloudSnapshot,
        receipt:copy(receipt) as UploadDecision & any
      }
      return {kind:'replayed',receipt:copy(receipt) as UploadDecision & any}
    }
  }
}

/**
 * Real uni-app callback request shape, but still fully injected. Neither this
 * function nor the future cloud module makes an HTTP call without a caller
 * explicitly passing its platform API and trusted destination.
 */
export type UniRequestApi={
  request(input:SyncHttpRequest & {
    timeout:number
    success(response:unknown):void
    fail(reason:unknown):void
  }):void
}
export function createUniRequestTransport(
  uniApi:UniRequestApi,timeoutMs=15000
):SyncHttpTransport{
  if(typeof uniApi?.request!=='function'||!Number.isSafeInteger(timeoutMs)||
     timeoutMs<1000||timeoutMs>30000)throw Error('sync_uni_request_invalid')
  return {
    request(input):Promise<SyncHttpResponse>{
      return new Promise((resolve,reject)=>{
        try{
          uniApi.request({...input,timeout:timeoutMs,
            success(response:unknown){
              const data=response as Record<string,unknown>|null
              if(!data||!Number.isInteger(data.statusCode)){
                reject(Error('sync_http_bad_response'));return
              }
              resolve({statusCode:Number(data.statusCode),data:data.data})
            },
            fail(){reject(Error('sync_network_unavailable'))}
          })
        }catch{reject(Error('sync_network_unavailable'))}
      })
    }
  }
}

/** Glue that can be used only after trusted login, explicit consent and first link. */
export function createFutureSyncPort(args:{
  ownerId:string
  deviceId:string
  storage:LocalSyncStorage
  currentRecords:()=>Records
  http:ReturnType<typeof createAuthenticatedBackupHttpBridge>
  secureRequestId:()=>string
}):SyncPort{
  const journal=createDurableJournalStore(args)
  if(args.http?.ownerId!==args.ownerId)
    throw Error('sync_http_cross_account')
  if(typeof args.currentRecords!=='function'||typeof args.secureRequestId!=='function')
    throw Error('sync_client_dependencies_required')
  return {
    load:journal.load,save:journal.save,
    readLocal:()=>copy(args.currentRecords()),
    newIdempotencyKey:args.secureRequestId,
    readCloud:args.http.readCloud,upload:args.http.upload
  }
}
