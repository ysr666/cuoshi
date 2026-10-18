/**
 * Future v0.5 opt-in automatic cloud backup. Pure orchestration around an
 * injected transport and durable journal: NEVER imported by the v0.4 app.
 *
 * Calls sharing the same adapter use an in-process single-flight lock; a
 * production client must also serialize instances using the same durable
 * journal across page/app lifecycles and isolate journals by account/device.
 */
import {sha256} from '../../src/core/backup'
import {cloneState,validate,type Records} from '../../src/core/model'
import {stableJson} from './stableJson'
import type {CloudSnapshot,UploadDecision,UploadRequest,UploadReceipt} from './snapshotContract'

const id=/^[A-Za-z0-9_-]{8,128}$/
const hash=/^[a-f0-9]{64}$/
const digest=(records:Records)=>sha256(stableJson(records))
type Cursor={revision:number;digest:string}
type Pending={request:UploadRequest;expectedDigest:string;blocked?:boolean}
export type SyncJournal={
  version:1;ownerId:string;deviceId:string;cursor:Cursor;pending:Pending|null
}
export type SyncResult={
  kind:'synced'|'pending_local_changes'|'retry_later'|'manual_conflict'|
    'rejected'|'requires_first_link'
  revision?:number
  reason?:string
}
export type SyncPort={
  /** Synchronous, isolated durable storage; write must survive restart. */
  load():SyncJournal|null
  save(state:SyncJournal):void
  /** Validated JWT on transport, owner chosen only by backend session. */
  readCloud():Promise<CloudSnapshot|null>
  upload(req:UploadRequest):Promise<UploadDecision>
  readLocal():Records
  newIdempotencyKey():string
}
const copy=(state:SyncJournal):SyncJournal=>JSON.parse(JSON.stringify(state))
function checkOwner(ownerId:string,deviceId:string,consent:boolean){
  if(!id.test(ownerId)||!id.test(deviceId))throw Error('sync_unauthenticated')
  if(!consent)throw Error('sync_consent_required')
}
function verifyCloud(cloud:CloudSnapshot|null,ownerId:string):cloud is CloudSnapshot{
  if(cloud===null)return false
  if(cloud.ownerId!==ownerId)throw Error('sync_owner_mismatch')
  if(!Number.isSafeInteger(cloud.revision)||cloud.revision<1||
     !hash.test(cloud.digest))throw Error('sync_bad_cloud_revision')
  validate(cloud.records)
  if(digest(cloud.records)!==cloud.digest)throw Error('sync_cloud_integrity')
  return true
}
function verifyJournal(state:SyncJournal,ownerId:string,deviceId:string){
  if(!state||state.version!==1||state.ownerId!==ownerId||
     state.deviceId!==deviceId)throw Error('sync_wrong_identity_or_invalid_journal')
  if(!Number.isSafeInteger(state.cursor?.revision)||state.cursor.revision<1||
     typeof state.cursor?.digest!=='string'||!hash.test(state.cursor.digest))
    throw Error('sync_bad_cursor')
  if(state.pending){
    const p=state.pending
    if(!Number.isSafeInteger(p.request?.baseRevision)||
       p.request.baseRevision!==state.cursor.revision||
       p.request.baseDigest!==state.cursor.digest||
       !id.test(p.request.idempotencyKey)||!hash.test(p.expectedDigest))
      throw Error('sync_bad_pending')
    validate(p.request.records)
    if(digest(p.request.records)!==p.expectedDigest)throw Error('sync_pending_integrity')
  }
}
function durable(port:SyncPort,state:SyncJournal){
  port.save(copy(state))
  const fromDisk=port.load()
  if(!fromDisk||stableJson(fromDisk)!==stableJson(state))
    throw Error('sync_journal_not_durable')
}
/** Called ONLY after first-link readback has been confirmed. */
export function createLinkedJournal(
  ownerId:string,deviceId:string,cloud:CloudSnapshot,
  verifiedLocal:Records
):SyncJournal{
  checkOwner(ownerId,deviceId,true)
  verifyCloud(cloud,ownerId)
  validate(verifiedLocal)
  if(cloud.digest!==digest(verifiedLocal))throw Error('sync_initial_link_unverified')
  return {version:1,ownerId,deviceId,
    cursor:{revision:cloud.revision,digest:cloud.digest},pending:null}
}
function historyPreserved(before:Records,after:Records):boolean{
  if(after.events.length<before.events.length)return false
  for(let i=0;i<before.events.length;i++){
    if(stableJson(before.events[i])!==stableJson(after.events[i]))return false
  }
  // Server still independently enforces the stricter note metadata/ledger
  // validation. The client should refuse obvious historical rewrites early.
  for(const [dayKey,day] of Object.entries(before.days)){
    const now=after.days[dayKey]
    if(!now)return false
    const recent=after.events.slice(before.events.length)
    for(const note of day.notes){
      const found=now.notes.find(n=>n.id===note.id)
      if(found&&found.createdAt!==note.createdAt)return false
      if(found&&found.updatedAt!==note.updatedAt&&
         !recent.some(e=>e.type==='note_edit'&&e.noteId===note.id))
        return false
    }
  }
  return true
}
async function submit(port:SyncPort,state:SyncJournal,ownerId:string):Promise<SyncResult>{
  const pending=state.pending
  if(!pending)throw Error('sync_no_pending')
  if(pending.blocked)return {kind:'manual_conflict',reason:'previous_conflict'}
  let decision:UploadDecision
  try{decision=await port.upload(cloneRequest(pending.request))}
  catch{return {kind:'retry_later',reason:'upload_unknown'} }
  if(decision.kind==='conflict'){
    state.pending={...pending,blocked:true}
    durable(port,state)
    return {kind:'manual_conflict',reason:decision.reason}
  }
  if(decision.kind==='rejected'){
    // Includes revoked consent, authentication and invalid historical data.
    return {kind:'rejected',reason:decision.reason}
  }
  const receipt=decision.receipt
  // Both accepted and replayed must be independently verified; a lost HTTP
  // response can safely retry the identical payload and idempotency key.
  let cloud:CloudSnapshot|null
  try{cloud=await port.readCloud()}
  catch{return {kind:'retry_later',reason:'readback_unavailable'} }
  let verified=false
  try{verified=verifyCloud(cloud,ownerId)}
  catch{verified=false}
  if(!cloud||!verified||!receiptMatches(receipt,cloud,pending,ownerId)){
    // An inconsistent server readback is NOT transient network downtime:
    // halt unattended retries until the owner has reconciled the snapshot.
    state.pending={...pending,blocked:true}
    durable(port,state)
    return {kind:'manual_conflict',reason:'readback_mismatch'}
  }
  const updated:SyncJournal={
    ...state,cursor:{revision:cloud.revision,digest:cloud.digest},pending:null
  }
  durable(port,updated)
  const local=port.readLocal()
  validate(local)
  return {
    kind:digest(local)===cloud.digest?'synced':'pending_local_changes',
    revision:cloud.revision
  }
}
function cloneRequest(req:UploadRequest):UploadRequest{
  return {...req,records:cloneState(req.records)}
}
function receiptMatches(receipt:UploadReceipt,cloud:CloudSnapshot,p:Pending,ownerId:string){
  return receipt.ownerId===ownerId&&receipt.idempotencyKey===p.request.idempotencyKey&&
    receipt.revision===cloud.revision&&receipt.revision===p.request.baseRevision+1&&
    receipt.digest===p.expectedDigest&&cloud.digest===p.expectedDigest&&
    stableJson(cloud.records)===stableJson(p.request.records)
}
/**
 * Single iteration: call after a local edit, reconnect, app foreground, or
 * scheduled retry. Caller must persist journal BEFORE attempting any upload.
 * Never resets the first-link cursor or silently merges divergent devices.
 */
const inFlight=new WeakSet<SyncPort>()
export async function runAutomaticSyncOnce(port:SyncPort,args:{
  ownerId:string;deviceId:string;consentEnabled:boolean
}):Promise<SyncResult>{
  if(inFlight.has(port))return {kind:'retry_later',reason:'sync_already_running'}
  inFlight.add(port)
  try{
  const {ownerId,deviceId,consentEnabled}=args
  checkOwner(ownerId,deviceId,consentEnabled)
  const state=port.load()
  if(!state)return {kind:'requires_first_link'}
  verifyJournal(state,ownerId,deviceId)
  if(state.pending)return await submit(port,copy(state),ownerId)
  let cloud:CloudSnapshot|null
  try{cloud=await port.readCloud()}
  catch{return {kind:'retry_later',reason:'cloud_unavailable'} }
  if(!verifyCloud(cloud,ownerId))return {kind:'manual_conflict',reason:'cloud_missing_after_link'}
  if(cloud.revision!==state.cursor.revision||cloud.digest!==state.cursor.digest)
    return {kind:'manual_conflict',reason:'cloud_revision_changed'}
  const current=port.readLocal()
  validate(current)
  if(digest(current)===cloud.digest)return {kind:'synced',revision:cloud.revision}
  if(!historyPreserved(cloud.records,current))
    return {kind:'manual_conflict',reason:'history_diverged'}
  const key=port.newIdempotencyKey()
  if(!id.test(key))throw Error('sync_bad_idempotency_key')
  const request:UploadRequest={
    baseRevision:cloud.revision,baseDigest:cloud.digest,
    idempotencyKey:key,records:cloneState(current)
  }
  const staged:SyncJournal={...state,pending:{request,expectedDigest:digest(current)}}
  durable(port,staged)
  return await submit(port,staged,ownerId)
  }finally{
    inFlight.delete(port)
  }
}
