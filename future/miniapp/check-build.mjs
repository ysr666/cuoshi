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
check(settings.includes('云端自动同步'),'Native settings explain cloud-first storage')
check(!settings.includes('JSON 备份'),'No v0.4 temporary JSON backup UI')
const config=JSON.parse(read('project.config.json'))
check(config.appid==='touristappid','No fake production AppID embedded')
const generated=readFileSync(join(base,'future','miniapp','cloudConfig.ts'),'utf8')
const noServer=!process.env.CUOSHI_V05_CLOUD_ORIGIN
if(noServer){
 check(generated.includes('cloudOrigin=""'),
   'Without a configured cloud origin, miniapp cannot authenticate/upload')
}
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
