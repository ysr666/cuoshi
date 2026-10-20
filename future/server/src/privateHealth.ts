/** Cached private edge readiness checks. No records, IDs or tokens returned.
 * Runs only on the already authenticated proxy /healthz route, not a public
 * unauthenticated DB maintenance endpoint. The smoke probe is deliberately
 * separate from startup's stronger and much heavier readiness contract.
 */
type ProbeDb={query(sql:string):Promise<{rows:Record<string,unknown>[]}>}
export function createPrivateHealthProbe(
 pools:readonly ProbeDb[],options:{now?:()=>number;okTtlMs?:number;
   failTtlMs?:number;deadlineMs?:number}={}
):()=>Promise<boolean>{
 if(!Array.isArray(pools)||pools.length!==4||
   pools.some(p=>!p||typeof p.query!=='function'))
   throw Error('private_cloud_health_pools_required')
 const now=options.now??Date.now
 const okTtl=options.okTtlMs??15000
 const failTtl=options.failTtlMs??5000
 const deadline=options.deadlineMs??2500
 if(!Number.isSafeInteger(deadline)||deadline<1||deadline>10000||
    !Number.isSafeInteger(okTtl)||okTtl<1||
    !Number.isSafeInteger(failTtl)||failTtl<1)
   throw Error('private_cloud_health_config_invalid')
 let nextDue=0,last=false,pending:Promise<boolean>|null=null
 return async()=>{
   if(pending)return pending
   if(now()<nextDue)return last
   pending=(async()=>{
     let timer:ReturnType<typeof setTimeout>|undefined
     try{
       const reachable=Promise.all(pools.map(p=>p.query('SELECT 1 AS healthy')))
       const result=await Promise.race([
         reachable,
         new Promise<null>(resolve=>{timer=setTimeout(()=>resolve(null),deadline)})
       ])
       last=Array.isArray(result)&&result.length===4&&
         result.every(row=>row.rows[0]?.healthy===1)
     }catch{last=false}
     finally{if(timer)clearTimeout(timer)}
     nextDue=now()+(last?okTtl:failTtl)
     return last
   })()
   try{return await pending}finally{pending=null}
 }
}
