/**
 * Binds the actual first-link runtime to the existing settings controller.
 * This uses the SAME durable journal that later automatic sync reads.
 * It does not construct real network transport, sessions or global uni.
 */
import type {SyncPort} from '../cloud/automaticSync'
import {runAutomaticSyncOnce} from '../cloud/automaticSync'
import {
  createFirstLinkRuntime,type FirstLinkPort
} from '../cloud/firstLinkRuntime'
import {INITIAL_MIGRATION_CONFIRMATION} from '../cloud/initialMigration'
import {inspectCloudConflict} from '../cloud/conflictReview'
import type {CloudSettingsAuth,CloudSettingsWork} from './cloudSettingsController'

export function createCloudSettingsWork(args:{
  ownerId:string
  deviceId:string
  auth:CloudSettingsAuth
  port:FirstLinkPort&SyncPort
}):CloudSettingsWork{
  const {ownerId,deviceId,auth,port}=args
  const first=createFirstLinkRuntime({
    ownerId,deviceId,port,
    getConsent:async()=>{
      const identity=await auth.getVerifiedSession()
      if(identity.ownerId!==ownerId)throw Error('wechat_session_account_changed')
      return (await auth.getStatus()).enabled
    }
  })
  return {
    hasVerifiedLink:(active)=>active===ownerId&&first.hasVerifiedLink(),
    hasUnsentChanges:(active)=>active!==ownerId||first.hasUnsentChanges(),
    reviewFirstBackup:()=>first.review(),
    async reviewConflict(){
      const identity=await auth.getVerifiedSession()
      if(identity.ownerId!==ownerId)throw Error('wechat_session_account_changed')
      if(!(await auth.getStatus()).enabled)throw Error('sync_consent_required')
      return inspectCloudConflict({ownerId,port})
    },
    firstBackup:()=>first.confirm(INITIAL_MIGRATION_CONFIRMATION),
    async syncNow(){
      const identity=await auth.getVerifiedSession()
      if(identity.ownerId!==ownerId)throw Error('wechat_session_account_changed')
      const consent=(await auth.getStatus()).enabled
      return runAutomaticSyncOnce(port,{ownerId,deviceId,consentEnabled:consent})
    }
  }
}
