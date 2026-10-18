'use strict'
const assert = require('node:assert/strict')
const {chromium} = require('playwright-core')
const {startH5TestServer} = require('./h5-built-server.cjs')

;(async () => {
  const server = await startH5TestServer()
  const browser = await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH || (process.platform==='darwin'?'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome':'/usr/bin/google-chrome')})
  try {
    async function newPage() {
      const context = await browser.newContext({viewport:{width:390,height:844},locale:'zh-CN'})
      await context.addInitScript(() => {
        const original = Storage.prototype.setItem
        Storage.prototype.setItem = function(key,value) {
          if (window.__cuoshiDropWrites && (key === 'cuoshi-uni-v1' || key === 'cuoshi-uni-drafts-v1')) return
          return original.call(this,key,value)
        }
      })
      const page = await context.newPage()
      await page.goto(server.url,{waitUntil:'domcontentloaded'})
      await page.locator('.round.primary').waitFor({state:'visible'})
      return {context,page}
    }
    {
      const {context,page}=await newPage()
      await page.evaluate(()=>window.__cuoshiDropWrites=true)
      await page.locator('.round.primary').click()
      await page.getByText(/本机记录保存未能确认/).first().waitFor({timeout:6000})
      assert.equal(await page.evaluate(()=>localStorage.getItem('cuoshi-uni-v1')),null,'Silent count write cannot persist phantom count')
      await page.evaluate(()=>window.__cuoshiDropWrites=false)
      await page.reload({waitUntil:'networkidle'})
      const recorded=await page.evaluate(()=>{
        const text=localStorage.getItem('cuoshi-uni-v1')
        return text?Object.keys(JSON.parse(text).data.days).length:0
      })
      assert.equal(recorded,0,'Reload cannot present unverified count as saved')
      console.log('PASS H5: silently dropped count writes visibly fail and never claim durability')
      await context.close()
    }
    {
      const {context,page}=await newPage()
      await page.evaluate(()=>window.__cuoshiDropWrites=true)
      await page.locator('textarea').first().fill('临时简记不能假报已保存')
      await page.getByText('草稿暂存失败，关闭页面可能丢失。',{exact:false}).waitFor({timeout:6000})
      assert.equal(await page.evaluate(()=>localStorage.getItem('cuoshi-uni-drafts-v1')),null,'Silently dropped draft must not appear persisted')
      console.log('PASS H5: silently dropped draft writes warn before a user leaves')
      await context.close()
    }
  } finally {await browser.close();await server.close()}
})().catch(e=>{console.error(e.stack||e);process.exitCode=1})
