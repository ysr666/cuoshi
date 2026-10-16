/** Release-facing UI checks: privacy disclosure, safe restore confirmation, local-only backup. */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {chromium}=require('playwright-core');
const {startH5TestServer}=require('./h5-built-server.cjs');
const chrome=process.env.CHROME_PATH||(process.platform==='darwin'?'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome':'/usr/bin/google-chrome');

(async()=>{
  const server=await startH5TestServer();
  const browser=await chromium.launch({headless:true,executablePath:chrome});
  try{
    for(const width of [320,390,430]){
      const context=await browser.newContext({viewport:{width,height:844},locale:'zh-CN',acceptDownloads:true});
      const page=await context.newPage();
      try{
        let pageErrors=[];
        page.on('pageerror',error=>pageErrors.push(error.message));
        await page.goto(server.url,{waitUntil:'domcontentloaded'});
        await page.getByText('或者，记为 0 件').click();
        await page.getByText('设置',{exact:true}).last().click();

        const toggle=page.getByText('隐私与数据说明',{exact:true});
        assert.equal(await page.locator('.privacy-expanded').count(),0);
        await toggle.click();
        await page.locator('.privacy-expanded').waitFor({state:'visible'});
        assert.match(await page.locator('.privacy-expanded').innerText(),/未加密/);
        assert.match(await page.locator('.privacy-expanded').innerText(),/微信聊天/);
        assert.match(await page.locator('.privacy-expanded').innerText(),/不会删除你以前分享/);
        assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth)<=width+1,'Privacy expanded causes overflow');
        if(width===390)await page.screenshot({path:'/tmp/cuoshi-release-privacy-390.png',fullPage:true});
        await toggle.click();
        assert.equal(await page.locator('.privacy-expanded').count(),0);

        // Export a real checksum-protected JSON, then deliberately change the record.
        const downloadEvent=page.waitForEvent('download',{timeout:8000});
        await page.getByText('导出完整备份',{exact:false}).click();
        const file=await downloadEvent;
        const text=fs.readFileSync(await file.path(),'utf8');
        assert.ok(JSON.parse(text).checksumSha256);
        await page.getByText('确定',{exact:true}).last().click();
        await page.getByText('今天',{exact:true}).last().click();
        await page.locator('.round.primary').click();
        assert.equal((await page.locator('.number').innerText()).trim(),'1');
        await page.getByText('设置',{exact:true}).last().click();

        let chooserCount=0;
        page.on('filechooser',()=>chooserCount++);
        let chooserEvent=page.waitForEvent('filechooser');
        await page.getByText('导入备份',{exact:true}).click();
        (await chooserEvent).setFiles({name:'测试备份.json',mimeType:'application/json',buffer:Buffer.from(text)});
        await page.getByText('替换导入',{exact:true}).waitFor();
        // Bypass the native overlay to exercise concurrent callback guard.
        await page.getByText('导入备份',{exact:true}).evaluate(el=>el.click());
        await page.waitForTimeout(150);
        assert.equal(chooserCount,1,'Cannot open a second chooser behind destructive confirmation');
        await page.getByText('取消',{exact:true}).last().click();
        await page.getByText('今天',{exact:true}).last().click();
        assert.equal((await page.locator('.number').innerText()).trim(),'1','Cancel must not alter current record');
        await page.getByText('设置',{exact:true}).last().click();

        chooserEvent=page.waitForEvent('filechooser');
        await page.getByText('导入备份',{exact:true}).click();
        await (await chooserEvent).setFiles({name:'测试备份.json',mimeType:'application/json',buffer:Buffer.from(text)});
        await page.getByText('替换导入',{exact:true}).click();
        await page.getByText('今天',{exact:true}).last().click();
        assert.equal((await page.locator('.number').innerText()).trim(),'0','Confirm restores exact original count');
        assert.deepEqual(pageErrors,[]);
        console.log('PASS release UI '+width+'px privacy/backup/download/cancel/restore/lock');
      }finally{await context.close();}
    }
  }finally{await browser.close();await server.close();}
})().catch(err=>{console.error('FAIL release UI',err.stack||err);process.exitCode=1});
