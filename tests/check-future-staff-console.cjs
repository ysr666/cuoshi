/* Synthetic staff-console browser acceptance. No real employee accounts. */
const assert=require('node:assert/strict')
const {createRequire}=require('node:module')
const {execFileSync}=require('node:child_process')
const {mkdtempSync,mkdirSync,rmSync}=require('node:fs')
const {tmpdir}=require('node:os')
const {join,resolve}=require('node:path')
const {randomBytes,createHash}=require('node:crypto')
const {createServer,request}=require('node:http')
const root=resolve('.'),temp=mkdtempSync(join(tmpdir(),'cuoshi-staff-ui-'))
const requireLocal=createRequire(resolve('package.json'))
const {chromium}=requireLocal('playwright-core')
let checks=0
const ok=(v,m)=>{assert.ok(v,m);checks++}
const token='T'.repeat(140),unprivileged='U'.repeat(140)
const fixturePass='fixture-owner-secret-12345',fixtureOtp='123456'
let staff,proxy,browser,overviewHits=0
;(async()=>{
 const output=join(temp,'dist');mkdirSync(output)
 execFileSync(resolve('node_modules/.bin/tsc'),[
   '--strict','--target','ES2022','--module','CommonJS','--moduleResolution','node',
   '--skipLibCheck','--rootDir',root,'--outDir',output,'future/server/src/staffHttpHost.ts'
 ],{cwd:root,stdio:'inherit'})
 const {listenStaffPrivateLoopback,createStaffConsoleAssets}=require(join(output,'future/server/src/staffHttpHost.js'))
 const {createTrustedEdgeBoundary}=require(join(output,'future/server/src/trustedEdge.js'))
 const sharedSecret=randomBytes(32),proof=createHash('sha256').update(sharedSecret).digest('hex')
 const edge=createTrustedEdgeBoundary({sharedSecret})
 const assets=createStaffConsoleAssets(resolve('future/admin/live'))
 ok(assets.size===4,'Only four preapproved local files are served')
 const deps={consoleAssets:assets,ownerAuth:{async login(c,ip){
 if(c.password!==fixturePass||c.otp!==fixtureOtp||ip!=='127.0.0.1')throw Error('owner_login_invalid')
 return token
 },async logout(){return undefined}},reporting:{async overview(key){overviewHits++
   if(key===unprivileged)throw Error('operational_reporting_access_denied')
   if(key!==token)throw Error('unauthorized')
   return {totalAccounts:12,cloudEnabledAccounts:9,storedSnapshots:7,
      snapshotsUpdatedLast7d:5,accountsCreatedLast7d:2}
 }}}
 staff=await listenStaffPrivateLoopback(deps,edge,0)
 const privatePort=staff.server.address().port
 const send=(req,res)=>{
   // An isolated test-only emulation of TLS proxy header replacement.
   // The real deployment must provide an equivalent trusted reverse proxy.
   const headers={...req.headers,'x-cuoshi-edge-proof':proof,
     'x-cuoshi-client-ip':'127.0.0.1'}
   delete headers.connection
   const upstream=request({hostname:'127.0.0.1',port:privatePort,path:req.url,method:req.method,headers},up=>{
     res.writeHead(up.statusCode,up.headers);up.pipe(res)
   })
   upstream.on('error',()=>{res.writeHead(502);res.end()});req.pipe(upstream)
 }
 proxy=createServer(send)
 await new Promise(resolve=>proxy.listen(0,'127.0.0.1',resolve))
 const origin='http://127.0.0.1:'+proxy.address().port
 ok((await fetch(staff.origin+'/admin/')).status===403,
   'Cannot bypass trusted proxy to reach staff UI')
 const pageRoute=await fetch(origin+'/admin/')
 ok(pageRoute.status===200&&pageRoute.headers.get('content-security-policy')?.includes("default-src 'none'"),
   'Strict CSP, protected staff UI via trusted proxy')
 ok((await fetch(origin+'/admin/secrets')).status===404,
   'No file path traversal or unknown static files')
 ok((await fetch(origin+'/v1/backup/snapshot')).status===404,
   'Even trusted owner edge cannot reach user backup API')
 ok((await fetch(origin+'/internal/admin/read-day',{method:'POST'})).status===404,
   'Legacy multi-employee private-note route is disabled')
 const chrome=process.env.CHROME_PATH||(process.platform==='darwin'?
   '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome':'/usr/bin/google-chrome')
 browser=await chromium.launch({headless:true,executablePath:chrome})
 for(const width of [390,1280]){
  const context=await browser.newContext({viewport:{width,height:850},locale:'zh-CN'})
  const page=await context.newPage(),issues=[],foreign=[]
  page.on('pageerror',e=>issues.push(e.message))
  page.on('request',r=>{if(!r.url().startsWith(origin))foreign.push(r.url())})
  await page.goto(origin+'/admin/')
  await page.locator('#auth-form').waitFor({state:'visible'})
  ok(await page.locator('#metrics').locator('.stat-card').count()===0,
    width+' no metrics before signed staff session')
  ok(await page.locator('#case-form').count()===0,width+' multi-person cases not present in owner dashboard')
  await page.locator('#owner-password').fill(fixturePass)
  await page.locator('#owner-otp').fill(fixtureOtp)
  await page.locator('#auth-form button').click()
  await page.locator('#metrics .stat-card').first().waitFor()
  ok(await page.locator('#metrics .stat-card').count()===5,width+' all five real metrics rendered')
  ok((await page.locator('#metrics').innerText()).includes('12'),width+' reads backend aggregate, not synthetic demo number')
  ok(!(await page.locator('#metrics').innerText()).includes('99.4'),width+' never invents sync success rate')
  if(process.env.CUOSHI_STAFF_UI_SCREENSHOT==='1')await page.screenshot({path:'/tmp/cuoshi-staff-live-'+width+'.png',fullPage:true})
  await page.getByRole('button',{name:/系统状态/}).click()
  ok(await page.locator('#system').isVisible(),width+' system state visible to owner')
  await page.getByRole('button',{name:/运营概览/}).click()
  ok(await page.locator('#overview').isVisible(),width+' owner overview navigation works')
  ok(await page.locator('[data-view="cases"]').count()===0,
    width+' no employee or second-approver workflow in the live UI')
  await page.locator('#logout').click()
  ok(await page.locator('#auth-card').isVisible()&&await page.locator('#metrics .stat-card').count()===0,
    width+' logout removes credentials and operational metrics')
  ok((await page.locator('#owner-otp').inputValue())==='',width+' token field scrubbed')
  await page.evaluate(()=>window.dispatchEvent(new Event('pagehide')))
  ok(await page.locator('#auth-card').isVisible(),width+' browser pagehide resets to login without lingering authorized UI')
  ok(!await page.evaluate(()=>localStorage.length||sessionStorage.length),width+' session never in web storage')
  const scroll=await page.evaluate(()=>document.documentElement.scrollWidth)
  ok(scroll<=width+1,width+' responsive width fits screen')
  ok(issues.length===0,width+' no JavaScript errors: '+issues.join(';'))
  ok(foreign.length===0,width+' no external requests')
  await context.close()
 }
 ok(overviewHits>=2,'Browser exercised sole-owner protected statistics route')
 console.log('PASS '+checks+' real-data staff console safety and Chrome interactions')
})().catch(e=>{console.error(e);process.exitCode=1}).finally(async()=>{
 await browser?.close();if(proxy)await new Promise(r=>proxy.close(r));await staff?.close()
 rmSync(temp,{recursive:true,force:true})
})
