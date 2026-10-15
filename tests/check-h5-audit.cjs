const assert = require('node:assert/strict');
const {chromium} = require('playwright-core');
const {startH5TestServer} = require('./h5-built-server.cjs');

(async () => {
  const server = await startH5TestServer();
  const browser = await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||(process.platform==='darwin'?'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome':'/usr/bin/google-chrome')});
  const failures=[];
  try {
    // An explicitly recorded zero is not an empty month.
    for (const width of [320,390,430]) {
      const context = await browser.newContext({viewport:{width,height:844},locale:'zh-CN'});
      const page = await context.newPage();
      try {
        await page.goto(server.url,{waitUntil:'domcontentloaded'});
        await page.getByText('或者，记为 0 件').click();
        await page.getByText('统计',{exact:true}).last().click();
        await page.getByText('今年',{exact:true}).click();
        const groups = page.locator('.bar-group');
        assert.equal(await groups.count(),12);
        const current = groups.nth(new Date().getMonth()).locator('.bar');
        const barHeight = await current.evaluate(e=>e.getBoundingClientRect().height);
        assert.ok(barHeight>=1.5, 'Explicit zero missing in annual chart: '+barHeight);
        assert.ok(await current.evaluate(e=>e.classList.contains('zero')),'Explicit zero needs a distinct marker');
        await page.screenshot({path:'/tmp/cuoshi-audit-year-zero-'+width+'.png'});
        console.log('PASS '+width+' annual zero differs from unrecorded');
      } catch (error) {
        failures.push('Annual '+width+': '+error.message);
        console.error('FAIL annual '+width,error.message);
      } finally {await context.close();}
    }

    // Canceling a file chooser must not permanently lock import/export.
    const context = await browser.newContext({viewport:{width:390,height:844},locale:'zh-CN'});
    const page = await context.newPage();
    try {
      await page.goto(server.url,{waitUntil:'domcontentloaded'});
      await page.getByText('设置',{exact:true}).last().click();
      const openImport = ()=>page.locator('.option').filter({hasText:'导入备份'}).click();
      const first = page.waitForEvent('filechooser',{timeout:6000});
      await openImport();
      await first;
      const chooserCount = await page.locator('input[type=file]').count();
      assert.ok(chooserCount>=1,'File input must exist while dialog is open');
      await page.evaluate(()=>document.querySelector('input[type=file]').dispatchEvent(new Event('cancel',{bubbles:true})));
      await page.waitForTimeout(200);
      assert.equal(await page.locator('input[type=file]').count(),0,'Canceled file chooser must be cleaned up');
      const second = page.waitForEvent('filechooser',{timeout:3500});
      await openImport();
      await second;
      console.log('PASS canceled import can open again');
    }catch(error){failures.push('Canceled import: '+error.message);console.error('FAIL canceled import',error.message)}
    finally {await context.close();}

    // Damaged local history must never be exported as an apparently valid empty backup.
    const brokenContext=await browser.newContext({viewport:{width:390,height:844},locale:'zh-CN'});
    const broken=await brokenContext.newPage();
    try{
      await broken.addInitScript(()=>{
        const corrupted={type:'object',data:{
          version:1,theme:'paper',
          days:{'2026-10-15':{count:7,notes:[]}},events:[]
        }};
        localStorage.setItem('cuoshi-uni-v1',JSON.stringify(corrupted));
      });
      await broken.goto(server.url,{waitUntil:'domcontentloaded'});
      await broken.locator('.warning').waitFor();
      await broken.getByText('设置',{exact:true}).last().click();
      let downloads=0;
      broken.on('download',()=>downloads++);
      await broken.getByText('导出完整备份',{exact:false}).click();
      await broken.waitForTimeout(300);
      assert.equal(downloads,0,'Damaged storage must never produce a misleading empty backup');
      console.log('PASS damaged history cannot be exported as an empty backup');
    }catch(error){failures.push('Damaged backup: '+error.message);console.error('FAIL damaged backup',error.message)}
    finally{await brokenContext.close();}

    // The optional-note explanation is meaningful small text, not a disabled control.
    // Preserve the quiet palette while meeting 4.5:1 normal-text contrast in both themes.
    const contrastContext=await browser.newContext({viewport:{width:390,height:844},locale:'zh-CN'});
    const contrastPage=await contrastContext.newPage();
    try{
      await contrastPage.goto(server.url,{waitUntil:'domcontentloaded'});
      async function ratio(){
        return contrastPage.locator('.hint').evaluate(el=>{
          const luminance=css=>{
            const channels=css.match(/\d+(?:\.\d+)?/g).slice(0,3).map(Number).map(v=>{
              const c=v/255;return c<=0.04045?c/12.92:((c+0.055)/1.055)**2.4;
            });
            return channels[0]*0.2126+channels[1]*0.7152+channels[2]*0.0722;
          };
          const foreground=luminance(getComputedStyle(el).color);
          const background=luminance(getComputedStyle(el.closest('.screen')).backgroundColor);
          return (Math.max(foreground,background)+0.05)/(Math.min(foreground,background)+0.05);
        });
      }
      const paperRatio=await ratio();
      assert.ok(paperRatio>=4.5,'Paper-note explanation contrast insufficient: '+paperRatio.toFixed(2));
      await contrastPage.getByText('设置',{exact:true}).last().click();
      await contrastPage.getByText('现代极简',{exact:true}).click();
      await contrastPage.getByText('今天',{exact:true}).last().click();
      await contrastPage.locator('.screen.modern').waitFor();
      const modernRatio=await ratio();
      assert.ok(modernRatio>=4.5,'Modern-note explanation contrast insufficient: '+modernRatio.toFixed(2));
      console.log('PASS optional-note explanation contrast in both themes',paperRatio.toFixed(2),modernRatio.toFixed(2));
    }catch(error){failures.push('Text contrast: '+error.message);console.error('FAIL text contrast',error.message)}
    finally{await contrastContext.close();}

    // Normal data must still export after a safe storage refresh.
    const healthyContext=await browser.newContext({viewport:{width:390,height:844},acceptDownloads:true});
    const healthy=await healthyContext.newPage();
    try{
      await healthy.goto(server.url,{waitUntil:'domcontentloaded'});
      await healthy.getByText('或者，记为 0 件').click();
      await healthy.getByText('设置',{exact:true}).last().click();
      const ready=healthy.waitForEvent('download',{timeout:6000});
      await healthy.getByText('导出完整备份',{exact:false}).click();
      const downloaded=await ready;
      assert.ok(downloaded.suggestedFilename().endsWith('.json'));
      console.log('PASS healthy history still exports normally');
    }catch(error){failures.push('Healthy backup: '+error.message);console.error('FAIL healthy backup',error.message)}
    finally{await healthyContext.close();}
  }finally{await browser.close();await server.close();}
  if(failures.length) throw Error('Audit failures: '+failures.join(' | '));
})().catch(e=>{console.error(e.stack||e);process.exitCode=1});
