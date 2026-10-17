/** Isolated native WeChat QA: test populated views, never touch actual user data. */
const assert=require('node:assert/strict');
const path=require('node:path');
const os=require('node:os');
const fs=require('node:fs');
const automator=require('miniprogram-automator');
const projectPath=process.env.CUOSHI_WECHAT_QA_PROJECT;
const cliPath=process.env.WECHAT_DEVTOOLS_CLI||'/Applications/wechatwebdevtools.app/Contents/MacOS/cli';
const KEY='cuoshi-uni-v1';
if(!projectPath||!fs.existsSync(path.join(projectPath,'project.config.json'))||
   !path.resolve(projectPath).endsWith('cuoshi-ui-redesign-wechat-preview')){
  console.error('Use only the isolated cuoshi-ui-redesign-wechat-preview project.');
  process.exit(2);
}
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const localDate=d=>[d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-');
const previousDate=(today,n)=>{const d=new Date(today.getFullYear(),today.getMonth(),today.getDate(),12);d.setDate(d.getDate()-n);return localDate(d);};
const todayDate=new Date(),today=localDate(todayDate);
const yesterday=previousDate(todayDate,1),twoDays=previousDate(todayDate,2),threeDays=previousDate(todayDate,3);
const at=new Date().toISOString();
const timezone=Intl.DateTimeFormat().resolvedOptions().timeZone||'local';
let nextEvent=0;
function event(targetDate,type,before,after,detail={}){
  return {id:'native-qa-'+(++nextEvent),at,opDate:today,timezone,targetDate,type,before,after,
    delta:before===null||after===null?null:after-before,...detail};
}
const fixture={
  version:1,theme:'paper',
  days:{
    [today]:{count:2,notes:[]},
    [yesterday]:{count:2,notes:[]},
    [twoDays]:{count:0,notes:[]},
    [threeDays]:{count:null,notes:[{id:'native-qa-note',text:'测试简记',createdAt:at}]}
  },
  events:[
    event(yesterday,'initial',null,1),
    event(yesterday,'count',1,2),
    event(today,'initial',null,2),
    event(twoDays,'initial',null,0),
    event(threeDays,'note_add',null,null,{noteId:'native-qa-note',oldText:null,newText:'测试简记'})
  ]
};
async function requireElement(page,selector){
  for(let attempt=0;attempt<20;attempt++){
    const el=await page.$(selector);
    if(el)return el;
    await wait(250);
  }
  throw Error('Missing native element '+selector+' on '+page.path);
}
async function main(){
  let mp;
  let tempProject;
  try {
    // Seed an ephemeral COPY of the compiled app before initialize() runs.
    // Automator clears storage when closing a project, so cross-launch injection
    // through setStorageSync is not reliable.
    tempProject=fs.mkdtempSync(path.join(os.tmpdir(),'cuoshi-native-fixture-'));
    fs.cpSync(projectPath,tempProject,{recursive:true});
    const appPath=path.join(tempProject,'app.js');
    const appSource=fs.readFileSync(appPath,'utf8');
    fs.writeFileSync(appPath,"wx.setStorageSync('"+KEY+"',"+JSON.stringify(fixture)+");\n"+appSource);
    mp=await automator.launch({cliPath,projectPath:tempProject});
    let page=await mp.reLaunch('/pages/today/index');
    await page.waitFor(500);
    assert.equal(await (await requireElement(page,'.brand')).text(),'错事');
    const nativeValue=await mp.evaluate(function(){
      const root=getCurrentPages()[0].$vm;
      const c=root.$children[0].$children.find(x=>x.$props&&'caption' in x.$props);
      return c&&c.$scope&&c.$scope.data.b;
    });
    // The older automator SDK cannot descend into uni-app custom components.
    // Inspect the actual rendered native component data using its evaluator.
    assert.equal(String(nativeValue),'2','Native counter rendered fixture');
    const changes=await page.$$('.quiet-change');
    const changeTexts=await Promise.all(changes.map(c=>c.text()));
    assert.ok(changeTexts.some(t=>t.includes('1 → 2')),JSON.stringify(changeTexts));
    await mp.screenshot({path:'/tmp/cuoshi-native-refined-today.png'});
    await mp.pageScrollTo(560);
    await wait(300);
    await mp.screenshot({path:'/tmp/cuoshi-native-refined-history.png'});
    console.log('PASS native Today counter and past-edit summary');

    page=await mp.switchTab('/pages/stats/index');
    await page.waitFor(350);
    assert.ok(await requireElement(page,'.daily-chart'));
    const bars=await page.$$('.daily-bar');
    assert.ok(bars.length>=3,'Native chart has positive and zero days');
    assert.ok(await requireElement(page,'.daily-bar.zero'),'Zero marker visible');
    await mp.screenshot({path:'/tmp/cuoshi-native-refined-stats.png'});
    console.log('PASS native daily distribution and zero baseline');

    page=await mp.switchTab('/pages/calendar/index');
    await page.waitFor(350);
    if(yesterday.slice(0,7)!==today.slice(0,7)){
      await (await requireElement(page,'.month-control')).tap();
      await page.waitFor(250);
    }
    const cells=await page.$$('.cell');
    let yesterdayCell=null;
    for(const cell of cells){
      const label=await cell.attribute('aria-label');
      if(String(label||'').startsWith(yesterday)){yesterdayCell=cell;break;}
    }
    assert.ok(yesterdayCell,'Native calendar previous day present');
    await yesterdayCell.tap();
    for(let i=0;i<12;i++){
      page=await mp.currentPage();
      if(page?.path==='pages/detail/index')break;
      await wait(300);
    }
    assert.equal(page.path,'pages/detail/index');
    await page.waitFor(700);
    assert.ok(await requireElement(page,'.detail-date'),'Native date detail has finished rendering');
    const meta=await requireElement(page,'.event .meta');
    assert.match(String(await meta.text()),/\d{2}:\d{2}/,'Native history includes exact time');
    await mp.screenshot({path:'/tmp/cuoshi-native-refined-detail.png'});
    console.log('PASS native history operation time');
    console.log('PASS native refinement regression');
  } finally {
    if(mp)await mp.close();
    if(tempProject)fs.rmSync(tempProject,{recursive:true,force:true});
  }
}
main().catch(err=>{console.error('FAIL native refinement',err.stack||err);process.exitCode=1});
