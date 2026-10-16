/**
 * PostgreSQL repository for future cloud functionality.
 * NO web server or authentication provider is included.
 * All session objects must come from a trusted, independently verified adapter.
 */
import {createHash} from 'node:crypto'
import {stableJson} from '../../cloud/stableJson'
import {cloneState,dateValid,type Records} from '../../../src/core/model'
import {checkBodyRead,type StaffIdentity,type AccessCase,type BodyAccessGrant} from '../../cloud/adminAccessContract'
import {validateCloudRecordLedger,preservesExistingHistory} from './ledger'
import type {UploadRequest,UploadDecision,CloudSnapshot} from '../../cloud/snapshotContract'

type DbRows={rows:Record<string,any>[]}
export type DbClient={query(sql:string,params?:unknown[]):Promise<DbRows>;release():void}
export type DbPool={connect():Promise<DbClient>}
export type VerifiedUserSession={userId:string;deviceId:string}
export type VerifiedStaffSession={staffId:string;mfaVerified:boolean}
export type AuditResult={allowed:boolean;reason:string;day:unknown|null;events:unknown[]}
const validId=(x:unknown)=>typeof x==='string'&&/^[a-zA-Z0-9_-]{8,128}$/.test(x)
const digestPattern=/^[a-f0-9]{64}$/
function requireUser(s:VerifiedUserSession){
  if(!s||!validId(s.userId)||!validId(s.deviceId))throw Error('unverified_identity')
}
function revisionNumber(x:unknown):number{
  const n=Number(x)
  if(!Number.isSafeInteger(n)||n<0)throw Error('invalid_revision')
  return n
}
async function transact<T>(pool:DbPool,fn:(client:DbClient)=>Promise<T>):Promise<T>{
  const client=await pool.connect()
  let opened=false
  try{
    await client.query('BEGIN')
    opened=true
    const value=await fn(client)
    await client.query('COMMIT')
    opened=false
    return value
  }catch(error){
    if(opened){try{await client.query('ROLLBACK')}catch{}}
    throw error
  }finally{client.release()}
}
function snapshot(row:Record<string,any>,ownerId:string):CloudSnapshot{
  return {ownerId,revision:revisionNumber(row.revision),digest:String(row.digest),
    records:cloneState(row.records as Records)}
}

/** Used only after a real WeChat/phone identity provider has verified the user. */
export async function provisionVerifiedUser(pool:DbPool,s:VerifiedUserSession):Promise<void>{
  requireUser(s)
  await pool.connect().then(async client=>{
    try{await client.query('INSERT INTO cloud_users(user_id) VALUES($1) ON CONFLICT(user_id) DO NOTHING',[s.userId])}
    finally{client.release()}
  })
}
/** Disabling sync does not silently delete backups; deletion is a separate explicit action. */
export async function setCloudConsent(pool:DbPool,s:VerifiedUserSession,enabled:boolean,noticeVersion:string):Promise<void>{
  requireUser(s)
  if(typeof enabled!=='boolean'||!/^[-.a-zA-Z0-9_]{3,64}$/.test(noticeVersion))
    throw Error('invalid_consent')
  await transact(pool,async db=>{
    const state=await db.query('SELECT user_id FROM cloud_users WHERE user_id=$1 FOR UPDATE',[s.userId])
    if(!state.rows.length)throw Error('unverified_identity')
    await db.query(`UPDATE cloud_users SET backup_enabled=$2,consent_version=$3,
      consent_at=CASE WHEN $2 THEN clock_timestamp() ELSE consent_at END
      WHERE user_id=$1`,[s.userId,enabled,noticeVersion])
  })
}
export async function getCloudSnapshot(pool:DbPool,s:VerifiedUserSession):Promise<CloudSnapshot|null>{
  requireUser(s)
  const db=await pool.connect()
  try{
    const result=await db.query(`SELECT b.revision,b.digest,b.records FROM cloud_users u
      JOIN cloud_snapshots b ON b.user_id=u.user_id
      WHERE u.user_id=$1 AND u.backup_enabled=TRUE`,[s.userId])
    return result.rows[0]?snapshot(result.rows[0],s.userId):null
  }finally{db.release()}
}
export type CloudBackupStatus={
  enabled:boolean
  hasStoredBackup:boolean
  revision:number|null
  lastSuccessAt:string|null
}
/** Non-private status for the user-visible backup page; opt-out keeps old snapshot until deletion. */
export async function getCloudBackupStatus(pool:DbPool,s:VerifiedUserSession):Promise<CloudBackupStatus>{
  requireUser(s)
  const db=await pool.connect()
  try{
    const row=(await db.query(`SELECT u.backup_enabled,s.revision,s.updated_at
      FROM cloud_users u LEFT JOIN cloud_snapshots s ON s.user_id=u.user_id
      WHERE u.user_id=$1`,[s.userId])).rows[0]
    if(!row)throw Error('unverified_identity')
    return {
      enabled:row.backup_enabled===true,
      hasStoredBackup:row.revision!==null,
      revision:row.revision===null?null:revisionNumber(row.revision),
      lastSuccessAt:row.updated_at?new Date(row.updated_at).toISOString():null
    }
  }finally{db.release()}
}
export async function uploadCloudSnapshot(pool:DbPool,s:VerifiedUserSession,request:UploadRequest):Promise<UploadDecision>{
  requireUser(s)
  if(!request||!Number.isSafeInteger(request.baseRevision)||request.baseRevision<0||
      !validId(request.idempotencyKey)||
      !(request.baseDigest===null||(typeof request.baseDigest==='string'&&digestPattern.test(request.baseDigest))))
    return {kind:'rejected',reason:'invalid_request'}
  let json:string
  try{
    validateCloudRecordLedger(request.records)
    json=JSON.stringify(request.records)
    if(Buffer.byteLength(json,'utf8')>10*1024*1024)return {kind:'rejected',reason:'invalid_request'}
  }catch{return {kind:'rejected',reason:'validation'}}
  const digest=createHash('sha256').update(stableJson(request.records)).digest('hex')
  const fingerprint=createHash('sha256').update(JSON.stringify([
    request.baseRevision,request.baseDigest,s.deviceId,digest
  ])).digest('hex')
  return transact(pool,async db=>{
    // Serializes writers for the same account, including when the snapshot does not exist.
    const owners=await db.query('SELECT backup_enabled FROM cloud_users WHERE user_id=$1 FOR UPDATE',[s.userId])
    if(!owners.rows.length)return {kind:'rejected',reason:'authentication'}
    if(!owners.rows[0].backup_enabled)return {kind:'rejected',reason:'consent_required'}
    const receipt=await db.query(`SELECT request_digest,revision,digest
      FROM cloud_upload_receipts WHERE user_id=$1 AND idempotency_key=$2`,[s.userId,request.idempotencyKey])
    if(receipt.rows.length){
      const previous=receipt.rows[0]
      if(previous.request_digest!==fingerprint)return {kind:'rejected',reason:'idempotency_mismatch'}
      return {kind:'replayed',receipt:{ownerId:s.userId,revision:revisionNumber(previous.revision),
        digest:previous.digest,idempotencyKey:request.idempotencyKey}}
    }
    const existing=await db.query('SELECT revision,digest,records FROM cloud_snapshots WHERE user_id=$1',[s.userId])
    const previous=existing.rows[0]
    const revision=previous?revisionNumber(previous.revision):0
    const prevDigest=previous?.digest??null
    if(revision!==request.baseRevision)return {kind:'conflict',currentRevision:revision,
      currentDigest:prevDigest,reason:'stale_revision'}
    if(prevDigest!==request.baseDigest)return {kind:'conflict',currentRevision:revision,
      currentDigest:prevDigest,reason:'divergent_base'}
    if(previous&&!preservesExistingHistory(previous.records as Records,request.records))
      return {kind:'rejected',reason:'history_rewrite'}
    const nextRevision=revision+1
    await db.query(`INSERT INTO cloud_snapshots(user_id,revision,digest,records)
      VALUES($1,$2,$3,$4::jsonb)
      ON CONFLICT(user_id) DO UPDATE SET revision=EXCLUDED.revision,digest=EXCLUDED.digest,
        records=EXCLUDED.records,updated_at=clock_timestamp()`,[s.userId,nextRevision,digest,json])
    await db.query(`INSERT INTO cloud_upload_receipts
      (user_id,idempotency_key,request_digest,revision,digest) VALUES($1,$2,$3,$4,$5)`,
      [s.userId,request.idempotencyKey,fingerprint,nextRevision,digest])
    const proof={ownerId:s.userId,revision:nextRevision,digest,idempotencyKey:request.idempotencyKey}
    return {kind:'accepted',snapshot:{ownerId:s.userId,revision:nextRevision,
      digest,records:cloneState(request.records)},receipt:proof}
  })
}
/** Explicit user-directed cloud erasure: do not interpret simple opt-out as deletion. */
export async function deleteCloudBackup(pool:DbPool,s:VerifiedUserSession):Promise<void>{
  requireUser(s)
  await transact(pool,async db=>{
    const users=await db.query('SELECT user_id FROM cloud_users WHERE user_id=$1 FOR UPDATE',[s.userId])
    if(!users.rows.length)throw Error('unverified_identity')
    await db.query('DELETE FROM cloud_upload_receipts WHERE user_id=$1',[s.userId])
    await db.query('DELETE FROM cloud_snapshots WHERE user_id=$1',[s.userId])
    await db.query('UPDATE cloud_users SET backup_enabled=FALSE WHERE user_id=$1',[s.userId])
  })
}
