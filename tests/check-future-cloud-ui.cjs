/**
 * Isolated v0.5 Vue cloud-backup UI real Chrome interactions.
 * No real WeChat login, no production host, no user records.
 */
const assert=require('node:assert/strict')
const {createServer}=require('node:http')
const {readFileSync,existsSync}=require('node:fs')
const {join,resolve,extname}=require('node:path')
const {chromium}=require('playwright-core')
const root=resolve('future/preview-dist')
if(!existsSync(join(root,'index.html')))
  throw Error('Build preview with npm run build:future:cloud-ui first')
const mime={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8',
  '.js':'text/javascript; charset=utf-8','.svg':'image/svg+xml'}
const server=createServer((req,res)=>{
  let file=join(root,(req.url||'/').replace(/^\//,''))
  if(req.url==='/')file=join(root,'index.html')
  if(!file.startsWith(root)||!existsSync(file)){res.writeHead(404);res.end();return}
  res.setHeader('Content-Type',mime[extname(file)]||'application/octet-stream')
  res.writeHead(200);res.end(readFileSync(file))
})
const listen=()=>new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
const close=()=>new Promise(resolve=>server.close(resolve))
;(async()=>{
  await listen()
  const url='http://127.0.0.1:'+server.address().port
  const browser=await chromium.launch({headless:true,
    executablePath:process.env.CHROME_PATH||(process.platform==='darwin'
      ?'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome':'/usr/bin/google-chrome')})
  let total=0
  const check=(value,msg)=>{assert.ok(value,msg);total++}
  try{
    for(const width of [320,390,430]){
      const page=await browser.newPage({viewport:{width,height:844},deviceScaleFactor:1})
      const errors=[];page.on('pageerror',e=>errors.push(e.message))
      page.setDefaultTimeout(6000)
      await page.goto(url,{waitUntil:'networkidle'})
      check(await page.getByText('只记录在这里',{exact:true}).isVisible(),
        'Signed-out preview starts local-only')
      check((await page.evaluate(()=>window.__cuoshiDemo.snapshot())).cloudSaved===false,
        'Opening UI does not use mock cloud upload')
      check((await page.locator('[data-testid="first-backup"]').count())===0,
        'No backup button before user authorization')
      check(await page.evaluate(()=>document.documentElement.scrollWidth)<=width+1,
        'No horizontal overflow at '+width+'px')
      if(width===390){
        await page.screenshot({path:'/tmp/cuoshi-future-cloud-signedout-390.png',fullPage:true})
      }
      await page.getByTestId('login').click()
      check(await page.getByText('还没有开启云备份',{exact:true}).isVisible(),
        'WeChat login leaves cloud backups disabled')
      await page.getByTestId('enable').click()
      check(await page.getByText('开启云备份？',{exact:true}).isVisible(),
        'Cloud opt-in has explicit confirmation before changing status')
      await page.getByText('再想想',{exact:true}).click()
      check(await page.getByText('未开启',{exact:true}).isVisible(),
        'Cancelling cloud opt-in did not enable it')
      await page.getByTestId('enable').click()
      await page.getByTestId('confirm-action').click()
      check(await page.getByText('准备第一次备份',{exact:true}).isVisible(),
        'Enabling cloud consent does not silently upload records')
      check((await page.evaluate(()=>window.__cuoshiDemo.snapshot())).cloudSaved===false,
        'Separate user confirmation required for first full-history migration')
      await page.getByTestId('first-backup').click()
      check(await page.getByText('首次上传本机完整历史？',{exact:true}).isVisible(),
        'First upload explicitly describes private history transfer')
      check(await page.getByText(/本机记录 4 天，含 8 条完整修改历史/).isVisible(),
        'First upload includes accurate non-sensitive reviewed counts')
      if(width===390)await page.screenshot({
        path:'/tmp/cuoshi-future-cloud-first-review-390.png',fullPage:true
      })
      await page.getByTestId('confirm-action').click()
      check(await page.getByText('已同步',{exact:true}).isVisible(),
        'Verified first-link result rendered')
      if(width===390)await page.screenshot({
        path:'/tmp/cuoshi-future-cloud-synced-390.png',fullPage:true
      })
      await page.evaluate(()=>window.__cuoshiDemo.offline(true))
      await page.getByTestId('sync-now').click()
      check(await page.getByText('暂时还没传上去',{exact:true}).isVisible(),
        'Offline retry shows pending, never success')
      await page.getByTestId('logout').click()
      await page.getByTestId('confirm-action').click()
      check(await page.getByText('操作暂未完成',{exact:true}).isVisible(),
        'Server-unconfirmed logout cannot show signed out')
      check(await page.getByTestId('logout').isVisible(),
        'A failed logout retains signed-in account controls')
      await page.evaluate(()=>window.__cuoshiDemo.offline(false))
      await page.getByTestId('sync-now').click()
      check(await page.getByText('已同步',{exact:true}).isVisible(),
        'Client can retry and return to verified state')
      await page.evaluate(()=>window.__cuoshiDemo.conflict(true))
      await page.getByTestId('sync-now').click()
      check(await page.getByText('需要你确认的不同记录',{exact:true}).isVisible(),
        'Divergent remote history clearly pauses cloud sync')
      if(width===390)await page.screenshot({
        path:'/tmp/cuoshi-future-cloud-conflict-390.png',fullPage:true
      })
      await page.evaluate(()=>window.__cuoshiDemo.conflict(false))
      await page.getByTestId('sync-now').click()
      await page.evaluate(()=>window.__cuoshiDemo.unsent(true))
      await page.getByTestId('logout').click()
      await page.getByTestId('confirm-action').click()
      check(await page.getByText('还有记录等待同步',{exact:true}).isVisible(),
        'Unsent local data blocks sign-out')
      await page.evaluate(()=>window.__cuoshiDemo.unsent(false))
      await page.getByTestId('logout').click()
      await page.getByTestId('confirm-action').click()
      check(await page.getByTestId('login').isVisible(),
        'Only server-confirmed logout returns to signed-out UI')
      check((await page.evaluate(()=>window.__cuoshiDemo.snapshot())).sessionActive===false,
        'Sign-out clears fake local session but keeps existing cloud data')
      check(errors.length===0,'No runtime errors: '+errors.join(' | '))
      check(await page.evaluate(()=>document.documentElement.scrollWidth)<=width+1,
        'No horizontal overflow after actions on '+width+'px')
      console.log('PASS cloud UI responsive interactions on '+width+'px')
      await page.close()
    }
    console.log('PASS',total,'isolated Vue cloud settings Chrome assertions')
  }finally{await browser.close();await close()}
})().catch(e=>{console.error('FAIL',e.stack||e);process.exitCode=1;server.close()})
