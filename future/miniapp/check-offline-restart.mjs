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
  removeStorageSync:key=>{storage.delete(key)},
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
    success({statusCode:snapshot?200:204,data:snapshot})
    return
   }
   if(url.endsWith('/v1/backup/snapshot')&&method==='PUT'){
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
 online=false
 networkListeners.clear()
 delete require.cache[require.resolve(runtimeModule)]
 app=require(runtimeModule)
 await app.start()
 ok(app.state.stage==='offline'&&app.getActions()===null,
   'Without B consent, offline reboot cannot reveal A private records')
 ok(storage.has('cuoshi-future-v05-owner-records-v1:'+
   require(join(out,'src','core','backup.js')).sha256(
    require(join(out,'future','cloud','stableJson.js')).stableJson('account0001'))),
   'Revoking A offline access does not delete A original records')
 console.log('PASS',n,'native wx crypto, cold offline restart and reconnect tests')
}finally{rmSync(temp,{recursive:true,force:true})}
