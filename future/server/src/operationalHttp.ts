/** For a future isolated staff ingress ONLY; never expose on cloudHttpHost. */
import type {IncomingMessage,ServerResponse} from 'node:http'
import {HttpFailure,answer,bearer,errorResponse} from './backupHttp'
import type {createStaffOperationalService} from './operationalService'

type Backend=ReturnType<typeof createStaffOperationalService>
export function createPrivateOperationalHttpHandler(backend:Backend){
  if(typeof backend?.overview!=='function')throw Error('operational_http_backend_required')
  return async(req:IncomingMessage,res:ServerResponse):Promise<void>=>{
    try{
      if(req.url!=='/internal/admin/overview')throw new HttpFailure(404,'not_found')
      if(req.method!=='GET'){
        res.setHeader('Allow','GET')
        throw new HttpFailure(405,'method_not_allowed')
      }
      const result=await backend.overview(bearer(req))
      return answer(res,200,result)
    }catch(error){
      const denied=error instanceof Error&&error.message==='operational_reporting_access_denied'
      const safe=denied?new HttpFailure(403,'access_denied'):errorResponse(error)
      if(!res.headersSent)answer(res,safe.status,{error:safe.code})
      else res.end()
    }
  }
}
