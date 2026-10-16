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
    'future/cloud/recoveryPlan.ts'
  ],{cwd:root,stdio:'pipe'})
  const m=require(join(out,'src/core/model.js'))
  const {sha256,exportBackup}=require(join(out,'src/core/backup.js'))
  const {stableJson}=require(join(out,'future/cloud/stableJson.js'))
  const {previewCloudRestore,prepareConfirmedCloudRestore,RESTORE_CONFIRMATION}=require(
    join(out,'future/cloud/recoveryPlan.js'))
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
  console.log('PASS',count,'future cloud recovery preview and confirmation checks')
}finally{rmSync(temp,{recursive:true,force:true})}
