/** Release input syntax validation only, NOT proof of platform approvals. */
import {isIP} from 'node:net'

const invalidHosts=/(?:^|\.)(?:localhost|local|test|invalid|example)$/i
const appIdSyntax=/^wx[a-zA-Z0-9]{16}$/
const privacyVersion=/^[a-zA-Z0-9_.-]{3,64}$/
// Ministry-issued mini-program filing suffix is -N X (not site -N or app -N A).
// This is syntax-only; actual issuance/ownership must be verified in WeChat.
const miniProgramFiling=/^[\u4e00-\u9fff]{1,3}ICP备[0-9]{4,20}号-[1-9][0-9]*X$/
const originSyntax=/^https:\/\/[a-z0-9.-]+(?::\d{2,5})?$/
export function parseMiniappBuildConfig(env){
 const appId=env.CUOSHI_V05_WECHAT_APP_ID||''
 const cloudOrigin=env.CUOSHI_V05_CLOUD_ORIGIN||''
 const noticeVersion=env.CUOSHI_V05_NOTICE_VERSION||'privacy-v1'
 const filingNumber=env.CUOSHI_V05_FILING_NUMBER||''
 const contactEmail=env.CUOSHI_V05_CONTACT_EMAIL||''
 const releaseValue=env.CUOSHI_V05_RELEASE_CANDIDATE||''
 if(!['','1'].includes(releaseValue))throw Error('invalid_release_candidate_flag')
 const releaseCandidate=releaseValue==='1'
 if(appId&&!appIdSyntax.test(appId))throw Error('invalid_wechat_app_id_syntax')
 if(cloudOrigin&&!originSyntax.test(cloudOrigin))
  throw Error('cloud_origin_must_be_https_host_only')
 if(!privacyVersion.test(noticeVersion))throw Error('invalid_privacy_notice_version')
 if(releaseCandidate){
  if(!appId)throw Error('release_requires_official_wechat_app_id')
  if(!cloudOrigin)throw Error('release_requires_verified_cloud_domain')
  const url=new URL(cloudOrigin)
  if(url.port||isIP(url.hostname)||!url.hostname.includes('.')||
    invalidHosts.test(url.hostname)||url.hostname.startsWith('-')||
    url.hostname.includes('..'))
   throw Error('release_requires_public_https_domain_without_port')
  if(!env.CUOSHI_V05_NOTICE_VERSION||noticeVersion==='privacy-v1')
   throw Error('release_requires_reviewed_privacy_notice_version')
  // Syntax checking is not legal validation: the operator must confirm the
  // actual filing record and monitored public contact in WeChat back office.
  if(!miniProgramFiling.test(filingNumber))
   throw Error('release_requires_actual_miniprogram_filing_number')
  if(!/^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,24}$/.test(contactEmail))
   throw Error('release_requires_public_support_contact')
 }
 return {appId,cloudOrigin,noticeVersion,releaseCandidate,filingNumber,contactEmail}
}
