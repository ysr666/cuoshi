/** Fully interactive cloud-first today + notes preview. Synthetic data only. */
import {createApp,defineComponent,h,ref} from 'vue'
import CloudFirstPanel from '../ui/CloudFirstPanel.vue'
import CloudTodayPanel from '../ui/CloudTodayPanel.vue'
import {createCloudFirst,type CloudState} from '../cloud/cloudFirst'
import {bindCloudFirstLifecycle} from '../cloud/cloudFirstLifecycle'
import {createUniAccountRecords} from '../cloud/uniAccountRecords'
import {createCloudRecordActions} from '../cloud/cloudRecordActions'
import {CloudContractSimulator} from '../cloud/snapshotContract'
import {createDurableJournalStore} from '../cloud/clientAdapters'
import {setCount,appendNote,cloneState,localDate,type Records} from '../../src/core/model'
import {sha256} from '../../src/core/backup'
import {stableJson} from '../cloud/stableJson'

const principal={userId:'account0001',deviceId:'device0001',cloudBackupEnabled:false}
const cloud=new CloudContractSimulator()
const entries=new Map<string,unknown>()
const storage={
 getStorageSync:(key:string)=>entries.get(key)??'',
 setStorageSync:(key:string,value:unknown)=>{entries.set(key,JSON.parse(JSON.stringify(value)))},
 removeStorageSync:(key:string)=>{entries.delete(key)}
}
const journal=createDurableJournalStore({storage,
 ownerId:principal.userId,deviceId:principal.deviceId})
const account=createUniAccountRecords({...principal,ownerId:principal.userId,storage})
const actions=createCloudRecordActions({ownerId:principal.userId,storage,store:account})
let internet=true,consent=false,serial=0,submissions=0
const view=ref<CloudState>({
 phase:'notice',message:'开始使用前，请了解记录与简记将自动保存在云端。',
 pendingLocal:false,hasCloudBackup:false
})
const selected=ref(localDate()),revision=ref(0)
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
 readLocal:account.read,
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
 onChange:s=>{view.value=s;revision.value++},
 replaceCleanLocal:account.replaceCleanLocal,
 finishCloudAdoption:account.finalizeAdoption
})
const busy=ref(false)
let lastSync=Promise.resolve(view.value)
const foreground=new Set<()=>void>()
const connectivity=new Set<(connected:boolean)=>void>()
const cleanup=bindCloudFirstLifecycle({
 onRecordSaved:account.onRecordSaved,
 onForeground(listener){foreground.add(listener);return ()=>{foreground.delete(listener)}},
 onNetworkStatusChange(listener){connectivity.add(listener);return ()=>{connectivity.delete(listener)}}
},{
 onLocalSaved(){revision.value++;lastSync=ctl.onLocalSaved();return lastSync},
 onForeground(){
   selected.value=localDate();lastSync=ctl.onForeground();return lastSync
 },
 onNetworkRestored(){lastSync=ctl.onNetworkRestored();return lastSync}
})
async function act(op:()=>Promise<unknown>){
 if(busy.value)return
 busy.value=true
 try{await op()}finally{busy.value=false}
}
// Synthetic tester commands are for the mock preview only. Every write goes
// through the same account-specific durable store as the rendered buttons.
Object.assign(window,{__cuoshiDemo:{
 offline(value:boolean){internet=!value},
 async online(){internet=true;for(const callback of connectivity)callback(true);await lastSync},
 async add(){actions.adjustCount(localDate(),1,true);await lastSync;return ctl.state()},
 async note(){actions.addNote(localDate(),'仅供演示的简记',true);await lastSync;return ctl.state()},
 async foreground(){for(const callback of foreground)callback();await lastSync;return ctl.state()},
 snapshot(){return {phase:ctl.state().phase,consent,submissions,
   count:actions.day().count,eventCount:actions.read().events.length,
   pending:ctl.state().pendingLocal,
   cloudRevision:cloud.readForOwner(principal,principal.userId)?.revision??0}},
 account,actions,dispose:cleanup
}})
const Demo=defineComponent({
 render:()=>h('div',{class:'shell'},[
  h('div',{class:'banner'},'错事 · v0.5 交互预览｜仅模拟数据，不会同步云端，请勿输入私人内容'),
  h(CloudFirstPanel,{state:view.value,demonstration:true,busy:busy.value,
   onAccept:()=>{void act(()=>ctl.acceptCloudNotice())},
   onRetry:()=>{void act(()=>ctl.onNetworkRestored())}}),
  ...(view.value.phase==='notice'?[]:[h(CloudTodayPanel,{
   date:selected.value,actions,state:view.value,revision:revision.value,
   onDate:(date:string)=>{selected.value=date},
   onChanged:()=>{revision.value++}
  })])
 ])
})
const style=document.createElement('style')
style.textContent='*{box-sizing:border-box}html,body{padding:0;margin:0;background:#f7f3eb;color:#292723}.shell{max-width:440px;margin:0 auto;padding:16px 24px 50px}.banner{font:12px PingFang SC,sans-serif;color:#81786e;padding:12px 0;border-bottom:1px solid #ded8ce}'
document.head.append(style)
createApp(Demo).mount('#app')
