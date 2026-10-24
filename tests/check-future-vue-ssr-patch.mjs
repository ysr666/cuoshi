/** Actual Vue SSR helper regression, not merely npm advisory inventory.
 * The vulnerable H5 SSR helper used to allow CR in dynamic attribute names.
 * Test only the patched Node helper; WeChat does not execute server rendering.
 */
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {resolve} from 'node:path'
const require=createRequire(import.meta.url)
const h5Require=createRequire(resolve('node_modules/@dcloudio/uni-h5/package.json'))
const version=h5Require('@vue/server-renderer/package.json').version
assert.equal(version,'3.5.42','DCloud H5 resolves the reviewed patched SSR implementation')
const {ssrRenderDynamicAttr}=h5Require('@vue/server-renderer')
assert.equal(typeof ssrRenderDynamicAttr,'function')
let checks=2
const reject=['data-x\r onmouseover','data-x\n onerror','data-x\t onclick',
 'data-x>onclick','data-x" onclick']
for(const name of reject){
  assert.equal(ssrRenderDynamicAttr(name,'exploit'),'',
   'Vue SSR must reject unsafe HTML attribute name '+JSON.stringify(name))
  checks++
}
assert.equal(ssrRenderDynamicAttr('data-ok','value'),' data-ok="value"');checks++
assert.equal(h5Require('vue/package.json').version,'3.4.21',
 'Client-facing Vue runtime remains pinned for H5 compatibility');checks++
console.log('PASS '+checks+' actual patched SSR helper and client version compatibility checks')
