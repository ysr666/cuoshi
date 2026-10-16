import assert from 'node:assert/strict'
import {execFileSync} from 'node:child_process'
import {mkdtempSync,mkdirSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join,resolve} from 'node:path'
import {createRequire} from 'node:module'

const root=resolve('.'),temp=mkdtempSync(join(tmpdir(),'cuoshi-cloud-contract-'))
const require=createRequire(import.meta.url)
let checks=0
const check=(actual,message)=>{assert.ok(actual,message);checks++}
try{
  const out=join(temp,'build');mkdirSync(out)
  execFileSync(resolve('node_modules/.bin/tsc'),[
    '--target','ES2022','--module','CommonJS','--moduleResolution','node',
    '--skipLibCheck','--rootDir',root,'--outDir',out,
    'future/cloud/snapshotContract.ts','future/cloud/adminAccessContract.ts'
  ],{cwd:root,stdio:'pipe'})
  const m=require(join(out,'src/core/model.js'))
  const {CloudContractSimulator}=require(join(out,'future/cloud/snapshotContract.js'))
  const {checkBodyRead}=require(join(out,'future/cloud/adminAccessContract.js'))
  const user={userId:'account0001',deviceId:'device0001',cloudBackupEnabled:true}
  const other={userId:'account0002',deviceId:'device0002',cloudBackupEnabled:true}
  const disabled={...user,cloudBackupEnabled:false}
  const yesterday=m.dateOffset(m.localDate(),-1)
  const today=m.localDate()
  const state=m.fresh()
  m.setCount(state,yesterday,0)
  m.appendNote(state,yesterday,'只供测试的私人文字📝')
  const sim=new CloudContractSimulator()
  const upload0={baseRevision:0,baseDigest:null,idempotencyKey:'request0001',records:state}
  check(sim.propose(disabled,upload0).reason==='consent_required','Cloud upload never automatic')
  check(sim.propose(null,upload0).reason==='authentication','Missing session rejected')
  check(sim.propose(user,null).reason==='invalid_request','Missing payload rejected')
  check(sim.readForOwner(null,user.userId)===null,'Missing session cannot read')
  check(sim.readForOwner(disabled,user.userId)===null,'Disabled cloud reading is refused')
  check(sim.readForOwner(other,user.userId)===null,'Cross-tenant reading forbidden')
  const first=sim.propose(user,upload0)
  check(first.kind==='accepted'&&first.receipt.revision===1,'Explicit first upload accepted')
  check(first.snapshot.records.events.length===2,'Keeps all count/note event history')
  check(first.snapshot.records.events.some(e=>e.newText?.includes('私人文字')),'Keeps historical note text')
  check(sim.propose(user,upload0).kind==='replayed','Exact idempotent replay does not create new revision')
  check(sim.readForOwner(user,user.userId).revision===1,'Replay does not change state')
  check(sim.propose({...user,deviceId:'device9999'},upload0).reason==='idempotency_mismatch','Idempotency cannot silently change originating device')
  const replayAbuse={...upload0,baseRevision:1,baseDigest:first.receipt.digest}
  check(sim.propose(user,replayAbuse).reason==='idempotency_mismatch','Same key with different base token forbidden')
  const changed=m.cloneState(state)
  m.setCount(changed,today,3)
  check(sim.propose(user,{...upload0,idempotencyKey:'request0002',records:changed}).kind==='conflict','Stale revision must not overwrite newer data')
  check(sim.propose(user,{...upload0,baseRevision:1,baseDigest:'0'.repeat(64),idempotencyKey:'request0003'}).reason==='divergent_base','Divergent checksum causes conflict')
  const forged=m.cloneState(state)
  forged.events[1].newText='被伪造的旧文字'
  check(sim.propose(user,{baseRevision:1,baseDigest:first.receipt.digest,idempotencyKey:'request0004',records:forged}).reason==='history_rewrite','Old event text cannot be rewritten')
  check(sim.propose(user,{baseRevision:1,baseDigest:first.receipt.digest,idempotencyKey:'request0005',records:m.fresh()}).reason==='history_rewrite','Old history cannot be truncated')
  const invalid=m.cloneState(changed)
  invalid.events[0].delta=42
  check(sim.propose(user,{baseRevision:1,baseDigest:first.receipt.digest,idempotencyKey:'request0006',records:invalid}).reason==='validation','Invalid event ledger denied')
  const next=sim.propose(user,{baseRevision:1,baseDigest:first.receipt.digest,idempotencyKey:'request0007',records:changed})
  check(next.kind==='accepted'&&next.receipt.revision===2,'Append-only change accepted at matching revision')
  check(sim.readForOwner(user,user.userId).records.days[today].count===3,'Next revision persisted without losing zero yesterday')
  check(sim.readForOwner(other,user.userId)===null,'Other user cannot read new revision')

  const now='2026-10-16T12:00:00.000Z'
  const staff={staffId:'staff_support_01',role:'support',mfaVerified:true}
  const caseRecord={id:'ticket0001',ownerId:user.userId,purpose:'support_ticket',status:'open'}
  const grant={
    id:'grant0001',staffId:staff.staffId,caseId:caseRecord.id,
    ownerId:user.userId,purpose:'support_ticket',dayKeys:[yesterday],
    startsAt:'2026-10-16T11:00:00.000Z',expiresAt:'2026-10-16T13:00:00.000Z',
    approvedBy:'staff_supervisor_02'
  }
  const access={staff,ownerId:user.userId,dayKey:yesterday,caseRecord,grant,now}
  const decide=override=>checkBodyRead({...access,...override})
  const allowed=decide({})
  check(allowed.allowed,'Support case with approved scope may access specific day')
  check(!JSON.stringify(allowed.audit).includes('私人文字'),'Audit never contains private note body')
  check(!decide({dayKey:today}).allowed,'Grant cannot read other dates')
  check(!decide({ownerId:other.userId}).allowed,'Grant cannot read other owners')
  check(!decide({grant:null}).allowed,'Missing grant denied')
  check(!decide({caseRecord:null}).allowed,'No case denied')
  check(!decide({caseRecord:{...caseRecord,status:'closed'}}).allowed,'Closed case denied')
  check(!decide({grant:{...grant,approvedBy:staff.staffId}}).allowed,'Self approval forbidden')
  check(!decide({grant:{...grant,revokedAt:'2026-10-16T11:30:00Z'}}).allowed,'Revoked grant denied')
  check(!decide({staff:{...staff,mfaVerified:false}}).allowed,'Missing MFA denied')
  check(!decide({staff:{...staff,role:'super_admin'}}).allowed,'Super admin does not automatically read bodies')
  check(!decide({staff:{...staff,role:'auditor'}}).allowed,'Auditor sees metadata not body')
  check(!decide({now:grant.expiresAt}).allowed,'Expiration inclusive denial')
  check(!decide({grant:{...grant,expiresAt:'2026-10-17T13:00:00Z'}}).allowed,'A long-lived body-access grant is invalid')
  check(!decide({now:'2026-10-16T10:00:00Z'}).allowed,'Not valid before start')
  check(!decide({grant:{...grant,dayKeys:[]}}).allowed,'Empty scope grants nothing')
  const safety={staffId:'staff_safety_01',role:'safety_reviewer',mfaVerified:true}
  const safetyCase={id:'review0001',ownerId:user.userId,purpose:'necessary_safety_review',status:'open'}
  const safetyGrant={...grant,staffId:safety.staffId,caseId:safetyCase.id,purpose:safetyCase.purpose}
  check(decide({staff:safety,caseRecord:safetyCase,grant:safetyGrant}).allowed,'Necessary safety case scoped access')
  check(!decide({staff:safety,caseRecord,grant}).allowed,'Safety reviewer cannot use customer support grant')
  check(!decide({now:'not-a-date'}).allowed,'Invalid time fails closed')
  console.log('PASS',checks,'future cloud contract assertions; no network, account or user data used')
}finally{rmSync(temp,{recursive:true,force:true})}
