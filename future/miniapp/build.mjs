/**
 * Build v0.5 miniapp from an isolated staging source tree.
 * Does not edit src/, its pages.json or the v0.4 release dist.
 */
import {cpSync,existsSync,mkdirSync,readFileSync,rmSync,symlinkSync,writeFileSync} from 'node:fs'
import {resolve,join,dirname} from 'node:path'
import {fileURLToPath} from 'node:url'
import {execFileSync} from 'node:child_process'
import {parseMiniappBuildConfig} from './buildConfig.mjs'
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..')
const staging=join(root,'future','.generated-mp')
const src=join(staging,'src'),future=join(staging,'future')
// Validate BEFORE deleting the previous build. Invalid release inputs must
// not disturb an existing offline QA package.
const buildConfig=parseMiniappBuildConfig(process.env)
if(!existsSync(join(root,'src','pages.json')))throw Error('wrong build root')
rmSync(staging,{recursive:true,force:true})
mkdirSync(src,{recursive:true})
// Release-scope allowlist. Never stage v0.4 stats, calendar, file IO,
// export/import pages or unrelated prototype UI: only the minimum needed
// for v0.5 daily records and authenticated automatic cloud persistence.
const copySource=(relative,from,to)=>{
 const target=join(to,relative)
 mkdirSync(dirname(target),{recursive:true})
 cpSync(join(from,relative),target)
}
for(const file of ['App.vue','main.ts','manifest.json',
 'core/model.ts','core/backup.ts'])copySource(file,join(root,'src'),src)
mkdirSync(future,{recursive:true})
mkdirSync(join(future,'cloud'),{recursive:true})
for(const file of [
 'automaticSync.ts','clientAdapters.ts','cloudFirst.ts',
 'cloudFirstLifecycle.ts','cloudRecordActions.ts','firstLinkRuntime.ts',
 'initialMigration.ts','snapshotContract.ts','stableJson.ts',
 'uniAccountRecords.ts','uniCloudHost.ts','wechatSession.ts'
])copySource(file,join(root,'future','cloud'),join(future,'cloud'))
for(const file of ['runtime.ts','historyView.ts'])
 copySource(file,join(root,'future','miniapp'),join(future,'miniapp'))
for(const page of ['today','settings']){
 const target=join(src,'pages',page,'index.vue')
 cpSync(join(root,'future','miniapp','pages',page,'index.vue'),target)
}
const pages={
 pages:[
  {path:'pages/today/index',style:{navigationStyle:'custom'}},
  {path:'pages/settings/index',style:{navigationStyle:'custom'}}
 ],
 globalStyle:{backgroundColor:'#f7f3eb',navigationBarTextStyle:'black',
   navigationBarTitleText:'错事'}
}
writeFileSync(join(src,'pages.json'),JSON.stringify(pages,null,2))
const manifest=JSON.parse(readFileSync(join(src,'manifest.json'),'utf8'))
manifest.name=buildConfig.releaseCandidate?'错事':'错事 · v0.5 开发验证'
manifest.versionName=buildConfig.releaseCandidate?'0.5.0-rc':'0.5.0-dev'
manifest.versionCode='50'
manifest['mp-weixin'].appid=buildConfig.appId // AppID is public; NEVER embed AppSecret.
writeFileSync(join(src,'manifest.json'),JSON.stringify(manifest,null,2))
const {cloudOrigin:origin,noticeVersion:version}=buildConfig
writeFileSync(join(future,'miniapp','cloudConfig.ts'),
 'export const cloudOrigin='+JSON.stringify(origin)+'\n'+
 'export const cloudNoticeVersion='+JSON.stringify(version)+'\n'+
 'export const cloudFilingNumber='+JSON.stringify(buildConfig.filingNumber)+'\n'+
 'export const cloudContactEmail='+JSON.stringify(buildConfig.contactEmail)+'\n')
cpSync(join(root,'vite.config.ts'),join(staging,'vite.config.ts'))
cpSync(join(root,'tsconfig.json'),join(staging,'tsconfig.json'))
cpSync(join(root,'package.json'),join(staging,'package.json'))
symlinkSync(join(root,'node_modules'),join(staging,'node_modules'),'dir')
const bin=join(root,'node_modules','.bin','uni')
execFileSync(bin,['build','-p','mp-weixin'],{cwd:staging,stdio:'inherit',
 env:{...process.env,UNI_INPUT_DIR:src,
   UNI_OUTPUT_DIR:join(staging,'dist','build','mp-weixin')}})
const output=join(staging,'dist','build','mp-weixin')
if(!existsSync(join(output,'app.json')))throw Error('missing WeChat app.json')
const app=JSON.parse(readFileSync(join(output,'app.json'),'utf8'))
if(JSON.stringify(app.pages)!==JSON.stringify([
 'pages/today/index','pages/settings/index'
]))throw Error('unexpected native mini-program entry pages')
console.log('PASS isolated v0.5 WeChat miniapp package: '+output)
console.log(buildConfig.releaseCandidate?
 'Release-CANDIDATE source compiled (operator must still verify AppID, filing, privacy, HTTPS and device QA)':
 origin?'Cloud host configured for real-provider QA':'No cloud origin: app fails closed without login or private uploads')
