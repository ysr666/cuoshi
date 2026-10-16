/**
 * Future mainland cloud BACKEND contract prototype.
 * This file is not imported by the v0.4 app or deployed to any service.
 * Atomic persistence and authenticated sessions MUST be implemented server-side.
 */
import {canonical,sha256} from '../../src/core/backup'
import {cloneState,validate,type Records} from '../../src/core/model'

export type Principal={userId:string;deviceId:string;cloudBackupEnabled:boolean}
export type CloudSnapshot={
  ownerId:string
  revision:number
  digest:string
  records:Records
}
export type UploadRequest={
  baseRevision:number
  baseDigest:string|null
  idempotencyKey:string
  records:Records
}
export type UploadReceipt={
  ownerId:string
  revision:number
  digest:string
  idempotencyKey:string
}
export type UploadDecision=
 | {kind:'accepted';snapshot:CloudSnapshot;receipt:UploadReceipt}
 | {kind:'replayed';receipt:UploadReceipt}
 | {kind:'conflict';currentRevision:number;currentDigest:string|null;reason:'stale_revision'|'divergent_base'}
 | {kind:'rejected';reason:'authentication'|'validation'|'invalid_request'|'idempotency_mismatch'|'consent_required'|'history_rewrite'}

type PriorWrite={requestDigest:string;receipt:UploadReceipt}

/** Ephemeral deterministic simulation. Never use this class as a production cloud store. */
export class CloudContractSimulator{
  private snapshots=new Map<string,CloudSnapshot>()
  private receipts=new Map<string,PriorWrite>()
  private validId(id:string){return typeof id==='string'&&/^[a-zA-Z0-9_-]{8,128}$/.test(id)}
  readForOwner(principal:Principal,requestedOwner:string):CloudSnapshot|null{
    if(!principal||!this.validId(principal.userId)||principal.userId!==requestedOwner||!principal.cloudBackupEnabled)return null
    const snapshot=this.snapshots.get(principal.userId)
    return snapshot?{...snapshot,records:cloneState(snapshot.records)}:null
  }
  propose(principal:Principal,req:UploadRequest):UploadDecision{
    if(!principal||!this.validId(principal.userId)||!this.validId(principal.deviceId))
      return {kind:'rejected',reason:'authentication'}
    if(!principal.cloudBackupEnabled)return {kind:'rejected',reason:'consent_required'}
    if(!req||typeof req!=='object')return {kind:'rejected',reason:'invalid_request'}
    if(!Number.isSafeInteger(req.baseRevision)||req.baseRevision<0||
       typeof req.idempotencyKey!=='string'||!this.validId(req.idempotencyKey)||
       !(req.baseDigest===null||/^[a-f0-9]{64}$/.test(req.baseDigest)))
      return {kind:'rejected',reason:'invalid_request'}
    try{validate(req.records)}catch{return {kind:'rejected',reason:'validation'}}
    // Verify the complete document, including old note text, change timestamps and event IDs.
    const incomingDigest=sha256(canonical(req.records))
    const requestFingerprint=sha256(JSON.stringify([req.baseRevision,req.baseDigest,principal.deviceId,incomingDigest]))
    const receiptKey=principal.userId+':'+req.idempotencyKey
    const previous=this.receipts.get(receiptKey)
    if(previous){
      if(previous.requestDigest!==requestFingerprint)return {kind:'rejected',reason:'idempotency_mismatch'}
      return {kind:'replayed',receipt:{...previous.receipt}}
    }
    const current=this.snapshots.get(principal.userId)
    const revision=current?.revision??0
    const digest=current?.digest??null
    if(revision!==req.baseRevision)return {kind:'conflict',currentRevision:revision,currentDigest:digest,reason:'stale_revision'}
    if(digest!==req.baseDigest)return {kind:'conflict',currentRevision:revision,currentDigest:digest,reason:'divergent_base'}
    // A restore or offline client may not secretly erase or rewrite events
    // already acknowledged by the server, even when its base token is correct.
    if(current&&(req.records.events.length<current.records.events.length||
       current.records.events.some((event,index)=>JSON.stringify(event)!==JSON.stringify(req.records.events[index]))))
      return {kind:'rejected',reason:'history_rewrite'}
    const next:CloudSnapshot={
      ownerId:principal.userId,revision:revision+1,digest:incomingDigest,
      records:cloneState(req.records)
    }
    const receipt:UploadReceipt={
      ownerId:principal.userId,revision:next.revision,digest:next.digest,
      idempotencyKey:req.idempotencyKey
    }
    this.snapshots.set(principal.userId,next)
    this.receipts.set(receiptKey,{requestDigest:requestFingerprint,receipt})
    return {kind:'accepted',snapshot:{...next,records:cloneState(next.records)},receipt:{...receipt}}
  }
}
