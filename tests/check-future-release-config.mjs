import assert from 'node:assert/strict'
import {parseMiniappBuildConfig} from '../future/miniapp/buildConfig.mjs'
let n=0
const check=(v,label)=>{assert.ok(v,label);n++}
const reject=(env,re,label)=>{
 assert.throws(()=>parseMiniappBuildConfig(env),re,label);n++
}
const safe=parseMiniappBuildConfig({})
check(safe.appId===''&&safe.cloudOrigin===''&&
 safe.noticeVersion==='privacy-v1'&&!safe.releaseCandidate,
 'Ordinary builds remain offline-only with no AppID or cloud identity')
const qa=parseMiniappBuildConfig({CUOSHI_V05_CLOUD_ORIGIN:'https://test.cuoshi.invalid'})
check(!qa.releaseCandidate&&qa.cloudOrigin==='https://test.cuoshi.invalid',
 'Synthetic QA endpoint permitted only outside release-candidate mode')
reject({CUOSHI_V05_WECHAT_APP_ID:'touristappid'},/invalid_wechat_app_id/,
 'Test/dev AppID rejected as a real identity input')
reject({CUOSHI_V05_RELEASE_CANDIDATE:'yes'},/invalid_release_candidate_flag/,
 'Release flag cannot silently accept a typo')
reject({CUOSHI_V05_CLOUD_ORIGIN:'http://api.example.com'},/cloud_origin_must/,
 'No plaintext upstream endpoints')
reject({CUOSHI_V05_CLOUD_ORIGIN:'https://api.example.com/path'},/cloud_origin_must/,
 'No hidden API path in root cloud origin')
reject({CUOSHI_V05_NOTICE_VERSION:'a'},/invalid_privacy_notice_version/,
 'Invalid privacy-version labels rejected')
reject({CUOSHI_V05_RELEASE_CANDIDATE:'1'},/release_requires_official/,
 'Release candidate refuses missing real AppID')
const appId='wx0123456789abcdef'
reject({CUOSHI_V05_RELEASE_CANDIDATE:'1',CUOSHI_V05_WECHAT_APP_ID:appId},
 /release_requires_verified_cloud_domain/,'Release refuses empty HTTPS origin')
const base={CUOSHI_V05_RELEASE_CANDIDATE:'1',CUOSHI_V05_WECHAT_APP_ID:appId,
 CUOSHI_V05_NOTICE_VERSION:'privacy-v05-20261019'}
for(const badOrigin of [
 'https://localhost','https://127.0.0.1','https://192.168.1.1',
 'https://api.cuoshi.invalid','https://api.cuoshi.test',
 'https://api.cuoshi.example','https://api.cuoshi.local',
 'https://api.example.com:8443'
])reject({...base,CUOSHI_V05_CLOUD_ORIGIN:badOrigin},
 /release_requires_public_https_domain/,'Release refuses private/test/port host: '+badOrigin)
reject({...base,CUOSHI_V05_CLOUD_ORIGIN:'https://api.cuoshi.cn',
 CUOSHI_V05_NOTICE_VERSION:undefined},/release_requires_reviewed_privacy_notice_version/,
 'Default draft privacy version cannot be used for RC')
reject({...base,CUOSHI_V05_CLOUD_ORIGIN:'https://api.cuoshi.cn',
 CUOSHI_V05_NOTICE_VERSION:'privacy-v1'},/release_requires_reviewed_privacy_notice_version/,
 'Unreviewed default privacy version rejected')
reject({...base,CUOSHI_V05_CLOUD_ORIGIN:'https://api.cuoshi.cn'},
 /release_requires_actual_filing_number/,
 'Release candidate refuses missing public filing number')
const withFiling={...base,CUOSHI_V05_CLOUD_ORIGIN:'https://api.cuoshi.cn',
 CUOSHI_V05_FILING_NUMBER:'陕ICP备2026123456号-1X'}
reject(withFiling,/release_requires_public_support_contact/,
 'Release candidate refuses missing public support and privacy contact')
const accepted=parseMiniappBuildConfig({...withFiling,
 CUOSHI_V05_CONTACT_EMAIL:'privacy@cuoshi.cn'})
check(accepted.releaseCandidate&&accepted.appId===appId&&
 accepted.cloudOrigin==='https://api.cuoshi.cn',
 'Complete syntactically valid RC input accepted for operator verification')
console.log('PASS',n,'WeChat v0.5 explicit release candidate config gates (synthetic values)')
