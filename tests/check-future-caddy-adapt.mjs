/** Validate Caddy's REAL Caddyfile-to-JSON interpretation (not textual grep).
 * CI obtains this JSON from the official Caddy executable using synthetic
 * public metadata and an offline, read-only container. No live listener.
 */
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'

const source=process.argv[2]
if(!source)throw Error('caddy_adapt_json_required')
const config=JSON.parse(readFileSync(source,'utf8'))
let checks=0
const check=(condition,label)=>{assert.ok(condition,label);checks++}
const nested=[]
function visit(node){
 if(!node||typeof node!=='object')return
 if(Array.isArray(node)){for(const item of node)visit(item);return}
 nested.push(node)
 for(const value of Object.values(node))visit(value)
}
visit(config)
check(config.admin?.disabled===true,
 'Actual Caddy JSON completely disables local admin API')
const proxies=nested.filter(x=>x.handler==='reverse_proxy')
check(proxies.length===1,'Exactly one reverse proxy in rendered Caddy app')
const proxy=proxies[0]
check(proxy.upstreams?.length===1&&proxy.upstreams[0].dial==='127.0.0.1:18765',
 'Caddy upstream resolved to one private loopback endpoint')
const matches=nested.filter(x=>Array.isArray(x.path))
const expectedRoutes=[
 '/healthz','/v1/auth/wechat','/v1/auth/logout','/v1/account/cancel',
 '/v1/account/cancel/status','/v1/backup/status','/v1/backup/consent',
 '/v1/backup/snapshot'
]
check(matches.some(x=>
 x.path.length===expectedRoutes.length&&
 expectedRoutes.every(route=>x.path.includes(route))),
 'Real adapter preserves exact eight production endpoint paths')
const actualPaths=[...new Set(matches.flatMap(x=>x.path))]
check(actualPaths.length===expectedRoutes.length,
 'No wildcard routing, extra debug/staff/export/admin endpoints in gateway')
const requestHeaders=proxy.headers?.request
check(!!requestHeaders,'Reverse proxy explicitly controls upstream request headers')
const normalized=(obj,key)=>Object.entries(obj||{}).find(([k])=>
 k.toLowerCase()===key.toLowerCase())?.[1]
const setProof=normalized(requestHeaders?.set,'X-Cuoshi-Edge-Proof')
const setIp=normalized(requestHeaders?.set,'X-Cuoshi-Client-Ip')
check(Array.isArray(setProof)&&setProof.length===1&&
 setProof[0]==='a'.repeat(64),
 'Only synthetic derived proof reaches backend; not incoming caller proof')
check(Array.isArray(setIp)&&setIp.length===1&&
 setIp[0]==='{http.request.remote.host}',
 'Trusted peer IP must be the actual direct remote socket, not X-Forwarded-For')
const stripped=(requestHeaders?.delete||[]).map(x=>String(x).toLowerCase())
check(stripped.includes('x-cuoshi-edge-proof')&&
 stripped.includes('x-cuoshi-client-ip'),
 'Caller-supplied privileged headers removed before proxy inserts trusted metadata')
const handlers=nested.filter(x=>x.handler==='static_response')
check(handlers.some(x=>x.status_code==='404'||x.status_code===404),
 'Unknown routes rejected by Caddy itself rather than leaked to private backend')
check(JSON.stringify(config).includes('api.cuoshi.invalid')&&
 !JSON.stringify(config).includes('api.example.com'),
 'Only synthetic test domain used; not a live registered service')
console.log('PASS',checks,'official Caddy adapted HTTPS route/edge-metadata contracts (no traffic)')
