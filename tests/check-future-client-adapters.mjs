import assert from 'node:assert/strict'
import {execFileSync} from 'node:child_process'
import {mkdtempSync,mkdirSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join,resolve} from 'node:path'
import {createRequire} from 'node:module'
const root=resolve('.'),temp=mkdtempSync(join(tmpdir(),'cuoshi-sync-client-'))
const require=createRequire(import.meta.url)
let n=0
const ok=(a,label)=>{assert.ok(a,label);n++}
const throws=(f,r)=>{assert.throws(f,r);n++}
const rejects=async(f,r)=>{await assert.rejects(f,r);n++}
const copy=v=>JSON.parse(JSON.stringify(v))
try{
  const out=join(temp,'build');mkdirSync(out)
  execFileSync(resolve('node_modules/.bin/tsc'),[
    '--strict','--target','ES2022','--module','CommonJS','--moduleResolution','node',
    '--skipLibCheck','--rootDir',root,'--outDir',out,
    'future/cloud/clientAdapters.ts','future/cloud/automaticSync.ts',
    'future/cloud/snapshotContract.ts'
  ],{cwd:root,stdio:'inherit'})
  const m=require(join(out,'src/core/model.js'))
  const {CloudContractSimulator}=require(join(out,'future/cloud/snapshotContract.js'))
  const {createLinkedJournal,runAutomaticSyncOnce,isSyncAuthenticationFailure}=require(join(out,'future/cloud/automaticSync.js'))
  const {localSyncKey,createDurableJournalStore,createAuthenticatedBackupHttpBridge,
    createFutureSyncPort,createUniRequestTransport}=require(join(out,'future/cloud/clientAdapters.js'))
  const user='account0001',device='device0001',other='account0002'
  const principal={userId:user,deviceId:device,cloudBackupEnabled:true}
  const sim=new CloudContractSimulator()
  const day=m.localDate(),before=m.dateOffset(day,-1)
  let local=m.fresh()
  m.setCount(local,before,0)
  m.appendNote(local,before,'已经记下来的虚构简记')
  const seed=sim.propose(principal,{baseRevision:0,baseDigest:null,
    idempotencyKey:'seedrequest001',records:local})
  ok(seed.kind==='accepted','Cloud simulator seeded')
  const durable=new Map()
  let dropWrite=false,throwWrite=false
  const storage={
    getStorageSync:key=>durable.get(key)??'',
    setStorageSync(key,value){
      if(throwWrite)throw Error('quota exceeded')
      if(!dropWrite)durable.set(key,value)
    }
  }
  const key=localSyncKey(user,device)
  ok(!key.includes(user)&&!key.includes(device),'Storage key contains only a hashed account/device scope')
  ok(localSyncKey(other,device)!==key,'Switching accounts gives a separate queue')
  ok(localSyncKey(user,'device0002')!==key,'Different device gives a separate queue')
  throws(()=>localSyncKey('bad','device0001'),/bad_identity/)
  const store=createDurableJournalStore({storage,ownerId:user,deviceId:device})
  ok(store.load()===null,'No preexisting journal')
  store.save(createLinkedJournal(user,device,sim.readForOwner(principal,user),local))
  ok(store.load()?.cursor.revision===1,'Verified first-link journal persisted')
  const foreign=createDurableJournalStore({storage,ownerId:other,deviceId:device})
  ok(foreign.load()===null,'Other account cannot inherit queue')
  throws(()=>foreign.save(store.load()),/cross_account/)
  dropWrite=true
  throws(()=>store.save({...store.load(),cursor:{revision:3,digest:'b'.repeat(64)}}),
    /journal_not_durable/)
  dropWrite=false
  throwWrite=true
  throws(()=>store.save(store.load()),/quota exceeded/)
  throwWrite=false
  durable.set(key,'broken json')
  throws(()=>store.load(),/journal_corrupt/)
  durable.set(key,JSON.stringify({version:1,checksum:'f'.repeat(64),journal:{}}))
  throws(()=>store.load(),/journal_corrupt/)
  store.save(createLinkedJournal(user,device,sim.readForOwner(principal,user),local))
  const origin='https://sync.example.invalid'
  const httpOptions={
    http:{request:async()=>({statusCode:204,data:null})},
    ownerId:user,authentication:{getVerifiedSession:async()=>({ownerId:user,accessToken:'a'.repeat(32)})}
  }
  for(const candidate of [
    'http://sync.example.invalid','https://me:pw@sync.example.invalid',
    'https://sync.example.invalid/sneaky','https://sync.example.invalid/?token=abc',
    'https://localhost','file:///etc/passwd'
  ])throws(()=>createAuthenticatedBackupHttpBridge({...httpOptions,origin:candidate}),
    /origin_invalid/)
  let sessionOwner=user
  let token='simulated_signed_session_token_0001'
  let offline=false,lostReply=false,damagedRead=false,brokenReceipt=false
  let requests=[],serial=0
  const http={
    async request(req){
      requests.push(copy(req))
      if(offline)throw Error('network offline')
      if(req.header.Authorization!=='Bearer '+token)
        return {statusCode:401,data:{error:'invalid token'}}
      if(req.method==='GET'){
        const cloud=sim.readForOwner(principal,user)
        return {statusCode:cloud?200:204,data:damagedRead&&cloud?
          {...cloud,digest:'f'.repeat(64)}:cloud}
      }
      if(req.method!=='PUT')throw Error('unsupported method')
      const result=sim.propose(principal,req.data)
      if(lostReply){lostReply=false;throw Error('response never arrived')}
      if(result.kind==='conflict')return {statusCode:409,data:result}
      if(result.kind==='rejected')return {statusCode:200,data:result}
      return {statusCode:200,data:brokenReceipt?
        {...result,receipt:{nonsense:true}}:result}
    }
  }
  const bridge=createAuthenticatedBackupHttpBridge({
    origin,http,ownerId:user,authentication:{getVerifiedSession:async()=>({ownerId:sessionOwner,accessToken:token})}
  })
  // A structurally valid but cross-account HTTP response must be rejected
  // at the transport boundary, never handed to a page or sync controller.
  const ownCloud=sim.readForOwner(principal,user)
  const ownReceipt={...seed.receipt,idempotencyKey:'security0001'}
  const securityRequest={baseRevision:0,baseDigest:null,
    idempotencyKey:'security0001',records:local}
  let injectedRead={...ownCloud,ownerId:other}
  let injectedWrite={kind:'accepted',snapshot:ownCloud,
    receipt:{...ownReceipt,ownerId:other}}
  const guarded=createAuthenticatedBackupHttpBridge({
    origin,ownerId:user,
    authentication:{getVerifiedSession:async()=>({ownerId:user,accessToken:token})},
    http:{request:async input=> input.method==='GET'?
      {statusCode:200,data:injectedRead}:{statusCode:200,data:injectedWrite}}
  })
  await rejects(()=>guarded.readCloud(),/sync_cloud_owner_mismatch/)
  ok(isSyncAuthenticationFailure(Error('sync_cloud_owner_mismatch')),
    'Foreign-owner cloud data is an authentication boundary violation, not offline')
  injectedRead=ownCloud
  ok((await guarded.readCloud()).ownerId===user,
    'Correctly scoped cloud response remains readable')
  await rejects(()=>guarded.upload(securityRequest),/sync_cloud_owner_mismatch/)
  injectedWrite={kind:'accepted',snapshot:{...ownCloud,ownerId:other},
    receipt:ownReceipt}
  await rejects(()=>guarded.upload(securityRequest),/sync_cloud_owner_mismatch/)
  injectedWrite={kind:'replayed',receipt:{...ownReceipt,ownerId:other}}
  await rejects(()=>guarded.upload(securityRequest),/sync_cloud_owner_mismatch/)
  injectedWrite={kind:'replayed',receipt:{...ownReceipt,idempotencyKey:'wrongkey0001'}}
  await rejects(()=>guarded.upload(securityRequest),/sync_cloud_receipt_invalid/)
  injectedWrite={kind:'accepted',snapshot:{...ownCloud,revision:2},
    receipt:ownReceipt}
  await rejects(()=>guarded.upload(securityRequest),/sync_cloud_upload_invalid/)
  injectedWrite={kind:'accepted',snapshot:ownCloud,receipt:ownReceipt}
  ok((await guarded.upload(securityRequest)).kind==='accepted',
    'Valid accepted receipt and owner-matched snapshot still pass')
  injectedWrite={kind:'replayed',receipt:ownReceipt}
  ok((await guarded.upload(securityRequest)).kind==='replayed',
    'Valid idempotent replay remains supported')
  throws(()=>createFutureSyncPort({
    ownerId:other,deviceId:device,storage,currentRecords:()=>local,
    http:bridge,secureRequestId:()=> 'request0000001'
  }),/http_cross_account/)
  const args={ownerId:user,deviceId:device,consentEnabled:true}
  function port(){
    return createFutureSyncPort({
      ownerId:user,deviceId:device,storage,currentRecords:()=>local,
      http:bridge,secureRequestId:()=> 'syncadpt'+String(++serial).padStart(8,'0')
    })
  }
  let active=port()
  ok((await runAutomaticSyncOnce(active,args)).kind==='synced',
    'Already-equal local and cloud state needs no upload')
  ok(requests[0].url===origin+'/v1/backup/snapshot'&&
    requests[0].header.Authorization==='Bearer '+token,
    'Fixed HTTPS backup path, short-lived bearer passed only in header')
  ok(!requests[0].url.includes(user)&&!requests[0].url.includes(token),
    'No bearer/user in the URL')
  m.setCount(local,day,3)
  ok((await runAutomaticSyncOnce(active,args)).kind==='synced',
    'Real adapter first upload and readback succeed')
  ok(requests.some(req=>req.method==='PUT'&&req.data.records.events.length===3),
    'Full event history uploaded, including old note text')
  ok(sim.readForOwner(principal,user).records.days[before].count===0,
    'Explicit zero survives transport')
  active=port()
  ok((await runAutomaticSyncOnce(active,args)).kind==='synced',
    'Fresh adapter after restart loads same durable revision cursor')
  // A user can log out or switch accounts while the old sync port exists.
  // No old-account notes may be transmitted using the new owner's token.
  const priorCalls=requests.length
  sessionOwner=other
  await rejects(()=>bridge.readCloud(),/session_owner_changed/)
  await rejects(()=>bridge.upload({
    baseRevision:1,baseDigest:seed.receipt.digest,
    idempotencyKey:'accswitch0001',records:local
  }),/session_owner_changed/)
  ok(requests.length===priorCalls,
    'Cross-account session switch is denied before any network operation')
  sessionOwner=user
  m.appendNote(local,day,'断网时仅保存在本机')
  offline=true
  ok((await runAutomaticSyncOnce(active,args)).kind==='retry_later',
    'Offline sync does not falsely report success')
  offline=false
  ok((await runAutomaticSyncOnce(active,args)).kind==='synced',
    'Reconnect eventually uploads the old local note')
  m.setCount(local,day,4)
  lostReply=true
  ok((await runAutomaticSyncOnce(active,args)).kind==='retry_later',
    'Server commit with lost response is pending')
  const revision=sim.readForOwner(principal,user).revision
  ok((await runAutomaticSyncOnce(port(),args)).kind==='synced',
    'Reopened app retries exact persisted request')
  ok(sim.readForOwner(principal,user).revision===revision,
    'Retry did not create duplicate revision')
  token=''
  await rejects(()=>bridge.readCloud(),/access_token_missing/)
  token='simulated_signed_session_token_0001'
  m.appendNote(local,day,'接收的远端校验摘要有误')
  damagedRead=true
  const malformedCloud=await runAutomaticSyncOnce(active,args)
  ok(malformedCloud.kind==='manual_conflict'&&
    malformedCloud.reason==='cloud_integrity_invalid',
    'Cloud integrity mismatch cannot send a write or pretend to be transient')
  damagedRead=false
  ok((await runAutomaticSyncOnce(active,args)).kind==='synced',
    'Valid response after temporary corruption recovers')
  m.setCount(local,day,5)
  brokenReceipt=true
  ok((await runAutomaticSyncOnce(active,args)).kind==='retry_later',
    'Malformed success receipt never counts as synced')
  brokenReceipt=false
  ok((await runAutomaticSyncOnce(active,args)).kind==='synced',
    'Exact idempotent replay verifies formerly broken reply')
  // A real uni.request callback-shape adapter must preserve the tested HTTP
  // protocol without requiring global wx/uni access.
  const fromUni=createUniRequestTransport({request(options){
    if(options.method==='GET'){
      options.success({statusCode:200,data:sim.readForOwner(principal,user)})
    }else options.fail({message:'simulated offline'})
  }})
  const wrapped=createAuthenticatedBackupHttpBridge({
    origin,http:fromUni,ownerId:user,authentication:{getVerifiedSession:async()=>({ownerId:sessionOwner,accessToken:token})}
  })
  ok((await wrapped.readCloud()).records.days[day].count===5,
    'Injected uni.request successfully adapts to authenticated cloud reads')
  await rejects(()=>fromUni.request({
    url:origin+'/v1/backup/snapshot',method:'PUT',header:{},data:{}
  }),/network_unavailable/)
  throws(()=>createUniRequestTransport({request(){}},25),/uni_request_invalid/)
  const malformedUni=createUniRequestTransport({request(o){
    o.success({invalid:true})
  }})
  await rejects(()=>malformedUni.request({
    url:origin+'/v1/backup/snapshot',method:'GET',header:{}
  }),/bad_response/)
  // Two separate page instances must not race and stage different requests
  // for the same account/device, even when they create separate port objects.
  m.appendNote(local,day,'两个页面同时触发的本地编辑')
  const normalRequest=http.request.bind(http)
  let resumeUpload,announceStarted
  const uploading=new Promise(done=>{resumeUpload=done})
  const started=new Promise(done=>{announceStarted=done})
  http.request=async options=>{
    if(options.method==='PUT'){announceStarted();await uploading}
    return normalRequest(options)
  }
  const activeTask=runAutomaticSyncOnce(active,args)
  await started
  const racingPage=await runAutomaticSyncOnce(port(),args)
  ok(racingPage.kind==='retry_later'&&racingPage.reason==='sync_already_running',
    'Two independent adapters for same account/device share in-process lock')
  resumeUpload()
  ok((await activeTask).kind==='synced','First page finishes the legitimate upload')
  http.request=normalRequest
  const competitor={...principal,deviceId:'device0002'}
  const remote=sim.readForOwner(principal,user)
  const changed=copy(remote.records)
  m.setCount(changed,day,7)
  ok(sim.propose(competitor,{
    baseRevision:remote.revision,baseDigest:remote.digest,
    idempotencyKey:'competitor0001',records:changed
  }).kind==='accepted','Second device can update its own account')
  const sent=requests.filter(x=>x.method==='PUT').length
  m.setCount(local,day,8)
  ok((await runAutomaticSyncOnce(active,args)).kind==='manual_conflict',
    'Second device cloud update blocks automatic overwrite')
  ok(requests.filter(x=>x.method==='PUT').length===sent,
    'Old cursor refuses to transmit a new conflicting update')
  ok(createDurableJournalStore({storage,ownerId:other,deviceId:device}).load()===null,
    'Switching account still leaves private pending data isolated')
  console.log('PASS',n,'client storage + authenticated transport checks (fully mocked)')
}finally{rmSync(temp,{recursive:true,force:true})}
