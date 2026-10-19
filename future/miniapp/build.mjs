/**
 * Build v0.5 miniapp from an isolated staging source tree.
 * Does not edit src/, its pages.json or the v0.4 release dist.
 */
import {cpSync,existsSync,mkdirSync,readFileSync,rmSync,symlinkSync,writeFileSync} from 'node:fs'
import {resolve,join,dirname} from 'node:path'
import {fileURLToPath} from 'node:url'
import {execFileSync} from 'node:child_process'
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..')
const staging=join(root,'future','.generated-mp')
const src=join(staging,'src'),future=join(staging,'future')
if(!existsSync(join(root,'src','pages.json')))throw Error('wrong build root')
rmSync(staging,{recursive:true,force:true})
mkdirSync(src,{recursive:true})
cpSync(join(root,'src'),src,{recursive:true})
// The v0.5 two-page package does not require legacy tab-bar artwork.
rmSync(join(src,'static','tab'),{recursive:true,force:true})
mkdirSync(future,{recursive:true})
cpSync(join(root,'future','cloud'),join(future,'cloud'),{recursive:true})
cpSync(join(root,'future','miniapp'),join(future,'miniapp'),{
  recursive:true,filter:path=>!path.includes('.generated-mp')
})
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
manifest.name='错事 · v0.5 开发验证'
manifest.versionName='0.5.0-dev'
manifest.versionCode='50'
manifest['mp-weixin'].appid='' // Never leak or assume a real registered AppID.
writeFileSync(join(src,'manifest.json'),JSON.stringify(manifest,null,2))
const origin=process.env.CUOSHI_V05_CLOUD_ORIGIN||''
if(origin&&!/^https:\/\/[a-z0-9.-]+(?::\d{2,5})?$/.test(origin))
 throw Error('CUOSHI_V05_CLOUD_ORIGIN must be an HTTPS host only')
const version=process.env.CUOSHI_V05_NOTICE_VERSION||'privacy-v1'
if(!/^[a-zA-Z0-9_.-]{3,64}$/.test(version))throw Error('invalid notice version')
writeFileSync(join(future,'miniapp','cloudConfig.ts'),
 'export const cloudOrigin='+JSON.stringify(origin)+'\n'+
 'export const cloudNoticeVersion='+JSON.stringify(version)+'\n')
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
console.log(origin?'Cloud host configured for real-provider QA':'No cloud origin: app fails closed without login or private uploads')
