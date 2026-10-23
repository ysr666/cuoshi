/** Parse only, no network, genuine credentials or production listener. */
import assert from 'node:assert/strict'
import {randomBytes} from 'node:crypto'
import {createRequire} from 'node:module'
import {mkdtempSync,mkdirSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join,resolve} from 'node:path'
import {execFileSync} from 'node:child_process'
const root=resolve('.'),folder=mkdtempSync(join(tmpdir(),'cuoshi-staff-cfg-'))
const require=createRequire(import.meta.url)
let n=0
try{
 const output=join(folder,'compiled');mkdirSync(output)
 execFileSync(resolve('node_modules/.bin/tsc'),[
  '--strict','--target','ES2022','--module','CommonJS','--moduleResolution','node',
  '--skipLibCheck','--rootDir',root,'--outDir',output,
  'future/server/src/privateStaffConfig.ts'
 ],{cwd:root,stdio:'inherit'})
 const {parsePrivateStaffConfig}=require(join(output,'future/server/src/privateStaffConfig.js'))
 const env={
   CUOSHI_STAFF_EDGE_ACK:'ISOLATED_STAFF_LOOPBACK_ONLY',CUOSHI_STAFF_PORT:'8644',
   CUOSHI_PRIVATE_PORT:'8622',CUOSHI_PG_SCHEMA:'cuoshi_test',
   CUOSHI_OWNER_ADMIN_ID:'soleowner01',
   CUOSHI_PG_STAFF_URL:'postgresql://role_staff:placeholder@127.0.0.1:5432/test?sslmode=verify-full',
   CUOSHI_PG_REPORTING_URL:'postgresql://role_reports:placeholder@127.0.0.1:5432/test?sslmode=verify-full',
   CUOSHI_STAFF_SIGNING_KEY_HEX:randomBytes(32).toString('hex'),
   CUOSHI_STAFF_EDGE_SHARED_SECRET_HEX:randomBytes(32).toString('hex')
 }
 const reject=(change,pattern)=>{assert.throws(()=>parsePrivateStaffConfig({...env,...change}),pattern);n++}
 reject({CUOSHI_STAFF_EDGE_ACK:''},/ack_required/)
 reject({CUOSHI_OWNER_ADMIN_ID:''},/sole_owner_required/)
 reject({CUOSHI_OWNER_ADMIN_ID:'abc'},/sole_owner_required/)
 reject({CUOSHI_STAFF_PORT:'80'},/port_invalid/)
 reject({CUOSHI_STAFF_PORT:'8622'},/port_collision/)
 reject({CUOSHI_PG_SCHEMA:'public'},/schema_invalid/)
 reject({CUOSHI_PG_REPORTING_URL:env.CUOSHI_PG_STAFF_URL},/roles_not_separated/)
 reject({CUOSHI_PG_REPORTING_URL:env.CUOSHI_PG_REPORTING_URL.replace('verify-full','disable')},/database_invalid/)
 reject({CUOSHI_STAFF_SIGNING_KEY_HEX:'invalid'},/secret_missing/)
 reject({CUOSHI_STAFF_EDGE_SHARED_SECRET_HEX:env.CUOSHI_STAFF_SIGNING_KEY_HEX},/secrets_not_separated/)
 const cfg=parsePrivateStaffConfig(env)
 assert.equal(cfg.port,8644);n++
 assert.equal(cfg.soleOwnerId,'soleowner01');n++
 assert.equal(cfg.dbSchema,'cuoshi_test');n++
 assert.equal(cfg.signingKey.byteLength,32);n++
 console.log('PASS '+n+' independent staff listener credential and role configuration gates')
}finally{rmSync(folder,{recursive:true,force:true})}
