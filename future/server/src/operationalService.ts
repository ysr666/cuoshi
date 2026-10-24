/**
 * Single-owner operations service. No issuer, listener, public route,
 * plaintext notes, account lookup or development bypass is provided.
 */
import {verifyServerSession} from './sessionTokens'
import {ensureSessionNotRevoked} from './sessionRevocation'
import {readAnonymousOperationalOverview} from './operationalReporting'
import type {DbPool} from './repository'

export function createStaffOperationalService(
  staffDb:DbPool,reportingDb:DbPool,
  staffKey:Uint8Array,
  nowSeconds:()=>number=()=>Math.floor(Date.now()/1000),
  soleOwnerId:string
){
  if(!staffDb||!reportingDb||!(staffKey instanceof Uint8Array)||staffKey.length<32||
     !/^[A-Za-z0-9_-]{8,128}$/.test(soleOwnerId))
    throw Error('operational_service_not_configured')
  return {
    async overview(token:unknown){
      const claims=verifyServerSession(
        token,staffKey,'cuoshi-staff-admin',nowSeconds()
      )
      if(!claims||claims.sub!==soleOwnerId||typeof claims.mfaAt!=='number')
        throw Error('unauthorized')
      await ensureSessionNotRevoked(staffDb,claims)
      // SQL independently checks the legacy role record with the reporting-only
      // PG role; an otherwise valid support token cannot see aggregates.
      return readAnonymousOperationalOverview(reportingDb,claims.sub,true)
    }
  }
}
