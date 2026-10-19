import assert from 'node:assert/strict'
import {execFileSync} from 'node:child_process'
import {mkdtempSync,mkdirSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join,resolve} from 'node:path'
import {createRequire} from 'node:module'
const root=resolve('.'),temp=mkdtempSync(join(tmpdir(),'cuoshi-cloud-first-'))
const require=createRequire(import.meta.url)
let n=0
const ok=(v,s)=>{assert.ok(v,s);n++}
const copy=v=>JSON.parse(JSON.stringify(v))
try{
 const out=join(temp,'compiled');mkdirSync(out)
 execFileSync(resolve('node_modules/.bin/tsc'),[
   '--strict','--target','ES2022','--module','CommonJS','--moduleResolution','node',
   '--skipLibCheck','--rootDir',root,'--outDir',out,
   'future/cloud/cloudFirst.ts','future/cloud/snapshotContract.ts',
   'future/cloud/clientAdapters.ts','future/cloud/cloudFirstLifecycle.ts'
 ],{cwd:root,stdio:'inherit'})
 const {createCloudFirst}=require(join(out,'future/cloud/cloudFirst.js'))
 const {bindCloudFirstLifecycle}=require(join(out,'future/cloud/cloudFirstLifecycle.js'))
 const m=require(join(out,'src/core/model.js'))
 const {sha256}=require(join(out,'src/core/backup.js'))
 const {stableJson}=require(join(out,'future/cloud/stableJson.js'))
 const {createDurableJournalStore}=require(join(out,'future/cloud/clientAdapters.js'))
 const {CloudContractSimulator}=require(join(out,'future/cloud/snapshotContract.js'))
 const dig=x=>sha256(stableJson(x))
 const day=m.localDate(),prior=m.dateOffset(day,-1)
 const sim=new CloudContractSimulator()
 const who={userId:'account0001',deviceId:'device0001',cloudBackupEnabled:false}
 const ownerId=who.userId,deviceId=who.deviceId
 const storageMap=new Map()
 const storage={getStorageSync:key=>storageMap.get(key)??'',
   setStorageSync:(key,value)=>storageMap.set(key,value)}
 const journal=createDurableJournalStore({storage,ownerId,deviceId})
 let current=m.fresh(),online=true,consent=false,account=ownerId,loginLimited=false,paused=false
 let uploaded=0,pullCount=0,requestNo=0,lost=false,failLocal=false
 const auth={
   getVerifiedSession:async()=>{if(loginLimited)throw Error('wechat_session_rate_limited')
     if(!online)throw Error('network_unavailable')
     return {ownerId:account,accessToken:'synthetic_valid_token'}},
   getStatus:async()=>{if(!online)throw Error('network_unavailable')
     return {enabled:consent,hasStoredBackup:!!sim.readForOwner(who,ownerId)}},
   setCloudConsent:async enabled=>{if(!online)throw Error('network_unavailable')
     consent=enabled;who.cloudBackupEnabled=enabled
     return {enabled:consent}}
 }
 const port={
   storage,load:journal.load,save:journal.save,
   readLocal:()=>copy(current),
   readCloud:async()=>{if(!online)throw Error('network_unavailable')
     return sim.readForOwner(who,ownerId)},
   upload:async req=>{
     uploaded++
     if(!online)throw Error('network_unavailable')
     const result=sim.propose(who,req)
     if(lost){lost=false;throw Error('network_lost_reply')}
     return result
   },
   newIdempotencyKey:()=> 'autocloud'+String(++requestNo).padStart(8,'0')
 }
 const notifications=[]
 const build=()=>createCloudFirst({ownerId,deviceId,auth,port,
   noticeVersion:'privacy-v1',
   pausedLocally:()=>paused,onServerConsentConfirmed:()=>{paused=false},
   onChange:s=>notifications.push(s),
   replaceCleanLocal:async(records,expected)=>{
     if(failLocal)throw Error('local_storage_failed')
     if(dig(current)!==expected)throw Error('local_changed_while_reading_cloud')
     current=copy(records);pullCount++
   }
 })
 let ctl=build()
 ok((await ctl.onForeground()).phase==='notice','No private transfer without initial clear notice')
 ok(!consent&&uploaded===0,'Notice is NOT automatic consent or upload')
 let state=await ctl.acceptCloudNotice()
 ok(state.phase==='synced'&&!state.hasCloudBackup,
   'Empty new account is ready without inventing cloud backup')
 ok(consent&&uploaded===0,'One-time notice enables default cloud, no empty data upload')
 ok(notifications.some(s=>s.phase==='checking'),'Sync status notifications emitted')
 m.setCount(current,prior,0)
 m.appendNote(current,prior,'仅用于测试的私密文字')
 state=await ctl.onLocalSaved()
 ok(state.phase==='synced'&&uploaded===1&&state.hasCloudBackup,
   'First real record automatically uploads after cloud onboarding')
 ok(sim.readForOwner(who,ownerId).records.days[prior].count===0,
   'Cloud preserves explicit zero and note')
 ok(journal.load()?.cursor.revision===1,
   'First automatic upload writes durable cursor')
 // The server revokes cloud consent on an already-linked account.
 // Routine foreground/reconnect MUST NOT reinstate permission silently.
 consent=false;who.cloudBackupEnabled=false
 const uploadsBeforeRevocation=uploaded
 state=await ctl.onForeground()
 ok(state.phase==='attention'&&state.consentRequired===true&&state.pendingLocal,
   'Server-revoked consent exposes a distinct explicit re-confirmation gate')
 state=await ctl.onNetworkRestored()
 ok(state.consentRequired===true&&consent===false&&uploaded===uploadsBeforeRevocation,
   'Network retry cannot silently re-enable revoked consent or upload content')
 ok(sim.readForOwner({...who,cloudBackupEnabled:true},ownerId).records.days[prior].count===0,
   'Revoked-consent snapshot and complete history stay unchanged on server')
 state=await ctl.acceptCloudNotice()
 ok(state.phase==='synced'&&state.consentRequired!==true&&consent===true,
   'Only an explicit renewed user confirmation restores server authorization')
 ok(uploaded===uploadsBeforeRevocation&&
   sim.readForOwner(who,ownerId).records.days[prior].notes.length===1,
   'Re-consent does not duplicate uploads or delete original notes')
 paused=true
 const beforePaused=uploaded
 m.setCount(current,prior,1)
 state=await ctl.onLocalSaved()
 ok(state.uploadPaused===true&&state.phase==='attention'&&uploaded===beforePaused,
   'Durable local cloud-pause blocks automatic uploads even when server is online')
 state=await ctl.onNetworkRestored()
 ok(state.uploadPaused===true&&uploaded===beforePaused,
   'Reconnect never silently overrides a user cloud-upload pause')
 state=await ctl.acceptCloudNotice()
 ok(!paused&&!state.uploadPaused&&state.phase==='synced',
   'Only renewed explicit consent can unblock saved local upload stop gate')
 ok(uploaded===beforePaused+1&&
   sim.readForOwner(who,ownerId).records.days[prior].count===1,
   'Resuming uploads pending local changes exactly once, with original note retained')
 online=false
 m.setCount(current,day,3)
 state=await ctl.onLocalSaved()
 ok(state.phase==='offline'&&state.pendingLocal,
   'Offline saved edit displays unsynced notice')
 ok(sim.readForOwner(who,ownerId).records.days[day]===undefined,
   'Offline edit remains local and not falsely uploaded')
 online=true
 state=await ctl.onNetworkRestored()
 ok(state.phase==='synced'&&!state.pendingLocal,
   'Reconnect auto retries previously saved data')
 ok(journal.load()?.cursor.revision===3,'Recovered upload durable at new revision')
 lost=true
 m.appendNote(current,day,'服务端写入但回执丢失')
 state=await ctl.onLocalSaved()
 ok(state.phase==='offline','Lost response does not claim synced')
 const afterLost=sim.readForOwner(who,ownerId).revision
 state=await ctl.onNetworkRestored()
 ok(state.phase==='synced','Idempotent retry after lost receipt confirms remote')
 ok(sim.readForOwner(who,ownerId).revision===afterLost,
   'Retried request never duplicates cloud revision')
 loginLimited=true
 state=await ctl.onForeground()
 ok(state.phase==='offline'&&!state.identityInvalid&&state.pendingLocal,
   '429 while cloud foreground refresh is temporary, never identity revocation')
 ok(/登录请求较频繁/.test(state.message),
   'Foreground rate limiting explains the wait in clear user language')
 loginLimited=false
 state=await ctl.onNetworkRestored()
 ok(state.phase==='synced'&&!state.identityInvalid,
   'A later verified retry restores synced status without identity quarantine')
 const cloudBefore=sim.readForOwner(who,ownerId)
 const remoteChanged=copy(cloudBefore.records)
 m.setCount(remoteChanged,day,8)
 const other={...who,deviceId:'device0002'}
 const accepted=sim.propose(other,{baseRevision:cloudBefore.revision,
   baseDigest:cloudBefore.digest,idempotencyKey:'otherdevice00001',records:remoteChanged})
 ok(accepted.kind==='accepted','Other device can commit cloud-authoritative edit')
 state=await ctl.onForeground()
 ok(state.phase==='synced'&&current.days[day].count===8,
   'Clean local device automatically downloads newer cloud')
 ok(pullCount===1&&journal.load().cursor.revision===afterLost+1,
   'Cloud pull updates durable verified cursor')
 const latest=sim.readForOwner(who,ownerId)
 m.setCount(current,day,9)
 const newerRemote=copy(latest.records)
 m.setCount(newerRemote,day,10)
 ok(sim.propose(other,{baseRevision:latest.revision,baseDigest:latest.digest,
   idempotencyKey:'otherdevice00002',records:newerRemote}).kind==='accepted',
   'Remote and offline local both edited independently')
 const noOverwrite=dig(current)
 state=await ctl.onForeground()
 ok(state.phase==='attention'&&state.pendingLocal,
   'Diverged unsent work paused without conflict UI or destructive merge')
 ok(dig(current)===noOverwrite&&current.days[day].count===9,
   'Cloud-first cannot silently erase still-unsynced local edits')
 ok(sim.readForOwner(who,ownerId).records.days[day].count===10,
   'Cloud authority remains unchanged when local pending cannot rebase')
 account='account0002'
 const sent=uploaded
 state=await ctl.onForeground()
 ok(state.phase==='attention'&&uploaded===sent,
   'Account switch never uploads old-account records under new login')
 account=ownerId
 // Existing cloud, new empty device: auto hydrate without asking for conflict handling.
 const device2='device0003',storage2map=new Map()
 const storage2={getStorageSync:key=>storage2map.get(key)??'',
   setStorageSync:(key,v)=>storage2map.set(key,v)}
 const journal2=createDurableJournalStore({storage:storage2,ownerId,deviceId:device2})
 let local2=m.fresh(),writes2=0
 const p2={...port,storage:storage2,load:journal2.load,save:journal2.save,
   readLocal:()=>copy(local2),upload:async()=>{writes2++;throw Error('must_not_push_empty_new_device')}}
 const second=createCloudFirst({ownerId,deviceId:device2,auth,port:p2,
   noticeVersion:'privacy-v1',
   replaceCleanLocal:async(records,expected)=>{
     assert.equal(dig(local2),expected);local2=copy(records)
   }})
 state=await second.onForeground()
 ok(state.phase==='notice','New device displays first-use privacy disclosure before cloud access')
 state=await second.acceptCloudNotice()
 ok(state.phase==='synced'&&local2.days[day].count===10,
   'Already-authorized new empty device auto-downloads cloud')
 ok(journal2.load().cursor.revision===sim.readForOwner(who,ownerId).revision,
   'Hydrated device persisted correct remote cursor')
 ok(writes2===0,'New device never overwrote cloud with empty local')
 // Host lifecycle events automatically invoke the sync trigger after
 // durable record write, foreground and connectivity restoration.
 const callbacks={saved:null,foreground:null,connected:null}
 const invocations={saved:0,foreground:0,connected:0}
 const lifecycle=bindCloudFirstLifecycle({
   onRecordSaved:fn=>{callbacks.saved=fn;return ()=>{callbacks.saved=null}},
   onForeground:fn=>{callbacks.foreground=fn;return ()=>{callbacks.foreground=null}},
   onNetworkStatusChange:fn=>{callbacks.connected=fn;return ()=>{callbacks.connected=null}}
 },{
   onLocalSaved:async()=>{invocations.saved++;return ctl.state()},
   onForeground:async()=>{invocations.foreground++;return ctl.state()},
   onNetworkRestored:async()=>{invocations.connected++;return ctl.state()}
 })
 callbacks.saved()
 callbacks.foreground()
 callbacks.connected(false)
 callbacks.connected(true)
 await new Promise(resolve=>setImmediate(resolve))
 ok(invocations.saved===1&&invocations.foreground===1&&invocations.connected===1,
   'Saved record / app foreground / network reconnect automatically trigger sync')
 lifecycle();lifecycle()
 ok(callbacks.saved===null&&callbacks.connected===null&&callbacks.foreground===null,
   'Disposal unregisters all hooks idempotently')
 console.log('PASS',n,'cloud-first auto sync onboarding, offline/reconnect, cloud authority checks')
}finally{rmSync(temp,{recursive:true,force:true})}
