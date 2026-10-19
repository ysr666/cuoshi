/** Real compiled v0.5 entry + native wx crypto + mock uni backend.
 * Runs ONLY after an isolated configured build with synthetic HTTPS origin.
 * Exercises process restart after an offline edit and automatic reconnect.
 */
import assert from 'node:assert/strict'
import {execFileSync} from 'node:child_process'
import {randomBytes} from 'node:crypto'
import {mkdtempSync,mkdirSync,symlinkSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join,resolve} from 'node:path'
import {createRequire} from 'node:module'
const root=resolve('.'),stage=join(root,'future','.generated-mp')
const temp=mkdtempSync(join(tmpdir(),'cuoshi-wx-real-offline-'))
const copy=x=>JSON.parse(JSON.stringify(x))
let n=0
const ok=(value,label)=>{assert.ok(value,label);n++}
const until=async(predicate)=>{
 for(let i=0;i<160;i++){if(predicate())return;await new Promise(r=>setTimeout(r,5))}
 throw Error('offline_runtime_condition_not_reached')
}
try{
 const out=join(temp,'compiled');mkdirSync(out)
 symlinkSync(join(root,'node_modules'),join(out,'node_modules'),'dir')
 execFileSync(join(root,'node_modules','.bin','tsc'),[
   '--strict','--target','ES2022','--module','CommonJS','--moduleResolution','node',
   '--skipLibCheck','--types','@dcloudio/types','--rootDir',stage,'--outDir',out,
   join(stage,'future','miniapp','runtime.ts'),join(stage,'future','cloud','snapshotContract.ts')
 ],{cwd:root,stdio:'inherit'})
 const require=createRequire(import.meta.url)
 const runtimeModule=join(out,'future','miniapp','runtime.js')
 const {CloudContractSimulator}=require(join(out,'future','cloud','snapshotContract.js'))
 const records=require(join(out,'src','core','model.js'))
 const cloud=new CloudContractSimulator()
 const storage=new Map(),tokens=new Map(),networkListeners=new Set()
 let ignoreNextOwnerRemoval=false,rejectNextLogin=false,nextLoginHttpStatus=0
 let rejectSnapshotRead=false,rejectSnapshotUpload=false
 let owner='account0001',online=true,serverConsent=false,loginCalls=0,
   httpCalls=0,uploads=0,wxCSPRNG=0,uniCSPRNG=0
 const device=()=>String(storage.get('cuoshi-future-v05-miniapp-device-id')||'')
 const principal=()=>({userId:owner,deviceId:device(),cloudBackupEnabled:serverConsent})
 globalThis.wx={
  getRandomValues({length,success}){
   wxCSPRNG++
   const random=randomBytes(length)
   const values=random.buffer.slice(random.byteOffset,random.byteOffset+random.byteLength)
   success({randomValues:values})
  }
 }
 globalThis.uni={
  getStorageSync:key=>storage.has(key)?copy(storage.get(key)):'',
  setStorageSync(key,value){storage.set(key,copy(value))},
  removeStorageSync:key=>{
   if(key==='cuoshi-future-v05-miniapp-last-verified-owner'&&ignoreNextOwnerRemoval){
    ignoreNextOwnerRemoval=false;return
   }
   storage.delete(key)
  },
  getRandomValues(){uniCSPRNG++;throw Error('undocumented shim used')},
  login({success,fail}){
   loginCalls++
   if(!online){fail({message:'offline'});return}
   success({code:'loginmock'+String(loginCalls).padStart(8,'0')})
  },
  request({url,method,data,header,success,fail}){
   httpCalls++
   if(!online){fail({message:'offline'});return}
   if(url.endsWith('/v1/auth/wechat')){
    if(rejectNextLogin){rejectNextLogin=false;success({statusCode:401,data:{}});return}
    if(nextLoginHttpStatus){
     const status=nextLoginHttpStatus;nextLoginHttpStatus=0
     success({statusCode:status,data:{error:status===429?'too_many_requests':'cloud_temporarily_unavailable'}})
     return
    }
    const token='a'.repeat(110)+String(loginCalls).padStart(5,'0')
    tokens.set(token,owner)
    success({statusCode:200,data:{
     ownerId:owner,deviceId:device(),accessToken:token,
     expiresInSeconds:900,isNewAccount:loginCalls===1
    }})
    return
   }
   const token=header?.Authorization?.slice(7)
   if(tokens.get(token)!==owner){success({statusCode:401,data:{}});return}
   const snapshot=cloud.readForOwner(principal(),owner)
   if(url.endsWith('/v1/backup/status')){
    success({statusCode:200,data:{enabled:serverConsent,hasStoredBackup:!!snapshot,
     revision:snapshot?.revision??null,lastSuccessAt:snapshot?'2026-10-19T00:00:00Z':null}})
    return
   }
   if(url.endsWith('/v1/backup/consent')){
    serverConsent=Boolean(data.enabled)
    success({statusCode:200,data:{enabled:serverConsent,hasStoredBackup:!!snapshot,
     revision:snapshot?.revision??null,lastSuccessAt:snapshot?'2026-10-19T00:00:00Z':null}})
    return
   }
   if(url.endsWith('/v1/backup/snapshot')&&method==='GET'){
    if(rejectSnapshotRead){rejectSnapshotRead=false;success({statusCode:401,data:{}});return}
    success({statusCode:snapshot?200:204,data:snapshot})
    return
   }
   if(url.endsWith('/v1/backup/snapshot')&&method==='PUT'){
    if(rejectSnapshotUpload){rejectSnapshotUpload=false;success({statusCode:403,data:{}});return}
    uploads++
    const decision=cloud.propose(principal(),data)
    success({statusCode:decision.kind==='conflict'?409:200,data:decision})
    return
   }
   fail({message:'unexpected url '+url})
  },
  onNetworkStatusChange(listener){networkListeners.add(listener)},
  offNetworkStatusChange(listener){networkListeners.delete(listener)}
 }
 let app=require(runtimeModule)
 await app.start()
 ok(app.state.stage==='notice'&&loginCalls===0&&httpCalls===0,
   'Real configured entry still shows first privacy notice before login')
 await app.consent()
 await until(()=>app.state.stage==='ready'&&app.state.sync==='已同步')
 ok(wxCSPRNG>=2&&uniCSPRNG===0,'Only the documented wx.getRandomValues is used')
 ok(serverConsent&&storage.has('cuoshi-future-v05-miniapp-last-verified-owner'),
   'After verified server consent, account/device binding is persisted')
 ok(app.getActions()!=null,'Verified account record actions initialized')
 app.getActions().changeCount(records.localDate(),2,true)
 await until(()=>cloud.readForOwner(principal(),owner)?.records.days[records.localDate()]?.count===2)
 ok(uploads===1,'Actual v0.5 native entry count edit automatically uploaded')
 online=false
 app.getActions().adjustCount(records.localDate(),1,true)
 await until(()=>app.state.sync==='暂未同步')
 ok(app.getActions().day().count===3,'Offline edit saved in owner-scoped local data')
 ok(cloud.readForOwner({...principal(),cloudBackupEnabled:true},owner).records.days[records.localDate()].count===2,
   'No server change while offline')
 // Simulated app/process restart: source module re-initializes, storage survives.
 networkListeners.clear()
 delete require.cache[require.resolve(runtimeModule)]
 app=require(runtimeModule)
 await app.start()
 ok(app.state.stage==='ready'&&app.state.sync==='暂未同步',
   'Cold offline restart reopens only previously verified account')
 ok(app.getActions().day().count===3,
   'Offline restart preserves existing unsynced count')
 app.getActions().adjustCount(records.localDate(),1,true)
 ok(app.getActions().day().count===4,'Offline restart still allows a real new local edit')
 ok(networkListeners.size===1,'One temporary reconnect watcher is installed')
 online=true
 for(const listener of [...networkListeners])listener({isConnected:true})
 await until(()=>cloud.readForOwner(principal(),owner)?.records.days[records.localDate()]?.count===4)
 ok(app.state.stage==='ready'&&app.state.sync==='已同步',
   'Connectivity restoration verifies account then automatically uploads offline edits')
 ok(networkListeners.size===1,
   'Temporary offline listener replaced by one live cloud-host listener')
 ok(uploads===2,'Offline edits uploaded once without duplicate revisions')
 ok(uniCSPRNG===0,'No insecure crypto fallback after reconnect')
 // Live session revocation / account switch: an old page must NOT keep the
 // account A actions exposed when the backend returns HTTP 401 for its JWT.
 owner='account0002';serverConsent=false
 ignoreNextOwnerRemoval=true
 app.onForeground()
 await until(()=>app.state.stage==='blocked')
 ok(app.getActions()===null&&app.state.sync==='账号需要重新验证',
   'Active page is immediately quarantined after verified session is rejected')
 ok(storage.get('cuoshi-future-v05-miniapp-offline-reverification-required')===true,
   'Revocation writes a durable deny-offline marker even if owner removal fails')
 ok(storage.has('cuoshi-future-v05-miniapp-last-verified-owner'),
   'Synthetic write failure retains stale owner marker for cold-boot attack test')
 ok(networkListeners.size===0,'Quarantined host releases its network observers')
 const originalRecordsKey='cuoshi-future-v05-owner-records-v1:'+
   require(join(out,'src','core','backup.js')).sha256(
    require(join(out,'future','cloud','stableJson.js')).stableJson('account0001'))
 ok(storage.has(originalRecordsKey),
   'Revoking live access preserves the original full account A record storage')
 online=false
 networkListeners.clear()
 delete require.cache[require.resolve(runtimeModule)]
 app=require(runtimeModule)
 await app.start()
 ok(app.state.stage==='blocked'&&app.getActions()===null,
   'Cold offline restart rejects stale owner despite failed entitlement removal')
 online=true
 // A new account must never read old account data.
 owner='account0002';serverConsent=false
 networkListeners.clear()
 delete require.cache[require.resolve(runtimeModule)]
 app=require(runtimeModule)
 await app.start()
 await until(()=>app.state.stage==='ready'&&app.state.sync==='需要确认云端存储')
 ok(app.getActions().day().count===null,
   'New verified account never inherits previous owner history')
 ok(uploads===2,'Switching accounts cannot upload first account old records')
 ok(!storage.has('cuoshi-future-v05-miniapp-last-verified-owner'),
   'Verified account switch invalidates prior account offline access immediately')
 ok(storage.get('cuoshi-future-v05-miniapp-offline-reverification-required')===true,
   'Old offline entitlement stays quarantined until new account consents')
 online=false
 networkListeners.clear()
 delete require.cache[require.resolve(runtimeModule)]
 app=require(runtimeModule)
 await app.start()
 ok(app.state.stage==='blocked'&&app.getActions()===null,
   'Before B consent, quarantined offline reboot cannot reveal account A data')
 ok(storage.has('cuoshi-future-v05-owner-records-v1:'+
   require(join(out,'src','core','backup.js')).sha256(
    require(join(out,'future','cloud','stableJson.js')).stableJson('account0001'))),
   'Revoking A offline access does not delete A original records')
 online=true
 await app.start()
 await until(()=>app.state.stage==='ready'&&app.state.sync==='需要确认云端存储')
 await app.consent()
 await until(()=>app.state.stage==='ready'&&app.state.sync==='已同步')
 ok(!storage.has('cuoshi-future-v05-miniapp-offline-reverification-required'),
   'B verified server consent and sync removes the offline quarantine')
 ok(storage.get('cuoshi-future-v05-miniapp-last-verified-owner')?.ownerId==='account0002',
   'Only newly verified B is granted fresh cold-offline entitlement')
 online=false
 networkListeners.clear()
 delete require.cache[require.resolve(runtimeModule)]
 app=require(runtimeModule)
 await app.start()
 ok(app.state.stage==='ready'&&app.getActions().day().count===null,
   'Cold offline account B never inherits A private record after authorization')
 online=true;rejectNextLogin=true
 networkListeners.clear()
 delete require.cache[require.resolve(runtimeModule)]
 app=require(runtimeModule)
 await app.start()
 ok(app.state.stage==='blocked'&&app.getActions()===null,
   'Server-rejected fresh login never opens the previously verified private account')
 ok(storage.get('cuoshi-future-v05-miniapp-offline-reverification-required')===true,
   'Rejected preflight login persists a new deny-offline marker')
 online=false
 delete require.cache[require.resolve(runtimeModule)]
 app=require(runtimeModule)
 await app.start()
 ok(app.state.stage==='blocked'&&app.getActions()===null,
   'Offline cold reboot cannot resurrect account B after preflight rejection')
 // Fresh login/status can succeed while only the backup GET endpoint rejects
 // an old token. This must be an identity failure, never normal offline mode.
 online=true
 await app.start()
 await until(()=>app.state.stage==='ready'&&app.state.sync==='已同步')
 app.getActions().changeCount(records.localDate(),1,true)
 await until(()=>cloud.readForOwner(principal(),owner)?.records.days[records.localDate()]?.count===1)
 const beforeGetRevocation=uploads
 rejectSnapshotRead=true
 app.onForeground()
 await until(()=>app.state.stage==='blocked')
 ok(app.getActions()===null&&app.state.sync==='账号需要重新验证',
   'Backup GET 401 quarantines live native account despite successful status')
 ok(uploads===beforeGetRevocation,
   'GET authorization failure never triggers extra uploads')
 ok(storage.get('cuoshi-future-v05-miniapp-offline-reverification-required')===true,
   'GET 401 revokes cold offline owner access durably')
 online=false
 networkListeners.clear()
 delete require.cache[require.resolve(runtimeModule)]
 app=require(runtimeModule)
 await app.start()
 ok(app.state.stage==='blocked'&&app.getActions()===null,
   'Backup GET 401 remains quarantined across cold offline restart')
 // Reverification restores the original account and leaves its history intact.
 online=true
 await app.start()
 await until(()=>app.state.stage==='ready'&&app.state.sync==='已同步')
 ok(app.getActions().day().count===1,
   'Fresh verified B restores full existing record after GET revocation')
 rejectSnapshotUpload=true
 app.getActions().adjustCount(records.localDate(),1,true)
 await until(()=>app.state.stage==='blocked')
 ok(app.getActions()===null&&app.state.sync==='账号需要重新验证',
   'Backup PUT 403 cannot be mistaken for ordinary offline upload failure')
 ok(cloud.readForOwner({...principal(),cloudBackupEnabled:true},owner).records.days[records.localDate()].count===1,
   'Rejected backup PUT never changes the authoritative cloud snapshot')
 ok(storage.get('cuoshi-future-v05-miniapp-offline-reverification-required')===true,
   'Backup PUT 403 also revokes cold offline access')
 online=false
 networkListeners.clear()
 delete require.cache[require.resolve(runtimeModule)]
 app=require(runtimeModule)
 await app.start()
 ok(app.state.stage==='blocked'&&app.getActions()===null,
   'Rejected PUT leaves unsynced private edits inaccessible under stale offline session')
 online=true
 await app.start()
 await until(()=>app.state.stage==='ready'&&app.state.sync==='已同步')
 ok(app.getActions().day().count===2&&
   cloud.readForOwner(principal(),owner)?.records.days[records.localDate()].count===2,
   'Fresh verified session replays pending full local edit without losing events')
 // A legitimate backend anti-abuse 429 is not a revoked identity. In
 // particular it must not persist a quarantine or destroy the cached owner.
 networkListeners.clear()
 delete require.cache[require.resolve(runtimeModule)]
 app=require(runtimeModule)
 nextLoginHttpStatus=429
 const originalOwner=storage.get('cuoshi-future-v05-miniapp-last-verified-owner')?.ownerId
 await app.start()
 ok(app.state.stage==='ready'&&app.state.sync==='暂未同步',
   'Cold startup HTTP 429 safely opens only the already verified offline owner')
 ok(app.getActions().day().count===2&&
   storage.get('cuoshi-future-v05-miniapp-last-verified-owner')?.ownerId===originalOwner,
   'Rate limiting preserves the exact owner records and verified offline binding')
 ok(!storage.has('cuoshi-future-v05-miniapp-offline-reverification-required'),
   'HTTP 429 cannot create a false durable account-revocation quarantine')
 ok(app.state.message.includes('登录请求较频繁'),
   'Native screen explains rate limiting instead of falsely claiming account ban')
 app.getActions().adjustCount(records.localDate(),1,true)
 ok(app.getActions().day().count===3,
   'Local count remains editable while cloud login is rate limited')
 // The provider may also temporarily return 503 on the following attempt;
 // the app still owes the user a durable local journal and another retry.
 nextLoginHttpStatus=503
 await app.start()
 ok(app.state.stage==='ready'&&app.state.sync==='暂未同步'&&
   app.getActions().day().count===3,
   'HTTP 503 on retry is transient and retains local pending edits')
 ok(!storage.has('cuoshi-future-v05-miniapp-offline-reverification-required'),
   'HTTP 503 never marks the owner revoked')
 await app.start()
 await until(()=>app.state.sync==='已同步'&&
   cloud.readForOwner(principal(),owner)?.records.days[records.localDate()]?.count===3)
 ok(app.getActions().day().count===3,
   'Verified login after 429 and 503 uploads all pending local count changes')
 ok(storage.get('cuoshi-future-v05-miniapp-last-verified-owner')?.ownerId===originalOwner,
   'Recovering from rate limiting keeps the same verified owner')
 // No previous binding: rate limiting must NEVER grant a new offline account.
 storage.delete('cuoshi-future-v05-miniapp-last-verified-owner')
 networkListeners.clear()
 delete require.cache[require.resolve(runtimeModule)]
 app=require(runtimeModule)
 nextLoginHttpStatus=429
 await app.start()
 ok(app.state.stage==='offline'&&app.getActions()===null,
   '429 without previous identity grant cannot reveal even existing private data')
 console.log('PASS',n,'native wx crypto, cold offline restart and reconnect tests')
}finally{rmSync(temp,{recursive:true,force:true})}
