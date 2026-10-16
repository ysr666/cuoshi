/**
 * Internal-only authentication boundary for the FUTURE backend.
 * No HTTP listener or public token issuer is provided. A future trusted
 * WeChat/phone/staff identity adapter must issue short-lived signed sessions.
 */
import {timingSafeEqual} from 'node:crypto'
import {verifyServerSession,type SessionClaims} from './sessionTokens'
import type {DbPool} from './repository'
import {
  provisionVerifiedUser,setCloudConsent,getCloudSnapshot,getCloudBackupStatus,uploadCloudSnapshot,deleteCloudBackup
} from './repository'
import {readPrivateDayWithAudit} from './adminRepository'
import type {UploadRequest} from '../../cloud/snapshotContract'

export class AuthenticatedCloudService{
  private readonly backupKey:Uint8Array
  private readonly staffKey:Uint8Array
  constructor(
    private readonly backupDb:DbPool,private readonly staffDb:DbPool,
    keys:{backupKey:Uint8Array;staffKey:Uint8Array},
    private readonly nowSeconds:()=>number=()=>Math.floor(Date.now()/1000)
  ){
    if(!(keys?.backupKey instanceof Uint8Array)||keys.backupKey.byteLength<32||
       !(keys?.staffKey instanceof Uint8Array)||keys.staffKey.byteLength<32)
      throw Error('session_keys_not_configured')
    if(keys.backupKey.byteLength===keys.staffKey.byteLength&&
       timingSafeEqual(keys.backupKey,keys.staffKey))
      throw Error('session_audiences_must_use_distinct_keys')
    this.backupKey=Uint8Array.from(keys.backupKey)
    this.staffKey=Uint8Array.from(keys.staffKey)
  }
  private asUser(token:unknown){
    const claims=verifyServerSession(token,this.backupKey,'cuoshi-cloud-backup',this.nowSeconds())
    if(!claims?.deviceId)throw Error('unauthorized')
    return {userId:claims.sub,deviceId:claims.deviceId}
  }
  private asStaff(token:unknown){
    const claims=verifyServerSession(token,this.staffKey,'cuoshi-staff-admin',this.nowSeconds())
    if(typeof claims?.mfaAt!=='number')throw Error('unauthorized')
    return {staffId:claims.sub,mfaVerified:true}
  }
  async provision(token:unknown){return provisionVerifiedUser(this.backupDb,this.asUser(token))}
  async setConsent(token:unknown,enabled:boolean,noticeVersion:string){
    return setCloudConsent(this.backupDb,this.asUser(token),enabled,noticeVersion)
  }
  async readBackup(token:unknown){return getCloudSnapshot(this.backupDb,this.asUser(token))}
  async status(token:unknown){return getCloudBackupStatus(this.backupDb,this.asUser(token))}
  async upload(token:unknown,request:UploadRequest){
    return uploadCloudSnapshot(this.backupDb,this.asUser(token),request)
  }
  async deleteBackup(token:unknown){return deleteCloudBackup(this.backupDb,this.asUser(token))}
  async readPrivateDay(token:unknown,ownerId:string,dayKey:string,caseId:string){
    return readPrivateDayWithAudit(this.staffDb,this.asStaff(token),ownerId,dayKey,caseId)
  }
}
