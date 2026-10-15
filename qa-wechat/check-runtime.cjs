/** Runtime regression. Requires a logged-in WeChat DevTools and an isolated preview directory. */
const assert=require('node:assert/strict')
const fs=require('node:fs')
const automator=require('miniprogram-automator')
const projectPath=process.env.CUOSHI_WECHAT_QA_PROJECT
const cliPath=process.env.WECHAT_DEVTOOLS_CLI || '/Applications/wechatwebdevtools.app/Contents/MacOS/cli'
if(!projectPath || !fs.existsSync(projectPath+'/project.config.json')){
  console.error('Set CUOSHI_WECHAT_QA_PROJECT to an isolated, locally built WeChat preview directory.')
  process.exit(2)
}
async function waitRoute(mp,path){
  for(let i=0;i<16;i++){
    const p=await mp.currentPage()
    if(p?.path===path)return p
    await new Promise(r=>setTimeout(r,300))
  }
  throw Error('Navigation did not reach '+path)
}
;(async()=>{
  const mp=await automator.launch({cliPath,projectPath})
  try{
    let p=await mp.reLaunch('/pages/today/index')
    await p.waitFor(400)
    const brand=await p.$('.brand')
    assert.equal(await brand.text(),'错事')
    console.log('PASS WeChat entry')
    p=await mp.switchTab('/pages/calendar/index')
    await p.waitFor(300)
    assert.equal(await (await p.$('.heading')).text(),'日历')
    const today=await p.$('.cell.today')
    assert.ok(today,'Today cell exists')
    await today.tap()
    const detail=await waitRoute(mp,'pages/detail/index')
    assert.ok(await detail.$('.history-title'),'Date detail includes history')
    console.log('PASS WeChat calendar + detail')
    p=await mp.switchTab('/pages/stats/index')
    await p.waitFor(300)
    assert.equal(await (await p.$('.heading')).text(),'统计')
    console.log('PASS WeChat statistics')
    p=await mp.switchTab('/pages/settings/index')
    await p.waitFor(300)
    assert.equal(await (await p.$('.heading')).text(),'设置')
    const options=await p.$$('.option')
    assert.ok(options.length>=3,'Settings data controls exist')
    const themes=await p.$$('.theme-row')
    assert.equal(themes.length,2,'Two visible theme choices')
    await themes[1].tap()
    await p.waitFor(400)
    const data=await mp.callWxMethod('getStorageSync','cuoshi-uni-v1')
    const record=typeof data==='string'?JSON.parse(data):data
    assert.equal(record.theme,'modern','Theme persisted in WeChat storage')
    p=await mp.reLaunch('/pages/settings/index')
    await p.waitFor(400)
    const restored=await mp.callWxMethod('getStorageSync','cuoshi-uni-v1')
    assert.equal((typeof restored==='string'?JSON.parse(restored):restored).theme,'modern')
    console.log('PASS WeChat settings/theme persistence')
    console.log('PASS WeChat native runtime smoke')
  }finally{await mp.close()}
})().catch(e=>{console.error('FAIL WECHAT RUNTIME',e&&e.stack||e);process.exit(1)})