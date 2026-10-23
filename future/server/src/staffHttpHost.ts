/** A separate, never-public employee API router; not mounted to cloudHttpHost. */
import {createServer,type IncomingMessage,type ServerResponse,type Server} from 'node:http'
import {type AddressInfo} from 'node:net'
import {answer} from './backupHttp'
import {createPrivateAdminHttpHandler} from './adminHttp'
import {createPrivateOperationalHttpHandler} from './operationalHttp'
import type {createTrustedEdgeBoundary,CloudRequestHandler} from './trustedEdge'
import type {AuthenticatedCloudService} from './authenticatedService'
import type {createStaffOperationalService} from './operationalService'

type PrivateDayService=Pick<AuthenticatedCloudService,'readPrivateDay'>
type ReportingService=ReturnType<typeof createStaffOperationalService>
export type StaffHttpDependencies={privateDay:PrivateDayService;reporting:ReportingService}
export function createStaffHttpRouter(deps:StaffHttpDependencies):CloudRequestHandler{
  if(typeof deps?.privateDay?.readPrivateDay!=='function'||
     typeof deps?.reporting?.overview!=='function')
    throw Error('staff_http_dependencies_required')
  const readDay=createPrivateAdminHttpHandler(deps.privateDay)
  const report=createPrivateOperationalHttpHandler(deps.reporting)
  return async(req:IncomingMessage,res:ServerResponse)=>{
    if(req.url==='/internal/admin/read-day')return readDay(req,res)
    if(req.url==='/internal/admin/overview')return report(req,res)
    return answer(res,404,{error:'not_found'})
  }
}
/**
 * Only bindable behind a verified, local TLS reverse proxy; never exposes
 * a public port, employee login endpoint, user HTTP routes, or mock tokens.
 */
export async function listenStaffPrivateLoopback(
  deps:StaffHttpDependencies,
  edge:ReturnType<typeof createTrustedEdgeBoundary>,port:number
):Promise<{server:Server;origin:string;close:()=>Promise<void>}>{
  if(!edge||typeof edge.protect!=='function'||typeof edge.clientIp!=='function'||
     !Number.isSafeInteger(port)||port<0||port>65535)
    throw Error('staff_private_edge_required')
  const protectedRoute=edge.protect(createStaffHttpRouter(deps))
  const server=createServer({maxHeaderSize:8192,requestTimeout:15000,
    headersTimeout:10000,keepAliveTimeout:3000},(req,res)=>{
    void protectedRoute(req,res).catch(()=>{
      if(!res.headersSent)answer(res,503,{error:'cloud_temporarily_unavailable'})
      else res.end()
    })
  })
  try{
    await new Promise<void>((resolve,reject)=>{
      server.once('error',reject)
      server.listen(port,'127.0.0.1',resolve)
    })
  }catch(error){server.close();throw error}
  const addr=server.address()
  if(!addr||typeof addr==='string'||addr.address!=='127.0.0.1'){
    await new Promise<void>(resolve=>server.close(()=>resolve()))
    throw Error('staff_loopback_bind_failed')
  }
  return {server,origin:'http://127.0.0.1:'+(addr as AddressInfo).port,
    close:()=>new Promise<void>((resolve,reject)=>{
      server.close(e=>e?reject(e):resolve())
      server.closeIdleConnections()
    })}
}
