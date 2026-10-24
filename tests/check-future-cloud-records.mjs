/** Cloud-first page uses real append-only domain actions, account partitions. */
import assert from 'node:assert/strict'
import {execFileSync} from 'node:child_process'
import {mkdtempSync,mkdirSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join,resolve} from 'node:path'
import {createRequire} from 'node:module'
const root=resolve('.'),temp=mkdtempSync(join(tmpdir(),'cuoshi-cloud-record-actions-'))
const require=createRequire(import.meta.url)
let passed=0
const ok=(x,msg)=>{assert.ok(x,msg);passed++}
const fails=(fn,rx)=>{assert.throws(fn,rx);passed++}
try{
 const out=join(temp,'compiled');mkdirSync(out)
 execFileSync(resolve('node_modules/.bin/tsc'),[
   '--strict','--target','ES2022','--module','CommonJS','--moduleResolution','node',
   '--skipLibCheck','--rootDir',root,'--outDir',out,
   'future/cloud/cloudRecordActions.ts','future/cloud/uniAccountRecords.ts'
 ],{cwd:root,stdio:'inherit'})
 const m=require(join(out,'src/core/model.js'))
 const {createUniAccountRecords}=require(join(out,'future/cloud/uniAccountRecords.js'))
 const {createCloudRecordActions}=require(join(out,'future/cloud/cloudRecordActions.js'))
 const ownerId='account0001',deviceId='device0001',otherOwner='account0002'
 const today=m.localDate(),yesterday=m.dateOffset(today,-1)
 const source=new Map()
 let block=false,dropped=false
 const storage={
  getStorageSync:key=>source.get(key)??'',
  setStorageSync(key,value){
   if(block)throw Error('disk_full')
   if(!dropped)source.set(key,JSON.parse(JSON.stringify(value)))
  },
  removeStorageSync:key=>source.delete(key)
 }
 const first=createUniAccountRecords({storage,ownerId,deviceId})
 const second=createUniAccountRecords({storage,ownerId:otherOwner,deviceId})
 let writes=0
 first.onRecordSaved(()=>{writes++})
 const record=createCloudRecordActions({ownerId,storage,store:first})
 const other=createCloudRecordActions({ownerId:otherOwner,storage,store:second})
 ok(record.day(today).count===null,'Fresh day is NOT a recorded zero')
 ok(record.changeCount(today,0,true),'Explicitly record zero')
 ok(record.day(today).count===0,'Explicit recorded zero displayed as 0')
 ok(first.read().events[0].type==='initial','Initial zero creates append-only event')
 ok(record.changeCount(today,0,true)===false,'Unchanged zero does not emit duplicate history')
 ok(writes===1,'No-op count does not call automatic sync')
 ok(record.adjustCount(today,1,true),'Increment count')
 ok(record.day(today).count===1&&writes===2,'Persisted event notifies sync')
 ok(record.adjustCount(today,-1,true),'Decrement count to explicit zero')
 ok(record.adjustCount(today,-1,true)===false,'Cannot decrement zero below zero')
 ok(record.canUndo(today),'Undo available after successful count edit')
 ok(record.reverseCount(today,true),'Undo appends a new event')
 ok(first.read().events.length===4,'Undo never removes earlier history')
 ok(record.day(today).count===1,'Undo correctly restores previous count')
 ok(record.changeCount(yesterday,2),'Past day can be edited')
 ok(record.recentPastChanges(today).length===1,'Past edit appears under today operation history')
 ok(record.day(yesterday).count===2,'Past day counts saved independently')
 record.saveDraft(today,'今天留下一些话')
 ok(record.draft(today)==='今天留下一些话','Account-scoped draft is durable')
 ok(writes===5,'Draft write never triggers cloud sync')
 ok(other.draft(today)===''&&other.day(today).count===null,
   'Other account does not inherit counts or drafts')
 ok(record.addDraftedNote(today,true),'Submitting the draft creates a real note')
 ok(record.draft(today)==='','Successful note commit clears temporary draft')
 const added=record.day(today).notes[0]
 ok(added.text==='今天留下一些话','Note text persisted in real record')
 ok(record.updateNote(today,added.id,'后来有了新的想法'),'Note edit saved')
 ok(first.read().events.at(-1).oldText==='今天留下一些话',
   'Old note content remains in event ledger')
 ok(record.removeNote(today,added.id),'Note deletion applied')
 ok(record.day(today).notes.length===0,'Deleted note absent from current view')
 ok(first.read().events.at(-1).oldText==='后来有了新的想法',
   'Deleted note content remains in event history')
 ok(first.read().events.some(e=>e.type==='note_edit')&&
    first.read().events.some(e=>e.type==='note_delete'),
   'Full add/edit/delete ledger preserved in account store')
 ok(other.read().events.length===0,
   'No private history crossed to another account')
 fails(()=>record.changeCount(today,10000,true),/0 至 9999/)
 fails(()=>record.saveDraft(today,'x'.repeat(301)),/最多 300/)
 fails(()=>record.addNote(m.dateOffset(today,1),'明天的笔记'),/新的一天/)
 fails(()=>record.saveDraft('2020-00-99','无效的日期'),/新的一天/)
 const formerlyToday=m.dateOffset(today,-1)
 const stale=createCloudRecordActions({
   ownerId,storage,store:first,clock:()=>m.dateFrom(today)
 })
 fails(()=>stale.changeCount(formerlyToday,2,true),/新的一天/)
 block=true;const seen=writes,oldCount=record.day(today).count
 fails(()=>record.changeCount(today,5,true),/disk_full/)
 ok(record.day(today).count===oldCount&&writes===seen,
   'Disk failure cannot pretend it saved a count or synced')
 block=false;dropped=true
 fails(()=>record.changeCount(today,6,true),/not_durable/)
 ok(record.day(today).count===oldCount,'Silent dropped disk write detected')
 dropped=false
 block=true
 fails(()=>record.saveDraft(today,'不能保存的草稿'),/disk_full/)
 block=false
 ok(record.draft(today)==='','Draft storage failure preserved old content')
 const reopened=createCloudRecordActions({ownerId,storage,store:
   createUniAccountRecords({storage,ownerId,deviceId})})
 ok(reopened.day(yesterday).count===2&&
    reopened.read().events.length===first.read().events.length,
   'Restart preserves all account events and old-day changes')
 console.log('PASS',passed,'v0.5 account record actions and private draft assertions')
}finally{rmSync(temp,{recursive:true,force:true})}
