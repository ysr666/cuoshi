/**
 * Internal-only authentication boundary for the FUTURE backend.
 * No HTTP listener or public token issuer is provided. A future trusted
 * WeChat/phone/staff identity adapter must issue short-lived signed sessions.
 */
import {timingSafeEqual} from 'node:crypto'
import {verifyServerSession,type SessionClaims} from './sessionTokens'
import {ensureSessionNotRevoked,revokeVerifiedSession} from './sessionRevocation'
import type {DbPool} from './repository'
import {
  provisionVerifiedUser,setCloudConsent,getCloudSnapshot,getCloudBackupStatus,uploadCloudSnapshot,deleteCloudBackup
} from './repository'
import {readPrivateDayWithAudit} from './adminRepository'
import {cancelVerifiedAccount,ACCOUNT_DELETE_CONFIRMATION} from './accountCancellation'
import type {UploadRequest} from '../../cloud/snapshotContract'

export class AuthenticatedCloudService{
  private readonly backupKey:Uint8Array
  private readonly staffKey:Uint8Array
  private readonly previousBackupKey?:Uint8Array
  private readonly previousStaffKey?:Uint8Array
  constructor(
    private readonly backupDb:DbPool,private readonly staffDb:DbPool,
    keys:{
      backupKey:Uint8Array;staffKey:Uint8Array
      previousBackupKey?:Uint8Array;previousStaffKey?:Uint8Array
    },
    private readonly nowSeconds:()=>number=()=>Math.floor(Date.now()/1000),
    private readonly cancellationDb:DbPool|undefined,
    private readonly requiredNoticeVersion:string
  ){
    if(typeof requiredNoticeVersion!=='string'||
       !/^[-.a-zA-Z0-9_]{3,64}$/.test(requiredNoticeVersion))
      throw Error('cloud_notice_version_unconfigured')
    if(!(keys?.backupKey instanceof Uint8Array)||keys.backupKey.byteLength<32||
       !(keys?.staffKey instanceof Uint8Array)||keys.staffKey.byteLength<32)
      throw Error('session_keys_not_configured')
    if(keys.backupKey.byteLength===keys.staffKey.byteLength&&
       timingSafeEqual(keys.backupKey,keys.staffKey))
      throw Error('session_audiences_must_use_distinct_keys')
    const all=[
      keys.backupKey,keys.staffKey,keys.previousBackupKey,keys.previousStaffKey
    ].filter((key):key is Uint8Array=>key!==undefined)
    if(all.some(key=>!(key instanceof Uint8Array)||key.byteLength<32))
      throw Error('session_keys_not_configured')
    for(let i=0;i<all.length;i++)for(let j=i+1;j<all.length;j++)
      if(all[i].byteLength===all[j].byteLength&&timingSafeEqual(all[i],all[j]))
        throw Error('session_audiences_must_use_distinct_keys')
    this.backupKey=Uint8Array.from(keys.backupKey)
    this.staffKey=Uint8Array.from(keys.staffKey)
    if(keys.previousBackupKey)this.previousBackupKey=Uint8Array.from(keys.previousBackupKey)
    if(keys.previousStaffKey)this.previousStaffKey=Uint8Array.from(keys.previousStaffKey)
  }
  private readClaims(token:unknown,aud:'cuoshi-cloud-backup'|'cuoshi-staff-admin'){
    const current=aud==='cuoshi-cloud-backup'?this.backupKey:this.staffKey
    const previous=aud==='cuoshi-cloud-backup'?this.previousBackupKey:this.previousStaffKey
    const now=this.nowSeconds()
    // Issue only with current keys. During a controlled rotation, accept the
    // previous key for at most the token's 15/5-minute original lifetime.
    return verifyServerSession(token,current,aud,now) ??
      (previous?verifyServerSession(token,previous,aud,now):null)
  }
  private async asUser(token:unknown){
    const claims=this.readClaims(token,'cuoshi-cloud-backup')
    if(!claims?.deviceId)throw Error('unauthorized')
    await ensureSessionNotRevoked(this.backupDb,claims)
    const db=await this.backupDb.connect()
    try{
      const row=await db.query('SELECT deleted_at,session_generation FROM cloud_users WHERE user_id=$1',[claims.sub])
      // Initial trusted bootstrap may not yet have a row. But tombstoned
      // accounts must NEVER be resumed with still-valid signed JWTs.
      if(row.rows[0]?.deleted_at)throw Error('account_closed')
      if(row.rows[0]&&Number(row.rows[0].session_generation)!==(claims.generation??0))throw Error('session_revoked')
    }finally{db.release()}
    return {userId:claims.sub,deviceId:claims.deviceId,generation:claims.generation??0}
  }
  private async asStaff(token:unknown){
    const claims=this.readClaims(token,'cuoshi-staff-admin')
    if(typeof claims?.mfaAt!=='number')throw Error('unauthorized')
    await ensureSessionNotRevoked(this.staffDb,claims)
    return {staffId:claims.sub,mfaVerified:true}
  }
  async logoutUser(token:unknown){
    const claims=this.readClaims(token,'cuoshi-cloud-backup')
    if(!claims?.deviceId)throw Error('unauthorized')
    return revokeVerifiedSession(this.backupDb,claims)
  }
  /** Force all devices to re-authenticate; stale uploads also check generation under DB lock. */
  async logoutAllUser(token:unknown){
    const user=await this.asUser(token)
    const db=await this.backupDb.connect()
    try{
      const result=await db.query(
        'UPDATE cloud_users SET session_generation=session_generation+1 '+
        'WHERE user_id=$1 AND deleted_at IS NULL AND session_generation=$2 RETURNING session_generation',
        [user.userId,user.generation]
      )
      if(!result.rows.length)throw Error('session_revoked')
      return {allDevicesSignedOut:true}
    }finally{db.release()}
  }
  async logoutStaff(token:unknown){
    const claims=this.readClaims(token,'cuoshi-staff-admin')
    if(typeof claims?.mfaAt!=='number')throw Error('unauthorized')
    return revokeVerifiedSession(this.staffDb,claims)
  }
  async provision(token:unknown){return provisionVerifiedUser(this.backupDb,await this.asUser(token))}
  async setConsent(token:unknown,enabled:boolean,noticeVersion:string){
    const verified=await this.asUser(token)
    if(enabled&&noticeVersion!==this.requiredNoticeVersion)
      throw Error('cloud_notice_outdated')
    return setCloudConsent(this.backupDb,verified,enabled,noticeVersion)
  }
  async readBackup(token:unknown){
    return getCloudSnapshot(this.backupDb,await this.asUser(token),this.requiredNoticeVersion)
  }
  async status(token:unknown){
    return getCloudBackupStatus(this.backupDb,await this.asUser(token),this.requiredNoticeVersion)
  }
  async upload(token:unknown,request:UploadRequest){
    return uploadCloudSnapshot(this.backupDb,await this.asUser(token),request,this.requiredNoticeVersion)
  }
  async deleteBackup(token:unknown){return deleteCloudBackup(this.backupDb,await this.asUser(token))}
  /** No default deletion privileges: separate restricted account-cancellation role required. */
  /** A non-content-bearing check for a lost account-deletion HTTP response.
   * Only a still-valid ORIGINAL signed JWT can query its own user tombstone;
   * this cannot mint credentials or associate a new WeChat account.
   */
  async cancellationStatus(token:unknown):Promise<{state:'closed'|'active'|'unknown'}>{
    const claims=this.readClaims(token,'cuoshi-cloud-backup')
    if(!claims?.deviceId)throw Error('unauthorized')
    const db=await this.backupDb.connect()
    try{
      const row=await db.query('SELECT deleted_at FROM cloud_users WHERE user_id=$1',
        [claims.sub])
      if(row.rows.length!==1)return {state:'unknown'}
      return {state:row.rows[0].deleted_at?'closed':'active'}
    }finally{db.release()}
  }
  async cancelAccount(token:unknown,confirmation:string){
    if(!this.cancellationDb)throw Error('account_cancellation_unavailable')
    // Never allow a client-supplied userId; verified session determines owner.
    return cancelVerifiedAccount(this.cancellationDb,await this.asUser(token),confirmation)
  }
  async readPrivateDay(token:unknown,ownerId:string,dayKey:string,caseId:string){
    return readPrivateDayWithAudit(this.staffDb,await this.asStaff(token),ownerId,dayKey,caseId)
  }
}
