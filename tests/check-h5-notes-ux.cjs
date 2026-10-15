const assert=require('node:assert/strict')
const {chromium}=require('playwright-core')
;(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'})
 try {
  for(const width of [320,390]){
   const context=await browser.newContext({viewport:{width,height:812}})
   const page=await context.newPage()
   await page.goto(process.env.CUOSHI_H5_URL||'http://127.0.0.1:4177/',{waitUntil:'networkidle'})
   const input=page.locator('textarea').first()
   await input.waitFor({state:'visible'})
   assert.ok(parseFloat(await input.evaluate(el=>getComputedStyle(el).fontSize))>=16,'Note font under 16px')
   const submit=page.locator('.save')
   assert.ok(await submit.evaluate(el=>el.classList.contains('inactive')),'Empty submit should look inactive')
   await submit.click()
   assert.equal(await page.locator('.note').count(),0,'Empty submission must not create notes')
   await input.fill('简记验证：文字与 Emoji 🌿')
   assert.equal(await submit.evaluate(el=>el.classList.contains('inactive')),false)
   assert.ok((await page.locator('.entry-hint').innerText()).includes('300'),'Limit displayed after entering text')
   await submit.click()
   await page.getByText('简记验证：文字与 Emoji 🌿',{exact:true}).waitFor()
   assert.equal(await page.locator('.note').count(),1,'Submitted note shown')
   await page.reload({waitUntil:'networkidle'})
   assert.equal(await page.locator('.note').count(),1,'Note retained after refresh')
   console.log('PASS '+width+'px editable notes, iOS font, empty guard, persistence')
   await context.close()
  }
 }finally{await browser.close()}
})().catch(err=>{console.error(err.stack||err);process.exitCode=1})