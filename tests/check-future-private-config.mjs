import assert from 'node:assert/strict'
import {execFileSync,spawnSync} from 'node:child_process'
import {mkdtempSync,mkdirSync,rmSync,existsSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join,resolve} from 'node:path'
import {createRequire} from 'node:module'
import {randomBytes} from 'node:crypto'
const root=resolve('.'),dir=mkdtempSync(join(tmpdir(),'cuoshi-private-config-'))
const require=createRequire(import.meta.url)
let n=0
const check=(v,label)=>{assert.ok(v,label);n++}
try{
 const out=join(dir,'compiled');mkdirSync(out)
 execFileSync(resolve('node_modules/.bin/tsc'),[
  '--strict','--target','ES2022','--module','CommonJS','--moduleResolution','node',
  '--skipLibCheck','--rootDir',root,'--outDir',out,
  'future/server/src/privateConfig.ts'
 ],{cwd:root,stdio:'inherit'})
 const {parsePrivateCloudConfig:parse}=require(join(out,'future/server/src/privateConfig.js'))
 const keys=['CUOSHI_BACKUP_SIGNING_KEY_HEX','CUOSHI_STAFF_SIGNING_KEY_HEX',
  'CUOSHI_WECHAT_SUBJECT_PEPPER_HEX','CUOSHI_WECHAT_CODE_PEPPER_HEX',
  'CUOSHI_LOGIN_PEER_HMAC_KEY_HEX','CUOSHI_EDGE_SHARED_SECRET_HEX']
 const env={CUOSHI_PRIVATE_EDGE_ACK:'PRIVATE_EDGE_LOOPBACK_ONLY',CUOSHI_PRIVATE_PORT:'18765',
  CUOSHI_WECHAT_APP_ID:'wx0123456789abcdef',CUOSHI_WECHAT_APP_SECRET:'a'.repeat(32),
  CUOSHI_PG_BACKUP_URL:'postgresql://backup_private:password@pg.example.net:5432/cuoshi?sslmode=verify-full',
  CUOSHI_PG_IDENTITY_URL:'postgresql://identity_private:password@pg.example.net:5432/cuoshi?sslmode=verify-full',
  CUOSHI_PG_STAFF_URL:'postgresql://staff_private:password@pg.example.net:5432/cuoshi?sslmode=verify-full'}
 for(const key of keys)env[key]=randomBytes(32).toString('hex')
 const config=parse(env)
 check(config.port===18765&&config.appId===env.CUOSHI_WECHAT_APP_ID,
  'Valid separated private service config parses to typed output')
 check(config.backupSigningKey.length===32&&config.edgeSecret.length===32,
  '32-byte secrets decode into memory, not the client package')
 const reject=(delta,pattern,label)=>{
  assert.throws(()=>parse({...env,...delta}),pattern,label);n++
 }
 reject({CUOSHI_PRIVATE_EDGE_ACK:'EXPOSE_PUBLIC'},/ack_required/,'No public-listener acknowledgement')
 reject({CUOSHI_PRIVATE_EDGE_ACK:undefined},/ack_required/,'No startup without deliberate acknowledgement')
 reject({CUOSHI_PRIVATE_PORT:'0'},/port_invalid/,'No random production bind port')
 reject({CUOSHI_PRIVATE_PORT:'80'},/port_invalid/,'No privileged/public redirect port')
 reject({CUOSHI_PRIVATE_PORT:'70000'},/port_invalid/,'No out-of-range port')
 reject({CUOSHI_WECHAT_APP_ID:'touristappid'},/wechat_config_invalid/,'Test app IDs blocked')
 reject({CUOSHI_WECHAT_APP_SECRET:'placeholder'},/wechat_config_invalid/,'Fake provider secrets blocked')
 reject({CUOSHI_PG_BACKUP_URL:'postgresql://postgres:password@pg.example.net/cuoshi?sslmode=verify-full'},
  /database_invalid/,'Database superuser name rejected')
 reject({CUOSHI_PG_BACKUP_URL:'postgresql://backup_private:password@pg.example.net/cuoshi?sslmode=disable'},
  /database_invalid/,'DB transport cannot be plaintext')
 reject({CUOSHI_PG_BACKUP_URL:'postgresql://backup_private:password@pg.example.net/cuoshi?sslmode=verify-full&sslmode=disable'},
  /database_invalid/,'Duplicate SSL parameters cannot downgrade encryption')
 reject({CUOSHI_PG_STAFF_URL:env.CUOSHI_PG_BACKUP_URL},/roles_not_separated/,
  'Staff account never shares backup DB role')
 reject({CUOSHI_BACKUP_SIGNING_KEY_HEX:'a'.repeat(12)},/secret_missing_or_invalid/,
  'Short signing keys rejected')
 reject({CUOSHI_EDGE_SHARED_SECRET_HEX:env.CUOSHI_LOGIN_PEER_HMAC_KEY_HEX},
  /secrets_not_separated/,'Proxy credential and client HMAC cannot share key')
 for(const key of keys){reject({[key]:undefined},/secret_missing_or_invalid/,
  'Missing required secret rejected: '+key)}
 // Compile the actual service entry and require a deliberate acknowledgement
 // BEFORE requiring pg or attempting any network/database activity.
 const compiled=resolve('future/server/.private-build/future/server/src/privateMain.js')
 if(!existsSync(compiled))execFileSync('node',['future/server/build-private.mjs'],{cwd:root,stdio:'inherit'})
 const run=spawnSync(process.execPath,[compiled],{
  cwd:root,env:{PATH:process.env.PATH},encoding:'utf8',timeout:6000
 })
 check(run.status===1&&run.stderr.includes('private_cloud_explicit_ack_required'),
  'Compiled real service fails closed when no deploy acknowledgement exists')
 check(!run.stdout.includes('listening')&&!
  run.stderr.includes('password')&&!run.stderr.includes('secret'),
  'Failed startup does not listen or log any credentials')
 console.log('PASS',n,'private cloud staging config and startup guard checks')
}finally{rmSync(dir,{recursive:true,force:true})}
