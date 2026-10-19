/**
 * Opt-in v0.5 cloud settings view model. Intentionally excluded from v0.4.
 * Does not read private notes, auto-login, upload, or merge on creation.
 */
import {computed,readonly,ref} from 'vue'
import type {FutureCloudStatus} from '../cloud/wechatSession'
import type {SyncResult} from '../cloud/automaticSync'

type Identity={ownerId:string;accessToken:string}
export type CloudSettingsAuth={
  getVerifiedSession():Promise<Identity>
  getStatus():Promise<FutureCloudStatus>
  setCloudConsent(enabled:boolean,noticeVersion:string):Promise<FutureCloudStatus>
  logoutCurrentDevice():Promise<void>
}
export type CloudSettingsWork={
  /** Must enforce authenticated first-link preview, CAS and full readback. */
  firstBackup():Promise<SyncResult>
  /** Must use the durable journal and fail closed on remote divergence. */
  syncNow():Promise<SyncResult>
  /** A journal belongs to the active owner and has verified revision/digest. */
  hasVerifiedLink(ownerId:string):boolean
  /** Never discard a private pending queue silently on logout. */
  hasUnsentChanges(ownerId:string):boolean
}
export type CloudScreenPhase='signed_out'|'loading'|'local_only'|'first_backup'|
  'review_cloud'|'ready'|'pending'|'conflict'|'offline'|'failure'
const statusEmpty:FutureCloudStatus={
  enabled:false,hasStoredBackup:false,revision:null,lastSuccessAt:null
}
const failureText:Record<string,string>={
  'wechat_session_account_changed':'登录账号与当前记录所属账号不同。已暂停备份，请确认后处理。',
  'wechat_session_authorization_required':'会话已失效。请重新登录。',
  'wechat_session_logout_not_confirmed':'服务器未确认退出，当前账号仍保持登录。请联网后重试。',
  'wechat_session_cloud_unavailable':'目前无法连接云服务，本机记录不会被清除。',
  'wechat_session_logout_unavailable':'网络不可用，尚未安全退出。',
  'sync_journal_not_durable':'同步队列无法安全保存，已暂停上传。',
  'sync_cloud_integrity':'云端记录校验异常，已停止自动同步。',
  'sync_pending_integrity':'待同步记录校验异常，已暂停上传。'
}
const resolveReason=(error:unknown)=>{
  const key=error instanceof Error?error.message:String(error)
  return failureText[key]??'操作未完成。本机记录未因此删除，请稍后重试。'
}
export const FIRST_BACKUP_CONFIRMATION='确认备份本机全部记录与修改历史'
export function createCloudSettingsController(deps:{
  auth:CloudSettingsAuth
  work:CloudSettingsWork
  noticeVersion:string
}){
  const phase=ref<CloudScreenPhase>('signed_out')
  const busy=ref(false)
  const account=ref<string|null>(null)
  const remote=ref<FutureCloudStatus>({...statusEmpty})
  const message=ref('')
  const confirmation=ref<'enable'|'disable'|'first'|'logout'|null>(null)
  const pending=ref(false)
  const displayAccount=computed(()=>account.value
    ?'已连接 · '+account.value.slice(0,4)+'…'+account.value.slice(-4):'未登录')
  const syncedTime=computed(()=>remote.value.lastSuccessAt?remote.value.lastSuccessAt:'尚无成功云备份')
  function classify(status:FutureCloudStatus,owner:string):CloudScreenPhase{
    if(!status.enabled)return 'local_only'
    if(!status.hasStoredBackup)return 'first_backup'
    if(!deps.work.hasVerifiedLink(owner))return 'review_cloud'
    // A server snapshot existing is NOT proof this device has caught up.
    return 'pending'
  }
  async function exclusive(action:()=>Promise<void>){
    if(busy.value)return
    busy.value=true
    message.value=''
    try{await action()}
    catch(e){message.value=resolveReason(e);phase.value='failure'}
    finally{busy.value=false}
  }
  async function connect(){
    await exclusive(async()=>{
      phase.value='loading'
      const identity=await deps.auth.getVerifiedSession()
      if(account.value&&account.value!==identity.ownerId){
        phase.value='conflict'
        throw Error('wechat_session_account_changed')
      }
      const status=await deps.auth.getStatus()
      account.value=identity.ownerId
      remote.value=status
      phase.value=classify(status,identity.ownerId)
    })
  }
  function ask(kind:'enable'|'disable'|'first'|'logout'){
    if(busy.value||!account.value)return
    if(kind==='enable'&&remote.value.enabled)return
    if(kind==='disable'&&!remote.value.enabled)return
    if(kind==='first'&&(!remote.value.enabled||remote.value.hasStoredBackup))return
    confirmation.value=kind
  }
  function cancel(){confirmation.value=null}
  async function confirm(){
    const kind=confirmation.value
    if(!kind||!account.value||busy.value)return
    confirmation.value=null
    await exclusive(async()=>{
      const owner=account.value!
      if(kind==='enable'||kind==='disable'){
        remote.value=await deps.auth.setCloudConsent(kind==='enable',deps.noticeVersion)
        // Consent toggles must not implicitly call the uploader.
        phase.value=classify(remote.value,owner)
        message.value=kind==='enable'?'已开启云备份授权。本机记录尚未自动上传。':
          '已关闭后续云备份。已经保存的云端记录不会因此被删除。'
      }else if(kind==='first'){
        if(remote.value.hasStoredBackup||!remote.value.enabled)
          throw Error('sync_cloud_integrity')
        const result=await deps.work.firstBackup()
        await apply(result,owner)
      }else{
        if(deps.work.hasUnsentChanges(owner)){
          message.value='仍有未同步的本机修改。请先处理这些记录，再退出账号。'
          phase.value='pending'
          return
        }
        await deps.auth.logoutCurrentDevice()
        account.value=null
        remote.value={...statusEmpty}
        phase.value='signed_out'
        message.value='已退出当前设备，服务端会话已撤销。本机记录仍保留。'
      }
    })
  }
  async function apply(result:SyncResult,owner:string){
    if(result.kind==='synced'){
      const status=await deps.auth.getStatus()
      remote.value=status
      // No optimistic success: only trusted status plus journal confirmation.
      if(!status.hasStoredBackup||!status.enabled||!deps.work.hasVerifiedLink(owner))
        throw Error('sync_cloud_integrity')
      pending.value=false
      phase.value='ready'
      message.value='这台设备的记录已完成云端核对。'
    }else if(result.kind==='pending_local_changes'){
      pending.value=true;phase.value='pending'
      message.value='部分记录已备份，还有新的本机修改等待同步。'
    }else if(result.kind==='manual_conflict'){
      phase.value='conflict'
      message.value='本机与云端历史不一致。自动同步已暂停，暂不覆盖任何一方。'
    }else if(result.kind==='retry_later'){
      pending.value=true;phase.value='offline'
      message.value='目前未能完成云备份。本机记录仍可使用，联网后可重试。'
    }else if(result.kind==='requires_first_link'){
      phase.value='first_backup'
      message.value='需要先确认本机首次备份，才能自动同步。'
    }else{
      phase.value='failure'
      message.value='云端拒绝了本次上传。本机记录保持不变。'
    }
  }
  async function syncNow(){
    if(!account.value||!remote.value.enabled||busy.value)return
    await exclusive(async()=>{
      const owner=account.value!
      if(!deps.work.hasVerifiedLink(owner)){
        phase.value=remote.value.hasStoredBackup?'review_cloud':'first_backup'
        message.value='尚未完成这台设备与云端历史的安全关联。'
        return
      }
      await apply(await deps.work.syncNow(),owner)
    })
  }
  async function refresh(){
    if(!account.value||busy.value)return
    await exclusive(async()=>{
      remote.value=await deps.auth.getStatus()
      phase.value=classify(remote.value,account.value!)
      message.value='已更新云备份状态。云端有记录不代表本机所有修改已同步。'
    })
  }
  const view=readonly({phase,busy,account,remote,message,confirmation,
    pending,displayAccount,syncedTime})
  return {view,connect,ask,cancel,confirm,syncNow,refresh}
}
