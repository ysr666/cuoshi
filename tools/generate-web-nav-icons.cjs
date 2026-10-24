/** Generate tab icons with the original standalone-web SVG paths.
 * Run from repo root: node tools/generate-web-nav-icons.cjs
 */
const fs=require('node:fs');
const path=require('node:path');
const {chromium}=require('playwright-core');
const paths={
  today:'<path d="M3 10.5 12 3l9 7.5V21h-6v-7H9v7H3z"/>',
  calendar:'<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4M17 3v4M3 10h18"/>',
  stats:'<path d="M4 21V13M10 21V8M16 21V3M22 21v-9"/>',
  settings:'<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.05.05-2 2-.05-.05A1.7 1.7 0 0 0 15.9 18.5a1.7 1.7 0 0 0-1.1 1.55V21h-3v-.95a1.7 1.7 0 0 0-1.1-1.55 1.7 1.7 0 0 0-1.84.37l-.05.05-2-2 .05-.05A1.7 1.7 0 0 0 7.2 15a1.7 1.7 0 0 0-1.56-1.05H4.7v-3h.94A1.7 1.7 0 0 0 7.2 9.9a1.7 1.7 0 0 0-.34-1.87l-.05-.05 2-2 .05.05A1.7 1.7 0 0 0 10.7 6.4a1.7 1.7 0 0 0 1.1-1.55V4h3v.85a1.7 1.7 0 0 0 1.1 1.55 1.7 1.7 0 0 0 1.84-.37l.05-.05 2 2-.05.05A1.7 1.7 0 0 0 19.4 9.9a1.7 1.7 0 0 0 1.56 1.05h.94v3h-.94A1.7 1.7 0 0 0 19.4 15z"/>'}
;(async()=>{
  const browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
  const page=await browser.newPage({viewport:{width:81,height:81},deviceScaleFactor:1});
  const root=path.resolve(__dirname,'../src/static/tab');fs.mkdirSync(root,{recursive:true});
  try{
    for(const [name,p] of Object.entries(paths))for(const selected of [false,true]){
      const color=selected?'#292723':'#837d73';
      await page.setContent('<style>html,body{margin:0;padding:0;background:transparent}#icon{width:81px;height:81px;display:flex;justify-content:center;align-items:center}svg{width:72px;height:72px;fill:none;stroke:'+color+';stroke-width:1.65;stroke-linejoin:round;stroke-linecap:round}</style><div id="icon"><svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">'+p+'</svg></div>');
      await page.locator('#icon').screenshot({path:path.join(root,name+(selected?'-active':'')+'.png'),omitBackground:true});
    }
    console.log('Restored the original web SVG navigation icons as 8 native PNGs');
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1});