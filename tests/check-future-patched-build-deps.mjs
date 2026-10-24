/** Check selective build-ecosystem security patch pins without pretending
 * other open DCloud/Vue advisories are resolved. This is a CI guard for
 * the root install, NOT a declaration that the release is security cleared.
 */
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {readFileSync,readdirSync} from 'node:fs'
import {join,resolve} from 'node:path'
let count=0
const check=(value,name)=>{assert.ok(value,name);count++}
const read=(name)=>JSON.parse(readFileSync(name,'utf8'))
const pkg=read('package.json'),lock=read('package-lock.json')
check(!Object.hasOwn(pkg.dependencies,'@dcloudio/uni-app-plus')&&
 !Object.hasOwn(pkg.dependencies,'vue-i18n')&&!Object.hasOwn(pkg.scripts,'dev:app'),
 'Unused native App and direct i18n dependencies remain out of v0.5 builds')
const patched={
 'ws':{minimum:'8.22.0',parent:'@dcloudio/uni-mp-weixin'},
 'source-map-js':{minimum:'1.2.2'},
 'adm-zip':{minimum:'0.6.1'},
 'postcss':{minimum:'8.5.23',reviewed:'8.5.31'},
 '@babel/core':{minimum:'7.29.6'},
 'jpeg-js':{minimum:'0.4.4'},
 'phin':{minimum:'3.7.1'},
 'postcss-selector-parser':{minimum:'7.1.6'},
 'esbuild':{minimum:'0.25.12'}
}
const nodes=[]
for(const [path,definition] of Object.entries(lock.packages)){
 const marker='node_modules/'
 const position=path.lastIndexOf(marker)
 if(position<0)continue
 const name=path.slice(position+marker.length)
 if(!name)continue
 nodes.push({path,name,version:definition.version})
}
// DCloud pins obsolete Intlify 9.1.9 transitive versions. The compatible
// 9.14.5 line removes vulnerable message-resolver and runtime copies; never
// silently reintroduce old compiler/runtime packages in the lockfile.
const reviewedIntlify=['core-base','message-compiler','message-resolver',
 'runtime','vue-devtools','shared','devtools-if'].map(x=>'@intlify/'+x)
for(const name of reviewedIntlify){
 check(pkg.overrides?.[name]==='9.14.5',
  'Intlify 9.14.5 security pin remains explicit: '+name)
 const copies=nodes.filter(x=>x.name===name)
 check(copies.every(x=>x.version==='9.14.5'),
  'No stale nested Intlify package may enter the build: '+name)
}
check(nodes.some(x=>x.name==='@intlify/core-base'&&x.version==='9.14.5'),
 'Patched Intlify core remains present in DCloud compiler')
check(nodes.some(x=>x.name==='@intlify/message-compiler'&&x.version==='9.14.5'),
 'Patched Intlify message compiler remains present')
check(!nodes.some(x=>x.name.startsWith('@intlify/')&&x.version==='9.1.9'),
 'Known vulnerable DCloud Intlify 9.1.9 tree cannot return')
const semver=(value)=>value.split('.').map(x=>Number(x))
const atLeast=(candidate,min)=>{
 const a=semver(candidate),b=semver(min)
 return a.length===3&&b.length===3&&a.every(Number.isSafeInteger)&&
 (a[0]>b[0]||(a[0]===b[0]&&
 (a[1]>b[1]||(a[1]===b[1]&&a[2]>=b[2]))))
}
for(const [name,policy] of Object.entries(patched)){
 const variants=nodes.filter(x=>x.name===name)
 check(variants.length>=1,'Lockfile resolves expected security-patched library: '+name)
 check(variants.every(x=>atLeast(x.version,policy.minimum)),
  'No vulnerable nested copy of '+name+' may re-enter the build lockfile')
 const version=policy.parent?
  pkg.overrides?.[policy.parent]?.[name]:pkg.overrides?.[name]
 check(version===(policy.reviewed??policy.minimum),
  'Security patch version stays explicitly reviewed: '+name)
}
// The pinned DCloud Vite adapter pulls exact Express 4.20.0, which has
// multiple known transitive DoS/XSS advisories. Our scoped 4.x-only override
// must remain effective in both npm lockfile and clean install; this does not
// relax the separate DCloud/Vite/Vue risk gate or update user-facing features.
check(pkg.overrides?.express==='4.22.3',
 'DCloud legacy builder Express override remains intentionally reviewed')
const verifiedExpress={
 'express':'4.22.3','body-parser':'1.20.9','qs':'6.16.1',
 'cookie':'0.7.2','send':'0.19.2','serve-static':'1.16.3',
 'path-to-regexp':'0.1.13'
}
const fromDcloud=createRequire(resolve('node_modules/@dcloudio/vite-plugin-uni/package.json'))
for(const [name,expected] of Object.entries(verifiedExpress)){
 const variants=nodes.filter(x=>x.name===name)
 check(variants.length>0&&variants.every(x=>x.version===expected),
  'No stale vulnerable nested Express dependency: '+name)
 const actual=fromDcloud(name+'/package.json').version
 check(actual===expected,
  'Real uni plugin resolves checked patched Express tree: '+name)
}
const from=createRequire(resolve('node_modules/@dcloudio/uni-mp-weixin/package.json'))
check(from('ws/package.json').version==='8.22.0',
 'Real DCloud WeChat builder resolves patched WebSocket dependency')
const fromNvue=createRequire(resolve('node_modules/@dcloudio/uni-nvue-styler/package.json'))
check(fromNvue('postcss/package.json').version==='8.5.31',
 'Real DCloud NVue styler resolves patched PostCSS parser')
check(createRequire(resolve('package.json'))('adm-zip/package.json').version==='0.6.1',
 'Real builder resolves patched ZIP parser')
for(const name of ['@babel/core','jpeg-js','phin','postcss-selector-parser','esbuild']){
 check(createRequire(resolve('package.json'))(name+'/package.json').version===patched[name].minimum,
  'Real root installation resolves explicitly reviewed patch: '+name)
}
const viteVersion=read('node_modules/vite/package.json').version
const uniPeer=read('node_modules/@dcloudio/vite-plugin-uni/package.json').peerDependencies.vite
check(viteVersion===uniPeer&&pkg.devDependencies.vite===viteVersion,
 'DCloud plugin exact Vite peer contract preserved (known advisory risk remains)')
check(pkg.dependencies.vue==='3.4.21'&&pkg.dependencies['@dcloudio/uni-mp-weixin']==='3.0.0-4080720251210001',
 'Pinned native Vue/DCloud UI stack not silently changed by scoped patches')
// DCloud H5's client router is incompatible with Vue 3.5.x: isolated upgrade
// causes a runtime read-only `_` assignment before the Today screen mounts.
// Patch only the affected SSR helper and its nested Vue 3.5.42 dependencies.
const patchedSsr='3.5.42'
check(pkg.overrides?.['@vue/server-renderer']===patchedSsr,
 'Dedicated secure Vue SSR patch is explicitly pinned')
const serverRenderer=nodes.filter(x=>x.name==='@vue/server-renderer')
check(serverRenderer.length>0&&serverRenderer.every(x=>x.version===patchedSsr),
 'All installed Vue SSR entry points are patched; no old nested copy')
const fromH5=createRequire(resolve('node_modules/@dcloudio/uni-h5/package.json'))
check(fromH5('@vue/server-renderer/package.json').version===patchedSsr,
 'Actual H5 compiler resolves patched SSR helper')
for(const part of ['compiler-core','compiler-dom','compiler-ssr','reactivity',
 'runtime-core','runtime-dom','shared']){
 const name='@vue/'+part
 const nested=nodes.filter(x=>x.path.startsWith('node_modules/@vue/server-renderer/node_modules/')&&x.name===name)
 check(nested.length===1&&nested[0].version===patchedSsr,
  'Patched SSR gets isolated compatible nested '+name+' without changing client runtime')
}
const clientRuntime=read('node_modules/@vue/runtime-dom/package.json').version
check(clientRuntime==='3.4.21',
 'DCloud client runtime stays on the browser-tested 3.4.21 line')

const output=resolve('future/.generated-mp/dist/build/mp-weixin')
const files=[]
function walk(path){for(const f of readdirSync(path,{withFileTypes:true})){
 const dest=join(path,f.name)
 if(f.isDirectory())walk(dest)
 else if(f.isFile())files.push(dest)
}}
walk(output)
const scripts=files.filter(x=>x.endsWith('.js'))
check(scripts.length>0,'WeChat native build exists for runtime packaging assessment')
for(const path of scripts){
 const source=readFileSync(path,'utf8')
 check(!/(?:node_modules\/(?:ws|adm-zip|source-map-js)|require\(['"](?:ws|adm-zip|source-map-js)['"]\))/.test(source),
  'Node-only patched build tools are not statically referenced in WeChat JS: '+path)
}
check(files.every(x=>!x.endsWith('.map')&&!/\.zip$/i.test(x)),
 'Release WeChat preview contains no source maps or raw ZIP assets')
console.log('PASS',count,'targeted patched build dependencies and native bundle isolation; open advisories still require review')
