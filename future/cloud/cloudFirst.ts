/** v0.5 cloud-first auto-sync; isolated from the v0.4 release.
 * First-use disclosure remains required before transferring private notes.
 * Thereafter edits, app foreground and reconnect trigger sync automatically.
 * Remote state is authoritative only when no local unsent work exists.
 */
import {sha256} from '../../src/core/backup'
import {validate,type Records} from '../../src/core/model'
import {stableJson} from './stableJson'
import {runAutomaticSyncOnce,createLinkedJournal,type SyncJournal,type SyncResult} from './automaticSync'
import {createFirstLinkRuntime,type FirstLinkPort} from './firstLinkRuntime'
import {INITIAL_MIGRATION_CONFIRMATION} from './initialMigration'
import type {CloudSnapshot} from './snapshotContract'
const valid=/^[A-Za-z0-9_-]{8,128}$/
const digest=(r:Records)=>sha256(stableJson(r))
const empty=(r:Records)=>r.theme==='paper'&&Object.keys(r.days).length===0&&r.events.length===0
const clone=<T>(v:T):T=>JSON.parse(JSON.stringify(v))
export type CloudPhase='notice'|'checking'|'synced'|'pending'|'offline'|'attention'
export type CloudState={phase:CloudPhase;message:string;pendingLocal:boolean;hasCloudBackup:boolean;identityInvalid?:boolean;consentRequired?:boolean;uploadPaused?:boolean}
export type CloudFirstAuth={
 getVerifiedSession():Promise<{ownerId:string;accessToken:string}>
 getStatus():Promise<{enabled:boolean;hasStoredBackup:boolean}>
 setCloudConsent(enabled:boolean,version:string):Promise<{enabled:boolean}>
}
export type CloudFirstPort=FirstLinkPort&{load():SyncJournal|null;save(state:SyncJournal):void}
export function createCloudFirst(args:{
 ownerId:string;deviceId:string;auth:CloudFirstAuth;port:CloudFirstPort
 noticeVersion:string
 /** True only for same owner and the same notice version, durably saved. */
 previouslyAcknowledged?:boolean
 /** Explicitly accepted while offline, before the server could persist it. */
 pendingFirstConsent?:boolean
 /** Locally persisted per-owner stop gate; checked BEFORE network or upload. */
 pausedLocally?:()=>boolean
 /** Called after authoritative server status confirms consent. */
 onServerConsentConfirmed?:()=>void
 /** Called only after server-authenticated account matches ownerId. */
 onVerifiedIdentity?:()=>Promise<void>|void
 /** MUST atomically compare expected on-disk digest and preserve drafts.
  * Reject changes during network read; resolve only after durable readback. */
 replaceCleanLocal:(records:Records,expectedDigest:string)=>Promise<void>
 /** Called only after the linked cursor was durably saved. */
 finishCloudAdoption?:()=>void
 onChange?:(state:CloudState)=>void
}){
 const {ownerId,deviceId,auth,port}=args
 if(!valid.test(ownerId)||!valid.test(deviceId)||
    typeof auth?.getVerifiedSession!=='function'||typeof auth?.getStatus!=='function'||
    typeof auth?.setCloudConsent!=='function'||typeof port?.load!=='function'||
    typeof port?.save!=='function'||typeof port?.readLocal!=='function'||
    typeof port?.readCloud!=='function'||typeof args.replaceCleanLocal!=='function'||
    !/^[a-zA-Z0-9._-]{3,64}$/.test(args.noticeVersion))
   throw Error('cloud_first_dependencies_required')
 let approved=args.previouslyAcknowledged===true||args.pendingFirstConsent===true,busy=false,rerun=false
 let consentJustAcknowledged=args.pendingFirstConsent===true,resumeExplicitly=false
 let state:CloudState={phase:'notice',message:'开始使用前，请了解记录与简记将自动保存在云端。',pendingLocal:false,hasCloudBackup:false}
 const set=(next:Partial<CloudState>)=>{state={...state,...next};args.onChange?.({...state})}
 const first=createFirstLinkRuntime({ownerId,deviceId,port,
   getConsent:async()=>{const s=await auth.getVerifiedSession();if(s.ownerId!==ownerId)
     throw Error('cloud_first_account_changed');return (await auth.getStatus()).enabled}})
 async function readCloud(){
   const cloud=await port.readCloud()
   if(cloud){
     if(cloud.ownerId!==ownerId||!Number.isSafeInteger(cloud.revision)||cloud.revision<1)
       throw Error('cloud_first_remote_invalid')
     validate(cloud.records)
     if(digest(cloud.records)!==cloud.digest)throw Error('cloud_first_remote_invalid')
   }
   return cloud
 }
 function saveCursor(remote:CloudSnapshot,records:Records){
   const journal=createLinkedJournal(ownerId,deviceId,remote,records)
   port.save(journal)
   if(stableJson(port.load())!==stableJson(journal))throw Error('cloud_first_cursor_not_durable')
 }
 async function adopt(remote:CloudSnapshot,expectedDigest:string){
   await args.replaceCleanLocal(clone(remote.records),expectedDigest)
   const applied=port.readLocal();validate(applied)
   if(digest(applied)!==remote.digest)throw Error('cloud_first_local_write_unverified')
   saveCursor(remote,applied)
   args.finishCloudAdoption?.()
   set({phase:'synced',message:'已同步',hasCloudBackup:true,pendingLocal:false})
 }
 function result(r:SyncResult){
   if(r.kind==='synced')set({phase:'synced',message:'已同步',pendingLocal:false,hasCloudBackup:true})
   else if(r.kind==='retry_later')set({phase:'offline',message:'网络异常，暂未同步；本机记录已保留。',pendingLocal:true})
   else if(r.kind==='pending_local_changes'){
     set({phase:'pending',message:'还有记录等待自动同步',pendingLocal:true,hasCloudBackup:true});rerun=true
   }else if(r.kind==='rejected'&&r.reason==='authentication'){
     set({phase:'attention',identityInvalid:true,
       message:'微信账号验证已失效，原账号已锁定；本机记录已保留。',pendingLocal:true})
   }else if(r.kind==='rejected'&&r.reason==='consent_required'){
     // Consent can be revoked AFTER status GET but BEFORE snapshot PUT.
     // Preserve the existing pending idempotency request and require an
     // explicit user action instead of calling it a cloud conflict.
     set({phase:'attention',consentRequired:true,
       message:'云端保存授权已关闭；未上传的修改仍在本机，重新确认后才能恢复同步。',pendingLocal:true})
   }else if(r.kind==='manual_conflict'||r.kind==='rejected'){
     set({phase:'attention',message:'云端已有更新，本机尚未同步的内容已保留，未覆盖。',pendingLocal:true})
   }else set({phase:'pending',message:'等待首次云端同步',pendingLocal:true})
 }
 async function cycle(){
   // No wx.login, temporary code or private upload before first notice.
   if(!approved){set({phase:'notice',message:'请先阅读并同意云端自动保存说明。'});return}
   if(args.pausedLocally?.()&&!resumeExplicitly){
     set({phase:'attention',uploadPaused:true,consentRequired:false,
       message:'已暂停本机自动上传；原有云记录保留，恢复前不会自动补传。',pendingLocal:true})
     return
   }
   set({phase:'checking',message:'正在同步…'})
   const identity=await auth.getVerifiedSession()
   if(identity.ownerId!==ownerId)throw Error('cloud_first_account_changed')
   await args.onVerifiedIdentity?.()
   let status=await auth.getStatus()
   if(!status.enabled){
     // Server-side consent was revoked: NEVER silently re-enable it based on
     // a remembered local preference from a previous app launch.
     if(!consentJustAcknowledged){
       set({phase:'attention',consentRequired:true,
         message:'云端保存授权已关闭；数字、简记和修改历史均已保留，请主动确认后再恢复同步。',pendingLocal:true})
       return
     }
     const updated=await auth.setCloudConsent(true,args.noticeVersion)
     if(!updated.enabled||(await auth.getStatus()).enabled!==true)throw Error('cloud_first_consent_failed')
   }
   if(consentJustAcknowledged){
     args.onServerConsentConfirmed?.()
     consentJustAcknowledged=false
   }
   // The server has confirmed consent or the current user explicitly renewed
   // it; never clear the re-consent gate on a mere retry or network return.
   if(state.consentRequired||state.uploadPaused)set({consentRequired:false,uploadPaused:false})
   const remote=await readCloud()
   const journal=port.load(),local=port.readLocal();validate(local)
   const localDigest=digest(local)
   if(journal){
     if(journal.ownerId!==ownerId||journal.deviceId!==deviceId)
       throw Error('cloud_first_wrong_account')
     if(!remote){
       set({phase:'attention',message:'云端记录暂不可用，本机记录已保留。',pendingLocal:true});return
     }
     if(journal.pending){result(await runAutomaticSyncOnce(port,{ownerId,deviceId,consentEnabled:true}));return}
     if(remote.revision!==journal.cursor.revision||remote.digest!==journal.cursor.digest){
       if(localDigest!==journal.cursor.digest){
         set({phase:'attention',message:'云端已更新；本机仍有未上传记录，已保留。',pendingLocal:true,hasCloudBackup:true});return
       }
       await adopt(remote,localDigest);return
     }
     result(await runAutomaticSyncOnce(port,{ownerId,deviceId,consentEnabled:true}));return
   }
   if(remote){
     if(localDigest===remote.digest){
       saveCursor(remote,local);set({phase:'synced',message:'已同步',hasCloudBackup:true,pendingLocal:false});return
     }
     if(empty(local)){await adopt(remote,localDigest);return}
     set({phase:'attention',message:'云端和本机都存有记录；已保留本机未同步内容。',hasCloudBackup:true,pendingLocal:true});return
   }
   if(empty(local)){
     set({phase:'synced',message:'云端已就绪，保存记录后自动同步',hasCloudBackup:false,pendingLocal:false});return
   }
   const review=await first.review()
   if(review.status!=='upload_local'){
     set({phase:'attention',message:'本机记录已保留，首次同步暂未完成。',pendingLocal:true});return
   }
   result(await first.confirm(INITIAL_MIGRATION_CONFIRMATION))
 }
 async function tick():Promise<CloudState>{
   if(busy){rerun=true;return {...state}}
   busy=true
   try{
     for(let i=0;i<3;i++){
       rerun=false
       try{await cycle()}
       catch(e){
         const reason=e instanceof Error?e.message:''
         // A remote 401/403 or a changed account is NOT offline. Quarantine
         // the old account until a newly verified login explicitly unlocks it.
         const invalid=/^(?:wechat_session_(?:account_changed|authorization_required|access_denied|authentication_failed|abandoned|invalid_response)|cloud_first_account_changed|sync_(?:owner_mismatch|session_owner_changed|cloud_(?:authentication_required|access_denied))|cloud_first_wrong_account)$/.test(reason)
         const rateLimited=reason==='wechat_session_rate_limited'
         const network=!invalid&&(rateLimited||/network|offline|timeout|unavailable|http/i.test(reason))
         set({phase:network?'offline':'attention',identityInvalid:invalid||state.identityInvalid,
           message:invalid?'微信账号验证已失效，已锁定原账号记录；请重新验证。':
             rateLimited?'登录请求较频繁，请稍后再试；本机记录已保留，暂未同步。':
             network?'网络异常，暂未同步；联网后将自动重试，本机记录已保留。':
             '同步暂未完成，本机记录已保留。',
           pendingLocal:true})
       }
       if(!rerun||['offline','attention'].includes(state.phase)||
          (state.phase==='notice'&&!approved))break
     }
   }finally{busy=false}
   return {...state}
 }
 return {
   state:()=>({...state}),
   /** Once at first-use onboarding; never ask again for each edit. */
   acceptCloudNotice:async()=>{
     approved=true;consentJustAcknowledged=true
     const paused=args.pausedLocally?.()===true
     // Only this explicit user invocation may bypass the on-disk stop flag.
     // A failed attempt must never let a later background tick silently
     // re-enable cloud consent or upload unsent local edits.
     if(paused)resumeExplicitly=true
     try{return await tick()}
     finally{
       if(paused){resumeExplicitly=false
         if(args.pausedLocally?.())consentJustAcknowledged=false}
     }
   },
   onLocalSaved:tick,onForeground:tick,onNetworkRestored:tick
 }
}
