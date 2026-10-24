/** No production secrets: synthetic temporary offline bootstrap only. */
import assert from 'node:assert/strict'
import {mkdtempSync,readFileSync,rmSync,statSync,symlinkSync,realpathSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join,resolve} from 'node:path'
import {scryptSync,createHash,createHmac} from 'node:crypto'
import {execFileSync,spawnSync} from 'node:child_process'
import {provisionSoleOwnerBundle} from '../future/server/deploy/prepare-owner.mjs'
let checks=0
const check=(condition,message)=>{assert.ok(condition,message);checks++}
const tmp=mkdtempSync(join(tmpdir(),'cuoshi-offline-owner-'))
const all=['owner-auth.env.fragment','owner-onboarding.txt','owner-enroll.sql','SHA256-MANIFEST.txt']
try{
 const output=join(tmp,'initial-owner')
 assert.throws(()=>provisionSoleOwnerBundle('relative','cuoshi_it'),/absolute_path_required/);checks++
 assert.throws(()=>provisionSoleOwnerBundle(output,'public'),/schema_invalid/);checks++
 assert.throws(()=>provisionSoleOwnerBundle(output,'cuoshi;DROP'),/schema_invalid/);checks++
 assert.throws(()=>provisionSoleOwnerBundle(resolve('.','future/server/deploy/secrets'),'cuoshi_prod'),
   /repository_forbidden/);checks++
 const result=provisionSoleOwnerBundle(output,'cuoshi_prod')
 check(result.count===4&&result.directory===realpathSync(output),'Four files made outside source tree only')
 check((statSync(output).mode&0o777)===0o700,'Private output directory mode 0700')
 for(const file of all)check((statSync(join(output,file)).mode&0o777)===0o600,
   'Restricted 0600 file: '+file)
 const env=readFileSync(join(output,all[0]),'utf8')
 const readVar=(key)=>env.split('\n').find(x=>x.startsWith(key+'='))?.slice(key.length+1)
 const owner=readVar('CUOSHI_OWNER_ADMIN_ID')
 const pw=readFileSync(join(output,all[1]),'utf8')
 const password=pw.match(/^Initial dashboard password: (.+)$/m)?.[1]
 const totp=pw.match(/^Authenticator TOTP secret \(Base32\): (.+)$/m)?.[1]
 check(/^owner_[a-f0-9]{24}$/.test(owner),'Non-identifying random sole-owner ID')
 check(typeof password==='string'&&password.length>=40,'Strong unique initial password')
 const [algo,cost,saltHex,expectedHex]=readVar('CUOSHI_OWNER_PASSWORD_SCRYPT').split(':')
 check(algo==='scrypt'&&cost==='16384','Reviewable password KDF parameters')
 check(scryptSync(password,Buffer.from(saltHex,'hex'),32,{N:16384,r:8,p:1,maxmem:64*1024*1024}).toString('hex')===expectedHex,
   'Generated password matches salted scrypt without storing plaintext in env')
 check(totp===readVar('CUOSHI_OWNER_TOTP_SECRET')&&/^[A-Z2-7]{32}$/.test(totp),
   '20 random bytes TOTP seed offered for offline enrollment')
 const keys=['CUOSHI_OWNER_LOGIN_PEER_KEY_HEX','CUOSHI_STAFF_SIGNING_KEY_HEX','CUOSHI_STAFF_EDGE_SHARED_SECRET_HEX']
 check(new Set(keys.map(readVar)).size===3&&keys.every(k=>/^[a-f0-9]{64}$/.test(readVar(k))),
   'Three independent 256-bit secrets')
 const sql=readFileSync(join(output,all[2]),'utf8')
 check(sql.includes('SET LOCAL search_path TO "cuoshi_prod",pg_catalog;'),
   'Enrollment is transactionally pinned to a reviewed schema')
 check(sql.includes("VALUES ('"+owner+"','super_admin',TRUE)")&&
   sql.includes('owner_bootstrap_requires_empty_staff_table'),
   'Exactly one owner, refuses preexisting staff identities')
 check(!sql.includes(password)&&!sql.includes(totp)&&!sql.includes(expectedHex),
   'Database initialization never receives dashboard secrets')
 const manifest=readFileSync(join(output,all[3]),'utf8')
 for(const filename of ['owner-auth.env.fragment','owner-enroll.sql']){
   const hash=createHash('sha256').update(readFileSync(join(output,filename))).digest('hex')
   check(manifest.includes(hash+'  '+filename),'Manifest matches '+filename)
 }
 assert.throws(()=>provisionSoleOwnerBundle(output,'cuoshi_prod'),/EEXIST/);checks++
 const target=join(tmp,'symlinked');symlinkSync(output,target)
 assert.throws(()=>provisionSoleOwnerBundle(join(target,'attempt'),'cuoshi_prod'),/unsafe_parent/);checks++
 const cli=spawnSync(process.execPath,['future/server/deploy/prepare-owner.mjs',join(tmp,'command-line')],{
   cwd:resolve('.'),env:{...process.env,CUOSHI_PG_SCHEMA:'cuoshi_prod'},encoding:'utf8'})
 check(cli.status===0&&/no credentials printed or installed/.test(cli.stdout),
   'Explicit CLI runs without network, passing only nonsecret success marker')
 check(!cli.stdout.includes(password)&&!cli.stdout.includes(totp)&&cli.stderr==='',
   'CLI never prints secrets or errors containing values')
 console.log('PASS '+checks+' sole-owner first-run offline provisioning and secret isolation checks')
}finally{rmSync(tmp,{recursive:true,force:true})}
