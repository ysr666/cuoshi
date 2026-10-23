/** Production-shaped dedicated staff process, no test issuer or public bind. */
import {createRequire} from 'node:module'
import {resolve} from 'node:path'
import {parsePrivateStaffConfig} from './privateStaffConfig'
import {privatePoolConnectionOptions} from './privateConfig'
import {checkPrivateStaffReadiness} from './privateStaffReadiness'
import {createTrustedEdgeBoundary} from './trustedEdge'
import {createStaffConsoleAssets,listenStaffPrivateLoopback} from './staffHttpHost'
import {createStaffOperationalService} from './operationalService'
import type {DbPool} from './repository'

async function main(){
 const cfg=parsePrivateStaffConfig(process.env)
 const localRequire=createRequire(__filename)
 const {Pool}=localRequire('pg') as {Pool:new(options:Record<string,unknown>)=>DbPool&{
  query(sql:string):Promise<{rows:Record<string,unknown>[]}>;end():Promise<void>
 }}
 const pool=(url:string)=>new Pool(privatePoolConnectionOptions(url,cfg.dbSchema,4))
 const staffDb=pool(cfg.staffDbUrl),reportDb=pool(cfg.reportingDbUrl)
 const pools=[staffDb,reportDb]
 let host:Awaited<ReturnType<typeof listenStaffPrivateLoopback>>|null=null
 try{
   await checkPrivateStaffReadiness(staffDb,reportDb,cfg.dbSchema)
   const assets=createStaffConsoleAssets(resolve(process.cwd(),'future/admin/live'))
   const edge=createTrustedEdgeBoundary({sharedSecret:cfg.edgeSecret})
   host=await listenStaffPrivateLoopback({
     reporting:createStaffOperationalService(staffDb,reportDb,cfg.signingKey,
       ()=>Math.floor(Date.now()/1000),cfg.soleOwnerId),
     consoleAssets:assets
   },edge,cfg.port)
   process.stdout.write('Cuoshi sole-owner admin loopback ready (trusted edge required)\n')
   let stopping=false
   const stop=async()=>{
     if(stopping)return;stopping=true
     try{await host?.close()}catch{}
     await Promise.allSettled(pools.map(p=>p.end()))
   }
   for(const signal of ['SIGINT','SIGTERM'] as const)
     process.once(signal,()=>{void stop().then(()=>{process.exitCode=0})})
 }catch(error){
   if(host){try{await host.close()}catch{}}
   await Promise.allSettled(pools.map(p=>p.end()))
   throw error
 }
}
void main().catch(()=>{
 // Never print database URLs, password, token, staff identifier or SQL text.
 process.stderr.write('private_staff_startup_blocked\n')
 process.exitCode=1
})
