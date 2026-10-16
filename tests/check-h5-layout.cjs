const assert=require('node:assert/strict')
const {chromium}=require('playwright-core')
const {startH5TestServer}=require('./h5-built-server.cjs')
;(async()=>{
 const server=await startH5TestServer()
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||(process.platform==='darwin'?'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome':'/usr/bin/google-chrome')})
 try{
  for(const width of [320,390,430]){
   const context=await browser.newContext({viewport:{width,height:700},locale:'zh-CN'})
   const page=await context.newPage()
   const errors=[];page.on('pageerror',e=>errors.push(e.message))
   let started=false, bootstrapError
   for(let attempt=1;attempt<=3 && !started;attempt++){
    try {
     await page.goto(server.url,{waitUntil:'domcontentloaded',timeout:12000})
     await page.locator('.number').waitFor({state:'visible',timeout:6000})
     started=true
    } catch(e){bootstrapError=e; console.warn(width+'px app bootstrap retry '+attempt+': '+e.message)}
   }
   if(!started) throw bootstrapError
   await page.getByText('今天',{exact:true}).first().waitFor()
   assert.equal(await page.locator('.number').textContent(),'—')
   const docWidth=await page.evaluate(()=>document.documentElement.scrollWidth)
   assert.ok(docWidth<=width+1,width+'px horizontal overflow '+docWidth)
   for(const selector of ['.round.primary','.save']){
    const b=await page.locator(selector).boundingBox()
    assert.ok(b && b.width>=43 && b.height>=43,width+'px touch target '+selector+' is '+JSON.stringify(b))
   }
   const header=await page.locator('.header').boundingBox()
   const counter=await page.locator('.counter').boundingBox()
   assert.ok(header && counter && header.y+header.height<=counter.y+3,'counter overlaps header')
   await page.locator('.round.primary').click()
   assert.equal(await page.locator('.number').textContent(),'1')
   await page.getByText('日历',{exact:true}).last().click()
   await page.getByText('日历',{exact:true}).first().waitFor()
   await page.locator('.cell.today').waitFor({state:'visible',timeout:5000})
   await page.getByText('统计',{exact:true}).last().click()
   await page.getByText('统计',{exact:true}).first().waitFor()
   await page.getByText('设置',{exact:true}).last().click()
   await page.getByText('设置',{exact:true}).first().waitFor()
   await page.getByText('现代极简',{exact:true}).click()
   await page.reload({waitUntil:'domcontentloaded'})
   assert.equal(await page.locator('.screen.modern').count(),1)
   assert.deepEqual(errors,[])
   console.log('PASS '+width+'px count / touch / tabs / modern reload')
   await context.close()
  }
 }finally{await browser.close();await server.close()}
})().catch(e=>{console.error('FAIL layout',e.stack||e);process.exitCode=1})
