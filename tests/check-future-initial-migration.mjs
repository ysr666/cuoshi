import assert from 'node:assert/strict'
import {execFileSync} from 'node:child_process'
import {mkdtempSync,mkdirSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join,resolve} from 'node:path'
import {createRequire} from 'node:module'
const root=resolve('.'),dir=mkdtempSync(join(tmpdir(),'cuoshi-initial-migration-'))
const require=createRequire(import.meta.url)
let n=0
const ok=(condition,message)=>{assert.ok(condition,message);n++}
const throws=(fn,regex)=>{assert.throws(fn,regex);n++}
try{
  const out=join(dir,'dist');mkdirSync(out)
  execFileSync(resolve('node_modules/.bin/tsc'),[
    '--target','ES2022','--module','CommonJS','--moduleResolution','node',
    '--skipLibCheck','--rootDir',root,'--outDir',out,
    'future/cloud/initialMigration.ts','future/cloud/snapshotContract.ts'
  ],{cwd:root,stdio:'pipe'})
  const m=require(join(out,'src/core/model.js'))
  const {sha256}=require(join(out,'src/core/backup.js'))
  const {stableJson}=require(join(out,'future/cloud/stableJson.js'))
  const {CloudContractSimulator}=require(join(out,'future/cloud/snapshotContract.js'))
  const {previewInitialMigration:preview,prepareInitialMigration:prepare,
    verifyInitialMigration:verify,INITIAL_MIGRATION_CONFIRMATION:CONFIRM}=
    require(join(out,'future/cloud/initialMigration.js'))
  const principal={userId:'account0001',deviceId:'device0001',cloudBackupEnabled:true}
  const yesterday=m.dateOffset(m.localDate(),-1),today=m.localDate()
  const local=m.fresh()
  m.setCount(local,yesterday,0)
  m.appendNote(local,yesterday,'虚构的草稿曾写过这些字 📝')
  m.editNote(local,yesterday,local.days[yesterday].notes[0].id,'重新理解昨天的错')
  m.setCount(local,today,3)
  m.setCount(local,today,2)
  m.appendNote(local,today,'暂时留在本机的简记')
  m.validate(local)
  const simulator=new CloudContractSimulator()
  const freshPreview=preview(local,null,principal.userId)
  ok(freshPreview.status==='upload_local','Populated local + no cloud permits first upload')
  ok(freshPreview.localEventCount===local.events.length,'Metadata records full event count')
  ok(freshPreview.localRecordedDays===2,'Explicit zero is a recorded day')
  ok(!JSON.stringify(freshPreview).includes('虚构的草稿'),'Preview cannot leak text')
  const args={currentLocal:local,currentCloud:null,preview:freshPreview,
    authenticatedOwnerId:principal.userId,authenticatedDeviceId:principal.deviceId,
    cloudConsentEnabled:true,confirmation:CONFIRM,idempotencyKey:'migration0001'}
  throws(()=>prepare({...args,cloudConsentEnabled:false}),/consent_required/)
  throws(()=>prepare({...args,confirmation:'是'}),/confirmation_required/)
  throws(()=>prepare({...args,authenticatedOwnerId:'account0002'}),/owner_mismatch|stale/)
  throws(()=>prepare({...args,idempotencyKey:'x'}),/idempotency_key_required/)
  const prepared=prepare(args)
  ok(prepared.request.baseRevision===0&&prepared.request.baseDigest===null,
    'Initial upload uses create-only revision 0 CAS token')
  ok(prepared.request.records.events.length===6,'Full history uploaded, not just latest counts')
  ok(prepared.request.records.events.some(e=>e.oldText==='虚构的草稿曾写过这些字 📝'),
    'Edited old note text remains in full history')
  prepared.request.records.days[today].count=999
  ok(local.days[today].count===2,'Upload payload deep cloned, no local mutation')
  // Restore the deliberately mutated copy; a prepared payload should validate.
  prepared.request.records.days[today].count=2
  const accepted=simulator.propose(principal,prepared.request)
  ok(accepted.kind==='accepted'&&accepted.receipt.revision===1,'First upload transaction accepted')
  const readback=simulator.readForOwner(principal,principal.userId)
  const verified=verify({prepared,currentLocal:local,receipt:accepted.receipt,
    readback,authenticatedOwnerId:principal.userId})
  ok(verified.status==='synced','Only matching authenticated server readback proves sync')
  ok(verified.uploadedEventCount===6,'Receipt proves all six events included')
  ok(readback.records.days[yesterday].count===0,'Explicit zero preserved cloud-side')
  ok(readback.records.events.some(e=>e.oldText?.includes('草稿曾写过')),
    'Old deleted/edited text included in server readback')
  ok(simulator.propose(principal,prepared.request).kind==='replayed',
    'Retry with same idempotency token does not duplicate revision')
  ok(simulator.readForOwner(principal,principal.userId).revision===1,
    'Idempotent replay leaves revision unchanged')
  const concurrent=simulator.propose({...principal,deviceId:'device0002'},
    {...prepared.request,idempotencyKey:'migration0002'})
  ok(concurrent.kind==='conflict','Second device cannot overwrite first snapshot at revision zero')
  const already=preview(local,readback,principal.userId)
  ok(already.status==='already_on_cloud','Identical local/cloud is no-op')
  throws(()=>prepare({...args,currentCloud:readback,preview:already}),/manual_action_required/)
  const anotherLocal=m.cloneState(local)
  m.setCount(anotherLocal,today,1)
  ok(preview(anotherLocal,readback,principal.userId).status==='manual_conflict',
    'Different local history and existing cloud must never auto overwrite')
  throws(()=>prepare({...args,currentLocal:anotherLocal}),/preview_stale/)
  const empty=m.fresh()
  ok(preview(empty,null,principal.userId).status==='nothing_to_migrate',
    'Empty first installation must not upload fake empty backup')
  ok(preview(empty,readback,principal.userId).status==='restore_cloud_separately',
    'Empty device with cloud data must restore using independent safe path')
  const themeOnly=m.fresh();themeOnly.theme='modern'
  ok(preview(themeOnly,null,principal.userId).status==='upload_local',
    'Custom theme is local state requiring explicit transfer')
  throws(()=>preview(local,{...readback,ownerId:'account0002'},principal.userId),/owner_mismatch/)
  throws(()=>preview(local,{...readback,digest:'f'.repeat(64)},principal.userId),/cloud_integrity/)
  const badReceipt={...accepted.receipt,digest:'f'.repeat(64)}
  throws(()=>verify({prepared,currentLocal:local,receipt:badReceipt,readback,
    authenticatedOwnerId:principal.userId}),/readback_mismatch/)
  throws(()=>verify({prepared,currentLocal:local,receipt:accepted.receipt,
    readback:{...readback,records:anotherLocal},authenticatedOwnerId:principal.userId}),
    /cloud_integrity/)
  const offlineEditing=m.cloneState(local)
  m.appendNote(offlineEditing,today,'首轮上传过程中新增')
  const pending=verify({prepared,currentLocal:offlineEditing,receipt:accepted.receipt,
    readback,authenticatedOwnerId:principal.userId})
  ok(pending.status==='local_changed_after_upload',
    'Locally added events after upload must never be marked fully synced')
  ok(local.events.length===6,'No test path mutates original source history')
  console.log('PASS',n,'future first-link cloud migration assertions; no network or real account')
}finally{rmSync(dir,{recursive:true,force:true})}
