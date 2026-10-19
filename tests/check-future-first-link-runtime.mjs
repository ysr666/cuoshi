import assert from 'node:assert/strict'
import {execFileSync} from 'node:child_process'
import {mkdtempSync,mkdirSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join,resolve} from 'node:path'
import {createRequire} from 'node:module'
const root=resolve('.'),tmp=mkdtempSync(join(tmpdir(),'cuoshi-link-run-'))
const require=createRequire(import.meta.url)
let n=0
const yes=(v,why)=>{assert.ok(v,why);n++}
const rejects=async(fn,pattern)=>{await assert.rejects(fn,pattern);n++}
const clone=x=>JSON.parse(JSON.stringify(x))
try{
 const out=join(tmp,'compiled');mkdirSync(out)
 execFileSync(resolve('node_modules/.bin/tsc'),[
   '--strict','--target','ES2022','--module','CommonJS','--moduleResolution','node',
   '--skipLibCheck','--rootDir',root,'--outDir',out,
   'future/cloud/firstLinkRuntime.ts','future/cloud/automaticSync.ts',
   'future/cloud/clientAdapters.ts','future/cloud/snapshotContract.ts'
 ],{cwd:root,stdio:'inherit'})
 const m=require(join(out,'src/core/model.js'))
 const {CloudContractSimulator}=require(join(out,'future/cloud/snapshotContract.js'))
 const {createDurableJournalStore}=require(join(out,'future/cloud/clientAdapters.js'))
 const {createFirstLinkRuntime}=require(join(out,'future/cloud/firstLinkRuntime.js'))
 const {INITIAL_MIGRATION_CONFIRMATION:CONFIRM}=require(
   join(out,'future/cloud/initialMigration.js'))
 const {runAutomaticSyncOnce}=require(join(out,'future/cloud/automaticSync.js'))
 const principal={userId:'account0001',deviceId:'device0001',cloudBackupEnabled:true}
 const ownerId=principal.userId,deviceId=principal.deviceId
 const sim=new CloudContractSimulator()
 const yesterday=m.dateOffset(m.localDate(),-1),today=m.localDate()
 const local=m.fresh()
 m.setCount(local,yesterday,0)
 m.appendNote(local,yesterday,'用户反思旧文字，虚构内容')
 m.editNote(local,yesterday,local.days[yesterday].notes[0].id,'重新理解')
 m.setCount(local,today,3)
 let enableConsent=false,offline=false,offlineUpload=false,dropQueue=false,throwQueue=false,
   dropJournal=false,failJournal=false,lostResponse=false,
   staleReadback=false,alterDuringUpload=null
 const entries=new Map(),uploads=[]
 const storage={
   getStorageSync:key=>entries.get(key)??'',
   setStorageSync(key,val){
     if(throwQueue)throw Error('disk_quota')
     if(!dropQueue)entries.set(key,val)
   }
 }
 const journal=createDurableJournalStore({storage,ownerId,deviceId})
 const port={
   storage,
   readLocal:()=>clone(local),
   load:journal.load,
   save(value){
     if(failJournal)throw Error('journal_quota')
     if(!dropJournal)journal.save(value)
   },
   readCloud:async()=>{
     if(offline)throw Error('network_lost')
     const cloud=sim.readForOwner(principal,ownerId)
     return staleReadback&&cloud?{...cloud,digest:'f'.repeat(64)}:cloud
   },
   upload:async(req)=>{
     uploads.push(clone(req))
     if(offline||offlineUpload)throw Error('network_lost')
     const result=sim.propose(principal,req)
     if(alterDuringUpload){alterDuringUpload();alterDuringUpload=null}
     if(lostResponse){lostResponse=false;throw Error('reply_lost')}
     return result
   },
   newIdempotencyKey:()=> 'firstid'+String(uploads.length+1).padStart(8,'0')
 }
 const runtime=()=>createFirstLinkRuntime({
   ownerId,deviceId,port,getConsent:async()=>enableConsent
 })
 let first=runtime()
 await rejects(()=>first.review(),/consent_required/)
 yes(uploads.length===0,'No consent, no first upload')
 enableConsent=true
 await rejects(()=>first.confirm(CONFIRM),/preview_required/)
 await rejects(()=>first.confirm('随便确认'),/confirmation_required/)
 const view=await first.review()
 yes(view.status==='upload_local'&&view.localEventCount===local.events.length,
   'Preview reports metadata, not private note contents')
 yes(!JSON.stringify(view).includes('用户反思旧文字'),
   'No private note text leaks through preview')
 const foreign=createFirstLinkRuntime({
   ownerId:'account0002',deviceId,port:{
     ...port,load:()=>null,save:()=>{}
   },getConsent:async()=>true
 })
 yes(foreign.getPendingStage()===null,'Different account stage partition is independent')
 const old=m.cloneState(local)
 m.setCount(local,today,4)
 const stale=await first.confirm(CONFIRM)
 yes(stale.kind==='manual_conflict'&&stale.reason==='first_link_preview_stale',
   'Changes after preview require fresh user review')
 yes(uploads.length===0,'Stale preview cannot send even one upload')
 const refreshed=await first.review()
 yes(refreshed.localDigest!==view.localDigest,'Re-preview includes newer edit')
 dropQueue=true
 await rejects(()=>first.confirm(CONFIRM),/stage_not_durable/)
 yes(uploads.length===0,'Silently dropped queue write aborts before network')
 dropQueue=false
 throwQueue=true
 await rejects(()=>first.confirm(CONFIRM),/disk_quota/)
 yes(uploads.length===0,'Thrown storage failure aborts before network')
 throwQueue=false
 offline=true
 const unavailablePreflight=await first.confirm(CONFIRM)
 yes(unavailablePreflight.kind==='retry_later'&&
   unavailablePreflight.reason==='first_link_preflight_unavailable',
   'Offline preflight cannot stage data against an unknown remote state')
 yes(first.getPendingStage()===null,
   'No first-link request staged until remote absence checked')
 offline=false
 offlineUpload=true
 const networkLost=await first.confirm(CONFIRM)
 yes(networkLost.kind==='retry_later','First-link request persisted before offline upload')
 const staged=first.getPendingStage()
 yes(staged?.prepared.request.records.events.length===local.events.length,
   'Full append-only private history durably staged before upload')
 yes(staged.prepared.request.baseRevision===0&&
   staged.prepared.request.baseDigest===null,'No existing server snapshot can be overwritten')
 const persistedId=staged.prepared.request.idempotencyKey
 const key=[...entries.keys()].find(x=>x.endsWith(':first_link_v1'))
 yes(Boolean(key),'Queue stored under account/device-scoped key')
 // Simulate application restart while offline; no hidden upload on page load.
 first=runtime()
 yes(uploads.length===1,'Recreated runtime never implicitly uploads or logs in')
 offlineUpload=false
 const resumed=await first.confirm(CONFIRM)
 yes(resumed.kind==='synced'&&resumed.revision===1,
   'Restart explicitly resumes originally confirmed first upload')
 yes(uploads.at(-1).idempotencyKey===persistedId,
   'Restart reuses exact durable idempotency key')
 yes(first.hasVerifiedLink(),'Server-verified durable revision cursor established')
 yes(first.getPendingStage()===null,'First-link private staged duplicate tombstoned')
 yes(!entries.get(key).includes('用户反思旧文字'),
   'Private historical note text removed from temporary first-link queue')
 yes(sim.readForOwner(principal,ownerId).records.days[yesterday].count===0,
   'Cloud retains an intentionally recorded zero')
 yes(sim.readForOwner(principal,ownerId).records.events.some(e=>
   e.oldText?.includes('用户反思旧文字')),
   'Cloud retains historical old note text')
 yes(!first.hasUnsentChanges(),'Fully synced initial history is not pending')
 m.appendNote(local,today,'备份完后新的简记')
 yes(first.hasUnsentChanges(),'New local edits after link block logout')
 const auto=await runAutomaticSyncOnce(port,{ownerId,deviceId,consentEnabled:true})
 yes(auto.kind==='synced'&&auto.revision===2,
   'Existing incremental sync continues from first-link verified cursor')
 yes(!first.hasUnsentChanges(),'Later cloud sync clears unsent state')
 // Separate scenario: lost response after database accepted insert.
 const principal2={userId:'account0003',deviceId:'device0003',cloudBackupEnabled:true}
 const sim2=new CloudContractSimulator(),store2=new Map()
 const storage2={
   getStorageSync:k=>store2.get(k)??'',
   setStorageSync:(k,v)=>store2.set(k,v)
 }
 let current2=m.cloneState(old),silent=true,uploads2=[]
 const journal2=createDurableJournalStore({
   storage:storage2,ownerId:principal2.userId,deviceId:principal2.deviceId})
 let badReceipt=false,dropCursor=false,changeLocal=false
 const port2={
   storage:storage2,readLocal:()=>clone(current2),
   load:journal2.load,
   save:x=>{if(dropCursor)return; journal2.save(x)},
   readCloud:async()=>sim2.readForOwner(principal2,principal2.userId),
   upload:async req=>{
     uploads2.push(clone(req))
     const response=sim2.propose(principal2,req)
     if(changeLocal){m.appendNote(current2,today,'上传过程中新增一条');changeLocal=false}
     if(badReceipt&&response.kind==='accepted'){
       return {...response,receipt:{...response.receipt,digest:'f'.repeat(64)}}
     }
     if(silent){silent=false;throw Error('successful_server_lost_response')}
     return response
   },
   newIdempotencyKey:()=> 'lostresp0001'
 }
 const run2=()=>createFirstLinkRuntime({
   ownerId:principal2.userId,deviceId:principal2.deviceId,port:port2,
   getConsent:async()=>true
 })
 let second=run2()
 await second.review()
 const ambiguous=await second.confirm(CONFIRM)
 yes(ambiguous.kind==='retry_later','Committed upload with lost response remains pending')
 yes(sim2.readForOwner(principal2,principal2.userId).revision===1,
   'Server did commit even when client cannot know')
 yes(second.getPendingStage()?.prepared.request.idempotencyKey==='lostresp0001',
   'Unknown commit retains exact staged request key')
 second=run2()
 changeLocal=true
 const replay=await second.confirm(CONFIRM)
 yes(replay.kind==='pending_local_changes','Later edits during replay remain pending')
 yes(sim2.readForOwner(principal2,principal2.userId).revision===1,
   'Idempotent replay does not create a duplicate cloud revision')
 yes(journal2.load()?.cursor.revision===1,
   'Cursor is based on verified uploaded snapshot, not modified live local')
 yes(second.hasUnsentChanges(),'New note is still unsynced')
 // Initial link when cloud already has EXACT same history (second device).
 const principal3={userId:principal2.userId,deviceId:'device0004',cloudBackupEnabled:true}
 const journal3=new Map()
 const storage3={
   getStorageSync:k=>journal3.get(k)??'',
   setStorageSync:(k,v)=>journal3.set(k,v)
 }
 const port3={
   storage:storage3,readLocal:()=>clone(old),
   load:()=>null,save:()=>{},
   readCloud:async()=>sim2.readForOwner(principal3,principal3.userId),
   upload:async()=>{throw Error('never_upload_in_relink')},
   newIdempotencyKey:()=>{throw Error('never_create_key')}
 }
 const journalStore3=createDurableJournalStore({storage:storage3,
   ownerId:principal3.userId,deviceId:principal3.deviceId})
 port3.load=journalStore3.load;port3.save=journalStore3.save
 const link3=createFirstLinkRuntime({ownerId:principal3.userId,
   deviceId:principal3.deviceId,port:port3,getConsent:async()=>true})
 const metadata3=await link3.review()
 yes(metadata3.status==='already_on_cloud','Identical second-device history recognized')
 const noUpload=await link3.confirm(CONFIRM)
 yes(noUpload.kind==='synced'&&journalStore3.load().cursor.revision===1,
   'Identical cloud/local history linked without any new network upload')
 // Cloud is DIFFERENT: no data overwrites even when confirmed.
 const divergent=m.cloneState(old);m.setCount(divergent,today,99)
 const port4={...port3,readLocal:()=>divergent,load:()=>null,save:()=>{}}
 const link4=createFirstLinkRuntime({ownerId:principal3.userId,
   deviceId:'device0005',port:{
     ...port4,storage:{getStorageSync:()=>'',setStorageSync:()=>{}}
   },getConsent:async()=>true})
 yes((await link4.review()).status==='manual_conflict','Different histories detected')
 yes((await link4.confirm(CONFIRM)).kind==='manual_conflict',
   'Different histories not overwritten or auto-merged')
 console.log('PASS',n,'durable first-link preview / retry / crash / relink assertions; synthetic data only')
}finally{rmSync(tmp,{recursive:true,force:true})}
