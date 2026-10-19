/** Simulates the real uni.request / wx.login / onShow / durable store calls. */
import assert from 'node:assert/strict'
import {execFileSync} from 'node:child_process'
import {mkdtempSync,mkdirSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join,resolve} from 'node:path'
import {createRequire} from 'node:module'
const root=resolve('.'),tmp=mkdtempSync(join(tmpdir(),'cuoshi-real-uni-host-'))
const require=createRequire(import.meta.url)
let n=0
const ok=(test,label)=>{assert.ok(test,label);n++}
const rejects=async(fn,matcher)=>{await assert.rejects(fn,matcher);n++}
const copy=x=>JSON.parse(JSON.stringify(x))
const flush=async(predicate)=>{
  for(let i=0;i<100;i++){
    if(predicate())return
    await new Promise(done=>setTimeout(done,5))
  }
  throw Error('simulation_did_not_reach_expected_state')
}
try{
 const out=join(tmp,'compiled');mkdirSync(out)
 execFileSync(resolve('node_modules/.bin/tsc'),[
   '--strict','--target','ES2022','--module','CommonJS','--moduleResolution','node',
   '--skipLibCheck','--rootDir',root,'--outDir',out,
   'future/cloud/uniCloudHost.ts','future/cloud/uniAccountRecords.ts',
   'future/cloud/cloudFirst.ts','future/cloud/snapshotContract.ts'
 ],{cwd:root,stdio:'inherit'})
 const {createUniCloudHost}=require(join(out,'future/cloud/uniCloudHost.js'))
 const m=require(join(out,'src/core/model.js'))
 const {CloudContractSimulator}=require(join(out,'future/cloud/snapshotContract.js'))
 const storage=new Map()
 let currentOwner='account0001',internet=true,consent=false,loginCalls=0,netCalls=0,
   uploadCalls=0,badDiskWrites=false,blockCursor=false,now=1800000000
 const original=m.fresh()
 const yesterday=m.dateOffset(m.localDate(),-1),day=m.localDate()
 m.setCount(original,yesterday,0)
 m.appendNote(original,yesterday,'旧版私密简记，只许旧账号继承')
 storage.set('cuoshi-uni-v1',copy(original))
 const sim=new CloudContractSimulator()
 const connected=new Set()
 const foreground=new Set()
 const connections=new Map()
 let nextId=0
 const principal=()=>({userId:currentOwner,deviceId:'device0001',
   cloudBackupEnabled:consent})
 const platform={
   getStorageSync(key){return storage.has(key)?copy(storage.get(key)):''},
   setStorageSync(key,value){
     if(blockCursor&&key.startsWith('cuoshi_future_v05_sync_journal_v1:'))throw Error('cursor_disk_full')
     if(badDiskWrites)throw Error('storage_disk_full')
     storage.set(key,copy(value))
   },
   removeStorageSync(key){storage.delete(key)},
   onNetworkStatusChange(fn){connected.add(fn)},
   offNetworkStatusChange(fn){connected.delete(fn)},
   login({success,fail}){
     loginCalls++
     if(!internet){fail({message:'offline'});return}
     success({code:'testlogin'+String(loginCalls).padStart(8,'0')})
   },
   request({url,method,data,header,success,fail}){
     netCalls++
     if(!internet){fail({message:'offline'});return}
     if(url.endsWith('/v1/auth/wechat')){
       const token='a'.repeat(110)+String(loginCalls).padStart(5,'0')
       connections.set(token,currentOwner)
       success({statusCode:200,data:{
         ownerId:currentOwner,deviceId:'device0001',accessToken:token,
         expiresInSeconds:900,isNewAccount:loginCalls===1
       }})
       return
     }
     const authOwner=connections.get(header?.Authorization?.slice(7))
     if(authOwner!==currentOwner){success({statusCode:401,data:{error:'unauthorized'}});return}
     if(url.endsWith('/v1/backup/status')){
       const snap=sim.readForOwner(principal(),currentOwner)
       success({statusCode:200,data:{enabled:consent,hasStoredBackup:!!snap,
         revision:snap?.revision??null,lastSuccessAt:snap?'2026-10-19T00:00:00Z':null}})
       return
     }
     if(url.endsWith('/v1/backup/consent')){
       consent=Boolean(data.enabled)
       const snap=sim.readForOwner(principal(),currentOwner)
       success({statusCode:200,data:{enabled:consent,hasStoredBackup:!!snap,
         revision:snap?.revision??null,lastSuccessAt:snap?'2026-10-19T00:00:00Z':null}})
       return
     }
     if(url.endsWith('/v1/backup/snapshot')&&method==='GET'){
       const snap=sim.readForOwner(principal(),currentOwner)
       success({statusCode:snap?200:204,data:snap})
       return
     }
     if(url.endsWith('/v1/backup/snapshot')&&method==='PUT'){
       uploadCalls++
       const res=sim.propose(principal(),data)
       success({statusCode:res.kind==='conflict'?409:200,data:res})
       return
     }
     fail({message:'unexpected URL '+url})
   }
 }
 const config=(owner=currentOwner,device='device0001')=>({
   platform,ownerId:owner,deviceId:device,
   origin:'https://backup.example.invalid',noticeVersion:'privacy-v1',
   nowSeconds:()=>now,secureRequestId:()=> 'validreq'+String(++nextId).padStart(9,'0'),
   onForeground:callback=>{foreground.add(callback);return ()=>foreground.delete(callback)}
 })
 const states=[]
 let host=createUniCloudHost({...config(),onState:s=>states.push(s)})
 const end=host.start()
 await flush(()=>host.cloud.state().phase==='notice')
 ok(loginCalls===0&&netCalls===0,'No WeChat login or network before first-use notice')
 ok(host.store.read().events.length===0,'Legacy data not touched before first-use notice')
 ok(original.events.length===2,'Legacy data has full private edit history')
 ok(connected.size===1&&foreground.size===1,'Real uni event listener + app foreground registered')
 await host.acceptNotice()
 await flush(()=>host.cloud.state().phase==='synced')
 ok(host.store.read().events.length===2,'Explicit first-time claim imported complete legacy history')
 ok(sim.readForOwner(principal(),currentOwner).records.days[yesterday].count===0,
   'Automated cloud-first legacy upload keeps explicitly recorded zero')
 ok(uploadCalls===1&&consent,'Legacy first upload happens once after notice and verified consent')
 ok(sim.readForOwner(principal(),currentOwner).records.events.length===2,
   'Full private note history stored for correct account only')
 ok(storage.get('cuoshi-uni-v1').events.length===2,
   'Unscoped legacy backup remains intact and is not destructively deleted')
 let changed=host.store.commit(d=>m.setCount(d,day,4))
 ok(changed,'Writing current account-scoped data succeeded')
 await flush(()=>sim.readForOwner(principal(),currentOwner).records.days[day]?.count===4)
 ok(host.cloud.state().phase==='synced','After write commit callback, cloud becomes synced')
 ok(uploadCalls===2,'Automatic upload fired without manual Sync button')
 internet=false
 host.store.commit(d=>m.setCount(d,day,5))
 await flush(()=>host.cloud.state().phase==='offline')
 ok(host.store.read().days[day].count===5,'Offline value durably retained on device')
 ok(sim.readForOwner({...principal(),cloudBackupEnabled:true},currentOwner).records.days[day].count===4,
   'Server unchanged while offline')
 internet=true
 for(const fn of [...connected])fn({isConnected:true})
 await flush(()=>sim.readForOwner(principal(),currentOwner).records.days[day].count===5)
 ok(host.cloud.state().phase==='synced','uni network restored callback auto retries and updates UI')
 ok(uploadCalls===3,'Offline pending upload eventually pushed once')
 // App comes back into foreground. After a clean local copy, new cloud wins.
 const before=sim.readForOwner(principal(),currentOwner)
 const next=copy(before.records)
 m.setCount(next,day,8)
 const competitor=sim.propose({...principal(),deviceId:'device0002'},{
   baseRevision:before.revision,baseDigest:before.digest,
   idempotencyKey:'otherdevice0001',records:next
 })
 ok(competitor.kind==='accepted','Second device wrote newer cloud revision')
 for(const fn of [...foreground])fn()
 await flush(()=>host.store.read().days[day].count===8)
 ok(host.cloud.state().phase==='synced','Foreground automatically adopts newer cloud if no local edits')
 ok(host.store.read().events.length===next.events.length,
   'Cloud hydration preserves complete remote append-only history')
 // Simulate interruption during storage commit: never signal saved callback.
 badDiskWrites=true
 const attempts=uploadCalls
 assert.throws(()=>host.store.commit(d=>m.setCount(d,day,9)),/storage_disk_full/)
 n++
 badDiskWrites=false
 ok(uploadCalls===attempts,'Failed local write never reports a saved edit/upload')
 ok(host.store.read().days[day].count===8,'Bad storage cannot overwrite prior durable cloud-hydrated data')
 // Crash at the most dangerous moment: newer cloud data has been written to
 // the account's local records, but writing its new cursor fails. On cold
 // restart the staged before-image must roll back, then auto-hydrate again.
 const crashBefore=sim.readForOwner(principal(),currentOwner)
 const crashNext=copy(crashBefore.records)
 m.setCount(crashNext,day,11)
 ok(sim.propose({...principal(),deviceId:'device0002'},{
   baseRevision:crashBefore.revision,baseDigest:crashBefore.digest,
   idempotencyKey:'crashadopt0001',records:crashNext
 }).kind==='accepted','New cloud revision available for simulated crash')
 blockCursor=true
 for(const fn of [...foreground])fn()
 await flush(()=>host.cloud.state().phase==='attention')
 const adoptionKey=[...storage.keys()].find(k=>k.includes('cuoshi-future-v05-cloud-adoption-v1:'))
 ok(Boolean(adoptionKey),'Before-image journal persisted prior to cloud adoption')
 ok(host.store.read().days[day].count===11,
   'Cloud after-image written even though durable cursor failed')
 assert.throws(()=>host.store.commit(d=>m.setCount(d,day,12)),/adoption_pending/)
 n++
 end()
 blockCursor=false
 const restarted=createUniCloudHost(config())
 ok(restarted.store.read().days[day].count===8,
   'Cold restart rolls back partial cloud adoption to previous verified state')
 ok(!storage.has(adoptionKey),
   'Reconciled recovery journal removed only after verified rollback')
 restarted.start()
 await flush(()=>restarted.store.read().days[day].count===11&&
   restarted.cloud.state().phase==='synced')
 ok(storage.has(adoptionKey)===false,
   'Retry hydrates latest cloud and clears temporary before-image after cursor')
 ok(sim.readForOwner(principal(),currentOwner).records.days[day].count===11,
   'Crash-recovery never sent a fake overwrite to cloud')
 restarted.stop()

 end();end()
 ok(connected.size===0&&foreground.size===0,'Disposal unregisters both network and app events')
 const beforeLogin=loginCalls
 host=createUniCloudHost(config())
 host.start()
 await flush(()=>loginCalls>beforeLogin&&host.cloud.state().phase==='synced')
 ok(host.cloud.state().phase!=='notice',
   'Same account after restart remembers one-time notice and syncs automatically')
 ok(storage.get('cuoshi-future-v05-legacy-owner-v1')===currentOwner,
   'Account-scoped original legacy owner marker durable across restart')
 consent=false
 for(const fn of [...foreground])fn()
 await flush(()=>host.cloud.state().phase==='attention')
 ok(consent===false&&host.cloud.state().phase==='attention',
   'Server-revoked backup consent is never silently enabled from remembered local notice')
 host.stop()
 // B account on same device must never inherit A's private history.
 currentOwner='account0002';consent=false
 const secondHost=createUniCloudHost(config('account0002'))
 secondHost.start()
 await flush(()=>secondHost.cloud.state().phase==='notice')
 ok(secondHost.store.read().events.length===0,
   'Account B has a separate blank record namespace')
 const previousUploads=uploadCalls
 await secondHost.acceptNotice()
 await flush(()=>secondHost.cloud.state().phase==='synced')
 ok(uploadCalls===previousUploads,'Account B cannot accidentally upload account A legacy data')
 ok(secondHost.store.read().events.length===0,
   'Account B remains empty after automatic cloud onboarding')
 ok(storage.get('cuoshi-future-v05-legacy-owner-v1')==='account0001',
   'Legacy copy ownership not transferred on account switch')
 const firstKey=host.store.key,secondKey=secondHost.store.key
 ok(firstKey!==secondKey,'Account A and B physically use different local record keys')
 secondHost.stop()
 ok(connected.size===0&&foreground.size===0,'No leaked event subscribers after switching accounts')
 // First informed choice made offline MUST survive restart, but a remote
 // revoked consent from an established user must not be auto-reenabled.
 currentOwner='account0003';consent=false;internet=false
 const pendingHost=createUniCloudHost(config('account0003'))
 pendingHost.start()
 await pendingHost.acceptNotice()
 await flush(()=>pendingHost.cloud.state().phase==='offline')
 ok(pendingHost.cloud.state().phase==='offline',
   'Offline consent acknowledgement leaves visible pending state')
 pendingHost.stop()
 internet=true
 const resumedChoice=createUniCloudHost(config('account0003'))
 resumedChoice.start()
 await flush(()=>resumedChoice.cloud.state().phase==='synced')
 ok(consent===true,
   'Restart automatically grants explicit consent that was accepted offline')
 resumedChoice.stop()
 console.log('PASS',n,'real injected uni host lifecycle/account ownership/offline sync assertions')
}finally{rmSync(tmp,{recursive:true,force:true})}
