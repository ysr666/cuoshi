import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {execFileSync} from 'node:child_process'
import {mkdtempSync,mkdirSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join,resolve} from 'node:path'
const root=resolve('.'),dir=mkdtempSync(join(tmpdir(),'cuoshi-auth-contract-'))
const require=createRequire(import.meta.url)
let n=0
const ok=(v,why)=>{assert.ok(v,why);n++}
try{
  mkdirSync(join(dir,'out'))
  execFileSync(resolve('node_modules/.bin/tsc'),[
    '--target','ES2022','--module','CommonJS','--moduleResolution','node','--skipLibCheck',
    '--strict','--rootDir',root,'--outDir',join(dir,'out'),'future/server/src/sessionTokens.ts'
  ],{cwd:root,stdio:'pipe'})
  const {issueServerSession,verifyServerSession}=require(join(dir,'out/future/server/src/sessionTokens.js'))
  const key=Buffer.alloc(32,17),other=Buffer.alloc(32,32)
  const now=1792132800
  const base={aud:'cuoshi-cloud-backup',sub:'account0001',deviceId:'device0001'}
  const token=issueServerSession(base,key,now)
  const check=(tok,aud='cuoshi-cloud-backup',time=now)=>
    verifyServerSession(tok,key,aud,time)
  const claims=check(token)
  ok(claims.sub===base.sub&&claims.deviceId===base.deviceId,'Verified user identity and device')
  ok(claims.aud===base.aud&&claims.iss==='cuoshi-server','Token issuer and audience')
  ok(claims.exp-now===900,'Cloud session max 15 minutes')
  ok(check(token,'cuoshi-staff-admin')===null,'Backup token never authorizes staff')
  ok(check(token,'cuoshi-cloud-backup',now+900)===null,'Token expires at exact exp')
  ok(check(token,'cuoshi-cloud-backup',now+899)?.sub===base.sub,'Valid before expiry')
  ok(check(token,'cuoshi-cloud-backup',now-1)===null,'Cannot use before issue')
  ok(verifyServerSession(token,other,'cuoshi-cloud-backup',now)===null,'Different secret invalid')
  ok(verifyServerSession(token,key,'cuoshi-cloud-backup',now+99999)===null,'Long after expiry')
  ok(check(token.slice(0,-1)+(token.at(-1)==='A'?'B':'A'))===null,'Signature tamper')
  const parts=token.split('.')
  const forgedSub=Buffer.from(JSON.stringify({...claims,sub:'account9999'})).toString('base64url')
  ok(check([parts[0],forgedSub,parts[2]].join('.'))===null,'Cannot forge user id without key')
  const forgedAud=Buffer.from(JSON.stringify({...claims,aud:'cuoshi-staff-admin'})).toString('base64url')
  ok(check([parts[0],forgedAud,parts[2]].join('.'))===null,'Cannot forge audience')
  ok(check('')===null,'Empty token denied')
  ok(check('a.b.c')===null,'Nonsense token denied')
  ok(check(token+'extra')===null,'Garbage suffix denied')
  ok(check(token.replaceAll('.',''))===null,'Missing token separators denied')
  ok(check('x'.repeat(10000))===null,'Oversized token denied')
  ok(check({token})===null,'Object instead of token denied')
  ok(check(null)===null,'Null token denied')
  ok(issueServerSession(base,key,now)!==token,'Unique session nonce')
  assert.throws(()=>issueServerSession(base,Buffer.alloc(16),now),/session_secret/);n++
  assert.throws(()=>verifyServerSession(token,Buffer.alloc(16),'cuoshi-cloud-backup',now),/session_secret/);n++
  assert.throws(()=>issueServerSession({...base,deviceId:''},key,now),/invalid_session/);n++
  assert.throws(()=>issueServerSession({...base,sub:'../../etc'},key,now),/invalid_session/);n++
  assert.throws(()=>issueServerSession({...base,aud:'cuoshi-staff-admin'},key,now),/staff_mfa/);n++
  assert.throws(()=>issueServerSession({...base,aud:'invalid'},key,now),/invalid_session/);n++
  const staffIdentity={aud:'cuoshi-staff-admin',sub:'support0001',mfaAt:now-30}
  const staffToken=issueServerSession(staffIdentity,key,now)
  const staff=check(staffToken,'cuoshi-staff-admin')
  ok(staff.sub==='support0001'&&staff.mfaAt===now-30,'Staff requires fresh MFA')
  ok(staff.exp-now===300,'Admin session expires in 5 minutes')
  ok(check(staffToken)===null,'Staff token cannot be used as normal user')
  ok(check(staffToken,'cuoshi-staff-admin',now+300)===null,'Staff token expires')
  ok(check(staffToken,'cuoshi-staff-admin',now+269)?.sub==='support0001','Staff valid until MFA freshness window')
  ok(check(staffToken,'cuoshi-staff-admin',now+301)===null,'Expired staff token invalid')
  assert.throws(()=>issueServerSession({...staffIdentity,mfaAt:now-301},key,now),/staff_mfa/);n++
  assert.throws(()=>issueServerSession({...staffIdentity,mfaAt:now+1},key,now),/staff_mfa/);n++
  assert.throws(()=>issueServerSession({...staffIdentity,deviceId:'device0001'},key,now),/staff_mfa/);n++
  ok(check(staffToken,'cuoshi-staff-admin',now-1)===null,'Staff not valid before mint')
  console.log('PASS',n,'signed-session boundary tests; no provider identities or public API')
}finally{rmSync(dir,{recursive:true,force:true})}
