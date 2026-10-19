/** v0.5 cloud-first production-direction demo; real Chrome, fictional data. */
const assert=require('node:assert/strict')
const {createServer}=require('node:http')
const {readFileSync,existsSync}=require('node:fs')
const {join,resolve,extname}=require('node:path')
const {chromium}=require('playwright-core')
const root=resolve('future/preview-dist')
if(!existsSync(join(root,'index.html')))throw Error('Build isolated preview first')
const mime={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8'}
const srv=createServer((req,res)=>{
 const path=join(root,req.url==='/'?'index.html':(req.url||'').replace(/^\//,''))
 if(!path.startsWith(root)||!existsSync(path)){res.writeHead(404);res.end();return}
 res.setHeader('Content-Type',mime[extname(path)]||'application/octet-stream')
 res.end(readFileSync(path))
})
;(async()=>{
 await new Promise(resolve=>srv.listen(0,'127.0.0.1',resolve))
 const browser=await chromium.launch({headless:true,
  executablePath:process.env.CHROME_PATH||(process.platform==='darwin'
   ?'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome':'/usr/bin/google-chrome')})
 let count=0
 const ok=(value,label)=>{assert.ok(value,label);count++}
 try{
  for(const width of [320,390,430]){
   const page=await browser.newPage({viewport:{width,height:844}})
   const errors=[];page.on('pageerror',e=>errors.push(e.message))
   page.setDefaultTimeout(5000)
   await page.goto('http://127.0.0.1:'+srv.address().port,{waitUntil:'networkidle'})
   ok(await page.getByTestId('cloud-status').innerText()==='开始使用错事',
     'First-time clear cloud data notice')
   ok((await page.evaluate(()=>window.__cuoshiDemo.snapshot())).consent===false,
     'No implicit upload before user has seen and accepted first-use notice')
   ok(await page.getByText(/数字、可选简记以及历次修改历史/).isVisible(),
     'First-use notice describes transferred private information')
   ok(await page.getByTestId('accept-cloud').isVisible(),
     'One initial informed consent button')
   ok((await page.getByText('查看本机与云端差异').count())===0,
     'No conflict comparison workflow in cloud-first product')
   await page.getByTestId('accept-cloud').click()
   await page.getByTestId('cloud-status').getByText('已同步').waitFor()
   ok((await page.evaluate(()=>window.__cuoshiDemo.snapshot())).consent,
     'Initial cloud setup grants server consent and shows ready')
   ok((await page.evaluate(()=>window.__cuoshiDemo.snapshot())).submissions===0,
     'Fresh empty account never uploads invented data')
   await page.evaluate(()=>window.__cuoshiDemo.add())
   ok((await page.evaluate(()=>window.__cuoshiDemo.snapshot())).cloudRevision===1,
     'First saved count automatically reaches cloud without second confirmation')
   ok(await page.getByTestId('cloud-status').innerText()==='已同步',
     'UI shows verified cloud success')
   await page.evaluate(()=>window.__cuoshiDemo.offline(true))
   await page.evaluate(()=>window.__cuoshiDemo.add())
   ok(await page.getByTestId('cloud-status').innerText()==='暂未同步',
     'Offline failure produces visible unsynced status')
   ok((await page.evaluate(()=>window.__cuoshiDemo.snapshot())).pending,
     'Offline saved change remains pending')
   ok(await page.getByText(/网络异常，暂未同步/).isVisible(),
     'Offline message is clear and non-alarming')
   if(width===390)await page.screenshot({path:'/tmp/cuoshi-cloud-first-offline-390.png',fullPage:true})
   await page.evaluate(()=>window.__cuoshiDemo.online())
   ok(await page.getByTestId('cloud-status').innerText()==='已同步',
     'Reconnect automatically retries pending edits')
   ok((await page.evaluate(()=>window.__cuoshiDemo.snapshot())).cloudRevision===2,
     'New revision confirmed after connection restored')
   ok((await page.getByTestId('retry-cloud').count())===0,
     'No redundant manual sync action in healthy state')
   if(width===390)await page.screenshot({path:'/tmp/cuoshi-cloud-first-online-390.png',fullPage:true})
   ok(!errors.length,'No Vue runtime errors: '+errors.join(' | '))
   ok(await page.evaluate(()=>document.documentElement.scrollWidth)<=width+1,
     'No viewport overflow at '+width+'px')
   await page.close()
  }
  console.log('PASS',count,'cloud-first mobile Chrome assertions (synthetic account only)')
 }finally{await browser.close();await new Promise(resolve=>srv.close(resolve))}
})().catch(e=>{console.error('FAIL',e.stack||e);process.exitCode=1;srv.close()})
