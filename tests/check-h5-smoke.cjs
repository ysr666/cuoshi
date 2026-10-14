const { chromium } = require('playwright-core');
(async () => {
 const browser = await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--no-first-run','--no-default-browser-check']});
 const context=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:2,locale:'zh-CN'});
 const page=await context.newPage();
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const response=await page.goto('http://127.0.0.1:4177/',{waitUntil:'networkidle'});
 console.log('HTTP',response?.status(),'URL',page.url(),'TITLE',await page.title());
 console.log('BODY', (await page.locator('body').innerText()).slice(0,1100));
 console.log('buttons',await page.locator('button').allTextContents());
 console.log('textareas',await page.locator('textarea').count());
 console.log('errors',errors);
 await page.screenshot({path:'qa-initial.png',fullPage:true});
 await browser.close();
})().catch(e=>{console.error(e);process.exitCode=1});