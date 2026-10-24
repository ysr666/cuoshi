import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {resolve} from 'node:path'
let n=0
const check=(v,m)=>{assert.ok(v,m);n++}
const req=createRequire(resolve('future/server/.private-build/future/server/src/privateMain.js'))
const {createPrivateHealthProbe}=req('./privateHealth.js')
const {listenCloudLoopbackForQa}=req('./cloudHttpHost.js')
assert.throws(()=>createPrivateHealthProbe([]),/health_pools_required/);n++
assert.throws(()=>createPrivateHealthProbe([{}]),/health_pools_required/);n++
let time=1000,calls=0,mode='ready'
const pools=Array.from({length:4},()=>({async query(sql){
 calls++
 assert.equal(sql,'SELECT 1 AS healthy')
 if(mode==='fail')throw Error('private connection error contains sensitive example')
 if(mode==='bad')return {rows:[{healthy:0}]}
 return {rows:[{healthy:1}]}
}}))
const probe=createPrivateHealthProbe(pools,{now:()=>time,okTtlMs:100,
 failTtlMs:20,deadlineMs:50})
const ready=await Promise.all(Array.from({length:15},()=>probe()))
check(ready.every(Boolean)&&calls===4,
 'Concurrent readiness requests coalesce into four bounded PostgreSQL probes')
mode='fail'
check(await probe()===true&&calls===4,
 'Readiness response cached briefly to avoid health endpoint database amplification')
time+=101
check(await probe()===false&&calls===8,
 'Database exception changes readiness to unavailable without leaking diagnostics')
mode='ready'
check(await probe()===false&&calls===8,
 'Transient outage cached briefly, avoiding unbounded retry storms')
time+=21
check(await probe()===true&&calls===12,
 'Database recovery observed after short retry cache expires')
time+=101;mode='bad'
check(await probe()===false&&calls===16,
 'Empty or incorrect DB smoke-test result is not reported as healthy')
let waited=0
const stuck=createPrivateHealthProbe(Array.from({length:4},()=>({
 query(){waited++;return new Promise(()=>{})}
})),{deadlineMs:12,failTtlMs:20,okTtlMs:50})
check(await stuck()===false&&waited===4,
 'Hung PostgreSQL check respects short health response deadline')
const deps={account:{identityDb:{},noticeVersion:'privacy-v1',authConfig:{},exchange:async()=>({openid:'synthetic'}),
 login:async()=>({userId:'account0001',deviceId:'device0001',accessToken:'x'.repeat(128)}),
 account:{status:async()=>({}),setConsent:async()=>{},logoutUser:async()=>{}},
 permitLogin:()=>true},
 backup:{readBackup:async()=>null,upload:async()=>({kind:'rejected'})},
 readiness:probe}
const listener=await listenCloudLoopbackForQa(deps,'SYNTHETIC_TEST_ONLY')
try{
 time+=21;mode='ready'
 const healthy=await fetch(listener.origin+'/healthz')
 check(healthy.status===204&&healthy.headers.get('cache-control')==='no-store, private',
  'Real HTTP readiness reports 204 after actual DB probe says ready')
 time+=101;mode='fail'
 const sick=await fetch(listener.origin+'/healthz')
 const body=await sick.text()
 check(sick.status===503&&body.includes('cloud_temporarily_unavailable')&&
  !body.includes('sensitive example'),
  'Real HTTP returns 503 on lost database connectivity without credential leak')
 check((await fetch(listener.origin+'/healthz',{method:'POST'})).status===404,
  'Readiness endpoint refuses unexpected method')
}finally{await listener.close()}
console.log('PASS',n,'production cached database readiness and real HTTP outage behavior')
