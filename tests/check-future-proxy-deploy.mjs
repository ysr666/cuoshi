import assert from 'node:assert/strict'
import {readFileSync,mkdtempSync,statSync,rmSync,existsSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join,resolve} from 'node:path'
import {randomBytes,createHash} from 'node:crypto'
import {deriveProxyProof,configLines,createProxyEnvironmentFile} from '../future/server/deploy/prepare-proxy-env.mjs'

let n=0
const check=(v,label)=>{assert.ok(v,label);n++}
const bad=(fn,pattern,label)=>{assert.throws(fn,pattern,label);n++}
const raw=randomBytes(32)
const secret=raw.toString('hex')
const proof=deriveProxyProof(secret)
check(proof===createHash('sha256').update(raw).digest('hex'),
 'Derived gateway proof matches the private Node edge verifier contract')
check(proof!==secret&&/^[a-f0-9]{64}$/.test(proof),
 'Proxy uses derived credential, not the Node service raw secret')
const env={CUOSHI_PUBLIC_DOMAIN:'api.cuoshi.cn',CUOSHI_PRIVATE_PORT:'18765',
 CUOSHI_EDGE_SHARED_SECRET_HEX:secret}
check(configLines(env).includes('CUOSHI_EDGE_PROOF_HEX='+proof),
 'Gateway config receives only derived proof')
check(!configLines(env).includes(secret),
 'Server raw signing secret never enters gateway environment')
for(const domain of ['localhost','api.example','api.test','127.0.0.1',
 'api.local','api.invalid','https://api.cuoshi.cn','a.cn:443'])
 bad(()=>configLines({...env,CUOSHI_PUBLIC_DOMAIN:domain}),
  /proxy_requires_public_domain/,'Unsafe public domain refused: '+domain)
for(const port of ['0','80','65536','abc'])
 bad(()=>configLines({...env,CUOSHI_PRIVATE_PORT:port}),
  /proxy_requires_valid_private_port/,'Invalid internal port refused: '+port)
bad(()=>deriveProxyProof('1234'),/proxy_secret_must_be_32_bytes/,
 'Proxy never accepts truncated secret')
const dir=mkdtempSync(join(tmpdir(),'cuoshi-proxy-deploy-'))
try{
 const location=join(dir,'private-proxy.env')
 bad(()=>createProxyEnvironmentFile('relative.env',env),/must_be_absolute/,
  'Credential output cannot be an accidental relative project file')
 bad(()=>createProxyEnvironmentFile(resolve('future/server/deploy/DO_NOT_WRITE.env'),env),
  /cannot_be_in_repository/,'Credential never written to source checkout')
 check(createProxyEnvironmentFile(location,env)===location&&existsSync(location),
  'Operator can create exactly one credential file outside repository')
 check((statSync(location).mode&0o777)===0o600,
  'Generated gateway credentials are readable only by the owner')
 check(readFileSync(location,'utf8').includes(proof)&&
  !readFileSync(location,'utf8').includes(secret),
  'Generated environment has only derived edge proof, not root secret')
 bad(()=>createProxyEnvironmentFile(location,env),/EEXIST/,
  'Accidental overwrite of a live credential file is refused')
}finally{rmSync(dir,{recursive:true,force:true})}
const caddy=readFileSync('future/server/deploy/Caddyfile','utf8')
const routes=['/healthz','/v1/auth/wechat','/v1/auth/logout',
 '/v1/account/cancel','/v1/account/cancel/status','/v1/backup/status',
 '/v1/backup/consent','/v1/backup/snapshot']
for(const path of routes)
 check(caddy.includes(path),'Real backend route allowed by gateway: '+path)
check(caddy.includes('reverse_proxy 127.0.0.1:{$CUOSHI_PRIVATE_PORT}'),
 'Gateway upstream is forced to same-host loopback')
check(caddy.includes('header_up -X-Cuoshi-Edge-Proof')&&
 caddy.includes('header_up -X-Cuoshi-Client-Ip')&&
 caddy.includes('header_up X-Cuoshi-Edge-Proof {$CUOSHI_EDGE_PROOF_HEX}')&&
 caddy.includes('header_up X-Cuoshi-Client-Ip {http.request.remote.host}'),
 'Both privileged headers stripped then set from trusted server configuration/socket')
check(!/X-Forwarded-For\}/i.test(caddy),
 'No trust of arbitrary client-controlled forwarded-for IP placeholder')
check(caddy.includes('respond 404')&&caddy.includes('admin off'),
 'Unknown paths not proxied and unnecessary Caddy admin endpoint disabled')
console.log('PASS',n,'production-proxy static contract and file-permission tests (no live TLS)')
