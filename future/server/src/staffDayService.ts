/** Verified MFA staff JWT -> revocation -> SQL-approved, audited single day. */
import {verifyServerSession} from './sessionTokens'
import {ensureSessionNotRevoked} from './sessionRevocation'
import {readPrivateDayWithAudit} from './adminRepository'
import type {DbPool} from './repository'
export function createStaffDayService(
 db:DbPool,staffKey:Uint8Array,
 nowSeconds:()=>number=()=>Math.floor(Date.now()/1000)
){
 if(!db||!(staffKey instanceof Uint8Array)||staffKey.length<32)
   throw Error('private_staff_day_service_invalid')
 return {
  async readPrivateDay(token:unknown,ownerId:string,dayKey:string,caseId:string){
    const claims=verifyServerSession(token,staffKey,
      'cuoshi-staff-admin',nowSeconds())
    if(!claims||typeof claims.mfaAt!=='number')throw Error('unauthorized')
    await ensureSessionNotRevoked(db,claims)
    return readPrivateDayWithAudit(db,{staffId:claims.sub,mfaVerified:true},
      ownerId,dayKey,caseId)
  }
 }
}
