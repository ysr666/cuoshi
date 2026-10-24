import assert from 'node:assert/strict'
import {execFileSync} from 'node:child_process'
import {mkdtempSync,mkdirSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join,resolve} from 'node:path'
import {createRequire} from 'node:module'
const root=resolve('.'),temp=mkdtempSync(join(tmpdir(),'cuoshi-conflict-review-'))
const require=createRequire(import.meta.url)
let total=0
const ok=(v,msg)=>{assert.ok(v,msg);total++}
const throws=(f,p)=>{assert.throws(f,p);total++}
const rejects=async(f,p)=>{await assert.rejects(f,p);total++}
try{
 const out=join(temp,'compiled');mkdirSync(out)
 execFileSync(resolve('node_modules/.bin/tsc'),[
   '--strict','--target','ES2022','--module','CommonJS','--moduleResolution','node',
   '--skipLibCheck','--rootDir',root,'--outDir',out,
   'future/cloud/conflictReview.ts','future/cloud/snapshotContract.ts'
 ],{cwd:root,stdio:'inherit'})
 const m=require(join(out,'src/core/model.js'))
 const {sha256}=require(join(out,'src/core/backup.js'))
 const {stableJson}=require(join(out,'future/cloud/stableJson.js'))
 const {previewCloudConflict:preview,inspectCloudConflict:inspect}=
   require(join(out,'future/cloud/conflictReview.js'))
 const owner='account0001',yesterday=m.dateOffset(m.localDate(),-1),
   today=m.localDate(),older=m.dateOffset(m.localDate(),-2)
 const base=m.fresh()
 m.setCount(base,yesterday,0)
 m.appendNote(base,yesterday,'测试私密便签：曾经的错误仅本机可见')
 m.setCount(base,older,2)
 const snapshot=(records,revision=1)=>({
   ownerId:owner,revision,digest:sha256(stableJson(records)),
   records:m.cloneState(records)
 })
 const identical=preview(base,snapshot(base),owner)
 ok(identical.kind==='identical'&&identical.differingDays===0,
   'Identical local and remote snapshot yields no conflicts')
 ok(identical.historyRelation==='identical','Matching history event prefix')
 ok(identical.localDays===2&&identical.cloudDays===2,'Metadata day counts exact')
 ok(identical.localEvents===3&&identical.cloudEvents===3,'All event counts included')
 const localAhead=m.cloneState(base)
 m.setCount(localAhead,today,4)
 const ahead=preview(localAhead,snapshot(base),owner)
 ok(ahead.kind==='different'&&ahead.historyRelation==='local_ahead',
   'Local append-only events recognized without automatically uploading')
 ok(ahead.differingDays===1&&ahead.days[0].kind==='local_only',
   'New local date labeled correctly')
 ok(ahead.days[0].localCount===4&&ahead.days[0].cloudCount===null,
   'Day-level counts are compared without note body exposure')
 const cloudAhead=m.cloneState(base)
 m.appendNote(cloudAhead,today,'云端另一条仅测试文字')
 const behind=preview(base,snapshot(cloudAhead,2),owner)
 ok(behind.historyRelation==='cloud_ahead'&&behind.days[0].kind==='cloud_only',
   'Cloud-only day is visible without silently replacing local')
 const diverged=m.cloneState(base)
 m.setCount(diverged,yesterday,2)
 m.appendNote(diverged,yesterday,'另一段十分私密的内容')
 const branch=m.cloneState(base)
 m.setCount(branch,yesterday,5)
 m.appendNote(branch,yesterday,'绝不在差异提示出现的云端文字')
 const difference=preview(diverged,snapshot(branch,3),owner)
 ok(difference.historyRelation==='diverged'&&difference.kind==='different',
   'Two independently edited histories are not auto-merged')
 ok(difference.days.some(x=>x.date===yesterday&&x.kind==='different'),
   'Same-day count modifications get a day-level difference')
 ok(difference.days.some(x=>x.date===yesterday&&x.notesDiffer),
   'Changed note ledger registered only as a boolean')
 const safe=JSON.stringify(difference)
 ok(!safe.includes('十分私密')&&!safe.includes('云端文字')&&
   !safe.includes('测试私密便签'),'Preview never exposes local or cloud note text')
 ok(!safe.includes('oldText')&&!safe.includes('newText')&&
   !safe.includes('createdAt'),'No private event or note metadata leaked')
 ok(!Object.prototype.hasOwnProperty.call(difference,'records'),
   'Result does not include a nested raw Records copy')
 const unrelated=m.cloneState(base);unrelated.theme='modern'
 const theme=preview(unrelated,snapshot(base),owner)
 ok(theme.kind==='different'&&theme.differingDays===0,
   'Theme-only divergence still reported even without different days')
 const missing=preview(base,null,owner)
 ok(missing.kind==='cloud_missing'&&missing.cloudRevision===null,
   'Cloud missing is distinct from identical empty snapshots')
 ok(missing.cloudEvents===0&&missing.days.length===0,
   'Missing cloud has no invented event differences')
 throws(()=>preview(base,{...snapshot(base),ownerId:'account0002'},owner),
   /wrong_owner/)
 throws(()=>preview(base,{...snapshot(base),digest:'f'.repeat(64)},owner),
   /cloud_integrity/)
 throws(()=>preview(base,{...snapshot(base),revision:0},owner),
   /invalid_cloud/)
 throws(()=>preview(base,snapshot(base),'bad'),/identity_required/)
 throws(()=>preview(base,snapshot(base),owner,0),/invalid_limit/)
 const mass=m.cloneState(base)
 for(let i=3;i<=24;i++){
   m.setCount(mass,m.dateOffset(today,-i),i)
 }
 const limited=preview(mass,snapshot(base),owner,5)
 ok(limited.differingDays===22&&limited.days.length===5&&limited.truncatedDays,
   'Bounded preview shows correct total with explicit truncation')
 ok(limited.days.every(x=>/^\d{4}-\d{2}-\d{2}$/.test(x.date)),
   'Only normalized date keys emitted')
 ok(limited.days[0].date>limited.days.at(-1).date,
   'Newest changed dates listed first')
 const unchanged=await inspect({ownerId:owner,port:{
   readLocal:()=>m.cloneState(localAhead),
   readCloud:async()=>snapshot(base)
 }})
 ok(unchanged.kind==='different'&&unchanged.historyRelation==='local_ahead',
   'Async inspector double-checks complete local snapshot')
 let midflight=0
 const changing=m.cloneState(base)
 await rejects(()=>inspect({ownerId:owner,port:{
   readLocal:()=>m.cloneState(changing),
   readCloud:async()=>{
     midflight++
     m.appendNote(changing,today,'临时操作期间的新记录')
     return snapshot(base)
   }
 }}),/local_changed/)
 ok(midflight===1,'Local modification between reads rejected')
 await rejects(()=>inspect({ownerId:owner,port:{
   readLocal:()=>m.cloneState(base),
   readCloud:async()=>{throw Error('offline')}
 }}),/offline/)
 ok(JSON.stringify(base)===JSON.stringify(snapshot(base).records),
   'Comparison never mutates the caller input')
 console.log('PASS',total,'non-destructive cloud conflict inspection checks (synthetic records)')
}finally{rmSync(temp,{recursive:true,force:true})}
