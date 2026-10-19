import assert from 'node:assert/strict'
import {execFileSync} from 'node:child_process'
import {mkdtempSync,mkdirSync,rmSync,symlinkSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join,resolve} from 'node:path'
import {createRequire} from 'node:module'
const root=resolve('.'),temp=mkdtempSync(join(tmpdir(),'cuoshi-firstlink-ui-'))
const require=createRequire(import.meta.url)
let n=0
const yes=(v,why)=>{assert.ok(v,why);n++}
const copy=x=>JSON.parse(JSON.stringify(x))
try{
 const out=join(temp,'compiled');mkdirSync(out)
 symlinkSync(resolve('node_modules'),join(out,'node_modules'),'dir')
 execFileSync(resolve('node_modules/.bin/tsc'),[
   '--strict','--target','ES2022','--module','CommonJS','--moduleResolution','node',
   '--skipLibCheck','--rootDir',root,'--outDir',out,
   'future/ui/createCloudSettingsWork.ts','future/ui/cloudSettingsController.ts',
   'future/cloud/clientAdapters.ts','future/cloud/firstLinkRuntime.ts',
   'future/cloud/snapshotContract.ts'
 ],{cwd:root,stdio:'inherit'})
 const {CloudContractSimulator}=require(join(out,'future/cloud/snapshotContract.js'))
 const {createDurableJournalStore}=require(join(out,'future/cloud/clientAdapters.js'))
 const {createCloudSettingsWork}=require(join(out,'future/ui/createCloudSettingsWork.js'))
 const {createCloudSettingsController}=require(join(out,'future/ui/cloudSettingsController.js'))
 const m=require(join(out,'src/core/model.js'))
 const user='account0001',device='device0001'
 const principal={userId:user,deviceId:device,cloudBackupEnabled:false}
 const sim=new CloudContractSimulator()
 const days=m.dateOffset(m.localDate(),-2),today=m.localDate()
 let current=m.fresh()
 m.setCount(current,days,0)
 m.appendNote(current,days,'测试：去年很在意的一件事')
 let cloudRevision=null,consent=false,offline=false,uploads=0,tokenRevoked=false,keyIndex=0
 const memory=new Map()
 const storage={
  getStorageSync:k=>memory.get(k)??'',
  setStorageSync:(k,v)=>memory.set(k,v)
 }
 const journal=createDurableJournalStore({storage,ownerId:user,deviceId:device})
 const port={
   storage,load:journal.load,save:journal.save,
   readLocal:()=>copy(current),
   async readCloud(){
     if(offline)throw Error('offline')
     return sim.readForOwner(principal,user)
   },
   async upload(request){
     uploads++
     if(offline)throw Error('offline')
     return sim.propose(principal,request)
   },
   newIdempotencyKey:()=> 'integrated'+String(++keyIndex).padStart(4,'0')
 }
 const auth={
   async getVerifiedSession(){
     if(tokenRevoked)throw Error('wechat_session_authorization_required')
     return {ownerId:user,accessToken:'valid-synthetic-token'}
   },
   async getStatus(){
     if(offline)throw Error('wechat_session_cloud_unavailable')
     const cloud=sim.readForOwner(principal,user)
     return {enabled:consent,hasStoredBackup:cloud!==null,
       revision:cloud?.revision??null,
       lastSuccessAt:cloud?'2026-10-19T00:01:02.000Z':null}
   },
   async setCloudConsent(enabled){
     consent=enabled;principal.cloudBackupEnabled=enabled
     return auth.getStatus()
   },
   async logoutCurrentDevice(){tokenRevoked=true}
 }
 const work=createCloudSettingsWork({ownerId:user,deviceId:device,auth,port})
 const ctrl=createCloudSettingsController({auth,work,noticeVersion:'privacy-v1'})
 yes(ctrl.view.phase==='signed_out','UI starts signed out')
 await ctrl.connect()
 yes(ctrl.view.phase==='local_only'&&uploads===0,
   'Login does not implicitly approve or send private notes')
 ctrl.ask('enable')
 await ctrl.confirm()
 yes(ctrl.view.phase==='first_backup'&&uploads===0,
   'Cloud consent alone never triggers first upload')
 await ctrl.reviewFirst()
 yes(ctrl.view.firstPreview?.status==='upload_local'&&
   ctrl.view.firstPreview.localRecordedDays===1&&
   ctrl.view.firstPreview.localEventCount===2,
   'Visible review reports real metadata without note text')
 yes(!JSON.stringify(ctrl.view.firstPreview).includes('去年很在意'),
   'No old note text leaks into reviewed UI state')
 yes(ctrl.view.confirmation==='first'&&uploads===0,
   'Review alone must not call upload')
 ctrl.cancel()
 yes(uploads===0&&ctrl.view.confirmation===null,
   'Cancel second-stage confirmation leaves cloud unchanged')
 await ctrl.reviewFirst()
 await ctrl.confirm()
 yes(ctrl.view.phase==='ready'&&uploads===1,
   'User confirmation triggers real end-to-end first link and readback')
 yes(journal.load()?.cursor.revision===1&&work.hasVerifiedLink(user),
   'Success UI requires durable account-bound journal cursor')
 yes((await auth.getStatus()).hasStoredBackup===true,
   'Cloud actually contains the complete synthetic prior history')
 m.appendNote(current,today,'今日新想法未传')
 yes(work.hasUnsentChanges(user),
   'Unsynced local note detected even when there is no pending HTTP payload')
 ctrl.ask('logout')
 await ctrl.confirm()
 yes(ctrl.view.phase==='pending'&&!tokenRevoked,
   'Sign out blocked while new local modifications remain unsynced')
 await ctrl.syncNow()
 yes(ctrl.view.phase==='ready'&&journal.load()?.cursor.revision===2,
   'Subsequent UI sync calls real revisioned automatic sync')
 yes(work.hasUnsentChanges(user)===false,
   'Latest local notes are no longer pending after verified remote readback')
 ctrl.ask('disable')
 await ctrl.confirm()
 yes(consent===false&&ctrl.view.phase==='local_only',
   'Turning cloud off does not erase cloud snapshot')
 yes(sim.readForOwner({...principal,cloudBackupEnabled:true},user)?.revision===2,
   'Opt-out retains prior user backups')
 ctrl.ask('logout')
 await ctrl.confirm()
 yes(ctrl.view.phase==='signed_out'&&tokenRevoked,
   'Server-confirmed logout returns UI to signed-out state')
 // Another device with identical backup should safely link without upload.
 const identical=m.cloneState(current),device2='device0002'
 const separate=new Map()
 const storage2={
   getStorageSync:key=>separate.get(key)??'',
   setStorageSync:(key,val)=>separate.set(key,val)
 }
 let uploadOther=0
 let consent2=true
 const auth2={
   getVerifiedSession:async()=>({ownerId:user,accessToken:'fresh-session'}),
   getStatus:async()=>({
     enabled:consent2,hasStoredBackup:true,revision:2,lastSuccessAt:'confirmed'
   }),
   setCloudConsent:async(e)=>{consent2=e;return auth2.getStatus()},
   logoutCurrentDevice:async()=>{}
 }
 principal.cloudBackupEnabled=true
 const j2=createDurableJournalStore({storage:storage2,ownerId:user,deviceId:device2})
 const p2={
   storage:storage2,readLocal:()=>cloneCopy(identical),
   load:j2.load,save:j2.save,
   readCloud:async()=>sim.readForOwner({...principal,deviceId:device2},user),
   upload:async()=>{uploadOther++;throw Error('must not upload existing')},
   newIdempotencyKey:()=>{throw Error('must not make token')}
 }
 function cloneCopy(x){return copy(x)}
 const ctrl2=createCloudSettingsController({
   auth:auth2,
   work:createCloudSettingsWork({ownerId:user,deviceId:device2,auth:auth2,port:p2}),
   noticeVersion:'privacy-v1'
 })
 await ctrl2.connect()
 yes(ctrl2.view.phase==='review_cloud',
   'Second device with cloud backup starts in manual review state')
 await ctrl2.reviewFirst()
 yes(ctrl2.view.firstPreview?.status==='already_on_cloud'&&ctrl2.view.confirmation==='first',
   'Matching local/remote history can be linked after explicit confirmation')
 await ctrl2.confirm()
 yes(ctrl2.view.phase==='ready'&&j2.load().cursor.revision===2&&uploadOther===0,
   'Second device linked without overwriting cloud or uploading again')
 console.log('PASS',n,'full controller → first link → sync → logout and second-device attach assertions')
}finally{rmSync(temp,{recursive:true,force:true})}
