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
const servers=Object.values(config.apps?.http?.servers||{})
const ownerServer=servers.find(x=>x.listen?.length===1&&x.listen[0]==='127.0.0.1:18767')
check(!!ownerServer,'Caddy owner listener MUST be bound to IPv4 loopback only')
const proxies=nested.filter(x=>x.handler==='reverse_proxy')
check(proxies.length===2,'Exactly two isolated loopback reverse proxies')
const proxy=proxies.find(x=>x.upstreams?.[0]?.dial==='127.0.0.1:18765')
const ownerProxy=proxies.find(x=>x.upstreams?.[0]?.dial==='127.0.0.1:18766')
check(!!proxy&&proxy.upstreams.length===1,
 'Caddy public backend has one private loopback endpoint')
check(!!ownerProxy&&ownerProxy.upstreams.length===1,
 'Caddy owner backend has a different private loopback endpoint')
const ownerNodes=[]
function visitOwner(node){if(!node||typeof node!=='object')return
 if(Array.isArray(node)){for(const item of node)visitOwner(item);return}
 ownerNodes.push(node);for(const value of Object.values(node))visitOwner(value)
}
visitOwner(ownerServer)
const ownerPaths=['/admin/','/admin/app.js','/admin/style.css','/admin/base.css',
 '/internal/admin/login','/internal/admin/logout','/internal/admin/overview']
const ownerMatches=ownerNodes.filter(x=>Array.isArray(x.path))
check(ownerMatches.some(x=>x.path.length===ownerPaths.length&&
 ownerPaths.every(v=>x.path.includes(v))),
 'SSH-only owner routes are exact seven paths, no bulk/private-note API')
check([...new Set(ownerMatches.flatMap(x=>x.path))].length===ownerPaths.length,
 'Owner gateway adds no wildcard or hidden endpoints')
for(const server of servers.filter(x=>x!==ownerServer)){
 const routes=[]
 function walk(node){if(!node||typeof node!=='object')return
  if(Array.isArray(node)){for(const item of node)walk(item);return}
  if(Array.isArray(node.path))routes.push(...node.path)
  for(const val of Object.values(node))walk(val)}
 walk(server)
 check(routes.every(path=>!ownerPaths.includes(path)),
  'No public Caddy listener exposes owner routes')
}
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
const publicMatches=matches.filter(x=>x.path.some(p=>p.startsWith('/v1/')||p==='/healthz'))
const actualPaths=[...new Set(publicMatches.flatMap(x=>x.path))]
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
const ownerHeaders=ownerProxy.headers?.request
const ownerProof=normalized(ownerHeaders?.set,'X-Cuoshi-Edge-Proof')
const ownerIp=normalized(ownerHeaders?.set,'X-Cuoshi-Client-Ip')
check(Array.isArray(ownerProof)&&ownerProof.length===1&&ownerProof[0]==='b'.repeat(64),
 'Owner gateway uses only the separate fake staff-derived proof')
check(Array.isArray(ownerIp)&&ownerIp.length===1&&
 ownerIp[0]==='{http.request.remote.host}',
 'Owner gateway uses the SSH tunnel TCP peer not caller-supplied forwarded IP')
check((ownerHeaders?.delete||[]).map(x=>String(x).toLowerCase()).includes('x-cuoshi-edge-proof')&&
 (ownerHeaders?.delete||[]).map(x=>String(x).toLowerCase()).includes('x-cuoshi-client-ip'),
 'Owner gateway strips forged private authentication metadata')
const stripped=(requestHeaders?.delete||[]).map(x=>String(x).toLowerCase())
check(stripped.includes('x-cuoshi-edge-proof')&&
 stripped.includes('x-cuoshi-client-ip'),
 'Caller-supplied privileged headers removed before proxy inserts trusted metadata')
const handlers=nested.filter(x=>x.handler==='static_response')
check(handlers.filter(x=>x.status_code==='404'||x.status_code===404).length>=2,
 'Unknown routes rejected by Caddy itself rather than leaked to private backend')
check(JSON.stringify(config).includes('api.cuoshi.invalid')&&
 !JSON.stringify(config).includes('api.example.com'),
 'Only synthetic test domain used; not a live registered service')
console.log('PASS',checks,'official Caddy adapted HTTPS route/edge-metadata contracts (no traffic)')
