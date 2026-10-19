/** Guardrail: future mainland cloud prototypes must never ship in the v0.4 bundles. */
import assert from 'node:assert/strict'
import {existsSync,readdirSync,readFileSync,statSync} from 'node:fs'
import {resolve,join} from 'node:path'

const roots=['dist/build/h5','dist/build/mp-weixin']
const forbidden=['CloudContractSimulator','checkBodyRead','cloudBackupEnabled','necessary_safety_review','AuthenticatedCloudService','issueServerSession','cloud_read_day','loginWithWechatCode','makeWechatCodeExchanger','cloud_wechat_identities','revokeVerifiedSession','cloud_revoked_backup_tokens','cloud_cancel_account','readAnonymousDeletionSummary','ACCOUNT_DELETE_CONFIRMATION','CLOUD_RESTORE_JOURNAL_KEY','commitConfirmedCloudRestore','prepareConfirmedCloudRestore','previewInitialMigration','prepareInitialMigration','verifyInitialMigration','INITIAL_MIGRATION_CONFIRMATION','runAutomaticSyncOnce','createLinkedJournal','sync_journal_not_durable','createFutureSyncPort','createAuthenticatedBackupHttpBridge','cuoshi_future_v05_sync_journal_v1','createBackupHttpHandler','createAccountHttpHandler','createWeChatSessionManager','createFirstLinkRuntime','createCloudSettingsWork','first_link_v1']
let checked=0
function walk(dir){
  for(const name of readdirSync(dir)){
    const f=join(dir,name),stat=statSync(f)
    if(stat.isDirectory()){walk(f);continue}
    if(!/\.(?:js|mjs|html|json|wxml|wxss)$/.test(name))continue
    const source=readFileSync(f,'utf8')
    for(const symbol of forbidden)
      assert.ok(!source.includes(symbol),'Future cloud prototype must NOT be bundled: '+symbol+' in '+f)
    checked++
  }
}
for(const path of roots){
  const root=resolve(path)
  assert.ok(existsSync(root),'Build missing before isolation test: '+root)
  walk(root)
}
console.log('PASS future cloud code absent from',checked,'v0.4 H5/WeChat build files')
