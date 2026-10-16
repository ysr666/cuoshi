/** Small, reversible feedback on a quiet record counter. Browser checks at phone widths. */
const assert=require('node:assert/strict');
const {chromium}=require('playwright-core');
const {startH5TestServer}=require('./h5-built-server.cjs');
const chrome=process.env.CHROME_PATH||(process.platform==='darwin'
  ?'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  :'/usr/bin/google-chrome');
const wait=ms=>new Promise(r=>setTimeout(r,ms));

(async()=>{
 const server=await startH5TestServer();
 const browser=await chromium.launch({headless:true,executablePath:chrome});
 try{
  for(const width of [320,390,430]){
   const context=await browser.newContext({viewport:{width,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:1,locale:'zh-CN'});
   const page=await context.newPage();page.setDefaultTimeout(8000);
   const errors=[];page.on('pageerror',e=>errors.push(e.message));
   await page.goto(server.url,{waitUntil:'domcontentloaded'});
   const number=page.locator('.number'),plus=page.locator('.round.primary'),minus=page.locator('.round').first();
   await number.waitFor();
   assert.equal((await number.innerText()).trim(),'—','Initial count is not recorded');
   assert.equal(await minus.getAttribute('disabled'),'true','Decrease starts disabled');
   const before=await number.boundingBox(),controls=await page.locator('.controls').boundingBox(),notesBefore=await page.locator('.notes').boundingBox();
   assert.ok(Math.abs(before.x+before.width/2-width/2)<2,'Count not centered');
   assert.ok(Math.abs(controls.x+controls.width/2-width/2)<2,'Controls not centered');
   const numSize=await number.evaluate(e=>parseFloat(getComputedStyle(e).fontSize));
   const captionSize=await page.locator('.caption').evaluate(e=>parseFloat(getComputedStyle(e).fontSize));
   assert.ok(numSize>=100&&captionSize>=15,'Numeral should remain the visual anchor');

   // Touch button: hold briefly; a soft scale is visible without layout movement.
   const btn=await plus.boundingBox();
   await page.touchscreen.tap(btn.x+btn.width/2,btn.y+btn.height/2);
   assert.equal((await number.innerText()).trim(),'1');
   assert.ok(await number.evaluate(e=>e.classList.contains('settling')),'Successful edit receives a restrained acknowledgement');
   const aria=await number.getAttribute('aria-label');
   assert.ok(aria.includes('1 件'),'Count should be announced accessibly');
   await wait(220);
   const after=await number.boundingBox(),controlsAfter=await page.locator('.controls').boundingBox(),notesAfter=await page.locator('.notes').boundingBox();
   assert.ok(Math.abs(after.x+after.width/2-width/2)<2);
   assert.ok(Math.abs(controlsAfter.y-controls.y)<1,'Feedback must not shift the controls');
   assert.ok(Math.abs(notesAfter.y-notesBefore.y)<1,'Recording must not shift the note input');
   await page.evaluate(()=>window.scrollTo(0,0));
   await page.screenshot({path:'/tmp/cuoshi-feedback-paper-'+width+'.png'});
   const cx=btn.x+btn.width/2,cy=btn.y+btn.height/2;
   await page.mouse.move(cx,cy);
   await page.mouse.down();
   await wait(160);
   const pressedScale=await plus.evaluate(el=>new DOMMatrixReadOnly(getComputedStyle(el).transform).a);
   assert.ok(pressedScale<.98&&pressedScale>.87,'Pressed button must subtly shrink: '+pressedScale);
   await page.mouse.up();
   assert.equal((await number.innerText()).trim(),'2','Pointer click should work after press');

   // Repeated touches are all accounted for, never replaced by an animation.
   for(let i=0;i<5;i++)await plus.tap();
   assert.equal((await number.innerText()).trim(),'7','Quick changes must not drop increments');
   for(let i=0;i<7;i++)await minus.tap();
   assert.equal((await number.innerText()).trim(),'0');
   assert.equal(await minus.getAttribute('disabled'),'true','Explicit zero cannot go negative');
   const idBefore=await number.getAttribute('aria-label');
   await minus.evaluate(el=>el.click());
   assert.equal((await number.innerText()).trim(),'0');
   assert.equal(await number.getAttribute('aria-label'),idBefore);

   // Editing the numeral preserves the old fixed layout and handles the 9999 boundary.
   await number.click();
   await page.locator('.editor').waitFor({state:'visible'});
   await page.locator('.number-input input').fill('9999');
   await page.getByText('保存',{exact:true}).last().click();
   assert.equal((await number.innerText()).trim(),'9999');
   assert.equal(await plus.getAttribute('disabled'),'true','At maximum, plus is disabled');
   const afterMax=await page.locator('.controls').boundingBox();
   assert.ok(Math.abs(afterMax.x+afterMax.width/2-width/2)<2,'Button row shifted');
   await number.evaluate(el=>{el.dataset.noopProbe='same'});
   await number.click();
   await page.locator('.number-input input').fill('9999');
   await page.getByText('保存',{exact:true}).last().click();
   assert.equal((await number.innerText()).trim(),'9999','No-op edit leaves same number');
   assert.equal(await number.getAttribute('data-noop-probe'),'same','No-op must not replay confirmation animation');

   // Theme change must preserve geometry and button feedback.
   await page.getByText('设置',{exact:true}).last().click();
   const options=page.locator('.theme-row');
   await options.last().click();
   await page.getByText('今天',{exact:true}).last().click();
   await number.waitFor();
   assert.equal((await number.innerText()).trim(),'9999');
   assert.equal(await plus.getAttribute('disabled'),'true');
   assert.ok(await page.locator('.screen.modern').count(),'Modern theme remains supported');
   await minus.tap();
   assert.equal((await number.innerText()).trim(),'9998');
   await number.click();
   await page.locator('.number-input input').fill('2');
   await page.getByText('保存',{exact:true}).last().click();
   await wait(250);
   await page.evaluate(()=>window.scrollTo(0,0));
   await page.screenshot({path:'/tmp/cuoshi-feedback-modern-'+width+'.png'});
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth)<=width+1,'Horizontal overflow');
   assert.deepEqual(errors,[]);
   console.log('PASS',width,'visual anchor, touch feedback, repeated changes, 0/max guards, modern theme');
   await context.close();
  }
  const reduced=await browser.newContext({viewport:{width:390,height:844},reducedMotion:'reduce'});
  const page=await reduced.newPage();
  await page.goto(server.url,{waitUntil:'domcontentloaded'});
  await page.locator('.round.primary').click();
  const animation=await page.locator('.number').evaluate(e=>getComputedStyle(e).animationName);
  assert.equal(animation,'none','Reduced motion must suppress number animation');
  await reduced.close();
  console.log('PASS reduced-motion respect');
 }finally {await browser.close();await server.close();}
})().catch(err=>{console.error('FAIL feedback',err.stack||err);process.exitCode=1});
