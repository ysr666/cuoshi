/** Single-owner administration gateway; not mounted to cloudHttpHost. */
import {createServer,type IncomingMessage,type ServerResponse,type Server} from 'node:http'
import {type AddressInfo} from 'node:net'
import {readFileSync} from 'node:fs'
import {join} from 'node:path'
import {answer} from './backupHttp'
import {createPrivateOperationalHttpHandler} from './operationalHttp'
import type {createTrustedEdgeBoundary,CloudRequestHandler} from './trustedEdge'
import type {createStaffOperationalService} from './operationalService'

type ReportingService=ReturnType<typeof createStaffOperationalService>
export type StaffHttpDependencies={
  reporting:ReportingService
  // Assets are created from reviewed local files, never from HTTP path input.
  consoleAssets?:ReadonlyMap<string,{content:Buffer;mime:string}>
}
const consoleAssetNames=new Map([
  ['/admin/',['index.html','text/html; charset=utf-8']],
  ['/admin/app.js',['app.js','text/javascript; charset=utf-8']],
  ['/admin/style.css',['style.css','text/css; charset=utf-8']],
  ['/admin/base.css',['../public/styles.css','text/css; charset=utf-8']]
] as const)
export function createStaffConsoleAssets(approvedDirectory:string){
  if(typeof approvedDirectory!=='string'||!approvedDirectory.startsWith('/'))
    throw Error('staff_console_directory_invalid')
  const result=new Map<string,{content:Buffer;mime:string}>()
  for(const [url,[file,mime]] of consoleAssetNames){
    const content=readFileSync(join(approvedDirectory,file))
    result.set(url,{content,mime})
  }
  return result
}
export function createStaffHttpRouter(deps:StaffHttpDependencies):CloudRequestHandler{
  if(typeof deps?.reporting?.overview!=='function')
    throw Error('staff_http_dependencies_required')
  const report=createPrivateOperationalHttpHandler(deps.reporting)
  return async(req:IncomingMessage,res:ServerResponse)=>{
    if(req.url==='/internal/admin/overview')return report(req,res)
    const asset=deps.consoleAssets?.get(req.url??'')
    if(asset){
      if(req.method!=='GET')return answer(res,405,{error:'method_not_allowed'})
      res.setHeader('Cache-Control','no-store, private')
      res.setHeader('Referrer-Policy','no-referrer')
      res.setHeader('X-Content-Type-Options','nosniff')
      res.setHeader('X-Frame-Options','DENY')
      res.setHeader('Content-Security-Policy',
        "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'")
      res.setHeader('Content-Type',asset.mime)
      res.writeHead(200)
      res.end(asset.content)
      return
    }
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
