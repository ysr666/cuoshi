import {createApp,defineComponent,h} from 'vue'
import CloudBackupPanel from '../ui/CloudBackupPanel.vue'
import {createCloudSettingsController} from '../ui/cloudSettingsController'
import type {CloudSettingsAuth,CloudSettingsWork} from '../ui/cloudSettingsController'

const dummyRecords={enabled:false,hasStoredBackup:false,revision:null,lastSuccessAt:null}
let sessionActive=false,consent=false,cloudSaved=false,linked=false,unsent=false,offline=false,conflict=false
let currentAccount='account0001'
const auth:CloudSettingsAuth={
  async getVerifiedSession(){
    if(offline)throw Error('wechat_session_cloud_unavailable')
    sessionActive=true
    return {ownerId:currentAccount,accessToken:'this_is_a_deliberate_fake_preview_token_never_valid_in_cloud'}
  },
  async getStatus(){
    if(offline)throw Error('wechat_session_cloud_unavailable')
    return {...dummyRecords,enabled:consent,hasStoredBackup:cloudSaved,
      revision:cloudSaved?1:null,lastSuccessAt:cloudSaved?'2026-10-19 08:00 · 模拟':null}
  },
  async setCloudConsent(enabled){
    if(offline)throw Error('wechat_session_cloud_unavailable')
    consent=enabled
    return auth.getStatus()
  },
  async logoutCurrentDevice(){
    if(offline)throw Error('wechat_session_logout_not_confirmed')
    sessionActive=false
  }
}
const work:CloudSettingsWork={
  hasVerifiedLink:owner=>linked&&owner===currentAccount,
  hasUnsentChanges:()=>unsent,
  async firstBackup(){
    if(offline)return {kind:'retry_later',reason:'offline'}
    if(conflict)return {kind:'manual_conflict',reason:'stale_revision'}
    cloudSaved=true;linked=true;unsent=false
    return {kind:'synced',revision:1}
  },
  async syncNow(){
    if(offline)return {kind:'retry_later',reason:'offline'}
    if(conflict)return {kind:'manual_conflict',reason:'stale_revision'}
    unsent=false
    return {kind:'synced',revision:1}
  }
}
const controller=createCloudSettingsController({auth,work,noticeVersion:'privacy-v1'})
// Simulation switches are for isolated QA only. They are absent from the
// real v0.4 bundle and MUST NOT be used as production cloud claims.
Object.assign(window,{__cuoshiDemo:{
  offline(value:boolean){offline=value},
  conflict(value:boolean){conflict=value},
  unsent(value:boolean){unsent=value},
  account(value:string){currentAccount=value},
  snapshot(){return {sessionActive,consent,cloudSaved,linked,unsent,offline,conflict,
    phase:controller.view.phase}}
}})
const Demo=defineComponent({
  render:()=>h('div',{class:'demo-shell'},[
    h('div',{class:'demo-banner'},'错事 · 交互实验室 / v0.5'),
    h(CloudBackupPanel,{controller,demonstration:true})
  ])
})
const styles=document.createElement('style')
styles.textContent='*{box-sizing:border-box}html,body{padding:0;margin:0;background:#f7f3eb;color:#292723}.demo-shell{margin:auto;max-width:440px;padding:20px 25px 50px}.demo-banner{color:#77716a;font-size:12px;padding:9px 0;border-bottom:1px solid #ded8ce}'
document.head.append(styles)
createApp(Demo).mount('#app')
