/**
 * Future private-loopback backend runner (behind a configured HTTPS edge).
 * Never starts without verified TLS database URLs, six distinct secrets,
 * restricted database roles, valid WeChat provider credentials and the
 * explicit loopback-only acknowledgement. No public listener is possible.
 */
import {createRequire} from 'node:module'
import {parsePrivateCloudConfig,privatePoolConnectionOptions} from './privateConfig'
import {createTrustedEdgeBoundary} from './trustedEdge'
import {listenPrivateEdgeLoopback} from './cloudHttpHost'
import {createPostgresWechatLoginLimiter} from './loginRateLimiter'
import {makeWechatCodeExchanger,loginWithWechatCode} from './wechatIdentity'
import {AuthenticatedCloudService} from './authenticatedService'
import type {DbPool} from './repository'
import {checkPrivateDatabaseReadiness} from './privateReadiness'
import {createPrivateHealthProbe} from './privateHealth'

async function main(){
 const config=parsePrivateCloudConfig(process.env)
 // pg is installed in future/server/node_modules, never a client bundle.
 const localRequire=createRequire(__filename)
 const {Pool}=localRequire('pg') as {Pool:new(opts:Record<string,unknown>)=>DbPool&{
   query(sql:string):Promise<{rows:Record<string,unknown>[]}>;end():Promise<void>
 }}
 const connect=(url:string)=>new Pool(privatePoolConnectionOptions(url,config.dbSchema))
 const identityDb=connect(config.identityDbUrl),backupDb=connect(config.backupDbUrl),
   staffDb=connect(config.staffDbUrl),cancellationDb=connect(config.cancellationDbUrl)
 const pools=[identityDb,backupDb,staffDb,cancellationDb]
 let host:Awaited<ReturnType<typeof listenPrivateEdgeLoopback>>|null=null
 try{
   // Run the SAME pre-listener checks as the real PostgreSQL CI contract.
   // A failing identity, role, schema or required function cannot listen.
   await checkPrivateDatabaseReadiness(
     {identityDb,backupDb,staffDb,cancellationDb},config.dbSchema)
   const edge=createTrustedEdgeBoundary({sharedSecret:config.edgeSecret})
   const service=new AuthenticatedCloudService(backupDb,staffDb,{
     backupKey:config.backupSigningKey,staffKey:config.staffSigningKey
   },()=>Math.floor(Date.now()/1000),cancellationDb,config.noticeVersion)
   const limiter=createPostgresWechatLoginLimiter({
     db:identityDb,peerHmacKey:config.loginPeerKey,verifiedPeer:edge.clientIp
   })
   const exchange=makeWechatCodeExchanger({appId:config.appId,appSecret:config.appSecret})
   host=await listenPrivateEdgeLoopback({
     account:{identityDb,noticeVersion:config.noticeVersion,authConfig:{
       appId:config.appId,codePepper:config.codePepper,
       subjectPepper:config.subjectPepper,
       backupSigningKey:config.backupSigningKey,
       nowSeconds:()=>Math.floor(Date.now()/1000)
     },exchange,login:loginWithWechatCode,account:service,permitLogin:limiter},
     backup:service,
     readiness:createPrivateHealthProbe(pools)
   },edge,config.port)
   // No DB URLs, passwords, user identities, appSecret or JWTs in logs.
   process.stdout.write('Cuoshi private cloud listening on 127.0.0.1:'+config.port+' (trusted edge required)\n')
   let closing=false
   const shutdown=async()=>{
     if(closing)return
     closing=true
     try{await host?.close()}catch{}
     await Promise.allSettled(pools.map(p=>p.end()))
   }
   for(const signal of ['SIGTERM','SIGINT'] as const){
     process.once(signal,()=>{void shutdown().then(()=>{process.exitCode=0})})
   }
 }catch(error){
   if(host){try{await host.close()}catch{}}
   await Promise.allSettled(pools.map(p=>p.end()))
   throw error
 }
}
void main().catch(error=>{
 // Report only bounded internal error codes, never raw SQL errors (which can
 // include a DSN), token contents, or provider responses.
 const message=error instanceof Error?error.message:''
 const safe=/^private_cloud_[a-z_]+(?::CUOSHI_[A-Z_]+)?$/.test(message)?message:
   'private_cloud_startup_failed'
 process.stderr.write(safe+'\n')
 process.exitCode=1
})
