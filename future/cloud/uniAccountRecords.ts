/**
 * v0.5 per-owner local store for cloud-first mini-program.
 * Explicitly account scoped. NEVER reads old unscoped v0.4 history as
 * an account's data unless a one-time, informed legacy claim is requested.
 *
 * Uses injected uni-compatible synchronous storage, not global wx/uni.
 * Records commit notifications are emitted ONLY after durable write/readback.
 */
import {sha256} from '../../src/core/backup'
import {cloneState,fresh,validate,type Records} from '../../src/core/model'
import {stableJson} from './stableJson'
import {localSyncKey} from './clientAdapters'
import type {SyncJournal} from './automaticSync'
const LEGACY='cuoshi-uni-v1'
const CLAIM='cuoshi-future-v05-legacy-owner-v1'
export type AccountRecordStorage={
  getStorageSync(key:string):unknown
  setStorageSync(key:string,value:unknown):void
  removeStorageSync(key:string):void
}
const digest=(value:Records)=>sha256(stableJson(value))
const safeRead=(storage:AccountRecordStorage,key:string):unknown=>{
  const raw=storage.getStorageSync(key)
  if(raw===''||raw===null||raw===undefined)return undefined
  if(typeof raw==='string'){
    if(key===CLAIM)return raw
    try{return JSON.parse(raw)}catch{throw Error('cloud_records_corrupt')}
  }
  return raw
}
const readRecords=(storage:AccountRecordStorage,key:string):Records=>{
  const raw=safeRead(storage,key)
  if(raw===undefined)return fresh()
  try{validate(raw as Records)}catch{throw Error('cloud_records_invalid')}
  return cloneState(raw as Records)
}
type ChangeListener=()=>void
export function createUniAccountRecords(args:{
  storage:AccountRecordStorage;ownerId:string;deviceId:string
}){
  const {storage,ownerId,deviceId}=args
  if(typeof storage?.getStorageSync!=='function'||
     typeof storage?.setStorageSync!=='function'||
     typeof storage?.removeStorageSync!=='function')
    throw Error('cloud_records_storage_required')
  // Do not accidentally use legacy global storage as account store.
  const ownerHash=sha256(stableJson(ownerId))
  const key='cuoshi-future-v05-owner-records-v1:'+ownerHash
  const adoptionKey='cuoshi-future-v05-cloud-adoption-v1:'+ownerHash
  localSyncKey(ownerId,deviceId) // validates both IDs
  type Adoption={version:1;ownerId:string;before:Records;
    beforeDigest:string;afterDigest:string}
  function pendingAdoption():Adoption|null{
    const stage=safeRead(storage,adoptionKey) as Adoption|undefined
    if(stage===undefined)return null
    try{
      if(stage?.version!==1||stage.ownerId!==ownerId||
         !/^[a-f0-9]{64}$/.test(stage.beforeDigest)||
         !/^[a-f0-9]{64}$/.test(stage.afterDigest))
        throw Error('invalid')
      validate(stage.before)
      if(digest(stage.before)!==stage.beforeDigest)
        throw Error('invalid')
    }catch{throw Error('cloud_records_adoption_corrupt')}
    return stage
  }
  function clearAdoption(){
    storage.removeStorageSync(adoptionKey)
    if(pendingAdoption()!==null)throw Error('cloud_records_adoption_cleanup_failed')
  }
  /**
   * Recover an interrupted two-key local write. The old snapshot is restored
   * ONLY if the new cloud revision cursor was NOT durably saved. If user
   * edits occurred after a partial write, block instead of erasing them.
   */
  function recoverAdoption(journal:SyncJournal|null):void{
    const stage=pendingAdoption()
    if(!stage)return
    const main=digest(readRecords(storage,key))
    if(journal&&(journal.ownerId!==ownerId||journal.deviceId!==deviceId))
      throw Error('cloud_records_adoption_wrong_journal')
    const cursorDigest=journal?.cursor.digest??null
    if(main===stage.afterDigest&&cursorDigest===stage.afterDigest){
      clearAdoption()
      return
    }
    if(main===stage.beforeDigest&&cursorDigest!==stage.afterDigest){
      clearAdoption()
      return
    }
    if(main===stage.afterDigest&&cursorDigest!==stage.afterDigest){
      // Main record got newer cloud data but the cursor did not. Roll back to
      // preserved before-image, then retry cloud pull after reconciliation.
      storage.setStorageSync(key,cloneState(stage.before))
      if(digest(readRecords(storage,key))!==stage.beforeDigest)
        throw Error('cloud_records_adoption_rollback_failed')
      clearAdoption()
      return
    }
    throw Error('cloud_records_adoption_manual_recovery')
  }
  function finalizeAdoption(){
    const stage=pendingAdoption()
    if(!stage)return
    if(digest(readRecords(storage,key))!==stage.afterDigest)
      throw Error('cloud_records_adoption_changed')
    clearAdoption()
  }
  const listeners=new Set<ChangeListener>()
  const notify=()=>{for(const listener of [...listeners]){
    try{listener()}catch{} // listener failures must not undo durable write
  }}
  const storeVerified=(value:Records)=>{
    validate(value)
    const copy=cloneState(value)
    storage.setStorageSync(key,copy)
    if(digest(readRecords(storage,key))!==digest(copy))
      throw Error('cloud_records_not_durable')
  }
  function read():Records{return readRecords(storage,key)}
  function onRecordSaved(listener:ChangeListener){
    if(typeof listener!=='function')throw Error('cloud_records_listener_required')
    listeners.add(listener)
    return ()=>{listeners.delete(listener)}
  }
  function commit(change:(draft:Records)=>boolean):boolean{
    if(typeof change!=='function')throw Error('cloud_records_commit_required')
    if(pendingAdoption())throw Error('cloud_records_adoption_pending')
    const original=read(),before=digest(original)
    const edited=cloneState(original)
    if(!change(edited))return false
    validate(edited)
    // This is an explicit stale-write guard, not a cross-process CAS.
    if(digest(read())!==before)throw Error('cloud_records_changed')
    if(digest(edited)===before)return false
    storeVerified(edited)
    notify()
    return true
  }
  /** Automatic cloud hydration ONLY when caller has verified remote owner,
   * remote hash, and that the local history is clean. No draft deletion.
   * The engine must persist its remote cursor immediately after this call.
   */
  async function replaceCleanLocal(remote:Records,expected:string):Promise<void>{
    if(!/^[a-f0-9]{64}$/.test(expected))throw Error('cloud_records_digest_required')
    if(digest(read())!==expected)throw Error('cloud_records_changed')
    if(pendingAdoption())throw Error('cloud_records_adoption_pending')
    const staged=cloneState(remote)
    validate(staged)
    const before=read(),beforeDigest=digest(before),afterDigest=digest(staged)
    if(beforeDigest===afterDigest)return
    const pending:Adoption={version:1,ownerId,before,beforeDigest,afterDigest}
    storage.setStorageSync(adoptionKey,JSON.parse(JSON.stringify(pending)))
    if(stableJson(pendingAdoption())!==stableJson(pending))
      throw Error('cloud_records_adoption_not_durable')
    // NEVER clear the adoption before-image until the cloud engine confirms
    // that the new linked cursor was independently saved and read back.
    storeVerified(staged)
    // No notify(): server-hydration must not trigger a duplicate upload.
  }
  /**
   * First-use onboarding only. User has already read a cloud privacy notice,
   * chosen this verified account, and wishes to link prior local v0.4 data.
   * The global legacy data is NOT removed as part of this claim.
   */
  function claimLegacyOnce():boolean{
    if(pendingAdoption())throw Error('cloud_records_adoption_pending')
    const marked=safeRead(storage,CLAIM)
    if(marked!==undefined&&marked!==ownerId)
      throw Error('cloud_records_legacy_owned_by_another_account')
    const legacy=safeRead(storage,LEGACY)
    if(legacy===undefined)return false
    try{validate(legacy as Records)}catch{throw Error('cloud_records_legacy_invalid')}
    const old=cloneState(legacy as Records)
    const existing=safeRead(storage,key)
    if(existing!==undefined){
      const active=read()
      if(marked===ownerId)return false // do not replay old history over edits
      if(digest(active)!==digest(old))
        throw Error('cloud_records_legacy_account_not_empty')
    }
    // Claim ownership BEFORE moving sensitive history to the account key.
    // If a later write fails, this owner can retry; a different login cannot
    // take the same unscoped legacy records.
    if(marked===undefined){
      storage.setStorageSync(CLAIM,ownerId)
      if(safeRead(storage,CLAIM)!==ownerId)
        throw Error('cloud_records_legacy_claim_not_durable')
    }
    if(existing===undefined){
      storeVerified(old)
      notify()
      return true
    }
    return marked===undefined
  }
  return {key,read,commit,onRecordSaved,replaceCleanLocal,claimLegacyOnce,
    recoverAdoption,finalizeAdoption}
}
