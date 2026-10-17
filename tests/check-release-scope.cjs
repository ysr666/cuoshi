#!/usr/bin/env node
'use strict'
// Avoid confusing the future cloud backend with an actually release-ready app.
// Running a non-release server test is not evidence of a v0.4 user feature.
const assert=require('node:assert/strict')
const fs=require('node:fs')
const path=require('node:path')
const root=path.resolve(__dirname,'..')
const packageJson=require(path.join(root,'package.json'))
assert(!fs.existsSync(path.join(root,'future')),'Future cloud or backend must not be in v0.4 release source')
assert(Object.keys(packageJson.scripts).every(name=>!name.startsWith('test:future')),
  'Future-cloud tests are not part of isolated release')
for(const file of Object.keys(packageJson.dependencies||{})){
  assert(!/supabase|firebase|wechat-cloud|aliyun|tencentcloud|@aws-sdk|pg$/.test(file),
    'Network/cloud service dependency accidentally included: '+file)
}
const forbidden=[
  /future\/(?:server|cloud)/i,/cloud_read_day/,
  /AuthenticatedCloudService/,/loginWithWechatCode/,
  /cloud_snapshots/,/CLOUD_RESTORE_JOURNAL_KEY/
]
// Source-level release guard: v0.4 has no app-owned cloud, telemetry, or
// background network transfer. WeChat's user-initiated local file-sharing API
// is deliberately NOT blocked. This is not a third-party/runtime network audit.
const outbound=[
  /\b(?:wx|uni)\s*(?:\.\s*(?:request|uploadFile|downloadFile|connectSocket|sendSocketMessage|cloud)\s*\(|\[\s*['"](?:request|uploadFile|downloadFile|connectSocket|sendSocketMessage|cloud)['"]\s*\]\s*\()/,
  /\b(?:fetch|WebSocket|EventSource|XMLHttpRequest)\s*\(/,
  /\bnew\s+(?:WebSocket|EventSource|XMLHttpRequest)\s*\(/,
  /\bnavigator\s*\.\s*sendBeacon\s*\(/
]
for(const example of ['uni.request({})','wx.uploadFile({})','wx["request"]({})',
  'fetch(url)','new WebSocket(url)','navigator.sendBeacon(url,x)']){
  assert(outbound.some(re=>re.test(example)),'Outbound API not detected: '+example)
}
for(const example of ['wx.shareFileMessage({filePath:x})','wx.chooseMessageFile({})','URL.createObjectURL(blob)']){
  assert(!outbound.some(re=>re.test(example)),'False network alert: '+example)
}
let inspected=0
for(const directory of ['src','dist/build/mp-weixin','dist/build/h5']){
  const absolute=path.join(root,directory)
  if(!fs.existsSync(absolute))continue
  const stack=[absolute]
  while(stack.length){
    const dir=stack.pop()
    for(const name of fs.readdirSync(dir)){
      const file=path.join(dir,name),stat=fs.statSync(file)
      if(stat.isDirectory()){stack.push(file);continue}
      if(!/\.(?:js|ts|vue|json|html|css)$/.test(name))continue
      const content=fs.readFileSync(file,'utf8')
      for(const re of forbidden)assert(!re.test(content),
        'Future-only API in release source/build: '+path.relative(root,file)+' ('+re+')')
      if(directory==='src')for(const re of outbound)assert(!re.test(content),
        'App-owned network operation in offline v0.4: '+path.relative(root,file)+' ('+re+')')
      if(directory==='src'&&/src\/(?:pages|core|platform)/.test(file))
        assert(!/https?:\/\/(?:api\.weixin\.qq\.com|[^\s'"<]+\/v1\/backup)/.test(content),
          'Unexpected network API in offline-only release')
      inspected++
    }
  }
}
assert(inspected>=8,'Release source/build unexpectedly small')
console.log('PASS release scope:',inspected,'files inspected; no future backend or cloud adapter packaged')
