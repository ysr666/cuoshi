/** Read-only release gate. No credentials, user data or write requests. */
import {isIP} from 'node:net'
const badDomain=/(?:^|\.)(?:invalid|example|test|local|localhost)$/i
export function checkedPublicOrigin(value){
 if(typeof value!=='string'||!/^https:\/\/[a-z0-9.-]+$/i.test(value))
  throw Error('public_edge_requires_https_origin_without_path_or_port')
 const {hostname}=new URL(value)
 if(isIP(hostname)||badDomain.test(hostname)||!hostname.includes('.')||
   hostname.includes('..'))throw Error('public_edge_host_not_public')
 return value
}
export async function inspectPublicEdge(value,fetcher=globalThis.fetch){
 const origin=checkedPublicOrigin(value)
 // No POST, login token, query body, nor private content is transmitted.
 const cases=[
  ['/healthz',204],
  ['/v1/backup/snapshot',401],
  ['/v1/not-a-real-route',404]
 ]
 const verified=[]
 for(const [path,expect] of cases){
  const result=await fetcher(origin+path,{method:'GET',
   headers:{Accept:'application/json'},redirect:'manual',
   signal:AbortSignal.timeout(8000)})
  if(result.status!==expect)
   throw Error('public_edge_unexpected_status:'+path+':'+result.status)
  verified.push(path)
 }
 return verified
}
if(process.argv[1]?.endsWith('/check-public-edge.mjs')){
 const origin=process.env.CUOSHI_V05_CLOUD_ORIGIN||''
 inspectPublicEdge(origin).then(paths=>{
  process.stdout.write('PASS public HTTPS edge read-only checks: '+paths.join(', ')+'\n')
 }).catch(error=>{
  // Errors must never include the domain or response bodies in CI logs.
  const msg=error instanceof Error?error.message:''
  const code=/^public_edge_[a-z_]+$/.test(msg)?msg:'public_edge_probe_failed'
  process.stderr.write(code+'\n');process.exitCode=1
 })
}
