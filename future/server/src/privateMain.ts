/**
 * Future private-loopback backend runner (behind a configured HTTPS edge).
 * Never starts without verified TLS database URLs, six distinct secrets,
 * restricted database roles, valid WeChat provider credentials and the
 * explicit loopback-only acknowledgement. No public listener is possible.
 */
import {createRequire} from 'node:module'
import {parsePrivateCloudConfig} from './privateConfig'
import {createTrustedEdgeBoundary} from './trustedEdge'
import {listenPrivateEdgeLoopback} from './cloudHttpHost'
import {createPostgresWechatLoginLimiter} from './loginRateLimiter'
import {makeWechatCodeExchanger,loginWithWechatCode} from './wechatIdentity'
import {AuthenticatedCloudService} from './authenticatedService'
import type {DbPool} from './repository'

async function main(){
 const config=parsePrivateCloudConfig(process.env)
 // pg is installed in future/server/node_modules, never a client bundle.
 const localRequire=createRequire(__filename)
 const {Pool}=localRequire('pg') as {Pool:new(opts:Record<string,unknown>)=>DbPool&{
   query(sql:string):Promise<{rows:Record<string,unknown>[]}>;end():Promise<void>
 }}
 const connect=(url:string)=>new Pool({connectionString:url,max:6,
   connectionTimeoutMillis:5000,idleTimeoutMillis:20000})
 const identityDb=connect(config.identityDbUrl),backupDb=connect(config.backupDbUrl),
   staffDb=connect(config.staffDbUrl)
 const pools=[identityDb,backupDb,staffDb]
 let host:Awaited<ReturnType<typeof listenPrivateEdgeLoopback>>|null=null
 try{
   // Fail before opening any TCP listener. Application roles must be distinct
   // and cannot be superusers, role creators, or table-migration owners.
   const roles:string[]=[]
   for(const pool of pools){
     const result=await pool.query(`SELECT current_user AS name,rolsuper,rolcreatedb,
       rolcreaterole,rolreplication,rolbypassrls FROM pg_roles WHERE rolname=current_user`)
     const role=result.rows[0]
     if(!role||typeof role.name!=='string'||role.rolsuper!==false||
        role.rolcreatedb!==false||role.rolcreaterole!==false||
        role.rolreplication!==false||role.rolbypassrls!==false)
       throw Error('private_cloud_database_role_unsafe')
     // A role may own tables despite lacking SUPERUSER or CREATEROLE.
     const ownership=await pool.query(`SELECT EXISTS(
       SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
       WHERE c.relowner=(SELECT oid FROM pg_roles WHERE rolname=current_user)
         AND c.relname IN ('cloud_users','cloud_snapshots','cloud_admin_audit',
           'cloud_wechat_identities','cloud_wechat_login_rate_windows')
     ) AS owns_sensitive_tables`)
     if(ownership.rows[0]?.owns_sensitive_tables!==false)
       throw Error('private_cloud_database_role_unsafe')
     const schema=await pool.query("SELECT to_regclass('cloud_users') AS users")
     if(!schema.rows[0]?.users)
       throw Error('private_cloud_database_schema_missing')
     roles.push(role.name)
   }
   if(new Set(roles).size!==3)throw Error('private_cloud_database_roles_not_separated')
   const limiterFunction=await identityDb.query(
     "SELECT to_regprocedure('cloud_take_wechat_login_slot(text)') AS configured")
   if(!limiterFunction.rows[0]?.configured)
     throw Error('private_cloud_login_limiter_migration_missing')
   const edge=createTrustedEdgeBoundary({sharedSecret:config.edgeSecret})
   const service=new AuthenticatedCloudService(backupDb,staffDb,{
     backupKey:config.backupSigningKey,staffKey:config.staffSigningKey
   })
   const limiter=createPostgresWechatLoginLimiter({
     db:identityDb,peerHmacKey:config.loginPeerKey,verifiedPeer:edge.clientIp
   })
   const exchange=makeWechatCodeExchanger({appId:config.appId,appSecret:config.appSecret})
   host=await listenPrivateEdgeLoopback({
     account:{identityDb,authConfig:{
       appId:config.appId,codePepper:config.codePepper,
       subjectPepper:config.subjectPepper,
       backupSigningKey:config.backupSigningKey,
       nowSeconds:()=>Math.floor(Date.now()/1000)
     },exchange,login:loginWithWechatCode,account:service,permitLogin:limiter},
     backup:service
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
