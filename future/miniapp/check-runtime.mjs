/** Actual compiled miniapp runtime must fail closed without cloud origin. */
import assert from 'node:assert/strict'
import {execFileSync} from 'node:child_process'
import {mkdtempSync,mkdirSync,symlinkSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join,resolve} from 'node:path'
import {createRequire} from 'node:module'
const root=resolve('.'),stage=join(root,'future','.generated-mp')
const temp=mkdtempSync(join(tmpdir(),'cuoshi-v05-wechat-runtime-'))
try{
 const out=join(temp,'compiled');mkdirSync(out)
 symlinkSync(join(root,'node_modules'),join(out,'node_modules'),'dir')
 execFileSync(join(root,'node_modules','.bin','tsc'),[
  '--strict','--target','ES2022','--module','CommonJS',
  '--moduleResolution','node','--skipLibCheck','--types','@dcloudio/types',
  '--rootDir',stage,'--outDir',out,
  join(stage,'future','miniapp','runtime.ts')
 ],{cwd:root,stdio:'inherit'})
 const data=new Map()
 const calls={login:0,request:0,random:0}
 globalThis.uni={
  getStorageSync:k=>data.get(k)??'',
  setStorageSync:(k,v)=>{data.set(k,v)},
  removeStorageSync:k=>{data.delete(k)},
  login(){calls.login++;throw Error('No origin, login forbidden')},
  request(){calls.request++;throw Error('No origin, requests forbidden')},
  getRandomValues(){throw Error('Should not access undocumented uni crypto shim')}
 }
 globalThis.wx={
  getRandomValues(){calls.random++;throw Error('No origin, crypto forbidden')}
 }
 const require=createRequire(import.meta.url)
 const runtime=require(join(out,'future','miniapp','runtime.js'))
 let n=0
 const check=(v,m)=>{assert.ok(v,m);n++}
 await runtime.start()
 check(runtime.state.stage==='notice','No network before privacy disclosure')
 check(calls.login===0&&calls.request===0,
   'No wx.login or cloud requests before first-use disclosure')
 await runtime.consent()
 check(runtime.state.stage==='blocked'&&/云服务尚未配置/.test(runtime.state.message),
   'Explicit confirmation still blocks login without configured cloud')
 check(data.get('cuoshi-future-v05-miniapp-disclosure')==='privacy-v1',
   'First-use disclosure decision persists for later legitimate reconnect')
 check(calls.login===0&&calls.request===0&&calls.random===0,
   'No origin -> no identity, HTTP, or random allocations')
 await runtime.start()
 check(runtime.state.stage==='blocked'&&calls.request===0,
   'Repeated retry cannot fabricate or request an unconfigured backend')
 check(runtime.getActions()===null,
   'Without verified remote identity the app never exposes account private data')
 console.log('PASS',n,'actual compiled miniapp runtime disclosure and no-origin safety checks')
}finally{rmSync(temp,{recursive:true,force:true})}
