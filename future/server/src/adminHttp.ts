/**
 * Future PRIVATE staff-only HTTP boundary, intentionally not registered in
 * cloudHttpHost or its public Caddy allowlist. It issues no staff credentials.
 * Its sole private-data operation uses the existing signed MFA session,
 * SQL case approval, date-scoped grant and audit-before-read function.
 */
import type {IncomingMessage,ServerResponse} from 'node:http'
import type {AuthenticatedCloudService} from './authenticatedService'
import {HttpFailure,answer,bearer,collectJson,errorResponse} from './backupHttp'
import {dateValid} from '../../../src/core/model'

type Service=Pick<AuthenticatedCloudService,'readPrivateDay'>
const id=(s:unknown):s is string=>
  typeof s==='string'&&/^[A-Za-z0-9_-]{8,128}$/.test(s)
function parseScope(value:unknown){
  if(!value||typeof value!=='object'||Array.isArray(value))
    throw new HttpFailure(400,'bad_request')
  const obj=value as Record<string,unknown>
  const keys=Object.keys(obj).sort()
  if(keys.length!==3||keys[0]!=='caseId'||keys[1]!=='dayKey'||keys[2]!=='ownerId'||
     !id(obj.caseId)||!id(obj.ownerId)||
     typeof obj.dayKey!=='string'||!dateValid(obj.dayKey))
    throw new HttpFailure(400,'bad_request')
  return {caseId:obj.caseId,ownerId:obj.ownerId,dayKey:obj.dayKey}
}
export function createPrivateAdminHttpHandler(service:Service){
  if(typeof service?.readPrivateDay!=='function')
    throw Error('private_admin_staff_service_required')
  return async(req:IncomingMessage,res:ServerResponse)=>{
    try{
      // This handler must be composed ONLY into a distinct staff edge that
      // already enforces TLS, limited source access and staff MFA issuance.
      if(req.url!=='/internal/admin/read-day')
        throw new HttpFailure(404,'not_found')
      if(req.method!=='POST'){
        res.setHeader('Allow','POST')
        throw new HttpFailure(405,'method_not_allowed')
      }
      const token=bearer(req)
      const scope=parseScope(await collectJson(req,512))
      const outcome=await service.readPrivateDay(
        token,scope.ownerId,scope.dayKey,scope.caseId
      )
      // Even SQL denials are audited, but reason codes and existence of
      // another account must not be leaked to the browser or reverse proxy.
      if(outcome?.allowed!==true)
        return answer(res,403,{error:'access_denied'})
      if(!Array.isArray(outcome.events)||
         !(outcome.day===null||typeof outcome.day==='object'&&
           !Array.isArray(outcome.day)))
        throw Error('private_admin_invalid_record')
      // No multi-day export, global search, or unapproved owner browsing.
      return answer(res,200,{day:outcome.day,events:outcome.events})
    }catch(error){
      const safe=errorResponse(error)
      if(!res.headersSent)answer(res,safe.status,{error:safe.code})
      else res.end()
    }
  }
}
