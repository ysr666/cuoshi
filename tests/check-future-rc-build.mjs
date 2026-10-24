/** Disposable, synthetic WeChat RC compile: no real AppID, secrets or users.
 * Tests the ACTUAL v0.5 release path while leaving developer preview intact.
 */
import assert from 'node:assert/strict'
import {mkdtempSync,cpSync,symlinkSync,readFileSync,rmSync,statSync,existsSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {resolve,join,dirname} from 'node:path'
import {execFileSync} from 'node:child_process'
import {fileURLToPath} from 'node:url'
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..')
const temp=mkdtempSync(join(tmpdir(),'cuoshi-v05-rc-compile-'))
const id='wx0123456789abcdef'
const filing='陕ICP备2026123456号-1X'
let n=0
const check=(v,message)=>{assert.ok(v,message);n++}
try{
 // Deliberately only copy source/build inputs; never use or overwrite
 // production AppID, the normal future/.generated-mp package or user files.
 for(const rel of ['package.json','vite.config.ts','tsconfig.json'])
   cpSync(join(root,rel),join(temp,rel))
 for(const rel of ['src','future/cloud','future/miniapp'])
   cpSync(join(root,rel),join(temp,rel),{recursive:true})
 symlinkSync(join(root,'node_modules'),join(temp,'node_modules'),'dir')
 // Never pass genuine local application secrets to synthetic builds.
 const env={PATH:process.env.PATH,HOME:process.env.HOME,
  TMPDIR:process.env.TMPDIR||'/tmp',LANG:process.env.LANG||'C.UTF-8',
  CUOSHI_V05_RELEASE_CANDIDATE:'1',CUOSHI_V05_WECHAT_APP_ID:id,
  CUOSHI_V05_CLOUD_ORIGIN:'https://api.synthetic-cuoshi.testonly.org',
  CUOSHI_V05_NOTICE_VERSION:'privacy-fixture-rc-20261024',
  CUOSHI_V05_FILING_NUMBER:filing,
  CUOSHI_V05_CONTACT_EMAIL:'privacy@synthetic-cuoshi.testonly.org'}
 const out=execFileSync(process.execPath,[join(temp,'future/miniapp/build.mjs')],
   {cwd:temp,env,timeout:80000,maxBuffer:2*1024*1024,encoding:'utf8'})
 check(out.includes('Release-CANDIDATE source compiled'),
  'Actual miniapp release flag reaches isolated production-like build')
 const dir=join(temp,'future/.generated-mp/dist/build/mp-weixin')
 const config=JSON.parse(readFileSync(join(dir,'project.config.json'),'utf8'))
 check(config.appid===id,'Compiled RC contains explicitly supplied synthetic AppID')
 const manifest=JSON.parse(readFileSync(join(temp,'future/.generated-mp/src/manifest.json'),'utf8'))
 check(manifest.name==='错事'&&manifest.versionName==='0.5.0-rc',
  'RC has public approved-name candidate marker and matching version')
 const stages=readFileSync(join(temp,'future/.generated-mp/future/miniapp/cloudConfig.ts'),'utf8')
 check(stages.includes(filing)&&stages.includes('privacy-fixture-rc-20261024')&&
   stages.includes('privacy@synthetic-cuoshi.testonly.org'),
   'RC embeds declared mini-program filing number, notice version and public contact')
 const wx=readFileSync(join(dir,'pages/today/index.wxml'),'utf8')
 check(wx.includes('你可以在「设置」中查看数据处理说明')&&
   wx.includes('正式发布前须完成适用的隐私政策')&&wx.includes('wx:if'),
   'RC template emits separate conditional public disclosure and dev-only test notice')
 const compiled=readFileSync(join(dir,'pages/today/index.js'),'utf8')
 check(compiled.includes('filingNumber'),
   'RC conditional branches evaluate deployed filing field, not fixed demo copy')
 const settings=readFileSync(join(dir,'pages/settings/index.wxml'),'utf8')
 check(settings.includes('小程序备案编号')&&settings.includes('个人信息查阅'),
   'Public contact and mini-program filing displayed in RC settings')
 check(!existsSync(join(temp,'future/.generated-mp/src/pages/stats')),
   'RC cannot contain unused statistics or backup/export pages')
 check((statSync(temp).mode&0o777)===0o700,
   'Synthetic staging directory is private; never leaves fixture AppID in Git')
 console.log('PASS '+n+' isolated synthetic RC compile, disclosure, filing and artifact integrity assertions')
}finally{rmSync(temp,{recursive:true,force:true})}
