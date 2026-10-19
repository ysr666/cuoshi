/** Loopback-only HTTP boundary tests. No production listener, URL or user data. */
import assert from 'node:assert/strict'
import {createServer} from 'node:http'
import {execFileSync} from 'node:child_process'
import {mkdtempSync,mkdirSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join,resolve} from 'node:path'
import {createRequire} from 'node:module'
const root=resolve('.'),tmp=mkdtempSync(join(tmpdir(),'cuoshi-http-contract-'))
const req=createRequire(import.meta.url)
const check=(x,label)=>{assert.ok(x,label);n++}
const rejects=async(f,re)=>{await assert.rejects(f,re);n++}
let n=0,server
try{
  const out=join(tmp,'compiled');mkdirSync(out)
  execFileSync(resolve('node_modules/.bin/tsc'),[
    '--strict','--target','ES2022','--module','CommonJS','--moduleResolution','node',
    '--skipLibCheck','--rootDir',root,'--outDir',out,
    'future/server/src/backupHttp.ts','future/cloud/clientAdapters.ts',
    'future/cloud/automaticSync.ts','future/cloud/snapshotContract.ts'
  ],{cwd:root,stdio:'inherit'})
  const {createBackupHttpHandler}=req(join(out,'future/server/src/backupHttp.js'))
  const m=req(join(out,'src/core/model.js'))
  const {CloudContractSimulator}=req(join(out,'future/cloud/snapshotContract.js'))
  const {createAuthenticatedBackupHttpBridge,createDurableJournalStore,
    createFutureSyncPort}=req(join(out,'future/cloud/clientAdapters.js'))
  const {createLinkedJournal,runAutomaticSyncOnce}=req(join(out,'future/cloud/automaticSync.js'))
  const owner='account0001',device='device0001'
  const tokenA='a'.repeat(128),tokenB='b'.repeat(128)
  const p={userId:owner,deviceId:device,cloudBackupEnabled:true}
  const sim=new CloudContractSimulator()
  let local=m.fresh()
  const yesterday=m.dateOffset(m.localDate(),-1),today=m.localDate()
  m.setCount(local,yesterday,0)
  m.appendNote(local,yesterday,'完全虚构的历史文字')
  const seed=sim.propose(p,{
    baseRevision:0,baseDigest:null,idempotencyKey:'initial000001',records:local
  })
  check(seed.kind==='accepted','Synthetic initial snapshot seeded')
  const backend={
    async readBackup(token){
      if(token!==tokenA)throw Error('unauthorized')
      return sim.readForOwner(p,owner)
    },
    async upload(token,payload){
      if(token!==tokenA)throw Error('unauthorized')
      return sim.propose(p,payload)
    }
  }
  server=createServer(createBackupHttpHandler(backend))
  await new Promise((resolve,reject)=>{
    server.once('error',reject)
    server.listen(0,'127.0.0.1',resolve)
  })
  const address=server.address()
  const loopback='http://127.0.0.1:'+address.port
  async function call(path,method='GET',token=tokenA,body,extraHeaders={}){
    return fetch(loopback+path,{
      method,
      headers:{
        Authorization:'Bearer '+token,
        ...(body===undefined?{}:{'Content-Type':'application/json'}),
        ...extraHeaders
      },
      ...(body===undefined?{}:{body:typeof body==='string'?body:JSON.stringify(body)})
    })
  }
  const get=await call('/v1/backup/snapshot')
  check(get.status===200,'Valid bearer can read own cloud snapshot')
  const cloud=await get.json()
  check(cloud.ownerId===owner&&cloud.records.days[yesterday].count===0,
    'HTTP returned expected owner and explicit zero')
  check(get.headers.get('cache-control')?.includes('no-store')&&
    get.headers.get('x-content-type-options')==='nosniff',
    'Private records are not cacheable or sniffable')
  check(get.headers.get('access-control-allow-origin')===null,
    'No wildcard CORS access to private backup data')
  const denied=await call('/v1/backup/snapshot','GET',tokenB)
  check(denied.status===401&&(await denied.text()).includes('unauthorized'),
    'Valid-format but unrecognized account token is denied')
  const anonymous=await call('/v1/backup/snapshot','GET','bad')
  check(anonymous.status===401,'Malformed bearer rejected')
  check((await call('/v1/backup/snapshot?userId=account0002')).status===404,
    'URL cannot select another account')
  check((await call('/v1/backup/snapshot/')).status===404,'Path must match exactly')
  const unsupported=await call('/v1/backup/snapshot','POST')
  check(unsupported.status===405&&unsupported.headers.get('allow')==='GET, PUT',
    'Unsupported methods denied with fixed Allow header')
  const malicious=await call('/v1/backup/snapshot','PUT',tokenA,
    {userId:'account0002',baseRevision:1,baseDigest:seed.receipt.digest,
      idempotencyKey:'spoofed00001',records:local})
  check(malicious.status===400,'Client-controlled userId is rejected, not trusted')
  const badMedia=await call('/v1/backup/snapshot','PUT',tokenA,'{}',
    {'Content-Type':'text/plain'})
  check(badMedia.status===415,'Non-JSON content denied')
  const badJson=await call('/v1/backup/snapshot','PUT',tokenA,'{invalid')
  check(badJson.status===400,'Malformed JSON rejected')
  const large=await call('/v1/backup/snapshot','PUT',tokenA,
    JSON.stringify({synthetic:'x'.repeat(11*1024*1024+500)}))
  check(large.status===413,'Oversize upload rejected before JSON parse')
  const storageRecords=new Map()
  const storage={
    getStorageSync:key=>storageRecords.get(key)??'',
    setStorageSync(key,val){storageRecords.set(key,val)}
  }
  const store=createDurableJournalStore({storage,ownerId:owner,deviceId:device})
  store.save(createLinkedJournal(owner,device,cloud,local))
  let authenticatedOwner=owner,token=tokenA,seq=0
  const transport={
    async request(request){
      assert.equal(new URL(request.url).protocol,'https:')
      const res=await fetch(loopback+new URL(request.url).pathname,{
        method:request.method,
        headers:request.header,
        ...(request.data===undefined?{}:{body:JSON.stringify(request.data)})
      })
      return {statusCode:res.status,
        data:res.status===204?null:await res.json()}
    }
  }
  const bridge=createAuthenticatedBackupHttpBridge({
    origin:'https://sync.example.invalid',
    ownerId:owner,
    http:transport,
    authentication:{getVerifiedSession:async()=>({ownerId:authenticatedOwner,accessToken:token})}
  })
  const port=createFutureSyncPort({ownerId:owner,deviceId:device,
    storage,currentRecords:()=>local,http:bridge,
    secureRequestId:()=> 'httpreq'+String(++seq).padStart(8,'0')})
  m.setCount(local,today,3)
  const result=await runAutomaticSyncOnce(port,{ownerId:owner,deviceId:device,consentEnabled:true})
  check(result.kind==='synced'&&result.revision===2,
    'Actual HTTP request reaches backend and survives complete readback')
  check(sim.readForOwner(p,owner).records.events.length===3,
    'End-to-end HTTP request retained full old + new history')
  check(store.load().pending===null&&store.load().cursor.revision===2,
    'Real HTTP acknowledgment clears durable journal only after verified readback')
  m.appendNote(local,today,'账号切换后不应上传')
  authenticatedOwner='account0002';token=tokenB
  const attempts=await runAutomaticSyncOnce(port,{ownerId:owner,deviceId:device,consentEnabled:true})
  check(attempts.kind==='rejected'&&attempts.reason==='authentication'&&
    store.load().pending===null,
    'Switching authenticated owner blocks further writes without staging pending data')
  check(sim.readForOwner(p,owner).revision===2,'Other user token cannot write to old cloud account')
  authenticatedOwner=owner;token=tokenA
  check((await runAutomaticSyncOnce(port,{ownerId:owner,deviceId:device,consentEnabled:true})).kind==='synced',
    'Restoring rightful authenticated account can resume synchronization')
  const cloudBefore=sim.readForOwner(p,owner)
  const changed=m.cloneState(cloudBefore.records)
  m.setCount(changed,today,8)
  const otherDevice={...p,deviceId:'device0002'}
  check(sim.propose(otherDevice,{baseRevision:cloudBefore.revision,
    baseDigest:cloudBefore.digest,idempotencyKey:'otherdevice9',records:changed}).kind==='accepted',
    'Concurrent authenticated device wrote an independent revision')
  const localEdits=m.cloneState(local)
  m.setCount(localEdits,today,9)
  const request={baseRevision:cloudBefore.revision,baseDigest:cloudBefore.digest,
    idempotencyKey:'outdated0001',records:localEdits}
  const response=await call('/v1/backup/snapshot','PUT',tokenA,request)
  check(response.status===409&&(await response.json()).reason==='stale_revision',
    'Real HTTP handler preserves optimistic-lock conflict semantics')
  check(sim.readForOwner(p,owner).revision===cloudBefore.revision+1,
    'Stale HTTP request cannot overwrite newer device')
  await rejects(async()=>createAuthenticatedBackupHttpBridge({
    origin:'http://127.0.0.1:'+address.port,ownerId:owner,http:transport,
    authentication:{getVerifiedSession:async()=>({ownerId:owner,accessToken:tokenA})}
  }),/origin_invalid/)
  console.log('PASS',n,'loopback HTTP / JSON / authenticated client-to-backend assertions')
}finally{
  if(server)await new Promise(resolve=>server.close(resolve))
  rmSync(tmp,{recursive:true,force:true})
}
