import assert from 'node:assert/strict'
import {execFileSync} from 'node:child_process'
import {mkdtempSync,mkdirSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join,resolve} from 'node:path'
import {createRequire} from 'node:module'
import {randomBytes} from 'node:crypto'
const root=resolve('.'),temp=mkdtempSync(join(tmpdir(),'cuoshi-login-limit-'))
const require=createRequire(import.meta.url)
let n=0
const check=(v,why)=>{assert.ok(v,why);n++}
try{
 const out=join(temp,'js');mkdirSync(out)
 execFileSync(resolve('node_modules/.bin/tsc'),[
  '--strict','--target','ES2022','--module','CommonJS','--moduleResolution','node',
  '--skipLibCheck','--rootDir',root,'--outDir',out,
  'future/server/src/loginRateLimiter.ts'
 ],{cwd:root,stdio:'inherit'})
 const {createPostgresWechatLoginLimiter}=require(join(out,'future/server/src/loginRateLimiter.js'))
 assert.throws(()=>createPostgresWechatLoginLimiter({db:null,peerHmacKey:randomBytes(32)}),/not_configured/);n++
 assert.throws(()=>createPostgresWechatLoginLimiter({db:{connect(){}},peerHmacKey:randomBytes(12)}),/not_configured/);n++
 const key=randomBytes(32),calls=[]
 let failures=false,released=0
 const db={async connect(){if(failures)throw Error('database_unavailable');return {
  async query(sql,values){calls.push({sql,values});return {rows:[{allowed:true}]}},
  release(){released++}
 }}}
 const worker1=createPostgresWechatLoginLimiter({db,peerHmacKey:key})
 const worker2=createPostgresWechatLoginLimiter({db,peerHmacKey:key})
 const req=(address,header='10.0.0.1')=>({socket:{remoteAddress:address},
  headers:{'x-forwarded-for':header,'x-real-ip':header}})
 check(await worker1(req('192.0.2.12'))&&await worker2(req('192.0.2.12','1.2.3.4')),
  'Two worker objects accept same peer without trusting spoofed proxy headers')
 check(calls[0].values[0]===calls[1].values[0]&&calls[0].values[0].length===64,
  'Stable keyed digest is shared across worker instances, not the raw IP')
 check(!JSON.stringify(calls).includes('192.0.2.12')&&
  !JSON.stringify(calls).includes('1.2.3.4'),
  'No source IP or forged X-Forwarded-For is sent to database')
 check(calls[0].sql==='SELECT cloud_take_wechat_login_slot($1) AS allowed',
  'Backend calls only the bounded security-definer SQL function')
 check(await worker1(req('192.0.2.13'))&&calls[2].values[0]!==calls[0].values[0],
  'Different socket peer receives a distinct non-reversible identifier')
 check(!await worker1(req('not-an-ip'))&&!
  await worker1({socket:{},headers:{'x-forwarded-for':'192.0.2.14'}}),
  'Untrusted or absent socket address is fail-closed even with forged header')
 const before=calls.length
 check(before===3,'Denied socket attempts never contact database')
 check(released===before,'DB resources released after all successful checks')
 failures=true
 await assert.rejects(()=>worker2(req('192.0.2.15')),/database_unavailable/);n++
 const deny=createPostgresWechatLoginLimiter({db:{async connect(){return {
  async query(){return {rows:[{allowed:false}]}},release(){}
 }}},peerHmacKey:key})
 check(!await deny(req('192.0.2.15')),'Database denies exhausted windows')
 const malformed=createPostgresWechatLoginLimiter({db:{async connect(){return {
  async query(){return {rows:[]}},release(){}
 }}},peerHmacKey:key})
 check(!await malformed(req('192.0.2.16')),'Missing DB decision cannot allow a login')
 console.log('PASS',n,'login limiter HMAC, trusted socket, two-worker and fail-closed assertions')
}finally{rmSync(temp,{recursive:true,force:true})}
