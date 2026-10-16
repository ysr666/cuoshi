/** Admin paths require a server-verified staff session; never pass raw client role/grant. */
import {checkBodyRead,type StaffIdentity,type AccessCase,type BodyAccessGrant} from '../../cloud/adminAccessContract'
import {dateValid} from '../../../src/core/model'
import type {DbPool} from './repository'
type Queryable={query(sql:string,args?:unknown[]):Promise<{rows:Record<string,any>[]}>;release():void}
export type VerifiedStaffSession={staffId:string;mfaVerified:boolean}
export type AdminReadResult={allowed:boolean;reason:string;day:unknown|null;events:unknown[]}

export async function readPrivateDayWithAudit(
  pool:DbPool,staffSession:VerifiedStaffSession,
  ownerId:string,dayKey:string,caseId:string
):Promise<AdminReadResult>{
  const db:Queryable=await pool.connect()
  let opened=false
  try{
    await db.query('BEGIN')
    opened=true
    const safeId=(s:unknown)=>typeof s==='string'&&/^[A-Za-z0-9_-]{8,128}$/.test(s)
    // Malformed requests are rejected before any query for private data.
    if(!staffSession||!safeId(staffSession.staffId)||!safeId(ownerId)||
       !safeId(caseId)||!dateValid(dayKey))throw Error('invalid_access_request')

    const staffRows=await db.query('SELECT role,active FROM cloud_staff WHERE staff_id=$1',
      [staffSession.staffId])
    const role=staffRows.rows[0]?.active?staffRows.rows[0].role:'auditor'
    const staff:StaffIdentity={staffId:staffSession.staffId,role,
      mfaVerified:staffSession.mfaVerified===true&&staffRows.rows[0]?.active===true}
    const cases=await db.query(`SELECT case_id,owner_id,purpose,status FROM cloud_access_cases
      WHERE case_id=$1`,[caseId])
    const row=cases.rows[0]
    const caseRecord:AccessCase|null=row?{
      id:row.case_id,ownerId:row.owner_id,purpose:row.purpose,status:row.status
    }:null
    const grants=await db.query(`SELECT grant_id,staff_id,case_id,owner_id,purpose,day_keys,
      starts_at,expires_at,approved_by,revoked_at
      FROM cloud_access_grants
      WHERE staff_id=$1 AND owner_id=$2 AND case_id=$3
      ORDER BY starts_at DESC LIMIT 1`,[staffSession.staffId,ownerId,caseId])
    const g=grants.rows[0]
    const grant:BodyAccessGrant|null=g?{
      id:g.grant_id,staffId:g.staff_id,caseId:g.case_id,ownerId:g.owner_id,
      purpose:g.purpose,dayKeys:g.day_keys,startsAt:new Date(g.starts_at).toISOString(),
      expiresAt:new Date(g.expires_at).toISOString(),approvedBy:g.approved_by,
      ...(g.revoked_at?{revokedAt:new Date(g.revoked_at).toISOString()}:{})
    }:null
    const consent=await db.query('SELECT backup_enabled FROM cloud_users WHERE user_id=$1',[ownerId])
    const now=await db.query('SELECT clock_timestamp() AS at')
    const decision=checkBodyRead({staff,ownerId,dayKey,caseRecord,grant,
      now:new Date(now.rows[0].at).toISOString()})
    const enabled=consent.rows[0]?.backup_enabled===true
    const allowed=decision.allowed&&enabled
    const reason=enabled?decision.reason:'consent_required'
    // Audit both allowed and denied reads. No private note text is inserted here.
    // If this INSERT fails the transaction rolls back and no body leaves the function.
    await db.query(`INSERT INTO cloud_admin_audit
      (staff_id,owner_id,day_key,case_id,grant_id,decision,reason)
      VALUES($1,$2,$3,$4,$5,$6,$7)`,[
      staffSession.staffId,ownerId,dayKey,caseId,grant?.id??null,
      allowed?'allow':'deny',reason
    ])
    let day:unknown|null=null
    let events:unknown[]=[]
    if(allowed){
      // Select only the authorized day; the service layer never receives other days.
      const result=await db.query(`SELECT records->'days'->$2 AS day,
        COALESCE((SELECT jsonb_agg(e) FROM jsonb_array_elements(records->'events') AS e
          WHERE e->>'targetDate'=$2),'[]'::jsonb) AS events
        FROM cloud_snapshots WHERE user_id=$1`,[ownerId,dayKey])
      day=result.rows[0]?.day??null
      events=result.rows[0]?.events??[]
    }
    await db.query('COMMIT')
    opened=false
    return {allowed,reason,day,events}
  }catch(error){
    if(opened){try{await db.query('ROLLBACK')}catch{}}
    throw error
  }finally{db.release()}
}
