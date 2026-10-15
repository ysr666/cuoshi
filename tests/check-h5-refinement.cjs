const assert = require('node:assert/strict');
const { chromium } = require('playwright-core');
const { startH5TestServer } = require('./h5-built-server.cjs');

const chrome = process.env.CHROME_PATH || (process.platform === 'darwin'
  ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  : '/usr/bin/google-chrome');
const dateKey = date => [date.getFullYear(),String(date.getMonth()+1).padStart(2,'0'),String(date.getDate()).padStart(2,'0')].join('-');

(async () => {
  const server = await startH5TestServer();
  const browser = await chromium.launch({headless:true,executablePath:chrome});
  try {
    for (const width of [320,390,430]) {
      const ctx = await browser.newContext({viewport:{width,height:844},locale:'zh-CN'});
      const page = await ctx.newPage();
      const errors=[];
      let stage='load';
      page.on('pageerror', e=>{
        const details={stage,message:e.message,stack:e.stack};
        errors.push(details);
        console.error('BROWSER_PAGEERROR',JSON.stringify(details));
      });
      page.setDefaultTimeout(10000);
      await page.goto(server.url,{waitUntil:'domcontentloaded'});
      await page.locator('.counter').waitFor();

      stage='note-only';
      // Only a note is not the same thing as an explicit zero.
      await page.locator('textarea').first().fill('只留下这段简记');
      await page.getByText('留下',{exact:true}).click();
      await page.getByText('统计',{exact:true}).last().click();
      await page.getByText('这段时间只留下了简记，还没有数字记录。').waitFor();
      assert.equal(await page.locator('.daily-chart').count(),0);
      await page.getByText('今天',{exact:true}).last().click();

      stage='zero';
      // Zero has a baseline marker, but no positive-length daily bar.
      await page.getByText('或者，记为 0 件').click();
      await page.getByText('统计',{exact:true}).last().click();
      await page.locator('.daily-chart').waitFor();
      assert.ok(await page.locator('.daily-bar.zero').count()>=1);
      assert.equal(await page.locator('.daily-bar:not(.zero)').count(),0);
      await page.getByText('本周',{exact:true}).click();
      assert.equal(await page.locator('.daily-group').count(),7);
      await page.getByText('本月',{exact:true}).click();
      assert.ok(await page.locator('.daily-group').count()>=28);
      await page.screenshot({path:'/tmp/cuoshi-refined-stats-'+width+'.png'});
      await page.getByText('今天',{exact:true}).last().click();

      stage='past-edit';
      // A past-date edit appears with its old and new number on Today.
      const yesterday=new Date();
      yesterday.setHours(12,0,0,0);
      yesterday.setDate(yesterday.getDate()-1);
      const key=dateKey(yesterday);
      await page.getByText('日历',{exact:true}).last().click();
      if(yesterday.getMonth()!==new Date().getMonth())await page.locator('.month-control').first().click();
      await page.locator('.cell[aria-label^="'+key+'"]').click();
      await page.locator('.round.primary').click();
      await page.locator('.round.primary').click();
      await page.getByText('返回日历').click();
      await page.getByText('今天',{exact:true}).last().click();
      const past=page.locator('.quiet');
      await past.waitFor({state:'visible'});
      const contents=await past.innerText();
      assert.ok(contents.includes('今天还修改了过去的记录 · 2 次'),contents);
      assert.ok(contents.includes('1 → 2 · 增加 1 件'),contents);
      assert.ok(contents.includes('未记录 → 1'),contents);
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth)<=width+1);
      await page.screenshot({path:'/tmp/cuoshi-refined-today-'+width+'.png'});
      await page.reload({waitUntil:'domcontentloaded'});
      await page.locator('.quiet-change').first().waitFor();

      stage='note-no-op';
      // Unchanged note edit does not claim that an update happened.
      await page.locator('.edit-link').first().click();
      await page.getByText('保存',{exact:true}).last().click();
      assert.equal(await page.locator('.note-actions').count(),0);
      assert.deepEqual(errors,[]);
      console.log('PASS '+width+'px note-only stats, zero, retro edits, reload, no-op edit');
      await ctx.close();
    }
  } finally {
    await browser.close();
    await server.close();
  }
})().catch(e=>{console.error('FAIL refinement',e.stack||e);process.exitCode=1});
