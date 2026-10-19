/**
 * v0.5 first cloud link: real orchestrator around injected authenticated
 * transport, locally durable queues, and the existing pure migration proof.
 * Nothing here imports global wx/uni or a production URL.
 *
 * First link is intentionally separated from normal incremental sync because
 * it has no trustworthy remote cursor until a fully verified readback.
 */
import {sha256} from '../../src/core/backup'
import {validate,type Records} from '../../src/core/model'
import {stableJson} from './stableJson'
import {
  previewInitialMigration,prepareInitialMigration,verifyInitialMigration,
  INITIAL_MIGRATION_CONFIRMATION,
  type InitialMigrationPreview,type PreparedInitialMigration
} from './initialMigration'
import {
  createLinkedJournal,isSyncAuthenticationFailure,type SyncPort,type SyncJournal,type SyncResult
} from './automaticSync'
import {localSyncKey,type LocalSyncStorage} from './clientAdapters'
import type {CloudSnapshot,UploadDecision} from './snapshotContract'

const validId=(v:unknown):v is string=>
  typeof v==='string'&&/^[a-zA-Z0-9_-]{8,128}$/.test(v)
const validHash=(v:unknown)=>typeof v==='string'&&/^[0-9a-f]{64}$/.test(v)
const copy=<T>(v:T):T=>JSON.parse(JSON.stringify(v)) as T
const digest=(records:Records)=>sha256(stableJson(records))
const QUEUE_SUFFIX=':first_link_v1'
const MAX_QUEUE_BYTES=9*1024*1024
function byteSize(value:string):number{
  let bytes=0
  for(let i=0;i<value.length;i++){
    const code=value.charCodeAt(i)
    if(code<0x80)bytes++
    else if(code<0x800)bytes+=2
    else if(code>=0xd800&&code<=0xdbff&&i+1<value.length&&
      value.charCodeAt(i+1)>=0xdc00&&value.charCodeAt(i+1)<=0xdfff){
      bytes+=4;i++
    }else bytes+=3
  }
  return bytes
}
type Stage={
  version:1;ownerId:string;deviceId:string
  prepared:PreparedInitialMigration
  blocked:boolean
}
type Envelope={version:1;checksum:string;stage:Stage|null}

export type FirstLinkPort=Pick<SyncPort,
  'readLocal'|'readCloud'|'upload'|'newIdempotencyKey'|'load'|'save'>
  & {storage:LocalSyncStorage}
type LinkArgs={
  ownerId:string
  deviceId:string
  port:FirstLinkPort
  /** Must query a trusted cloud session/status, not a local toggle alone. */
  getConsent:()=>Promise<boolean>
}
const inFlight=new Set<string>()
function verifyStage(v:Stage,owner:string,device:string):void{
  if(!v||v.version!==1||v.ownerId!==owner||v.deviceId!==device||
     v.prepared?.ownerId!==owner||v.prepared.deviceId!==device||
     !validHash(v.prepared.localDigest)||
     v.prepared.request?.baseRevision!==0||
     v.prepared.request.baseDigest!==null||
     !validId(v.prepared.request.idempotencyKey)||
     typeof v.blocked!=='boolean')
    throw Error('first_link_stage_invalid')
  validate(v.prepared.request.records)
  if(digest(v.prepared.request.records)!==v.prepared.localDigest)
    throw Error('first_link_stage_integrity')
}

export function createFirstLinkRuntime(args:LinkArgs){
  const {ownerId,deviceId,port,getConsent}=args
  if(!validId(ownerId)||!validId(deviceId)||typeof getConsent!=='function'||
     typeof port?.readLocal!=='function'||typeof port?.readCloud!=='function'||
     typeof port?.upload!=='function'||typeof port?.load!=='function'||
     typeof port?.save!=='function'||typeof port?.newIdempotencyKey!=='function'||
     typeof port?.storage?.getStorageSync!=='function'||
     typeof port?.storage?.setStorageSync!=='function')
    throw Error('first_link_dependencies_required')
  const key=localSyncKey(ownerId,deviceId)+QUEUE_SUFFIX
  let reviewed:InitialMigrationPreview|null=null
  function readStage():Stage|null{
    const raw=port.storage.getStorageSync(key)
    if(raw===null||raw===undefined||raw==='')return null
    if(typeof raw!=='string')throw Error('first_link_stage_corrupt')
    let envelope:Envelope
    try{envelope=JSON.parse(raw) as Envelope}
    catch{throw Error('first_link_stage_corrupt')}
    if(!envelope||envelope.version!==1||
       !validHash(envelope.checksum)||
       envelope.checksum!==sha256(stableJson(envelope.stage)))
      throw Error('first_link_stage_corrupt')
    if(envelope.stage===null)return null
    verifyStage(envelope.stage,ownerId,deviceId)
    return copy(envelope.stage)
  }
  function writeStage(stage:Stage){
    verifyStage(stage,ownerId,deviceId)
    const value=JSON.stringify({
      version:1,checksum:sha256(stableJson(stage)),stage:copy(stage)
    } satisfies Envelope)
    if(byteSize(value)>MAX_QUEUE_BYTES)throw Error('first_link_queue_too_large')
    port.storage.setStorageSync(key,value)
    if(port.storage.getStorageSync(key)!==value)
      throw Error('first_link_stage_not_durable')
  }
  function finishStage(){
    // Overwrite rather than only remove: a success path must no longer
    // leave a second plaintext copy of the uploaded private history.
    const value=JSON.stringify({
      version:1,checksum:sha256(stableJson(null)),stage:null
    } satisfies Envelope)
    port.storage.setStorageSync(key,value)
    if(port.storage.getStorageSync(key)!==value)
      throw Error('first_link_stage_cleanup_not_durable')
  }
  function writeLinkedJournal(cloud:CloudSnapshot,records:Records){
    const journal=createLinkedJournal(ownerId,deviceId,cloud,records)
    port.save(journal)
    const saved=port.load()
    if(stableJson(saved)!==stableJson(journal))
      throw Error('first_link_journal_not_durable')
  }
  function hasVerifiedLink():boolean{
    const journal=port.load()
    return Boolean(journal&&journal.version===1&&journal.ownerId===ownerId&&
      journal.deviceId===deviceId&&journal.cursor.revision>=1&&
      validHash(journal.cursor.digest))
  }
  function hasUnsentChanges():boolean{
    const stage=readStage()
    const journal=port.load()
    if(stage&&!journal)return true
    if(journal?.pending)return true
    if(journal){
      const current=port.readLocal()
      validate(current)
      // A cursor means an earlier snapshot is stored remotely, not that all
      // edits made since that cursor were also uploaded.
      return digest(current)!==journal.cursor.digest
    }
    return false
  }
  async function review():Promise<InitialMigrationPreview>{
    if(!await getConsent())throw Error('first_link_consent_required')
    const local=port.readLocal()
    validate(local)
    const cloud=await port.readCloud()
    const preview=previewInitialMigration(local,cloud,ownerId)
    reviewed=preview
    // This metadata never contains note text. A private pending queue is
    // not implicitly replayed merely by opening a settings screen.
    return copy(preview)
  }
  async function confirm(
    confirmation:string
  ):Promise<SyncResult>{
    if(confirmation!==INITIAL_MIGRATION_CONFIRMATION)
      throw Error('first_link_confirmation_required')
    const flightKey=ownerId+':'+deviceId
    if(inFlight.has(flightKey))
      return {kind:'retry_later',reason:'first_link_in_progress'}
    inFlight.add(flightKey)
    try{
      if(!await getConsent())throw Error('first_link_consent_required')
      const alreadyLinked=port.load()
      if(alreadyLinked){
        // Existing cursors belong to ordinary sync. Never re-upload a create
        // request or replace an account-linked journal.
        if(alreadyLinked.ownerId!==ownerId||alreadyLinked.deviceId!==deviceId)
          throw Error('first_link_wrong_journal')
        return {kind:'requires_first_link',reason:'already_linked_use_sync'}
      }
      let staged=readStage()
      if(staged?.blocked)return {kind:'manual_conflict',reason:'first_link_blocked'}
      if(!staged){
        if(!reviewed)throw Error('first_link_preview_required')
        const local=port.readLocal()
        let cloud:CloudSnapshot|null
        try{cloud=await port.readCloud()}
        catch(e){return isSyncAuthenticationFailure(e)?
          {kind:'rejected',reason:'authentication'}:
          {kind:'retry_later',reason:'first_link_preflight_unavailable'}}
        // Identical snapshots from another device: no network PUT needed,
        // but require a fresh explicit review before linking this device.
        const latest=previewInitialMigration(local,cloud,ownerId)
        if(latest.status==='already_on_cloud'&&cloud){
          if(latest.localDigest!==reviewed.localDigest||
             latest.cloudDigest!==reviewed.cloudDigest||
             latest.cloudRevision!==reviewed.cloudRevision)
            return {kind:'manual_conflict',reason:'first_link_preview_stale'}
          writeLinkedJournal(cloud,local)
          finishStage()
          reviewed=null
          return {kind:'synced',revision:cloud.revision}
        }
        if(latest.status!=='upload_local')
          return {kind:'manual_conflict',reason:latest.status}
        let prepared:PreparedInitialMigration
        try{
          prepared=prepareInitialMigration({
            currentLocal:local,currentCloud:cloud,preview:reviewed,
            authenticatedOwnerId:ownerId,authenticatedDeviceId:deviceId,
            cloudConsentEnabled:true,confirmation,
            idempotencyKey:port.newIdempotencyKey()
          })
        }catch(e){
          if(e instanceof Error&&e.message==='migration_preview_stale')
            return {kind:'manual_conflict',reason:'first_link_preview_stale'}
          throw e
        }
        staged={version:1,ownerId,deviceId,prepared,blocked:false}
        // Persist the exact idempotency key AND the full private snapshot
        // before touching the network, or abort without any upload.
        writeStage(staged)
      }
      const expected=staged.prepared
      let decision:UploadDecision
      try{decision=await port.upload(copy(expected.request))}
      catch(e){return isSyncAuthenticationFailure(e)?
        {kind:'rejected',reason:'authentication'}:
        {kind:'retry_later',reason:'first_link_network_unknown'}}
      if(decision.kind==='conflict'){
        writeStage({...staged,blocked:true})
        return {kind:'manual_conflict',reason:decision.reason}
      }
      if(decision.kind==='rejected'){
        return {kind:'rejected',reason:decision.reason}
      }
      let cloud:CloudSnapshot|null
      try{cloud=await port.readCloud()}
      catch(e){return isSyncAuthenticationFailure(e)?
        {kind:'rejected',reason:'authentication'}:
        {kind:'retry_later',reason:'first_link_readback_unavailable'}}
      if(!cloud){
        writeStage({...staged,blocked:true})
        return {kind:'manual_conflict',reason:'first_link_missing_readback'}
      }
      let verified:ReturnType<typeof verifyInitialMigration>
      try{
        verified=verifyInitialMigration({
          prepared:expected,currentLocal:port.readLocal(),
          receipt:decision.receipt,readback:cloud,
          authenticatedOwnerId:ownerId
        })
      }catch{
        writeStage({...staged,blocked:true})
        return {kind:'manual_conflict',reason:'first_link_readback_mismatch'}
      }
      // If new local edits happened while uploading, initialize the cursor
      // with the exact acknowledged snapshot; the next normal sync uploads
      // additional events without touching earlier private history.
      writeLinkedJournal(cloud,expected.request.records)
      finishStage()
      reviewed=null
      return {
        kind:verified.status==='synced'?'synced':'pending_local_changes',
        revision:verified.cloudRevision
      }
    }finally{inFlight.delete(flightKey)}
  }
  return {review,confirm,hasVerifiedLink,hasUnsentChanges,
    // Diagnosable for tests, not a UI action to erase a staged payload.
    getPendingStage:readStage}
}
