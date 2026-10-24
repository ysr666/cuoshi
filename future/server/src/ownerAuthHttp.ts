/** Auth-only routes on the verified private owner edge. No public API mount. */
import type {IncomingMessage,ServerResponse} from 'node:http'
import {HttpFailure,answer,bearer,collectJson,errorResponse} from './backupHttp'
import type {createOwnerAuthService} from './ownerAuth'
type Backend=ReturnType<typeof createOwnerAuthService>
function shape(raw:unknown){
 if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new HttpFailure(400,'bad_request')
 const obj=raw as Record<string,unknown>
 if(Object.keys(obj).sort().join(',')!=='otp,password'||
   typeof obj.otp!=='string'||typeof obj.password!=='string')
   throw new HttpFailure(400,'bad_request')
 return {password:obj.password,otp:obj.otp}
}
export function createOwnerAuthHttpHandler(
 backend:Backend,verifiedPeer:(req:IncomingMessage)=>string|null
){
 if(typeof backend?.login!=='function'||typeof backend?.logout!=='function'||
    typeof verifiedPeer!=='function')throw Error('owner_http_backend_required')
 return async(req:IncomingMessage,res:ServerResponse)=>{
  try{
   if(req.url==='/internal/admin/login'){
     if(req.method!=='POST')throw new HttpFailure(405,'method_not_allowed')
     // Reject direct connections even if the outer edge was miscomposed.
     const peer=verifiedPeer(req)
     if(!peer)throw new HttpFailure(403,'access_denied')
     const credentials=shape(await collectJson(req,768))
     const token=await backend.login(credentials,peer)
     return answer(res,200,{token,expiresInSeconds:300})
   }
   if(req.url==='/internal/admin/logout'){
     if(req.method!=='POST')throw new HttpFailure(405,'method_not_allowed')
     if(!verifiedPeer(req))throw new HttpFailure(403,'access_denied')
     await backend.logout(bearer(req))
     return answer(res,200,{ok:true})
   }
   throw new HttpFailure(404,'not_found')
  }catch(error){
   if(error instanceof Error&&error.message==='owner_login_rate_limited')
      return answer(res,429,{error:'too_many_requests'})
   if(error instanceof Error&&error.message==='owner_login_invalid')
      return answer(res,401,{error:'unauthorized'})
   const safe=errorResponse(error)
   return answer(res,safe.status,{error:safe.code})
  }
 }
}
