/** Simulate actual calendar boundaries; do not rely on wall-clock timing. */
const assert=require('node:assert/strict');
const {chromium}=require('playwright-core');
const {startH5TestServer}=require('./h5-built-server.cjs');
const chrome=process.env.CHROME_PATH||(process.platform==='darwin'?'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome':'/usr/bin/google-chrome');
const at=(date,time)=>new Date(date+'T'+time+'+08:00');
(async()=>{
 const server=await startH5TestServer();
 const browser=await chromium.launch({headless:true,executablePath:chrome});
 const errors=[];
 try{
  async function scenario(start,fn){
    const ctx=await browser.newContext({viewport:{width:390,height:844},timezoneId:'Asia/Shanghai',locale:'zh-CN'});
    const page=await ctx.newPage();
    page.on('pageerror',e=>errors.push(e.message));
    try{
      await page.clock.install({time:at(start,'23:58:00')});
      await page.goto(server.url,{waitUntil:'domcontentloaded'});
      await page.locator('.number').waitFor();
      await fn(page);
    }finally{await ctx.close()}
  }
  const tab=async(page,name)=>page.getByText(name,{exact:true}).last().click();
  await scenario('2026-10-16',async page=>{
    await tab(page,'日历');
    await page.locator('.cell[aria-label^="2026-10-15"]').click();
    await page.locator('.round.primary').click();
    await page.getByText('返回日历').click();
    await tab(page,'今天');
    assert.equal(await page.locator('.quiet-title').count(),1,'Same-day historical edits visible');
    assert.match(await page.locator('.quiet-title').innerText(),/1 次/);
    await page.clock.setFixedTime(at('2026-10-17','00:03:00'));
    await tab(page,'日历');
    await tab(page,'今天');
    assert.match(await page.locator('.small-date').first().innerText(),/10月17日/);
    assert.equal(await page.locator('.quiet-title').count(),0,'Yesterday changes must not be labeled as today');
    console.log('PASS midnight past-edit heading recalculates on return');
  });
  await scenario('2026-10-31',async page=>{
    await tab(page,'日历');
    assert.match(await page.locator('.month-row').innerText(),/2026年\s*10月/);
    await page.clock.setFixedTime(at('2026-11-01','00:02:00'));
    await tab(page,'今天');
    await tab(page,'日历');
    assert.match(await page.locator('.month-row').innerText(),/2026年\s*11月/);
    assert.match(await page.locator('.cell.today').getAttribute('aria-label'),/2026-11-01/);
    console.log('PASS month rollover tracks current month and current day');
  });
  await scenario('2026-10-31',async page=>{
    await tab(page,'日历');
    await page.getByLabel('上个月').click();
    assert.match(await page.locator('.month-row').innerText(),/2026年\s*9月/);
    await page.clock.setFixedTime(at('2026-11-01','00:02:00'));
    await tab(page,'今天');
    await tab(page,'日历');
    assert.match(await page.locator('.month-row').innerText(),/2026年\s*9月/,'Browsing a past month must not unexpectedly jump');
    console.log('PASS intentional historical browsing survives month rollover');
  });
  await scenario('2026-10-18',async page=>{
    await page.getByText('或者，记为 0 件').click();
    await tab(page,'统计');
    await page.getByText('本周',{exact:true}).click();
    assert.equal((await page.locator('.stat-number').nth(1).innerText()).trim(),'1');
    await page.clock.setFixedTime(at('2026-10-19','00:04:00'));
    await tab(page,'今天');
    await tab(page,'统计');
    await page.getByText('本周',{exact:true}).click();
    assert.equal((await page.locator('.stat-number').nth(1).innerText()).trim(),'0','New week should not count previous Sunday');
    console.log('PASS Sunday to Monday weekly statistics refresh');
  });
  await scenario('2026-12-31',async page=>{
    await page.locator('.round.primary').click();
    await tab(page,'统计');
    await page.getByText('今年',{exact:true}).click();
    assert.equal((await page.locator('.stat-number').first().innerText()).trim(),'1');
    await page.clock.setFixedTime(at('2027-01-01','00:01:00'));
    await tab(page,'今天');
    await tab(page,'统计');
    await page.getByText('今年',{exact:true}).click();
    assert.equal((await page.locator('.stat-number').first().innerText()).trim(),'0','New year must not show last year count');
    await tab(page,'日历');
    assert.match(await page.locator('.month-row').innerText(),/2027年\s*1月/);
    console.log('PASS year rollover updates annual summary and calendar');
  });
  await scenario('2026-10-16',async page=>{
    // Keep Today visible. Timers must flip the day without any tab navigation.
    await page.clock.fastForward(5*60*1000);
    assert.match(await page.locator('.small-date').first().innerText(),/10月17日/);
    await page.locator('.round.primary').click();
    const saved=await page.evaluate(()=>JSON.parse(localStorage.getItem('cuoshi-uni-v1')).data);
    assert.deepEqual(Object.keys(saved.days),['2026-10-17']);
    assert.equal(saved.events[0].opDate,'2026-10-17');
    assert.equal(saved.events[0].targetDate,'2026-10-17');
    console.log('PASS continuously visible Today crosses midnight without writing to yesterday');
  });
  await scenario('2026-10-16',async page=>{
    // Simulate an abrupt clock/timezone jump before the midnight timer can fire.
    await page.clock.setFixedTime(at('2026-10-17','00:03:00'));
    assert.match(await page.locator('.small-date').first().innerText(),/10月16日/);
    await page.locator('.round.primary').click();
    assert.equal(await page.evaluate(()=>localStorage.getItem('cuoshi-uni-v1')),null,
      'Stale Today button must not write into the previous date');
    assert.match(await page.locator('.small-date').first().innerText(),/10月17日/);
    await page.locator('.round.primary').click();
    const saved=await page.evaluate(()=>JSON.parse(localStorage.getItem('cuoshi-uni-v1')).data);
    assert.deepEqual(Object.keys(saved.days),['2026-10-17']);
    console.log('PASS stale-date button refuses yesterday and refreshes before retry');
  });
  await scenario('2026-10-16',async page=>{
    await page.locator('textarea').first().fill('午夜前留下的草稿');
    await page.clock.setFixedTime(at('2026-10-17','00:03:00'));
    await page.getByText('留下',{exact:true}).click();
    const saved=await page.evaluate(()=>{
      const raw=localStorage.getItem('cuoshi-uni-v1');
      return raw?JSON.parse(raw).data:null;
    });
    assert.ok(!saved?.days['2026-10-16']?.notes?.length,
      'Stale Today must not append a note to yesterday after a clock jump');
    assert.match(await page.locator('.small-date').first().innerText(),/10月17日/);
    const drafts=await page.evaluate(()=>JSON.parse(localStorage.getItem('cuoshi-uni-drafts-v1')).data);
    assert.equal(drafts['2026-10-16'],'午夜前留下的草稿','Pending text must remain recoverable as yesterday’s draft');
    await tab(page,'日历');
    await page.locator('.cell[aria-label^="2026-10-16"]').click();
    assert.equal(await page.locator('textarea').first().inputValue(),'午夜前留下的草稿');
    await page.getByText('留下',{exact:true}).click();
    await page.locator('.round.primary').click();
    const restored=await page.evaluate(()=>JSON.parse(localStorage.getItem('cuoshi-uni-v1')).data);
    assert.equal(restored.days['2026-10-16'].notes[0].text,'午夜前留下的草稿');
    assert.equal(restored.days['2026-10-16'].count,1);
    assert.ok(restored.events.some(e=>e.targetDate==='2026-10-16'&&e.opDate==='2026-10-17'&&e.type==='note_add'));
    console.log('PASS stale Today defers text safely while deliberate historical editing remains possible');
  });
  await scenario('2026-10-31',async page=>{
    await tab(page,'日历');
    await page.clock.fastForward(5*60*1000);
    assert.match(await page.locator('.month-row').innerText(),/2026年\s*11月/);
    assert.match(await page.locator('.cell.today').getAttribute('aria-label'),/2026-11-01/);
    console.log('PASS continuously visible calendar follows month boundary');
  });
  await scenario('2026-10-18',async page=>{
    await page.getByText('或者，记为 0 件').click();
    await tab(page,'统计');
    await page.getByText('本周',{exact:true}).click();
    await page.clock.fastForward(5*60*1000);
    assert.equal((await page.locator('.stat-number').nth(1).innerText()).trim(),'0');
    console.log('PASS continuously visible statistics follow week boundary');
  });
  await scenario('2026-10-16',async page=>{
    await tab(page,'日历');
    await page.locator('.cell.today').click();
    assert.match(await page.locator('.caption').innerText(),/今天觉得/);
    assert.ok((await page.locator('.date-arrow').last().getAttribute('class')).includes('inactive'));
    await page.clock.fastForward(5*60*1000);
    assert.match(await page.locator('.caption').innerText(),/现在觉得这一天/);
    assert.ok(!(await page.locator('.date-arrow').last().getAttribute('class')).includes('inactive'),
      'Date-detail forward arrow must activate when yesterday becomes editable');
    await page.locator('.date-arrow').last().click();
    assert.match(await page.locator('.detail-date').innerText(),/2026年10月17日/);
    console.log('PASS open date detail relabels today/yesterday and enables next-day arrow');
  });
  // DST-aware local-midnight scheduling: the same behavior in a different timezone.
  {
    const ctx=await browser.newContext({viewport:{width:390,height:844},timezoneId:'America/Los_Angeles',locale:'zh-CN'});
    const page=await ctx.newPage();
    try{
      await page.clock.install({time:new Date('2026-10-31T23:58:00-07:00')});
      await page.goto(server.url,{waitUntil:'domcontentloaded'});
      await page.locator('.number').waitFor();
      await page.clock.fastForward(5*60*1000);
      assert.match(await page.locator('.small-date').first().innerText(),/11月1日/);
      await page.locator('.round.primary').click();
      const saved=await page.evaluate(()=>JSON.parse(localStorage.getItem('cuoshi-uni-v1')).data);
      assert.deepEqual(Object.keys(saved.days),['2026-11-01']);
      console.log('PASS local midnight refresh across Pacific DST transition');
    }finally{await ctx.close()}
  }
  assert.deepEqual(errors,[],'No unhandled cross-midnight browser errors');
 }finally{await browser.close();await server.close()}
})().catch(e=>{console.error('FAIL calendar boundary',e.stack||e);process.exitCode=1});
