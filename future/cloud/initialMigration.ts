/**
 * Future v0.5 first-account-link data migration.
 * Pure, offline contract: never reads storage, performs login, or contacts any
 * server. It must NOT be imported into the v0.4 release bundle.
 */
import {sha256} from '../../src/core/backup'
import {cloneState,validate,type Records} from '../../src/core/model'
import {stableJson} from './stableJson'
import type {CloudSnapshot,UploadRequest,UploadReceipt} from './snapshotContract'

const idPattern=/^[A-Za-z0-9_-]{8,128}$/
const hashPattern=/^[a-f0-9]{64}$/
const digest=(records:Records)=>sha256(stableJson(records))
const empty=(records:Records)=>records.theme==='paper'&&
  Object.keys(records.days).length===0&&records.events.length===0

function verifyCloud(cloud:CloudSnapshot|null,ownerId:string):void{
  if(!cloud)return
  if(cloud.ownerId!==ownerId)throw Error('migration_owner_mismatch')
  if(!Number.isSafeInteger(cloud.revision)||cloud.revision<=0||
     typeof cloud.digest!=='string'||!hashPattern.test(cloud.digest))
    throw Error('migration_bad_cloud_revision')
  validate(cloud.records)
  if(digest(cloud.records)!==cloud.digest)throw Error('migration_cloud_integrity')
}

export type InitialMigrationStatus=
  'upload_local'|'nothing_to_migrate'|'restore_cloud_separately'|
  'already_on_cloud'|'manual_conflict'

export type InitialMigrationPreview={
  status:InitialMigrationStatus
  ownerId:string
  localDigest:string
  cloudRevision:number
  cloudDigest:string|null
  localEventCount:number
  cloudEventCount:number
  localRecordedDays:number
  cloudRecordedDays:number
}

/** Only metadata. Private notes and historical text must not enter a preview. */
export function previewInitialMigration(
  local:Records,cloud:CloudSnapshot|null,authenticatedOwnerId:string
):InitialMigrationPreview{
  if(!idPattern.test(authenticatedOwnerId))throw Error('migration_unauthenticated')
  validate(local)
  verifyCloud(cloud,authenticatedOwnerId)
  const localDigest=digest(local)
  const cloudDigest=cloud?.digest??null
  const status:InitialMigrationStatus=cloud
    ? localDigest===cloudDigest?'already_on_cloud'
      :empty(local)?'restore_cloud_separately':'manual_conflict'
    :empty(local)?'nothing_to_migrate':'upload_local'
  return {
    status,ownerId:authenticatedOwnerId,localDigest,
    cloudRevision:cloud?.revision??0,cloudDigest,
    localEventCount:local.events.length,
    cloudEventCount:cloud?.records.events.length??0,
    localRecordedDays:Object.values(local.days).filter(d=>d.count!==null||d.notes.length>0).length,
    cloudRecordedDays:cloud?Object.values(cloud.records.days)
      .filter(d=>d.count!==null||d.notes.length>0).length:0
  }
}

export const INITIAL_MIGRATION_CONFIRMATION='确认将本机全部记录及历史首次备份到云端'

export type PreparedInitialMigration={
  ownerId:string
  deviceId:string
  localDigest:string
  request:UploadRequest
}

/**
 * Re-check both observed snapshots before preparing a strictly insert-only
 * upload. Production must fetch cloud status from an authenticated service
 * immediately before this call, and use transactional CAS on upload.
 */
export function prepareInitialMigration(args:{
  currentLocal:Records
  currentCloud:CloudSnapshot|null
  preview:InitialMigrationPreview
  authenticatedOwnerId:string
  authenticatedDeviceId:string
  cloudConsentEnabled:boolean
  confirmation:string
  idempotencyKey:string
}):PreparedInitialMigration{
  const {currentLocal,currentCloud,preview,authenticatedOwnerId,
    authenticatedDeviceId,cloudConsentEnabled,confirmation,idempotencyKey}=args
  if(!idPattern.test(authenticatedOwnerId)||!idPattern.test(authenticatedDeviceId))
    throw Error('migration_unauthenticated')
  if(!cloudConsentEnabled)throw Error('migration_consent_required')
  if(confirmation!==INITIAL_MIGRATION_CONFIRMATION)
    throw Error('migration_confirmation_required')
  if(!idPattern.test(idempotencyKey))throw Error('migration_idempotency_key_required')
  const actual=previewInitialMigration(currentLocal,currentCloud,authenticatedOwnerId)
  if(actual.ownerId!==preview?.ownerId||actual.localDigest!==preview.localDigest||
     actual.cloudRevision!==preview.cloudRevision||
     actual.cloudDigest!==preview.cloudDigest||actual.status!==preview.status)
    throw Error('migration_preview_stale')
  if(actual.status!=='upload_local')throw Error('migration_manual_action_required')
  // Never send only days/latest values: full events include prior note text,
  // operation timestamps, explicit zero and deletion events.
  return {
    ownerId:authenticatedOwnerId,deviceId:authenticatedDeviceId,
    localDigest:actual.localDigest,
    request:{baseRevision:0,baseDigest:null,idempotencyKey,
      records:cloneState(currentLocal)}
  }
}

export type VerifiedMigration={
  status:'synced'|'local_changed_after_upload'
  cloudRevision:number
  cloudDigest:string
  uploadedEventCount:number
}
/**
 * Upload acknowledgement ALONE cannot mean "cloud backed up". Require an
 * authenticated owner readback matching the submitted complete snapshot.
 * If a user kept editing while uploading, show pending sync, not "synced".
 */
export function verifyInitialMigration(args:{
  prepared:PreparedInitialMigration
  currentLocal:Records
  receipt:UploadReceipt
  readback:CloudSnapshot
  authenticatedOwnerId:string
}):VerifiedMigration{
  const {prepared,currentLocal,receipt,readback,authenticatedOwnerId}=args
  if(!prepared||prepared.ownerId!==authenticatedOwnerId||
     !idPattern.test(authenticatedOwnerId))
    throw Error('migration_owner_mismatch')
  validate(currentLocal)
  verifyCloud(readback,authenticatedOwnerId)
  const expected=digest(prepared.request.records)
  if(prepared.localDigest!==expected||receipt.ownerId!==authenticatedOwnerId||
     receipt.idempotencyKey!==prepared.request.idempotencyKey||
     receipt.revision!==readback.revision||receipt.digest!==expected||
     readback.digest!==expected||
     stableJson(readback.records)!==stableJson(prepared.request.records))
    throw Error('migration_readback_mismatch')
  return {
    status:digest(currentLocal)===prepared.localDigest?'synced':'local_changed_after_upload',
    cloudRevision:readback.revision,cloudDigest:readback.digest,
    uploadedEventCount:prepared.request.records.events.length
  }
}
