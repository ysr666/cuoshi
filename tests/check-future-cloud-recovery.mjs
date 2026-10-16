import assert from 'node:assert/strict'
import {execFileSync} from 'node:child_process'
import {mkdtempSync,mkdirSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join,resolve} from 'node:path'
import {createRequire} from 'node:module'
const root=resolve('.'),temp=mkdtempSync(join(tmpdir(),'cuoshi-recovery-'))
const require=createRequire(import.meta.url)
let count=0
const check=(x,label)=>{assert.ok(x,label);count++}
const throws=(fn,pattern)=>{assert.throws(fn,pattern);count++}
try{
  const out=join(temp,'build');mkdirSync(out)
  execFileSync(resolve('node_modules/.bin/tsc'),[
    '--target','ES2022','--module','CommonJS','--moduleResolution','node',
    '--skipLibCheck','--rootDir',root,'--outDir',out,
    'future/cloud/recoveryPlan.ts','future/cloud/recoveryStorage.ts'
  ],{cwd:root,stdio:'pipe'})
  const m=require(join(out,'src/core/model.js'))
  const {sha256,exportBackup}=require(join(out,'src/core/backup.js'))
  const {stableJson}=require(join(out,'future/cloud/stableJson.js'))
  const {previewCloudRestore,prepareConfirmedCloudRestore,RESTORE_CONFIRMATION}=require(
    join(out,'future/cloud/recoveryPlan.js'))
  const {
    CLOUD_RESTORE_MAIN_KEY:MAIN,
    CLOUD_RESTORE_DRAFTS_KEY:DRAFTS,
    CLOUD_RESTORE_JOURNAL_KEY:JOURNAL,
    commitConfirmedCloudRestore,
    inspectPendingCloudRestore,
    finishPendingCloudRestore
  }=require(join(out,'future/cloud/recoveryStorage.js'))
  const ownerId='account0001',another='account0002'
  const yesterday=m.dateOffset(m.localDate(),-1)
  const local=m.fresh()
  const remote=m.fresh()
  m.setCount(remote,yesterday,0)
  m.appendNote(remote,yesterday,'云端有文字的历史 A')
  const makeCloud=(records=remote)=>({
    ownerId,revision:3,records,digest:sha256(stableJson(records))
  })
  const snapshot=makeCloud()
  const missing=previewCloudRestore(local,null,ownerId)
  check(missing.kind==='no_cloud_backup','No backup is explicit')
  check(missing.cloudDigest===null&&missing.remote===null,'No fictitious cloud metadata')
  const empty=previewCloudRestore(local,snapshot,ownerId)
  check(empty.kind==='remote_available','Empty local can see remote recovery option')
  check(empty.local.recordedDays===0,'An untouched local record is not zero')
  check(empty.remote.recordedDays===1&&empty.remote.explicitZeroDays===1,
    'Explicit zero is counted as recorded, not untouched')
  check(empty.remote.notes===1&&empty.remote.historyEvents===2,'Note history preserved')
  check(!JSON.stringify(empty).includes('云端有文字'),'Preview leaks no private note text')
  check(empty.cloudRevision===3,'Preview preserves observed server version')
  throws(()=>previewCloudRestore(local,snapshot,another),/owner_mismatch/)
  throws(()=>previewCloudRestore(local,{...snapshot,digest:'f'.repeat(64)},ownerId),/digest_mismatch/)
  throws(()=>previewCloudRestore(local,{...snapshot,revision:-1},ownerId),/invalid_cloud/)
  throws(()=>previewCloudRestore(local,{...snapshot,revision:2.5},ownerId),/invalid_cloud/)
  throws(()=>previewCloudRestore(local,{...snapshot,records:{...remote,version:2}},ownerId),/记录格式/)
  throws(()=>prepareConfirmedCloudRestore({
    current:local,cloud:snapshot,preview:empty,ownerId,choice:'replace_local',confirmation:'继续'
  }),/confirmation_required/)
  const restored=prepareConfirmedCloudRestore({
    current:local,cloud:snapshot,preview:empty,ownerId,
    choice:'replace_local',confirmation:RESTORE_CONFIRMATION
  })
  check(restored.days[yesterday].count===0,'Remote explicit zero restored')
  check(restored.events.length===2,'Remote full event history restored')
  restored.days[yesterday].count=999
  check(remote.days[yesterday].count===0,'Restore result is deep cloned')
  const same=previewCloudRestore(m.cloneState(remote),snapshot,ownerId)
  check(same.kind==='already_identical','Identical data never asks user to overwrite')
  const changed=m.cloneState(local)
  m.appendNote(changed,yesterday,'本地尚未备份的唯一文本')
  const conflict=previewCloudRestore(changed,snapshot,ownerId)
  check(conflict.kind==='manual_conflict','Note-only local record makes manual conflict')
  check(conflict.local.noteOnlyDays===1,'Note-only days remain distinct from zero')
  check(!JSON.stringify(conflict).includes('本地尚未'),'Conflict metadata does not expose text')
  const args={current:changed,cloud:snapshot,preview:conflict,ownerId,
    choice:'replace_local',confirmation:RESTORE_CONFIRMATION}
  throws(()=>prepareConfirmedCloudRestore(args),/local_backup_required/)
  throws(()=>prepareConfirmedCloudRestore({...args,localExportJson:'not json',
    userConfirmedExportSaved:true}),/local_backup_invalid/)
  const exportJson=exportBackup(changed)
  throws(()=>prepareConfirmedCloudRestore({...args,localExportJson:exportJson,
    userConfirmedExportSaved:false}),/local_backup_required/)
  const replaced=prepareConfirmedCloudRestore({...args,localExportJson:exportJson,
    userConfirmedExportSaved:true})
  check(replaced.days[yesterday].count===0&&replaced.events.length===2,
    'Explicitly confirmed recoverable local backup allows replacement')
  const modified=m.cloneState(changed)
  m.setCount(modified,yesterday,4)
  throws(()=>prepareConfirmedCloudRestore({...args,current:modified,
    localExportJson:exportJson,userConfirmedExportSaved:true}),/preview_stale/)
  const newer=m.cloneState(remote)
  m.setCount(newer,yesterday,5)
  throws(()=>prepareConfirmedCloudRestore({...args,cloud:makeCloud(newer),
    localExportJson:exportJson,userConfirmedExportSaved:true}),/preview_stale/)
  throws(()=>prepareConfirmedCloudRestore({...args,preview:{...conflict,ownerId:another},
    localExportJson:exportJson,userConfirmedExportSaved:true}),/preview_stale/)
  // A file whose checksum is valid but describes old local state is not a current backup.
  throws(()=>prepareConfirmedCloudRestore({...args,localExportJson:exportBackup(local),
    userConfirmedExportSaved:true}),/backup_outdated/)
  const modern=m.fresh();modern.theme='modern'
  check(previewCloudRestore(modern,snapshot,ownerId).kind==='manual_conflict',
    'Theme-only preference is still local data and not silently overwritten')
  // Fault-injection storage: copies values like uni-app's JSON-compatible
  // synchronous storage, never touches real device records or memory.
  class FakeStorage{
    constructor(initial={}){this.state=new Map(Object.entries(initial));this.fail=null}
    getStorageSync(key){
      const value=this.state.get(key)
      return value===undefined?undefined:JSON.parse(JSON.stringify(value))
    }
    setStorageSync(key,value){
      if(this.fail?.kind==='set'&&this.fail.key===key){
        this.fail=null;throw Error('simulated_set_failure')
      }
      this.state.set(key,JSON.parse(JSON.stringify(value)))
    }
    removeStorageSync(key){
      if(this.fail?.kind==='remove'&&this.fail.key===key){
        this.fail=null;throw Error('simulated_remove_failure')
      }
      this.state.delete(key)
    }
  }
  const callRecovery=(storage,current=local,cloud=snapshot,preview=empty,extra={})=>
    commitConfirmedCloudRestore(storage,{
      current,cloud,preview,ownerId,confirmation:RESTORE_CONFIRMATION,
      choice:'replace_local',...extra
    })
  const clean=new FakeStorage({[DRAFTS]:{'2026-01-01':'草稿不能泄漏'}})
  check(inspectPendingCloudRestore(clean)==='none','No pending recovery in clean local storage')
  check(callRecovery(clean).applied,'Journaled restore writes complete remote state')
  check(clean.getStorageSync(MAIN).days[yesterday].count===0,
    'Verified primary local record contains restored explicit zero')
  check(clean.getStorageSync(MAIN).events.length===2,
    'Verified primary local record preserves all change events')
  check(clean.getStorageSync(DRAFTS)===undefined&&clean.getStorageSync(JOURNAL)===undefined,
    'Completed restore clears stale draft and temporary recovery journal')
  check(inspectPendingCloudRestore(clean)==='none','No false pending marker after success')
  check(callRecovery(new FakeStorage({[MAIN]:remote}),remote,snapshot,same).applied===false,
    'Identical cloud data is a harmless no-op')
  const staleDisk=new FakeStorage({[MAIN]:changed})
  throws(()=>callRecovery(staleDisk),/restore_local_state_changed/)
  check(staleDisk.getStorageSync(MAIN).days[yesterday].notes[0].text.includes('本地'),
    'Stale local source never changed')
  const beforeOld=new FakeStorage({[MAIN]:changed,[DRAFTS]:{sample:'unfinished'}})
  throws(()=>callRecovery(beforeOld,changed,snapshot,conflict),/local_backup_required/)
  check(beforeOld.getStorageSync(JOURNAL)===undefined,
    'Missing confirmed backup never stages a write')
  const guarded=()=>({localExportJson:exportBackup(changed),userConfirmedExportSaved:true})
  check(callRecovery(beforeOld,changed,snapshot,conflict,guarded()).applied,
    'Confirmed external local export permits replacing note-only state')
  check(beforeOld.getStorageSync(MAIN).days[yesterday].count===0,
    'Cloud note/count history restored without combining divergence')
  const journalFailure=new FakeStorage({[MAIN]:changed})
  journalFailure.fail={kind:'set',key:JOURNAL}
  throws(()=>callRecovery(journalFailure,changed,snapshot,conflict,guarded()),/simulated_set_failure/)
  check(journalFailure.getStorageSync(MAIN).days[yesterday].notes[0].text.includes('本地'),
    'Journal creation error leaves user primary untouched')
  const primaryFailure=new FakeStorage({[MAIN]:changed})
  primaryFailure.fail={kind:'set',key:MAIN}
  throws(()=>callRecovery(primaryFailure,changed,snapshot,conflict,guarded()),/restore_write_failed/)
  check(primaryFailure.getStorageSync(MAIN).days[yesterday].notes[0].text.includes('本地'),
    'Primary write failure rolls back to original record')
  check(inspectPendingCloudRestore(primaryFailure)==='none',
    'Rollback removed successful journal after verified recovery')
  const journalRemoveFailure=new FakeStorage({[MAIN]:changed})
  journalRemoveFailure.fail={kind:'remove',key:JOURNAL}
  const pending=callRecovery(journalRemoveFailure,changed,snapshot,conflict,guarded())
  check(pending.applied&&pending.cleanupPending,
    'Failed cleanup reports new data applied with a pending marker')
  check(inspectPendingCloudRestore(journalRemoveFailure)==='replacement_present',
    'Interrupted cleanup recognized as new primary, not automatic rollback')
  throws(()=>callRecovery(journalRemoveFailure,changed,snapshot,conflict,guarded()),
    /restore_pending_reconciliation/)
  check(finishPendingCloudRestore(journalRemoveFailure)==='replacement_present',
    'Safe follow-up cleanup removes marker after verified primary write')
  check(inspectPendingCloudRestore(journalRemoveFailure)==='none',
    'Safe finish unblocks future user actions')
  const draftFailure=new FakeStorage({[MAIN]:changed,[DRAFTS]:{sample:'draft'}})
  draftFailure.fail={kind:'remove',key:DRAFTS}
  check(callRecovery(draftFailure,changed,snapshot,conflict,guarded()).cleanupPending,
    'Draft cleanup failure is reported, never confused with failed primary')
  check(finishPendingCloudRestore(draftFailure)==='replacement_present',
    'Pending draft cleanup can resume without overwriting primary')
  check(draftFailure.getStorageSync(DRAFTS)===undefined,'Stale draft removed on safe finish')
  // Simulate the hardest failure: a partially corrupted primary write,
  // followed by an unsuccessful rollback. The durable before-image must be
  // retained, and new writes must be blocked until recovery is inspected.
  const doubleFailure=new FakeStorage({[MAIN]:changed})
  const normalWrite=doubleFailure.setStorageSync.bind(doubleFailure)
  let mainWrites=0
  doubleFailure.setStorageSync=(key,value)=>{
    if(key===MAIN){
      mainWrites++
      if(mainWrites===1){
        normalWrite(key,{invalid:'half-written-value'})
        throw Error('simulated_power_loss')
      }
      if(mainWrites===2)throw Error('rollback_storage_failure')
    }
    return normalWrite(key,value)
  }
  throws(()=>callRecovery(doubleFailure,changed,snapshot,conflict,guarded()),
    /restore_manual_recovery_required/)
  check(inspectPendingCloudRestore(doubleFailure)==='manual_recovery_required',
    'Failed original restore leaves an emergency journal instead of hiding corruption')
  check(doubleFailure.getStorageSync(JOURNAL).before.days[yesterday].notes[0].text.includes('本地'),
    'Emergency recovery journal retains intact original note and event history')
  throws(()=>callRecovery(doubleFailure,changed,snapshot,conflict,guarded()),
    /restore_pending_reconciliation/)
  const inconsistent=new FakeStorage({[MAIN]:changed,[JOURNAL]:{
    version:1,hadMain:true,hadDrafts:false,before:changed,drafts:null,
    beforeDigest:'f'.repeat(64),afterDigest:snapshot.digest,cloudRevision:3
  }})
  check(inspectPendingCloudRestore(inconsistent)==='manual_recovery_required',
    'Corrupted journal cannot be treated as clean')
  throws(()=>finishPendingCloudRestore(inconsistent),/manual_recovery_required/)
  throws(()=>callRecovery(inconsistent,changed,snapshot,conflict,guarded()),
    /restore_pending_reconciliation/)
  check(inconsistent.getStorageSync(MAIN).days[yesterday].notes[0].text.includes('本地'),
    'Ambiguous recovery never overwrites original user content')
  const originalPresent=new FakeStorage({[MAIN]:changed,[JOURNAL]:{
    version:1,hadMain:true,hadDrafts:false,before:changed,drafts:null,
    beforeDigest:sha256(stableJson(changed)),afterDigest:snapshot.digest,cloudRevision:3
  }})
  check(inspectPendingCloudRestore(originalPresent)==='original_present',
    'Crash before replacement keeps recognized original state')
  check(finishPendingCloudRestore(originalPresent)==='original_present',
    'Safe cleanup preserves old record after pre-write crash')
  check(originalPresent.getStorageSync(MAIN).days[yesterday].notes[0].text.includes('本地'),
    'No silent cloud overwrite when power was interrupted before replacement')
  console.log('PASS',count,'future cloud recovery + crash-safe local storage fault checks')
}finally{rmSync(temp,{recursive:true,force:true})}
