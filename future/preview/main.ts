/** Cloud-first product-direction preview. Synthetic data and transport only. */
import {createApp,defineComponent,h,ref} from 'vue'
import CloudFirstPanel from '../ui/CloudFirstPanel.vue'
import {createCloudFirst,type CloudState} from '../cloud/cloudFirst'
import {CloudContractSimulator} from '../cloud/snapshotContract'
import {createDurableJournalStore} from '../cloud/clientAdapters'
import {fresh,setCount,appendNote,cloneState,localDate,type Records} from '../../src/core/model'
import {sha256} from '../../src/core/backup'
import {stableJson} from '../cloud/stableJson'

const principal={userId:'account0001',deviceId:'device0001',cloudBackupEnabled:false}
const cloud=new CloudContractSimulator()
const entries=new Map<string,string>()
const storage={
 getStorageSync:(key:string)=>entries.get(key)??'',
 setStorageSync:(key:string,value:string)=>{entries.set(key,value)}
}
const journal=createDurableJournalStore({storage,
 ownerId:principal.userId,deviceId:principal.deviceId})
let local:Records=fresh(),internet=true,consent=false
let serial=0,submissions=0
const view=ref<CloudState>({
 phase:'notice',message:'开始使用前，请了解记录与简记将自动保存在云端。',
 pendingLocal:false,hasCloudBackup:false
})
const auth={
 async getVerifiedSession(){if(!internet)throw Error('network_unavailable')
   return {ownerId:principal.userId,accessToken:'DEMO_NOT_A_REAL_TOKEN'}},
 async getStatus(){if(!internet)throw Error('network_unavailable')
   return {enabled:consent,hasStoredBackup:!!cloud.readForOwner(principal,principal.userId)}},
 async setCloudConsent(enabled:boolean){if(!internet)throw Error('network_unavailable')
   consent=enabled;principal.cloudBackupEnabled=enabled;return {enabled}}
}
const port={
 storage,load:journal.load,save:journal.save,
 readLocal:()=>cloneState(local),
 readCloud:async()=>{if(!internet)throw Error('network_unavailable')
   return cloud.readForOwner(principal,principal.userId)},
 upload:async(req:import('../cloud/snapshotContract').UploadRequest)=>{
   if(!internet)throw Error('network_unavailable')
   submissions++
   return cloud.propose(principal,req)
 },
 newIdempotencyKey:()=> 'democloud'+String(++serial).padStart(8,'0')
}
const ctl=createCloudFirst({
 ownerId:principal.userId,deviceId:principal.deviceId,
 auth,port,noticeVersion:'privacy-v1',
 onChange:s=>{view.value=s},
 async replaceCleanLocal(records,expected){
   if(sha256(stableJson(local))!==expected)throw Error('local_state_changed')
   local=cloneState(records)
 }
})
const busy=ref(false)
async function act(op:()=>Promise<unknown>){
 if(busy.value)return
 busy.value=true
 try{await op()}finally{busy.value=false}
}
// Synthetic lifecycle hooks; production should inject uni.onNetworkStatusChange,
// app onShow, and invoke after the record has been durably written.
Object.assign(window,{__cuoshiDemo:{
 offline(value:boolean){internet=!value},
 async online(){internet=true;await ctl.onNetworkRestored()},
 async add(){setCount(local,localDate(),(local.days[localDate()]?.count??0)+1);return ctl.onLocalSaved()},
 async note(){appendNote(local,localDate(),'仅供演示的简记');return ctl.onLocalSaved()},
 async foreground(){return ctl.onForeground()},
 snapshot(){return {phase:ctl.state().phase,consent,submissions,
   pending:ctl.state().pendingLocal,cloudRevision:cloud.readForOwner(principal,principal.userId)?.revision??0}}
}})
const Demo=defineComponent({
 render:()=>h('div',{class:'shell'},[
  h('div',{class:'banner'},'错事 · v0.5 云端优先体验（模拟）'),
  h(CloudFirstPanel,{state:view.value,demonstration:true,busy:busy.value,
   onAccept:()=>{void act(()=>ctl.acceptCloudNotice())},
   onRetry:()=>{void act(()=>ctl.onNetworkRestored())}})
 ])
})
const style=document.createElement('style')
style.textContent='*{box-sizing:border-box}html,body{padding:0;margin:0;background:#f7f3eb;color:#292723}.shell{max-width:440px;margin:0 auto;padding:16px 24px 50px}.banner{font:12px PingFang SC,sans-serif;color:#81786e;padding:12px 0;border-bottom:1px solid #ded8ce}'
document.head.append(style)
createApp(Demo).mount('#app')
