/**
 * Isolated v0.5 HTTP composition for a trusted HTTPS host.
 * No database owner role, credential, listener or public route is created here.
 * Production hosting still requires real WeChat credentials, external TLS,
 * distributed abuse prevention and a security review.
 */
import {createServer,type IncomingMessage,type ServerResponse,type Server} from 'node:http'
import {type AddressInfo} from 'node:net'
import {createAccountHttpHandler,type AccountHttpDependencies} from './accountHttp'
import {createBackupHttpHandler,answer} from './backupHttp'
import type {CloudRequestHandler,createTrustedEdgeBoundary} from './trustedEdge'
import type {AuthenticatedCloudService} from './authenticatedService'

type BackupService=Pick<AuthenticatedCloudService,'readBackup'|'upload'>
export type CloudHttpDependencies={account:AccountHttpDependencies;backup:BackupService}
const accountRoutes=new Set([
  '/v1/auth/wechat','/v1/auth/logout',
  '/v1/backup/status','/v1/backup/consent'
])

/**
 * Exact routing: queries, traversal, trailing slashes and staff/admin paths
 * never select an authenticated endpoint. Each inner handler still validates
 * the method, bearer and strict payload shape. No universal CORS policy.
 */
export function createCloudHttpRouter(deps:CloudHttpDependencies){
  if(!deps?.account||!deps.backup)throw Error('cloud_http_dependencies_required')
  const account=createAccountHttpHandler(deps.account)
  const backup=createBackupHttpHandler(deps.backup)
  return async(req:IncomingMessage,res:ServerResponse):Promise<void>=>{
    const pathname=req.url??''
    if(pathname==='/v1/backup/snapshot')return backup(req,res)
    if(accountRoutes.has(pathname))return account(req,res)
    // A liveness check does not claim DB, WeChat or upload readiness.
    if(pathname==='/healthz'&&req.method==='GET')return answer(res,204)
    return answer(res,404,{error:'not_found'})
  }
}

/**
 * Explicit localhost-only ephemeral test listener, not a deployment helper.
 * Fails closed if a caller forgets the test-only acknowledgement. The only
 * accepted bind address is 127.0.0.1; never starts on a public interface.
 */
export async function listenCloudLoopbackForQa(
  deps:CloudHttpDependencies,
  acknowledgement:'SYNTHETIC_TEST_ONLY'
):Promise<{server:Server;origin:string;close:()=>Promise<void>}>{
  if(acknowledgement!=='SYNTHETIC_TEST_ONLY')
    throw Error('cloud_http_public_listener_forbidden')
  const router=createCloudHttpRouter(deps)
  const server=createServer({maxHeaderSize:8192,requestTimeout:15000,
    headersTimeout:10000,keepAliveTimeout:3000},(req,res)=>{
    void router(req,res).catch(()=>{
      // Never echo stack, token, SQL or note text even if a composition bug
      // escapes the inner handlers. A sent response cannot be reset safely.
      if(!res.headersSent)answer(res,503,{error:'cloud_temporarily_unavailable'})
      else res.end()
    })
  })
  try{
    await new Promise<void>((resolve,reject)=>{
      server.once('error',reject)
      server.listen(0,'127.0.0.1',resolve)
    })
  }catch(error){server.close();throw error}
  const address=server.address()
  if(!address||typeof address==='string'||address.address!=='127.0.0.1'){
    await new Promise<void>(resolve=>server.close(()=>resolve()))
    throw Error('cloud_http_loopback_bind_failed')
  }
  return {server,origin:'http://127.0.0.1:'+(address as AddressInfo).port,
    close:()=>new Promise<void>((resolve,reject)=>{
      server.close(error=>error?reject(error):resolve())
      server.closeIdleConnections()
    })}
}

/**
 * Explicit, loopback-only service listener for a separately authenticated
 * local reverse proxy. Unlike the synthetic QA listener, requests without
 * a configured trusted-edge proof are rejected BEFORE any cloud route.
 * This does not set up TLS, WeChat credentials, distributed storage or a
 * production proxy: those remain external deployment requirements.
 */
export async function listenPrivateEdgeLoopback(
  deps:CloudHttpDependencies,
  edge:ReturnType<typeof createTrustedEdgeBoundary>,
  port:number
):Promise<{server:Server;origin:string;close:()=>Promise<void>}>{
  if(!edge||typeof edge.protect!=='function'||typeof edge.clientIp!=='function'||
     !Number.isSafeInteger(port)||port<0||port>65535)
    throw Error('cloud_private_edge_required')
  const protectedRoute:CloudRequestHandler=edge.protect(createCloudHttpRouter(deps))
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
  const address=server.address()
  if(!address||typeof address==='string'||address.address!=='127.0.0.1'){
    await new Promise<void>(resolve=>server.close(()=>resolve()))
    throw Error('cloud_private_edge_bind_failed')
  }
  return {server,origin:'http://127.0.0.1:'+(address as AddressInfo).port,
    close:()=>new Promise<void>((resolve,reject)=>{
      server.close(error=>error?reject(error):resolve())
      server.closeIdleConnections()
    })}
}
