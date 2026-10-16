/**
 * Future admin repository. Does NOT hold SELECT on cloud_snapshots.
 * Only invokes an audited SECURITY DEFINER function with limited output.
 * The caller must have validated a short-lived staff session and MFA.
 */
import {dateValid} from '../../../src/core/model'
import type {DbPool} from './repository'
export type VerifiedStaffSession={staffId:string;mfaVerified:boolean}
export type AdminReadResult={allowed:boolean;reason:string;day:unknown|null;events:unknown[]}
const validId=(s:unknown)=>typeof s==='string'&&/^[A-Za-z0-9_-]{8,128}$/.test(s)

/**
 * The restricted PostgreSQL role receives EXECUTE on cloud_read_day only:
 * case checks, scoped reading and audit are enforced by PostgreSQL itself.
 * If audit insertion fails, no body is returned.
 */
export async function readPrivateDayWithAudit(
  pool:DbPool,staffSession:VerifiedStaffSession,
  ownerId:string,dayKey:string,caseId:string
):Promise<AdminReadResult>{
  if(!staffSession||!validId(staffSession.staffId)||!validId(ownerId)||
     !validId(caseId)||!dateValid(dayKey))throw Error('invalid_access_request')
  const client=await pool.connect()
  try{
    const result=await client.query(
      'SELECT allowed,reason,day,events FROM cloud_read_day($1,$2,$3,$4,$5)',
      [staffSession.staffId,staffSession.mfaVerified===true,ownerId,dayKey,caseId]
    )
    const row=result.rows[0]
    if(!row)throw Error('admin_access_not_audited')
    return {
      allowed:row.allowed===true,
      reason:String(row.reason),
      day:row.allowed===true?(row.day??null):null,
      events:row.allowed===true?(row.events??[]):[]
    }
  }finally{client.release()}
}
