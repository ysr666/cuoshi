/** Read-only production HTTPS availability check. Never sends user data,
 * auth tokens, provider keys or private headers. Fail closed on TLS errors,
 * redirects, wrong status, DNS errors or deadlines. A failed systemd unit
 * is an observable signal, NOT an actual configured pager/notification.
 */
import https from 'node:https'
import {isIP} from 'node:net'
import {resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
const forbidden=new Set(['localhost','example.com','api.example.com',
 'cuoshi.invalid','api.cuoshi.invalid'])
export function checkedPublicHostname(value){
 if(typeof value!=='string'||value.length>253||value!==value.toLowerCase()||
    !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(value)||
    isIP(value)!==0||forbidden.has(value)||
    ['.local','.internal','.invalid','.example','.test','.localhost'].some(x=>value.endsWith(x))||
    value.includes('..'))throw Error('private_cloud_monitor_domain_invalid')
 return value
}
export function realHttpsProbe(url,deadlineMs){
 return new Promise((resolve,reject)=>{
   const request=https.get(url,{
     timeout:deadlineMs,agent:false,headers:{'cache-control':'no-cache',
       'user-agent':'Cuoshi-Synthetic-Health-Probe/0.5'}
   },res=>{
     const status=res.statusCode
     res.resume()
     res.on('end',()=>resolve(status))
     res.on('error',reject)
   })
   request.on('timeout',()=>request.destroy(Error('private_cloud_monitor_timeout')))
   request.on('error',reject)
 })
}
export async function checkPublicCloudHealth(env,transport=realHttpsProbe){
 const domain=checkedPublicHostname(env?.CUOSHI_PUBLIC_DOMAIN)
 // HTTPS only, certificate hostname validation on, no credential nor redirect.
 const code=await transport('https://'+domain+'/healthz',5000)
 if(code!==204)throw Error('private_cloud_monitor_unavailable')
 return true
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 void checkPublicCloudHealth(process.env).then(()=>{
   process.stdout.write('Cuoshi HTTPS readiness OK\n')
 }).catch(()=>{
   // No provider host, IP, DSN, JWT, token, response body or stack in logs.
   process.stderr.write('private_cloud_monitor_failed\n')
   process.exitCode=1
 })
}
