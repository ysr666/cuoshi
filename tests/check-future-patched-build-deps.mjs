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
const patched={
 'ws':{minimum:'8.22.0',parent:'@dcloudio/uni-mp-weixin'},
 'source-map-js':{minimum:'1.2.2'},
 'adm-zip':{minimum:'0.6.1'},
 'postcss':{minimum:'8.5.23',reviewed:'8.5.31',parent:'@dcloudio/uni-nvue-styler'}
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
const from=createRequire(resolve('node_modules/@dcloudio/uni-mp-weixin/package.json'))
check(from('ws/package.json').version==='8.22.0',
 'Real DCloud WeChat builder resolves patched WebSocket dependency')
const fromNvue=createRequire(resolve('node_modules/@dcloudio/uni-nvue-styler/package.json'))
check(fromNvue('postcss/package.json').version==='8.5.31',
 'Real DCloud NVue styler resolves patched PostCSS parser')
check(createRequire(resolve('package.json'))('adm-zip/package.json').version==='0.6.1',
 'Real builder resolves patched ZIP parser')
const viteVersion=read('node_modules/vite/package.json').version
const uniPeer=read('node_modules/@dcloudio/vite-plugin-uni/package.json').peerDependencies.vite
check(viteVersion===uniPeer&&pkg.devDependencies.vite===viteVersion,
 'DCloud plugin exact Vite peer contract preserved (known advisory risk remains)')
check(pkg.dependencies.vue==='3.4.21'&&pkg.dependencies['@dcloudio/uni-mp-weixin']==='3.0.0-4080720251210001',
 'Pinned native Vue/DCloud UI stack not silently changed by scoped patches')
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
