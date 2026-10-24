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
   ok(await page.getByText(/仅模拟数据，不会同步云端，请勿输入私人内容/).isVisible(),
     'Public preview explicitly warns against entering private notes')
   ok(await page.locator('meta[name="robots"]').getAttribute('content')==='noindex,nofollow,noarchive',
     'Public preview is marked against crawler indexing')
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
   ok(await page.getByTestId('cloud-today').isVisible(),
     'Real record page appears after single cloud notice')
   ok((await page.getByTestId('count-display').innerText()).trim()==='2',
     'Existing recorded amount rendered through account-specific store')
   await page.getByTestId('plus').click()
   await page.waitForFunction(()=>window.__cuoshiDemo.snapshot().cloudRevision===3)
   ok((await page.getByTestId('count-display').innerText()).trim()==='3',
     'Clicking real plus writes an append-only count and auto uploads')
   await page.getByTestId('minus').click()
   await page.waitForFunction(()=>window.__cuoshiDemo.snapshot().cloudRevision===4)
   ok((await page.getByTestId('count-display').innerText()).trim()==='2',
     'Clicking real minus updates account count and cloud revision')
   await page.getByTestId('count-display').click()
   ok(await page.getByTestId('number-input').isVisible(),
     'Large number opens simple numeric edit dialog')
   await page.getByTestId('number-input').fill('0')
   await page.getByTestId('number-save').click()
   await page.waitForFunction(()=>window.__cuoshiDemo.snapshot().cloudRevision===5)
   ok((await page.getByTestId('count-display').innerText()).trim()==='0',
     'Direct number input saves explicit zero rather than unrecorded')
   const initialNotes=await page.evaluate(()=>window.__cuoshiDemo.account.read().events.length)
   await page.getByTestId('note-draft').fill('仅用于浏览器测试的简记')
   ok((await page.evaluate(()=>window.__cuoshiDemo.account.read().events.length))===initialNotes,
     'Draft remains local and is not an event/upload')
   await page.getByTestId('save-note').click()
   await page.waitForFunction(()=>window.__cuoshiDemo.snapshot().cloudRevision===6)
   ok(await page.getByText('仅用于浏览器测试的简记',{exact:true}).isVisible(),
     'Clicking save writes optional note into actual durable account store')
   await page.getByTestId('edit-note').click()
   await page.getByTestId('edit-note-input').fill('重新看待这件事')
   await page.getByTestId('save-note-edit').click()
   await page.waitForFunction(()=>window.__cuoshiDemo.snapshot().cloudRevision===7)
   ok(await page.getByText('重新看待这件事',{exact:true}).isVisible(),
     'Note edit appears in actual record view')
   ok(await page.getByText('修改简记（保留旧文）',{exact:true}).isVisible(),
     'Visible history includes note edit ledger')
   const oldText=await page.evaluate(()=>window.__cuoshiDemo.account.read().events
      .some(e=>e.type==='note_edit'&&e.oldText==='仅用于浏览器测试的简记'))
   ok(oldText,'Previous note text remains in authoritative event ledger')
   await page.getByTestId('previous-day').click()
   ok(await page.getByTestId('mark-zero').isVisible(),
     'Past date remains truly unrecorded before explicitly recording')
   await page.getByTestId('mark-zero').click()
   await page.waitForFunction(()=>window.__cuoshiDemo.snapshot().cloudRevision===8)
   ok((await page.getByTestId('count-display').innerText()).trim()==='0',
     'Past date explicit zero saved and uploaded with full opDate')
   await page.getByTestId('back-today').click()
   ok(await page.getByTestId('past-change-summary').isVisible(),
     'Today displays modification of past record after backdating')
   if(width===390)await page.screenshot({
     path:'/tmp/cuoshi-cloud-first-real-today-390.png',fullPage:true
   })
   await page.getByTestId('edit-note').click()
   await page.getByTestId('remove-note').click()
   await page.waitForFunction(()=>window.__cuoshiDemo.snapshot().cloudRevision===9)
   ok((await page.getByText('重新看待这件事',{exact:true}).count())===0,
     'Deleting the note removes current text from rendered view')
   ok(await page.getByText('删除简记（保留旧文）',{exact:true}).isVisible(),
     'Deleting note appends a deletion event, retaining prior text')
   ok(await page.evaluate(()=>window.__cuoshiDemo.account.read().events
      .some(e=>e.type==='note_delete'&&e.oldText==='重新看待这件事')),
     'Complete old private note text survives delete in durable history')
   await page.evaluate(()=>window.__cuoshiDemo.offline(true))
   await page.getByTestId('plus').click()
   await page.getByTestId('cloud-status').getByText('暂未同步').waitFor()
   ok((await page.getByTestId('count-display').innerText()).trim()==='1',
     'Offline real plus button saves locally and visibly updates the count')
   ok((await page.evaluate(()=>window.__cuoshiDemo.snapshot())).cloudRevision===9,
     'Offline real page interaction leaves cloud revision unchanged')
   await page.evaluate(()=>window.__cuoshiDemo.online())
   await page.getByTestId('cloud-status').getByText('已同步').waitFor()
   ok((await page.evaluate(()=>window.__cuoshiDemo.snapshot())).cloudRevision===10,
     'Connection restoration syncs offline edit from real page event')
   const eventCount=await page.evaluate(()=>window.__cuoshiDemo.account.read().events.length)
   ok(eventCount>=8,'Real view produces complete count/note/past-date event ledger')
   ok(!errors.length,'No Vue runtime errors: '+errors.join(' | '))
   ok(await page.evaluate(()=>document.documentElement.scrollWidth)<=width+1,
     'No viewport overflow at '+width+'px')
   await page.close()
  }
  console.log('PASS',count,'cloud-first mobile Chrome assertions (synthetic account only)')
 }finally{await browser.close();await new Promise(resolve=>srv.close(resolve))}
})().catch(e=>{console.error('FAIL',e.stack||e);process.exitCode=1;srv.close()})
