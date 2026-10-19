import {readFileSync,existsSync,readdirSync} from 'node:fs'
import {join,resolve,dirname} from 'node:path'
import {fileURLToPath} from 'node:url'
import assert from 'node:assert/strict'
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..')
const base=join(root,'future','.generated-mp')
const app=join(base,'dist','build','mp-weixin')
let n=0
const check=(value,message)=>{assert.ok(value,message);n++}
const read=p=>readFileSync(join(app,p),'utf8')
const pages=JSON.parse(read('app.json')).pages
check(JSON.stringify(pages)===JSON.stringify([
 'pages/today/index','pages/settings/index'
]),'Exactly two separate native v0.5 pages')
for(const page of pages){
 for(const ext of ['js','wxml','wxss','json']){
  check(existsSync(join(app,page+'.'+ext)),page+' native '+ext)
 }
}
const today=read('pages/today/index.wxml')
for(const term of ['了解并开始','今天','留几个字','修改历史','首次']){
 check(today.includes(term),'Native template keeps '+term)
}
const settings=read('pages/settings/index.wxml')
// Regression guard: complete history must remain reachable on the native page.
for(const term of ['今天修改了过去的记录','原文：','删除前：','本地时间']){
 check(today.includes(term),'Native history renders '+term)
}
const todayScript=read('pages/today/index.js')
check(todayScript.includes('展开全部')&&todayScript.includes('收起历史'),
 'Native history offers expandable complete ledger rather than silently hiding older events')
check(today.includes('mode="date"')&&today.includes('end="{{')&&
 today.includes('date-picker'),
 'Native history date is directly selectable with today as the upper bound')
check(todayScript.includes('dateValid')&&
 todayScript.includes('只能查看今天及以前的日期'),
 'Invalid or future date selection is refused before switching account records')
check(!today.includes('导出数据')&&!settings.includes('导出数据')&&
 !today.includes('导入数据')&&!settings.includes('导入数据'),
 'No unnecessary export/import controls on either page')
check(settings.includes('云端自动同步'),'Native settings explain cloud-first storage')
check(settings.includes('暂停自动云端保存')&&settings.includes('重试关闭云端授权')&&
 settings.includes('重新开启自动云端保存'),
 'Native data management exposes opt-out, uncertain-retry and explicit resume')
check(read('pages/settings/index.js').includes('暂停自动云端保存？'),
 'Native pause requires final confirmation and discloses that cloud data remains')
check(read('pages/today/index.js').includes('重新确认自动云端保存'),
 'Native today page offers an explicit restore action after revoked cloud consent')
check(today.includes('重新核验注销结果')&&settings.includes('重新核验注销结果'),
 'Both native pages expose original-bearer deletion verification without auto-login')
check(settings.includes('申请注销账号')&&
 read('pages/settings/index.js').includes('最后确认注销账号'),
 'Native settings retain irreversible cancellation confirmation and warnings')
check(read('common/vendor.js').includes('注销账号并清除云端记录'),
 'Native settings require exact typed account deletion confirmation')
check(today.includes('重新开始（创建新账号）'),
 'Native today page offers explicit re-registration after cancellation')
check(settings.includes('重新确认自动云端保存'),
 'Native settings provide a visible re-consent path without deleting records')
check(!settings.includes('JSON 备份'),'No v0.4 temporary JSON backup UI')
const config=JSON.parse(read('project.config.json'))
check(config.appid==='touristappid','No fake production AppID embedded')
const generated=readFileSync(join(base,'future','miniapp','cloudConfig.ts'),'utf8')
const noServer=!process.env.CUOSHI_V05_CLOUD_ORIGIN
if(noServer){
 check(generated.includes('cloudOrigin=""'),
   'Without a configured cloud origin, miniapp cannot authenticate/upload')
}
// Treat the actual compiled package as the release-scope boundary. A stray
// page, legacy file-sharing bridge or subscription API is a regression even
// if its UI is hidden behind a flag. Keep this list deliberately small.
const allowedRuntimeFiles=[
 'app.js','app.json','app.wxss','common/vendor.js',
 'core/backup.js','core/model.js',
 'pages/today/index.js','pages/today/index.json',
 'pages/today/index.wxml','pages/today/index.wxss',
 'pages/settings/index.js','pages/settings/index.json',
 'pages/settings/index.wxml','pages/settings/index.wxss',
 'project.config.json'
]
const runtimeFiles=readdirSync(app,{recursive:true,withFileTypes:true})
 .filter(entry=>entry.isFile())
 .map(entry=>join(entry.parentPath,entry.name).slice(app.length+1)
   .split('\\').join('/')).sort()
check(JSON.stringify(runtimeFiles)===JSON.stringify(allowedRuntimeFiles.slice().sort()),
 'v0.5 output includes only its two pages, account model and runtime core')
const stagedSourceFiles=readdirSync(join(base,'src'),{recursive:true})
 .map(String)
check(!stagedSourceFiles.some(name=>
 /^(components|platform|static)(\/|$)/.test(name)||
 /^(pages\/(calendar|detail|stats))(\/|$)/.test(name)),
 'No v0.4 stats, calendar, import/export bridge or nonessential source staged')
const deliveredJavaScript=runtimeFiles.filter(x=>x.endsWith('.js'))
 .map(read).join('\n')
for(const api of ['chooseMessageFile','shareFileMessage','getFileSystemManager',
 'requestSubscribeMessage','getPhoneNumber'])
 check(!deliveredJavaScript.includes(api),'No optional file/subscription/phone API: '+api)
for(const obsolete of ['导出完整备份','导入备份','累计排行','连续打卡','AI 判断错误'])
 check(!today.includes(obsolete)&&!settings.includes(obsolete),
   'No optional feature surface: '+obsolete)
const all=readdirSync(app,{recursive:true})
check(!all.some(name=>String(name).includes('test-fixtures')),
 'No test fixture copied into the miniapp')
check(!existsSync(join(app,'pages','calendar','index.js')),
 'v0.4 legacy page not included')
const mainJs=read('common/vendor.js')
check(mainJs.includes('云服务尚未配置'),
 'Compiled runtime retains fail-closed server configuration guard')
check(!mainJs.includes('sk-proj-')&&!mainJs.includes('AppSecret'),
 'No cloud secret embedded')
console.log('PASS',n,'v0.5 native WeChat build and no-config safety checks')
