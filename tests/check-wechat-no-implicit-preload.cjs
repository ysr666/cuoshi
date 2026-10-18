#!/usr/bin/env node
'use strict'
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const root = path.resolve(__dirname, '..')
const output = path.join(root, 'dist/build/mp-weixin')
const source = path.join(root, 'node_modules/@dcloudio/uni-mp-weixin/dist/uni.mp.esm.js')
assert(fs.existsSync(source), 'Pinned DCloud runtime missing: review upgraded package first')
const vendorSource = fs.readFileSync(source, 'utf8')
assert(vendorSource.includes('wx.preloadAssets') && vendorSource.includes('__UNI_PRELOAD_SHADOW_IMAGE__'),
  'DCloud runtime changed; reassess source-level preload guard')
assert(fs.existsSync(path.join(output, 'app.js')), 'WeChat production build missing')
let jsFiles = 0
function verify(dir) {
  for (const entry of fs.readdirSync(dir, {withFileTypes:true})) {
    const file = path.join(dir, entry.name)
    if (entry.isDirectory()) verify(file)
    else if (entry.name.endsWith('.js')) {
      const data = fs.readFileSync(file, 'utf8')
      assert(!data.includes('shadow-grey.png'), 'Undisclosed DCloud shadow image in compiled app: '+file)
      assert(!data.includes('preloadAssets'), 'Implicit asset prefetch API in compiled app: '+file)
      jsFiles++
    }
  }
}
verify(output)
assert(jsFiles >= 4, 'WeChat build contains unexpectedly few JavaScript files')
console.log('PASS no implicit DCloud CDN shadow preload in', jsFiles, 'WeChat build JS assets')
