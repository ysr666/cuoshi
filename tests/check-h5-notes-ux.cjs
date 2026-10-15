const assert=require('node:assert/strict')
const {chromium}=require('playwright-core')
const {startH5TestServer}=require('./h5-built-server.cjs')
;(async()=>{
 const server=await startH5TestServer()
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||(process.platform==='darwin'?'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome':'/usr/bin/google-chrome')})
 try {
  for(const width of [320,390]){
   const context=await browser.newContext({viewport:{width,height:812}})
   const page=await context.newPage()
   const input=page.locator('textarea').first()
   let launched=false
   for(let attempt=1;attempt<=3&&!launched;attempt++){
    try{
     await page.goto(server.url,{waitUntil:'domcontentloaded',timeout:12000})
     await input.waitFor({state:'visible',timeout:7000})
     launched=true
    }catch(err){
     if(attempt===3)throw err
     console.warn(width+'px note input bootstrap retry '+attempt)
    }
   }
   assert.ok(parseFloat(await input.evaluate(el=>getComputedStyle(el).fontSize))>=16,'Note font under 16px')
   const submit=page.locator('.save')
   assert.ok(await submit.evaluate(el=>el.classList.contains('inactive')),'Empty submit should look inactive')
   await submit.click()
   assert.equal(await page.locator('.note').count(),0,'Empty submission must not create notes')
   await input.fill('简记验证：文字与 Emoji 🌿')
   assert.equal(await submit.evaluate(el=>el.classList.contains('inactive')),false)
   assert.ok((await page.locator('.foot').innerText()).includes('草稿'),'Draft retention note displayed after typing')
   await submit.click()
   await page.getByText('简记验证：文字与 Emoji 🌿',{exact:true}).waitFor()
   assert.equal(await page.locator('.note').count(),1,'Submitted note shown')
   await page.reload({waitUntil:'networkidle'})
   assert.equal(await page.locator('.note').count(),1,'Note retained after refresh')
   console.log('PASS '+width+'px editable notes, iOS font, empty guard, persistence')
   await context.close()
  }
 }finally{await browser.close();await server.close()}
})().catch(err=>{console.error(err.stack||err);process.exitCode=1})
