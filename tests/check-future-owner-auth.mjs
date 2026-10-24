/** Real password KDF and TOTP verification, only synthetic credentials. */
import assert from 'node:assert/strict'
import {createHmac,randomBytes,scryptSync} from 'node:crypto'
import {createRequire} from 'node:module'
import {execFileSync} from 'node:child_process'
import {mkdtempSync,mkdirSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join,resolve} from 'node:path'
const root=resolve('.'),temp=mkdtempSync(join(tmpdir(),'cs-owner-auth-'))
const require=createRequire(import.meta.url)
let n=0
const ok=(v,m)=>{assert.ok(v,m);n++}
function base32(buffer){let bits=0,value=0,out='';const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
 for(const byte of buffer){value=(value<<8)|byte;bits+=8;while(bits>=5){bits-=5;out+=alphabet[(value>>bits)&31]}}
 if(bits)out+=alphabet[(value<<(5-bits))&31];return out}
function code(key,step){const bytes=Buffer.alloc(8);bytes.writeBigUInt64BE(BigInt(step))
 const hash=createHmac('sha1',key).update(bytes).digest(),offset=hash[19]&15
 return String((hash.readUInt32BE(offset)&0x7fffffff)%1000000).padStart(6,'0')}
try{
 const out=join(temp,'build');mkdirSync(out)
 execFileSync(resolve('node_modules/.bin/tsc'),[
  '--strict','--target','ES2022','--module','CommonJS','--moduleResolution','node',
  '--skipLibCheck','--rootDir',root,'--outDir',out,'future/server/src/ownerAuth.ts'
 ],{cwd:root,stdio:'inherit'})
 const {createOwnerAuthService,validateOwnerLoginSettings}=require(join(out,'future/server/src/ownerAuth.js'))
 const {verifyServerSession}=require(join(out,'future/server/src/sessionTokens.js'))
 const password='fixture-password-for-single-owner',salt=randomBytes(16),totpKey=randomBytes(20)
 const key=randomBytes(32),hashKey=randomBytes(32),now=()=>1800000000
 const settings={ownerId:'soleowner01',signingKey:key,peerHashKey:hashKey,
  passwordRecord:`scrypt:16384:${salt.toString('hex')}:${scryptSync(password,salt,32,{N:16384,r:8,p:1,maxmem:64*1024*1024}).toString('hex')}`,
  totpSecret:base32(totpKey)}
 const invalid=(patch,re)=>{assert.throws(()=>validateOwnerLoginSettings({...settings,...patch}),re);n++}
 invalid({passwordRecord:'plaintext12345678'},/hash_invalid/)
 invalid({totpSecret:'PASSWORD'},/totp_secret_invalid/)
 invalid({signingKey:hashKey},/config_invalid/)
 let count=0,lastStep=-1,revoke=false,revocationWrites=0
 const pool={async connect(){return {async query(sql,params){
   if(sql.includes('cloud_take_owner_login_slot')){
     count++;ok(/^[a-f0-9]{64}$/.test(params[0]),'Only HMAC peer fingerprint reaches DB')
     return {rows:[{allowed:count<=6}]}
   }
   if(sql.includes('cloud_consume_owner_totp_step')){
     const step=Number(params[1]);const accepted=step>lastStep
     if(accepted)lastStep=step
     ok(params[0]==='soleowner01','Only fixed owner ID in anti-replay SQL')
     return {rows:[{accepted}]}
   }
   if(sql.includes('SELECT 1 FROM cloud_revoked_staff_tokens'))return {rows:revoke?[{one:1}]:[]}
   if(sql.includes('INSERT INTO cloud_revoked_staff_tokens')){revocationWrites++;revoke=true;return {rows:[]}}
   throw Error('unexpected_sql')
 },release(){}}}}
 const auth=createOwnerAuthService(pool,settings,now)
 await assert.rejects(auth.login({password:'definitely-wrong!',otp:code(totpKey,now()/30|0)},'192.0.2.5'),/login_invalid/);n++
 await assert.rejects(auth.login({password,otp:'123'},'192.0.2.5'),/login_invalid/);n++
 await assert.rejects(auth.login({password,otp:'000000'},'invalid-address'),/peer_unverified/);n++
 const validOtp=code(totpKey,Math.floor(now()/30))
 const issued=await auth.login({password,otp:validOtp},'192.0.2.5')
 ok(typeof issued==='string'&&issued.length>90,'Valid password + fresh TOTP issues token')
 const claims=verifyServerSession(issued,key,'cuoshi-staff-admin',now())
 ok(claims?.sub==='soleowner01'&&claims?.exp===now()+300,'Five-minute scoped sole-owner session')
 await assert.rejects(auth.login({password,otp:validOtp},'192.0.2.5'),/login_invalid/);n++
 await auth.logout(issued)
 ok(revocationWrites===1,'Logout writes verified token revocation to persistent DB')
 await assert.rejects(auth.logout(issued),/session_revoked/);n++
 await assert.rejects(auth.login({password,otp:validOtp},'192.0.2.5'),/login_invalid/);n++
 await assert.rejects(auth.login({password,otp:validOtp},'192.0.2.5'),/login_invalid/);n++
 await assert.rejects(auth.login({password,otp:validOtp},'192.0.2.5'),/rate_limited/);n++
 console.log('PASS '+n+' owner password, TOTP anti-replay, IP guard and signed logout assertions')
}finally{rmSync(temp,{recursive:true,force:true})}
