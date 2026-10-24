import assert from 'node:assert/strict'
import {inspectPublicEdge,checkedPublicOrigin} from '../future/server/check-public-edge.mjs'
let n=0
const check=(v,msg)=>{assert.ok(v,msg);n++}
for(const origin of ['', 'http://api.cuoshi.cn','https://localhost',
 'https://127.0.0.1','https://api.cuoshi.invalid',
 'https://api.cuoshi.example','https://api.cuoshi.cn:18765',
 'https://api.cuoshi.cn/a','https://api.cuoshi.cn?token=oops']){
 assert.throws(()=>checkedPublicOrigin(origin),/public_edge_/);n++
}
check(checkedPublicOrigin('https://api.cuoshi.cn')==='https://api.cuoshi.cn',
 'Actual public HTTPS host syntax accepted for operator verification')
const calls=[]
const fake=async(url,opts)=>{
 calls.push({url,method:opts.method,headers:opts.headers})
 return {status:url.endsWith('/healthz')?204:
  url.endsWith('/v1/backup/snapshot')?401:404}
}
const checked=await inspectPublicEdge('https://api.cuoshi.cn',fake)
check(checked.length===3&&calls.length===3,
 'Only three fixed read-only endpoint checks sent')
check(calls.every(c=>c.method==='GET'&&
 !c.headers.Authorization&&!c.url.includes('token')),
 'Probe never sends logins, secrets or private records')
await assert.rejects(()=>inspectPublicEdge('https://api.cuoshi.cn',
 async()=>({status:204})),/public_edge_unexpected_status/);n++
await assert.rejects(()=>inspectPublicEdge('https://api.cuoshi.cn',
 async()=>({status:302})),/public_edge_unexpected_status/);n++
console.log('PASS',n,'read-only public HTTPS gateway readiness checks (mock requests only)')
