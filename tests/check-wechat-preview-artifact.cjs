#!/usr/bin/env node
'use strict'
const fs=require('node:fs')
const path=require('node:path')
const assert=require('node:assert/strict')
const root=path.resolve('dist/build/mp-weixin')
assert(fs.existsSync(root),'WeChat build is missing')
assert(fs.statSync(root).isDirectory(),'Expected WeChat build directory')
assert(fs.existsSync(path.join(root,'app.js')),'Compiled WeChat app.js missing')
assert(fs.existsSync(path.join(root,'app.json')),'Compiled WeChat app.json missing')
let inspected=0
const banned=/(^|[\\/])(\.env(?:\.|$)|\.npmrc$|\.git(?:[\\/]|$)|credentials?\.|service.account|private.key|id_rsa|\.DS_Store$)/i
function walk(folder){
 for(const name of fs.readdirSync(folder)){
  const full=path.join(folder,name)
  const rel=path.relative(root,full)
  assert(!banned.test(rel),'Sensitive project file in WeChat artifact: '+rel)
  assert(!/\.(?:pem|p12|pfx|key|sqlite|db|bak|jsonl|log)$/i.test(name),
    'Unexpected secret/database/log artifact: '+rel)
  const stat=fs.statSync(full)
  if(stat.isDirectory())walk(full)
  else {
    assert(stat.size<30*1024*1024,'Unexpectedly large WeChat asset: '+rel)
    inspected++
  }
 }
}
walk(root)
assert(inspected>=5,'WeChat compiled asset list unexpectedly short')
console.log('PASS WeChat preview package file hygiene:',inspected,'build files; no private fixtures')
