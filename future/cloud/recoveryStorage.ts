/**
 * Future cloud restore: fault-tolerant local storage adapter.
 * NOT imported by v0.4. No uni global, no network, no automatic replacement.
 *
 * This is a journaled single-record replacement, not a guarantee of physical
 * atomicity for arbitrary platform storage. In an interrupted state it blocks
 * subsequent overwrites until a safe explicit reconciliation.
 */
import {sha256} from '../../src/core/backup'
import {cloneState,fresh,validate,type Records} from '../../src/core/model'
import {stableJson} from './stableJson'
import {
  prepareConfirmedCloudRestore,type RestorePreview,
  type RestoreChoice
} from './recoveryPlan'
import type {CloudSnapshot} from './snapshotContract'

export const CLOUD_RESTORE_MAIN_KEY='cuoshi-uni-v1'
export const CLOUD_RESTORE_DRAFTS_KEY='cuoshi-uni-drafts-v1'
export const CLOUD_RESTORE_JOURNAL_KEY='cuoshi-future-restore-journal-v1'

export type RestoreStorage={
  getStorageSync(key:string):unknown
  setStorageSync(key:string,value:unknown):void
  removeStorageSync(key:string):void
}
type RestoreJournal={
  version:1
  hadMain:boolean
  hadDrafts:boolean
  before:Records
  drafts:unknown
  beforeDigest:string
  afterDigest:string
  cloudRevision:number
}
export type PendingRestoreState='none'|'original_present'|'replacement_present'|'manual_recovery_required'

function read(storage:RestoreStorage,key:string):unknown{
  const item=storage.getStorageSync(key)
  if(typeof item==='string')return item.length?JSON.parse(item):undefined
  return item===''||item===null?undefined:item
}
function digest(records:Records){return sha256(stableJson(records))}
function readMain(storage:RestoreStorage){
  const existing=read(storage,CLOUD_RESTORE_MAIN_KEY)
  if(existing===undefined)return {exists:false,records:fresh()}
  validate(existing as Records)
  return {exists:true,records:existing as Records}
}
function readJournal(storage:RestoreStorage):RestoreJournal|null{
  const raw=read(storage,CLOUD_RESTORE_JOURNAL_KEY)
  if(raw===undefined)return null
  const j=raw as RestoreJournal
  if(!j||j.version!==1||typeof j.hadMain!=='boolean'||
     typeof j.hadDrafts!=='boolean'||typeof j.beforeDigest!=='string'||
     typeof j.afterDigest!=='string'||!Number.isSafeInteger(j.cloudRevision)||
     j.cloudRevision<=0)throw Error('restore_manual_recovery_required')
  try{validate(j.before)}catch{throw Error('restore_manual_recovery_required')}
  if(digest(j.before)!==j.beforeDigest)throw Error('restore_manual_recovery_required')
  return j
}
/** Never restores or destroys anything without separate explicit user action. */
export function inspectPendingCloudRestore(storage:RestoreStorage):PendingRestoreState{
  let journal:RestoreJournal|null
  try{journal=readJournal(storage)}
  catch{return 'manual_recovery_required'}
  if(!journal)return 'none'
  try{
    const local=readMain(storage)
    const actual=digest(local.records)
    if(local.exists===journal.hadMain&&actual===journal.beforeDigest)
      return 'original_present'
    if(actual===journal.afterDigest)return 'replacement_present'
  }catch{}
  return 'manual_recovery_required'
}
/** Clear only a journal whose old/new record matches the on-disk primary.
 * On replacement success, clears forgotten drafts to finish interrupted work.
 */
export function finishPendingCloudRestore(storage:RestoreStorage):PendingRestoreState{
  const status=inspectPendingCloudRestore(storage)
  if(status==='none')return status
  if(status==='manual_recovery_required')throw Error('restore_manual_recovery_required')
  if(status==='replacement_present')storage.removeStorageSync(CLOUD_RESTORE_DRAFTS_KEY)
  storage.removeStorageSync(CLOUD_RESTORE_JOURNAL_KEY)
  return status
}
/** Synchronously stage a recoverable before-image before updating primary.
 * The UI MUST obtain confirmation, original disk snapshot, and actual user
 * file-save acknowledgement beforehand. Returned data is a success report,
 * not a promise that a cloud server was contacted.
 */
export function commitConfirmedCloudRestore(storage:RestoreStorage,args:{
  current:Records
  cloud:CloudSnapshot
  preview:RestorePreview
  ownerId:string
  confirmation:string
  choice:RestoreChoice
  localExportJson?:string
  userConfirmedExportSaved?:boolean
}):{applied:boolean;cleanupPending:boolean}{
  if(inspectPendingCloudRestore(storage)!=='none')
    throw Error('restore_pending_reconciliation')
  const disk=readMain(storage)
  if(digest(disk.records)!==digest(args.current))
    throw Error('restore_local_state_changed')
  const next=prepareConfirmedCloudRestore({...args,current:disk.records})
  const beforeHash=digest(disk.records),afterHash=digest(next)
  if(beforeHash===afterHash)return {applied:false,cleanupPending:false}
  const drafts=read(storage,CLOUD_RESTORE_DRAFTS_KEY)
  const journal:RestoreJournal={
    version:1,hadMain:disk.exists,hadDrafts:drafts!==undefined,
    before:cloneState(disk.records),drafts:drafts===undefined?null:JSON.parse(JSON.stringify(drafts)),
    beforeDigest:beforeHash,afterDigest:afterHash,cloudRevision:args.cloud.revision
  }
  storage.setStorageSync(CLOUD_RESTORE_JOURNAL_KEY,journal)
  // Abort without touching primary if the backup journal wasn't persisted.
  if(inspectPendingCloudRestore(storage)!=='original_present')
    throw Error('restore_journal_write_failed')
  try{
    storage.setStorageSync(CLOUD_RESTORE_MAIN_KEY,cloneState(next))
    if(inspectPendingCloudRestore(storage)!=='replacement_present')
      throw Error('restore_write_verification_failed')
  }catch{
    // Best-effort rollback. If that too fails the original data remains in the
    // journal; no silent retry is permitted.
    try{
      if(journal.hadMain)storage.setStorageSync(CLOUD_RESTORE_MAIN_KEY,cloneState(journal.before))
      else storage.removeStorageSync(CLOUD_RESTORE_MAIN_KEY)
      if(inspectPendingCloudRestore(storage)==='original_present')
        storage.removeStorageSync(CLOUD_RESTORE_JOURNAL_KEY)
    }catch{}
    throw Error(inspectPendingCloudRestore(storage)==='manual_recovery_required'
      ?'restore_manual_recovery_required':'restore_write_failed')
  }
  try{
    storage.removeStorageSync(CLOUD_RESTORE_DRAFTS_KEY)
    storage.removeStorageSync(CLOUD_RESTORE_JOURNAL_KEY)
  }catch{
    // The primary is already confirmed; never claim the restoration failed
    // and provoke another replacement. Pending marker can be reconciled.
    return {applied:true,cleanupPending:true}
  }
  return {applied:true,cleanupPending:false}
}
