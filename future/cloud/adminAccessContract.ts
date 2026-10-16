/**
 * Future administrator authorization CONTRACT (not an admin endpoint).
 * Default deny: no record-body read without a case-scoped temporary grant.
 */
export type StaffRole='support'|'safety_reviewer'|'super_admin'|'auditor'
export type CasePurpose='support_ticket'|'necessary_safety_review'
export type StaffIdentity={staffId:string;role:StaffRole;mfaVerified:boolean}
export type AccessCase={
  id:string
  ownerId:string
  purpose:CasePurpose
  status:'open'|'closed'
}
export type BodyAccessGrant={
  id:string
  staffId:string
  caseId:string
  ownerId:string
  purpose:CasePurpose
  dayKeys:string[]
  startsAt:string
  expiresAt:string
  approvedBy:string
  revokedAt?:string
}
export type BodyReadRequest={
  staff:StaffIdentity
  ownerId:string
  dayKey:string
  caseRecord:AccessCase|null
  grant:BodyAccessGrant|null
  now:string
}
export type BodyAccessOutcome={
  allowed:boolean
  reason:'approved'|'invalid_request'|'staff_role'|'mfa_required'|'no_case'|
  'case_closed'|'case_mismatch'|'no_grant'|'grant_mismatch'|'scope_denied'|
  'not_yet_valid'|'expired'|'self_approved'|'revoked'
  audit:{
    action:'read_private_record'
    staffId:string
    caseId:string|null
    ownerId:string
    dayKey:string
    decision:'allow'|'deny'
    reason:string
    at:string
  }
}
function validTime(t:string):boolean{
  return typeof t==='string'&&Number.isFinite(Date.parse(t))
}
const dayPattern=/^\d{4}-\d{2}-\d{2}$/

/** Pure policy only: the production server must enforce and append audit atomically. */
export function checkBodyRead(x:BodyReadRequest):BodyAccessOutcome{
  const {staff,caseRecord:c,grant:g,ownerId,dayKey,now}=x
  let reason:BodyAccessOutcome['reason']='approved'
  const time=Date.parse(now)
  if(!staff||!staff.staffId||!ownerId||!dayPattern.test(dayKey)||!validTime(now))
    reason='invalid_request'
  else if(staff.role!=='support'&&staff.role!=='safety_reviewer')
    reason='staff_role'
  else if(!staff.mfaVerified)
    reason='mfa_required'
  else if(!c)reason='no_case'
  else if(c.status!=='open')reason='case_closed'
  else if(c.ownerId!==ownerId||!c.id||c.purpose!==(staff.role==='support'?'support_ticket':'necessary_safety_review'))
    reason='case_mismatch'
  else if(!g)reason='no_grant'
  else if(g.caseId!==c.id||g.staffId!==staff.staffId||g.ownerId!==ownerId||
          g.purpose!==c.purpose||!g.id||!g.approvedBy||!Array.isArray(g.dayKeys))
    reason='grant_mismatch'
  else if(g.revokedAt)reason='revoked'
  else if(g.approvedBy===staff.staffId)reason='self_approved'
  else if(!g.dayKeys.includes(dayKey))reason='scope_denied'
  else if(!validTime(g.startsAt)||!validTime(g.expiresAt))reason='invalid_request'
  else if(time<Date.parse(g.startsAt))reason='not_yet_valid'
  else if(time>=Date.parse(g.expiresAt)||Date.parse(g.expiresAt)<=Date.parse(g.startsAt)||
          Date.parse(g.expiresAt)-Date.parse(g.startsAt)>2*60*60*1000)
    reason='expired'
  return {
    allowed:reason==='approved',reason,
    audit:{
      action:'read_private_record',staffId:staff?.staffId||'unknown',
      caseId:c?.id||null,ownerId,dayKey,decision:reason==='approved'?'allow':'deny',
      reason,at:validTime(now)?new Date(now).toISOString():'invalid_timestamp'
    }
  }
}
