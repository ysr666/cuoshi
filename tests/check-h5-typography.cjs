const assert = require('node:assert/strict');
const {chromium}=require('playwright-core');
const {startH5TestServer}=require('./h5-built-server.cjs');
(async()=>{
const server=await startH5TestServer();
const b=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
try{
for(const width of [320,390,430]){
const page=await b.newPage({viewport:{width,height:780},locale:'zh-CN'});
const errors=[];page.on('pageerror',e=>errors.push(e.message));
let launched=false;
for(let attempt=0;attempt<3 && !launched;attempt++){
 try {
  await page.goto(server.url,{waitUntil:'domcontentloaded',timeout:12000});
  await page.locator('.counter').waitFor({state:'visible',timeout:6000});
  launched=true;
 } catch(e){
  if(attempt===2)throw new Error('H5 app failed to initialize after 3 tries: '+String(e));
  console.warn(width+'px app bootstrap retry '+(attempt+1)+': '+e.message);
 }
}
let font=async sel=>Math.round(Number(await page.locator(sel).first().evaluate(e=>parseFloat(getComputedStyle(e).fontSize))));
assert.ok(await font('.caption')>=15,'caption too small');
assert.ok(await font('.small-date')>=14,'date too small');
assert.ok(await font('.hint')>=14,'notes hint too small');
assert.ok(await font('.field')>=16,'note input too small');
await page.getByText('日历',{exact:true}).last().click();
await page.locator('.cell.today').waitFor({state:'visible'});
assert.ok(await font('.cell')>=15,'calendar day too small');
assert.ok(await font('.legend')>=13,'legend too small');
await page.getByText('统计',{exact:true}).last().click();await page.locator('.stat-row').waitFor();
assert.ok(await font('.stat-label')>=14,'stats description too small');
await page.getByText('设置',{exact:true}).last().click();await page.locator('.option-title').first().waitFor();
assert.ok(await font('.description')>=14,'settings explanation too small');
assert.ok(await font('.privacy-detail')>=14,'privacy copy too small');
let docWidth=await page.evaluate(()=>document.documentElement.scrollWidth);
assert.ok(docWidth<=width+1,width+' horizontal overflow '+docWidth);
const privacy=page.locator('.privacy-detail');await privacy.scrollIntoViewIfNeeded();
const rect=await privacy.boundingBox();
assert.ok(rect && rect.y+rect.height<=790,'privacy text not scrollable into viewport '+JSON.stringify(rect));
assert.deepEqual(errors,[]);
await page.screenshot({path:'/tmp/cuoshi-type-setting-'+width+'.png'});
console.log('PASS',width,'readable type + scrollable settings / no overflow');
await page.close();
}
}finally{await b.close();await server.close()}
})().catch(e=>{console.error('FAIL',e.stack||e);process.exitCode=1});
