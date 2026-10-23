import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {request as httpRequest} from 'node:http'
import {openAdminPreview} from '../future/admin/server.mjs'
const require=createRequire(import.meta.url)
const {chromium}=require('playwright-core')
let checks=0
const ok=(condition,message)=>{assert.ok(condition,message);checks++}
await assert.rejects(()=>openAdminPreview({port:0}),/explicit_synthetic_ack/);checks++
await assert.rejects(()=>openAdminPreview({port:0,acknowledgement:'PRODUCTION'}),/explicit_synthetic_ack/);checks++
const preview=await openAdminPreview({port:0,acknowledgement:'SYNTHETIC_ADMIN_PREVIEW_ONLY'})
const endpoint=preview.origin
let browser
try{
 const headers=await fetch(endpoint)
 ok(headers.status===200,'Preview only loopback serves HTML')
 ok(headers.headers.get('content-security-policy')?.includes("default-src 'none'"),'Strict CSP with no external scripts')
 ok(headers.headers.get('cache-control')?.includes('no-store'),'Admin mock always no-store')
 const api=await fetch(endpoint+'/api/preview/overview')
 const data=await api.json()
 ok(data.sampleOnly===true&&data.metrics.accounts===1286,'Overview is clearly marked synthetic')
 ok(!JSON.stringify(data).includes('records')&&!JSON.stringify(data).includes('accessToken'),
   'Overview never provides note bodies or access credentials')
 ok((await fetch(endpoint+'/api/admin/users')).status===404,
   'Real account and privileged endpoints do not exist in the preview')
 ok((await fetch(endpoint+'/v1/backup/snapshot')).status===404,
   'Preview has no private cloud record route')
 ok((await fetch(endpoint+'/api/preview/overview',{method:'POST'})).status===405,
   'Preview is GET-only')
 const hostileStatus=await new Promise((resolve,reject)=>{
   const req=httpRequest(endpoint+'/',{headers:{Host:'attacker.invalid'}},res=>{res.resume();resolve(res.statusCode)});req.on('error',reject);req.end()
 })
 ok(hostileStatus===403,'Untrusted Host header cannot read preview through DNS rebinding')
 const executable=process.env.CHROME_PATH||(process.platform==='darwin'?'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome':'/usr/bin/google-chrome')
 browser=await chromium.launch({headless:true,executablePath:executable})
 for(const width of [390,1280]){
   const context=await browser.newContext({viewport:{width,height:850},locale:'zh-CN'})
   const page=await context.newPage()
   const errors=[];const external=[]
   page.on('pageerror',e=>errors.push(e.message))
   page.on('request',r=>{if(!r.url().startsWith(endpoint))external.push(r.url())})
   await page.goto(endpoint)
   await page.locator('[data-metric="accounts"]').waitFor({state:'visible'})
   ok(await page.getByText('独立演示环境').isVisible(),width+' preview is prominently labeled synthetic')
   ok((await page.locator('[data-metric="accounts"]').textContent()).trim()==='1,286',width+' KPI renders')
   ok(await page.locator('.chart-wrap .bar').count()===28,width+' sample trend has 28 bars')
   const bars=await page.locator('.chart-wrap .bar').all()
   ok((await bars[0].boundingBox()).height>20,width+' sample trend bars have visible height')
   await page.getByRole('button',{name:/账号状态/}).click()
   await page.locator('tbody tr').first().waitFor()
   ok(await page.locator('tbody tr').count()===5,width+' synthetic account list renders')
   await page.getByRole('searchbox',{name:'搜索账号'}).fill('A041')
   ok(await page.locator('tbody tr').count()===1,width+' status filter works')
   await page.getByRole('button',{name:/工单与授权/}).click()
   await page.getByRole('button',{name:'查看范围'}).first().click()
   ok((await page.locator('#case-detail').textContent()).includes('工单：DEMO-2026-001'),width+' case detail shows scoped synthetic metadata')
   ok(await page.getByRole('button',{name:/生产权限未配置/}).isDisabled(),width+' real record lookup is disabled')
   await page.getByRole('button',{name:/系统状态/}).click()
   await page.getByRole('button',{name:'刷新示例状态'}).waitFor({state:'visible'})
   ok((await page.locator('#view-content').innerText()).includes('需要真实云资源及加密备份策略'),width+' production gaps explicit')
   await page.getByRole('button',{name:'刷新示例状态'}).click()
   ok((await page.locator('#refreshed').innerText()).includes('示例刷新'),width+' refresh labels synthetic result')
   const horizontal=await page.evaluate(()=>document.documentElement.scrollWidth)
   ok(horizontal<=width+1,width+' no horizontal overflow')
   ok(errors.length===0,width+' no JS errors: '+errors.join(';'))
   ok(external.length===0,width+' no external network requests')
   await context.close()
 }
 console.log('PASS '+checks+' secure synthetic admin preview and Chrome UX assertions')
}finally{await browser?.close();await preview.close()}
