/**
 * Never a production administrator server: only a localhost, synthetic-data
 * visual preview. It has no DB adapter, account reader or credential issuer.
 */
import {createServer} from 'node:http'
import {readFile} from 'node:fs/promises'
import {fileURLToPath} from 'node:url'
import {join,dirname} from 'node:path'
import {DEMO_DATA} from './demoData.mjs'
const directory=join(dirname(fileURLToPath(import.meta.url)),'public')
const files=new Map([
  ['/','index.html'],['/styles.css','styles.css'],['/app.js','app.js']
])
const api=new Map(Object.entries(DEMO_DATA).map(([key,value])=>['/api/preview/'+key,value]))
export async function openAdminPreview({port=0,acknowledgement}={}){
  if(acknowledgement!=='SYNTHETIC_ADMIN_PREVIEW_ONLY'||
     !Number.isSafeInteger(port)||port<0||port>65535)
    throw Error('admin_preview_requires_explicit_synthetic_ack')
  const app=createServer({requestTimeout:5000,headersTimeout:5000,maxHeaderSize:4096},async(req,res)=>{
    res.setHeader('X-Content-Type-Options','nosniff')
    res.setHeader('X-Frame-Options','DENY')
    res.setHeader('Referrer-Policy','no-referrer')
    res.setHeader('Cache-Control','no-store, private')
    res.setHeader('Content-Security-Policy',"default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'")
    // No reverse proxy or DNS alias: only open in this computer's browser.
    if(!/^((127\.0\.0\.1)|(localhost))(?:\:\d{1,5})?$/.test(req.headers.host??'')){
      res.writeHead(403);res.end();return
    }
    if(req.method!=='GET'||!req.url||req.url.includes('?')){
      res.writeHead(req.method==='GET'?404:405);res.end();return
    }
    if(api.has(req.url)){
      res.writeHead(200,{'Content-Type':'application/json; charset=utf-8'})
      res.end(JSON.stringify(api.get(req.url)));return
    }
    const file=files.get(req.url)
    if(!file){res.writeHead(404);res.end();return}
    try{
      const data=await readFile(join(directory,file))
      res.writeHead(200,{'Content-Type':file.endsWith('.css')?'text/css; charset=utf-8':
        file.endsWith('.js')?'text/javascript; charset=utf-8':'text/html; charset=utf-8'})
      res.end(data)
    }catch{res.writeHead(503);res.end()}
  })
  await new Promise((resolve,reject)=>{
    app.once('error',reject)
    app.listen(port,'127.0.0.1',resolve)
  })
  const bound=app.address()
  if(!bound||typeof bound!=='object'||bound.address!=='127.0.0.1'){
    app.close();throw Error('admin_preview_loopback_required')
  }
  return {origin:'http://127.0.0.1:'+bound.port,
    close:()=>new Promise((resolve,reject)=>app.close(e=>e?reject(e):resolve())),server:app}
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1]){
  const ack=process.env.CUOSHI_ADMIN_DEMO_ACK
  const desired=process.env.CUOSHI_ADMIN_DEMO_PORT===undefined?4177:Number(process.env.CUOSHI_ADMIN_DEMO_PORT)
  openAdminPreview({port:desired,acknowledgement:ack}).then(({origin})=>{
    process.stdout.write('Cuoshi SYNTHETIC admin preview (no private records): '+origin+'\n')
  }).catch(()=>{process.stderr.write('Admin preview disabled: explicit local synthetic acknowledgement required\n');process.exitCode=1})
}
