/** Real IPv4 HTTP requests against the same pre-connect middleware used by
 * dev and preview. No public bind, cloud secrets, user data or production APIs.
 */
import assert from 'node:assert/strict'
import {createServer,request as httpRequest} from 'node:http'
import {resolveConfig} from 'vite'

const config=await resolveConfig({configFile:'vite.config.ts'},'serve')
assert.equal(config.server.host,'127.0.0.1')
assert.equal(config.preview.host,'127.0.0.1')
assert.equal(config.server.hmr,false,'uni() cannot silently reenable HMR')
assert.equal(config.server.cors,false)
assert.equal(config.preview.cors,false)
assert.equal(config.server.strictPort,true)
assert.equal(config.preview.strictPort,true)
const guard=config.plugins.find(p=>p.name==='cuoshi-loopback-request-guard')
assert.ok(guard,'Loopback Host/Origin guard is installed in Vite')
let passed=8

async function exercise(kind){
 const middleware=[]
 const hook=kind==='preview'?guard.configurePreviewServer:guard.configureServer
 if(typeof hook!=='function')throw Error('vite_loopback_guard_missing_'+kind)
 await hook({middlewares:{use(fn){middleware.push(fn)}}})
 assert.equal(middleware.length,1,'Guard mounted before '+kind+' fallback')
 passed++
 const server=createServer((req,res)=>middleware[0](req,res,()=>{
   res.statusCode=200;res.end('ok')
 }))
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
 const port=server.address().port
 async function request(opts={}){
   // Explicit Host and Origin emulate DNS rebinding and cross-site requests;
   // the TCP connection itself remains strictly loopback.
   const host=Object.prototype.hasOwnProperty.call(opts,'host')?opts.host:`127.0.0.1:${port}`
   const origin=Object.prototype.hasOwnProperty.call(opts,'origin')?opts.origin:undefined
   return await new Promise((resolve,reject)=>{
     const headers={}
     if(host!==null)headers.Host=host
     if(origin!==undefined)headers.Origin=origin
     const x=httpRequest({hostname:'127.0.0.1',port,path:'/',headers,method:'GET'},res=>{
       let body='';res.setEncoding('utf8');res.on('data',c=>body+=c)
       res.on('end',()=>resolve({status:res.statusCode,body,cache:res.headers['cache-control']}))
     });x.on('error',reject);x.end()
   })
 }
 try{
   const accepted=[
     {origin:undefined},
     {host:`127.0.0.1:${port}`,origin:`http://127.0.0.1:${port}`},
     {host:`localhost:${port}`,origin:`http://localhost:${port}`}
   ]
   for(const opts of accepted){const r=await request(opts)
     assert.equal(r.status,200,kind+' rejects same-origin loopback');passed++}
   const blocked=[
     {host:'evil.example'},
     {host:`evil.example:${port}`,origin:`http://evil.example:${port}`},
     {host:`localhost.evil.example:${port}`},
     {host:`127.0.0.2:${port}`},
     {host:`[::1]:${port}`},
     {host:`127.0.0.1:${port}`,origin:'http://evil.example'},
     {host:`127.0.0.1:${port}`,origin:'null'},
     {host:`127.0.0.1:${port}`,origin:'https://127.0.0.1:'+port},
     {host:`127.0.0.1:${port}`,origin:`http://127.0.0.1:${port+1}`},
     {host:`127.0.0.1:${port}`,origin:['http://127.0.0.1:'+port,'http://evil.example']},
     {host:`127.0.0.1:65536`}
   ]
   for(const opts of blocked){const r=await request(opts)
     assert.equal(r.status,403,kind+' accepted unsafe Host/Origin '+JSON.stringify(opts))
     assert.equal(r.cache,'no-store');passed+=2}
 }finally{await new Promise((resolve,reject)=>server.close(e=>e?reject(e):resolve()))}
}
await exercise('dev')
await exercise('preview')
console.log('PASS '+passed+' actual loopback-only HTTP Host/Origin and disabled-HMR checks')
