/** Reproducible shipped-code check for remaining DCloud / Vue / Vite advisories.
 * This intentionally does NOT grant a security waiver for the dependency graph.
 * A negative string/asset scan cannot prove absence of exploitability.
 */
import assert from 'node:assert/strict'
import {readFileSync,readdirSync,statSync,writeFileSync,mkdtempSync,rmSync} from 'node:fs'
import {join,resolve,relative} from 'node:path'
import {tmpdir} from 'node:os'
import {resolveConfig} from 'vite'
const project=resolve('.')
const readJson=p=>JSON.parse(readFileSync(resolve(project,p),'utf8'))
const pkg=readJson('package.json'),lock=readJson('package-lock.json')
const frozenDcloud='3.0.0-4080720251210001'
const details={
  status:'requires_manual_security_signoff',
  releaseApproved:false,
  scope:'built H5, legacy WeChat preview, isolated v0.5 WeChat, isolated private Node sources',
  scanned:{},
  advisoriesNotAutomaticallyRemediated:[
    'Vite 5.2.8: known development server issues',
    'DCloud Vue3 pinned 2025 compiler line: other npm advisory ranges'
  ]
}
const check=(condition,why)=>{assert.ok(condition,why);checks++}
let checks=0
const plugin=lock.packages['node_modules/@dcloudio/vite-plugin-uni']
const uniH5=lock.packages['node_modules/@dcloudio/uni-h5']
check(pkg.devDependencies.vite==='5.2.8'&&plugin.version===frozenDcloud&&
 plugin.peerDependencies.vite==='5.2.8',
 'DCloud exact Vite peer contract remains frozen and visible')
check(pkg.dependencies.vue==='3.4.21'&&uniH5.version===frozenDcloud&&
 uniH5.dependencies['@vue/server-renderer']==='3.4.21'&&
 pkg.overrides['@vue/server-renderer']==='3.5.42'&&
 lock.packages['node_modules/@vue/server-renderer'].version==='3.5.42',
 'DCloud dependency metadata stays pinned while installed Vue SSR is patched')
details.scanned.ssr={installed:'3.5.42',declaredByDcloud:'3.4.21',
  clientRuntime:'3.4.21',patchType:'isolated compiler SSR transitive override'}
const cfg=await resolveConfig({configFile:resolve(project,'vite.config.ts')},'serve')
check(cfg.server.host==='127.0.0.1'&&cfg.preview.host==='127.0.0.1'&&
 cfg.server.strictPort===true&&cfg.preview.strictPort===true,
 'Vite development and preview servers are restricted to loopback')
details.scanned.vite={version:pkg.devDependencies.vite,serverHost:cfg.server.host,
 previewHost:cfg.preview.host,upgraded:false}
const targets=[
 {name:'h5',path:'dist/build/h5',type:'web'},
 {name:'v04Wechat',path:'dist/build/mp-weixin',type:'wechat'},
 {name:'v05Wechat',path:'future/.generated-mp/dist/build/mp-weixin',type:'wechat'}
]
const forbiddenFiles=[/(^|\/)\.env(?:\.|$)/i,/\.map$/i,/\.pem$/i,/\.key$/i,
 /(^|\/)(?:package-lock\.json|package\.json|node_modules)(?:\/|$)/i]
const forbiddenSignatures=[
 {id:'vue_ssr_helper_export',re:/\bssrRenderDynamicAttr\b|\bssrRenderAttrs\b/},
 {id:'vite_development_transport',re:/\/@vite\/client|vite\/dist\/client\/client\.mjs/},
 {id:'node_http_build_server',re:/require\(['"](?:vite|express|@vue\/server-renderer)['"]\)/},
 {id:'node_modules_path',re:/node_modules\/(?:vite|express|@vue\/server-renderer)\//}
]
function auditDirectory(folder){
 const files=[]
 function walk(dir){for(const item of readdirSync(dir,{withFileTypes:true})){
   const file=join(dir,item.name)
   if(item.isSymbolicLink())throw Error('release_symlink_forbidden')
   if(item.isDirectory())walk(file)
   else if(item.isFile())files.push(file)
 }}
 walk(folder)
 check(files.length>0,'Nonempty release output: '+folder)
 let bytes=0,jsFiles=0
 for(const file of files){
   const rel=relative(folder,file).replaceAll('\\','/')
   check(!forbiddenFiles.some(pattern=>pattern.test(rel)),
      'No private, sourcemap or dependency manifest in release: '+rel)
   const size=statSync(file).size;bytes+=size
   if(!file.endsWith('.js'))continue
   jsFiles++
   const source=readFileSync(file,'utf8')
   for(const {id,re} of forbiddenSignatures){
     check(!re.test(source),'No '+id+' detected in '+rel)
   }
 }
 check(jsFiles>0,'Compiled JavaScript exists in '+folder)
 return {files:files.length,jsFiles,bytes,
  blockedSignatures:forbiddenSignatures.map(x=>x.id),
  caveat:'Static source-pattern check only; minified code and reachable behavior require separate review'}
}
for(const target of targets){
 const dir=resolve(project,target.path)
 details.scanned[target.name]=auditDirectory(dir)
}
// Independently verify the scan fails on a fixture containing a known risky
// output, rather than relying solely on a green build with benign inputs.
const testDir=mkdtempSync(join(tmpdir(),'cuoshi-framework-negative-'))
try{
 const codeFile=join(testDir,'sample.js')
 writeFileSync(codeFile,'const safe = 1;\n')
 check(auditDirectory(testDir).jsFiles===1,'Clean synthetic JS fixture is permitted')
 writeFileSync(codeFile,'exports.ssrRenderDynamicAttr = function(){};\n')
 assert.throws(()=>auditDirectory(testDir),/vue_ssr_helper_export/);checks++
 writeFileSync(codeFile,'import "/@vite/client";\n')
 assert.throws(()=>auditDirectory(testDir),/vite_development_transport/);checks++
 writeFileSync(codeFile,'require("express");\n')
 assert.throws(()=>auditDirectory(testDir),/node_http_build_server/);checks++
 writeFileSync(codeFile,'const safe = 1;\n')
 writeFileSync(join(testDir,'.env.production'),'PRIVATE_TOKEN=fixture\n')
 assert.throws(()=>auditDirectory(testDir),/No private, sourcemap/);checks++
}finally{rmSync(testDir,{recursive:true,force:true})}
const serverSources=resolve(project,'future/server/src')
const server=readFileSync(resolve(project,'future/server/package.json'),'utf8')
const backendPackage=JSON.parse(server)
check(Object.keys(backendPackage.dependencies).length===1&&backendPackage.dependencies.pg,
 'Isolated production database server declares no DCloud/Vue/Vite/Express runtime libraries')
let serverFiles=0
function walkSources(dir){for(const file of readdirSync(dir,{withFileTypes:true})){
 const path=join(dir,file.name)
 if(file.isDirectory())walkSources(path)
 else if(file.isFile()&&file.name.endsWith('.ts')){
  serverFiles++
  const text=readFileSync(path,'utf8')
  check(!/(?:from\s*|require\s*\()['"](?:vite|express|@vue\/server-renderer|@dcloudio\/)/.test(text),
   'No known-vulnerable frontend/build package imported by production Node source: '+file.name)
 }
}}
walkSources(serverSources)
check(serverFiles>0,'Production Node source files enumerated')
details.scanned.backend={sourceFiles:serverFiles,productionDependencies:Object.keys(backendPackage.dependencies)}
// Release approval remains false even if all static checks pass. These guards
// prevent known regressions; they are not a substitute for advisory triage.
check(details.releaseApproved===false,'Never infer release approval from successful static checks')
if(process.argv[2]){
 const dst=resolve(process.argv[2])
 check(!dst.startsWith(project+'/'),'Report must be written outside source tree')
 details.checksPassed=checks
 writeFileSync(dst,JSON.stringify(details,null,2)+'\n',{flag:'wx',mode:0o600})
}
console.log('PASS '+checks+' framework boundary checks; unresolved upstream advisories remain BLOCKED')
