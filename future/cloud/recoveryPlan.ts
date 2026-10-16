/**
 * Future cloud restore safety contract. NOT imported by the current v0.4 app.
 * Does not contact a server or change local storage. The real UI must verify
 * that local export was saved before confirming an irreversible replacement.
 */
import {sha256,parseBackup} from '../../src/core/backup'
import {cloneState,fresh,validate,type Records} from '../../src/core/model'
import {stableJson} from './stableJson'
import type {CloudSnapshot} from './snapshotContract'

export type RestoreSummary={
  recordedDays:number
  explicitZeroDays:number
  noteOnlyDays:number
  notes:number
  historyEvents:number
}
export type RestoreChoice='replace_local'
export type RestorePreview={
  kind:'no_cloud_backup'|'already_identical'|'remote_available'|'manual_conflict'
  localDigest:string
  cloudDigest:string|null
  cloudRevision:number|null
  ownerId:string
  local:RestoreSummary
  remote:RestoreSummary|null
}
export const RESTORE_CONFIRMATION='确认用云备份替换本机记录'
const idPattern=/^[A-Za-z0-9_-]{8,128}$/
function digest(records:Records){return sha256(stableJson(records))}
function summary(records:Records):RestoreSummary{
  const days=Object.values(records.days)
  return {
    recordedDays:days.filter(day=>day.count!==null).length,
    explicitZeroDays:days.filter(day=>day.count===0).length,
    noteOnlyDays:days.filter(day=>day.count===null&&day.notes.length>0).length,
    notes:days.reduce((sum,day)=>sum+day.notes.length,0),
    historyEvents:records.events.length
  }
}
function verifyCloud(snapshot:CloudSnapshot,ownerId:string):void{
  if(snapshot.ownerId!==ownerId)throw Error('cloud_owner_mismatch')
  if(!Number.isSafeInteger(snapshot.revision)||snapshot.revision<=0||
     typeof snapshot.digest!=='string'||!/^[a-f0-9]{64}$/.test(snapshot.digest))
    throw Error('invalid_cloud_snapshot')
  validate(snapshot.records)
  if(snapshot.digest!==digest(snapshot.records))throw Error('cloud_digest_mismatch')
}
function emptyLocal(records:Records):boolean{
  return records.theme==='paper'&&Object.keys(records.days).length===0&&
    records.events.length===0
}
/** Only metadata is returned: no note text, dates or complete journal content. */
export function previewCloudRestore(
  current:Records,cloud:CloudSnapshot|null,authenticatedOwnerId:string
):RestorePreview{
  if(!idPattern.test(authenticatedOwnerId))throw Error('invalid_authenticated_owner')
  validate(current)
  if(cloud)verifyCloud(cloud,authenticatedOwnerId)
  const localDigest=digest(current)
  const cloudDigest=cloud?.digest??null
  const kind=!cloud?'no_cloud_backup':
    cloudDigest===localDigest?'already_identical':
    emptyLocal(current)?'remote_available':'manual_conflict'
  return {
    kind,localDigest,cloudDigest,cloudRevision:cloud?.revision??null,
    ownerId:authenticatedOwnerId,local:summary(current),
    remote:cloud?summary(cloud.records):null
  }
}
/** Strongly fail closed if local/cloud content changed after preview.
 * This only creates a proposed replacement, does NOT save it to storage.
 */
export function prepareConfirmedCloudRestore(args:{
  current:Records
  cloud:CloudSnapshot
  preview:RestorePreview
  ownerId:string
  confirmation:string
  choice:RestoreChoice
  localExportJson?:string
  userConfirmedExportSaved?:boolean
}):Records{
  const {current,cloud,preview,ownerId,confirmation,choice}=args
  if(choice!=='replace_local'||confirmation!==RESTORE_CONFIRMATION)
    throw Error('restore_confirmation_required')
  const actual=previewCloudRestore(current,cloud,ownerId)
  if(actual.kind==='already_identical')return cloneState(current)
  if(actual.kind==='no_cloud_backup')throw Error('cloud_backup_unavailable')
  if(actual.kind!==preview.kind||actual.localDigest!==preview.localDigest||
     actual.cloudDigest!==preview.cloudDigest||
     actual.cloudRevision!==preview.cloudRevision||
     actual.ownerId!==preview.ownerId)throw Error('restore_preview_stale')
  if(actual.kind==='manual_conflict'){
    if(!args.userConfirmedExportSaved||typeof args.localExportJson!=='string')
      throw Error('local_backup_required')
    let backup:Records
    try{backup=parseBackup(args.localExportJson)}
    catch{throw Error('local_backup_invalid')}
    if(digest(backup)!==actual.localDigest)throw Error('local_backup_outdated')
  }
  // The caller MUST perform a separate atomic local commit, only after the
  // user confirms in UI. This function never touches the cloud or backend.
  return cloneState(cloud.records)
}
