import assert from 'node:assert/strict'
import {execFileSync} from 'node:child_process'
import {mkdtempSync,mkdirSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join,resolve} from 'node:path'
import {createRequire} from 'node:module'
const root=resolve('.'),temp=mkdtempSync(join(tmpdir(),'cuoshi-auto-sync-'))
const require=createRequire(import.meta.url)
let count=0
const check=(x,why)=>{assert.ok(x,why);count++}
const throws=async(fn,pattern)=>{await assert.rejects(fn,pattern);count++}
const copy=o=>JSON.parse(JSON.stringify(o))
try{
  const out=join(temp,'dist');mkdirSync(out)
  execFileSync(resolve('node_modules/.bin/tsc'),[
    '--target','ES2022','--module','CommonJS','--moduleResolution','node',
    '--skipLibCheck','--rootDir',root,'--outDir',out,
    'future/cloud/automaticSync.ts','future/cloud/snapshotContract.ts'
  ],{cwd:root,stdio:'inherit'})
  const m=require(join(out,'src/core/model.js'))
  const {CloudContractSimulator}=require(join(out,'future/cloud/snapshotContract.js'))
  const {runAutomaticSyncOnce:run,createLinkedJournal}=require(
    join(out,'future/cloud/automaticSync.js'))
  const principal={userId:'account0001',deviceId:'device0001',cloudBackupEnabled:true}
  const other={...principal,deviceId:'device0002'}
  const day=m.localDate(),yesterday=m.dateOffset(day,-1)
  const initial=m.fresh()
  m.setCount(initial,yesterday,0)
  m.appendNote(initial,yesterday,'初始测试文字')
  const sim=new CloudContractSimulator()
  const seed=sim.propose(principal,{baseRevision:0,baseDigest:null,
    idempotencyKey:'seed00000001',records:initial})
  check(seed.kind==='accepted','Seed cloud snapshot starts with real history')
  let local=copy(initial),persisted=null,uploads=[],cloudReads=0,keyNumber=0
  let offlineUpload=false,offlineRead=false,missingCloud=false,dropSave=false,failSave=false
  let lostResponse=false,readbackBroken=false,locallyEditDuringUpload=null
  const port={
    load(){return persisted?copy(persisted):null},
    save(v){
      if(failSave)throw Error('simulated_storage_full')
      if(!dropSave)persisted=copy(v)
    },
    readLocal(){return copy(local)},
    newIdempotencyKey(){return 'reqsync'+String(++keyNumber).padStart(8,'0')},
    async readCloud(){
      cloudReads++
      if(offlineRead)throw Error('offline')
      if(missingCloud)return null
      const cloud=sim.readForOwner(principal,principal.userId)
      return readbackBroken&&persisted?.pending&&cloud?{...cloud,revision:cloud.revision+1}:cloud
    },
    async upload(req){
      uploads.push(copy(req))
      if(offlineUpload)throw Error('offline')
      const result=sim.propose(principal,req)
      if(locallyEditDuringUpload){locallyEditDuringUpload();locallyEditDuringUpload=null}
      if(lostResponse){lostResponse=false;throw Error('http response lost')}
      return result
    }
  }
  const args={ownerId:principal.userId,deviceId:principal.deviceId,consentEnabled:true}
  check((await run(port,args)).kind==='requires_first_link',
    'Never automatic-upload without a verified first-link checkpoint')
  check(uploads.length===0,'Missing link cannot send private content')
  await throws(()=>run(port,{...args,consentEnabled:false}),/consent_required/)
  check(uploads.length===0,'Revoked consent blocks outbound content')
  const linked=createLinkedJournal(principal.userId,principal.deviceId,
    sim.readForOwner(principal,principal.userId),initial)
  persisted=copy(linked)
  check((await run(port,args)).kind==='synced','Already synced local is no-op')
  check(uploads.length===0,'No writes when local equals server')
  await throws(()=>run(port,{...args,deviceId:other.deviceId}),/wrong_identity/)
  const bogus=m.cloneState(initial);m.setCount(bogus,day,3)
  await throws(async()=>createLinkedJournal(principal.userId,
    principal.deviceId,sim.readForOwner(principal,principal.userId),bogus),
    /initial_link_unverified/)
  m.setCount(local,day,2)
  const s1=await run(port,args)
  check(s1.kind==='synced'&&s1.revision===2,'Normal local edit uploaded and confirmed')
  check(persisted.cursor.revision===2&&persisted.pending===null,
    'Acknowledged cursor advanced atomically after server readback')
  check(uploads[0].records.events.length===3,'Full history, not one changed count, submitted')
  check(sim.readForOwner(principal,principal.userId).records.days[yesterday].count===0,
    'Cloud keeps the explicit zero day')
  check(uploads[0].baseRevision===1&&uploads[0].baseDigest===seed.receipt.digest,
    'Optimistic CAS requires verified prior revision and digest')
  // Simultaneous app foreground and edit triggers must not both stage/send.
  m.appendNote(local,day,'两个触发源几乎同时发起')
  const originalUpload=port.upload
  let letUploadContinue
  let announceStarted
  const pendingUpload=new Promise(resolve=>{letUploadContinue=resolve})
  const started=new Promise(resolve=>{announceStarted=resolve})
  port.upload=async req=>{
    announceStarted()
    await pendingUpload
    return originalUpload(req)
  }
  const firstTask=run(port,args)
  await started
  const overlapping=await run(port,args)
  check(overlapping.kind==='retry_later'&&overlapping.reason==='sync_already_running',
    'Concurrent trigger on the same port never starts a second sync')
  check(persisted.pending!==null,'Single-flight writes one staged payload before network')
  letUploadContinue()
  check((await firstTask).kind==='synced','Original in-flight task completes safely')
  port.upload=originalUpload
  m.appendNote(local,day,'网络没通时的文字')
  offlineUpload=true
  const down=await run(port,args)
  check(down.kind==='retry_later'&&down.reason==='upload_unknown',
    'Upload failure does not falsely report success')
  check(persisted.pending!==null&&persisted.pending.request.records.events.length===5,
    'Original full payload journaled durably before trying network')
  const savedKey=persisted.pending.request.idempotencyKey
  m.setCount(local,day,4) // user keeps recording while first upload is offline
  offlineUpload=false
  const recovered=await run(port,args)
  check(recovered.kind==='pending_local_changes',
    'Old pending payload retried first; new local edits remain unsynced')
  check(uploads.at(-1).idempotencyKey===savedKey,
    'Offline retry reuses same durable idempotency token')
  check(persisted.pending===null&&persisted.cursor.revision===4,
    'Original pending cleared only after server readback')
  check(sim.readForOwner(principal,principal.userId).records.days[day].count===2,
    'The staged payload never reads newer local count by accident')
  const next=await run(port,args)
  check(next.kind==='synced'&&next.revision===5,'Next cycle uploads new events in order')
  check(sim.readForOwner(principal,principal.userId).records.days[day].count===4,
    'Cloud eventually gets the newer count and all old history')
  m.setCount(local,day,5)
  lostResponse=true
  const beforeLost=sim.readForOwner(principal,principal.userId).revision
  check((await run(port,args)).kind==='retry_later',
    'Accepted server commit with lost HTTP response is not announced as synced')
  check(sim.readForOwner(principal,principal.userId).revision===beforeLost+1,
    'Server committed even though response disappeared')
  check(persisted.pending!==null,'Failed response retains exact pending request')
  check((await run(port,args)).kind==='synced','Idempotent replay verified after lost response')
  check(sim.readForOwner(principal,principal.userId).revision===beforeLost+1,
    'Replay does not double-upload or increment revision')
  m.appendNote(local,day,'读取云端失败后重试')
  offlineRead=true
  check((await run(port,args)).kind==='retry_later',
    'Initial cloud read failure does not try write')
  offlineRead=false
  readbackBroken=true
  check((await run(port,args)).reason==='readback_mismatch',
    'Receipt and mismatching verified cloud revision cannot claim sync')
  check(persisted.pending?.blocked===true,
    'Inconsistent readback blocks automatic retries pending reconciliation')
  const beforeReadbackBlock=uploads.length
  readbackBroken=false
  check((await run(port,args)).kind==='manual_conflict',
    'Readback mismatch does not resume uploads without manual resolution')
  check(uploads.length===beforeReadbackBlock,
    'Blocked mismatch does not generate repeated network writes')
  // Simulate a trusted account reconciliation to the actual saved snapshot.
  persisted=copy(createLinkedJournal(principal.userId,principal.deviceId,
    sim.readForOwner(principal,principal.userId),local))
  m.appendNote(local,day,'服务器读回时断网')
  locallyEditDuringUpload=()=>{offlineRead=true}
  const beforeReadFailure=sim.readForOwner(principal,principal.userId).revision
  check((await run(port,args)).reason==='readback_unavailable',
    'Readback exception after upload keeps pending status')
  check(sim.readForOwner(principal,principal.userId).revision===beforeReadFailure+1,
    'Server write still completed when readback failed')
  offlineRead=false
  check((await run(port,args)).kind==='synced',
    'Replay after readback failure verifies earlier completed server write')
  m.appendNote(local,day,'日志静默拒绝写入')
  const beforeDurable=uploads.length
  dropSave=true
  await throws(()=>run(port,args),/journal_not_durable/)
  check(uploads.length===beforeDurable,'Silent dropped journal write aborts before upload')
  dropSave=false
  failSave=true
  await throws(()=>run(port,args),/simulated_storage_full/)
  check(uploads.length===beforeDurable,'Thrown storage write aborts before upload')
  failSave=false
  const beforeLocal=m.cloneState(local)
  m.editNote(local,yesterday,local.days[yesterday].notes[0].id,'改写昨天的测试文字')
  check((await run(port,args)).kind==='synced','Append-only old-note edit syncs safely')
  check(sim.readForOwner(principal,principal.userId).records.events.length===
    local.events.length,'All prior events preserved after note edit')
  // Simulate another account-owned device committing a new event since the
  // cursor the local device last verified.
  const competing=sim.readForOwner(principal,principal.userId)
  m.setCount(competing.records,day,7)
  const others=sim.propose(other,{baseRevision:competing.revision,
    baseDigest:competing.digest,idempotencyKey:'otherdevice0001',
    records:competing.records})
  check(others.kind==='accepted','Competing authenticated device commits')
  const beforeConflict=uploads.length
  m.setCount(local,day,8)
  const conflict=await run(port,args)
  check(conflict.kind==='manual_conflict'&&conflict.reason==='cloud_revision_changed',
    'Stale local cursor never overwrites a remote device')
  check(uploads.length===beforeConflict,
    'Known divergent base never even sends a write request')
  // A write races AFTER our cloud read, before transactional CAS runs.
  const racing=sim.readForOwner(principal,principal.userId)
  persisted=copy(createLinkedJournal(principal.userId,principal.deviceId,
    racing,racing.records))
  local=copy(racing.records);m.setCount(local,day,9)
  port.upload=async request=>{
    uploads.push(copy(request))
    if(!port.raceInjected){
      port.raceInjected=true
      const concurrently=copy(racing.records);m.setCount(concurrently,day,11)
      const winner=sim.propose(other,{baseRevision:racing.revision,
        baseDigest:racing.digest,idempotencyKey:'otherdevice0002',records:concurrently})
      assert.equal(winner.kind,'accepted')
    }
    return sim.propose(principal,request)
  }
  const raced=await run(port,args)
  check(raced.kind==='manual_conflict'&&raced.reason==='stale_revision',
    'DB CAS detects competing writer after initial cloud read')
  check(persisted.pending?.blocked===true,
    'Actual conflict blocks unattended retries until reviewed')
  const once=uploads.length
  check((await run(port,args)).kind==='manual_conflict',
    'Blocked conflict never auto-pushes different history')
  check(uploads.length===once,'Blocked queue does not endlessly retry')
  await throws(()=>run(port,{...args,consentEnabled:false}),/consent_required/)
  check(uploads.length===once,'Consent revocation prevents sending blocked queue')
  persisted.pending.expectedDigest='f'.repeat(64)
  await throws(()=>run(port,args),/pending_integrity/)
  check(uploads.length===once,'Tampered pending data fails closed')
  // If the user loses a previously acknowledged cloud backup there is no
  // automatic "start over" operation which could erase another device.
  persisted=copy(linked);missingCloud=true
  check((await run(port,args)).reason==='cloud_missing_after_link',
    'Deleted/missing cloud snapshot cannot be re-created by autopilot')
  check(uploads.length===once,'Missing cloud requires manual re-link')
  console.log('PASS',count,'automatic cloud sync assertions; injected transport only, no actual network')
}finally{rmSync(temp,{recursive:true,force:true})}
