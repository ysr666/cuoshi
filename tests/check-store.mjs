import assert from 'node:assert/strict'
import {execFileSync} from 'node:child_process'
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join,resolve} from 'node:path'
import {createRequire} from 'node:module'
const dir=mkdtempSync(join(tmpdir(),'cuoshi-store-'));const req=createRequire(import.meta.url)
let checks=0;const ok=(condition,description)=>{assert.ok(condition,description);checks++}
try{
  const modules=join(dir,'node_modules','vue');mkdirSync(modules,{recursive:true});writeFileSync(join(modules,'index.js'),'exports.ref = initial => ({value:initial});')
  const types=join(dir,'globals.d.ts');writeFileSync(types,"declare module 'vue' { export function ref<T>(initial:T): {value:T} }; declare const uni:any;\n")
  const output=join(dir,'dist')
  execFileSync('tsc',['--target','ES2022','--module','CommonJS','--moduleResolution','node','--skipLibCheck','--outDir',output,resolve('src/core/store.ts'),types],{stdio:'pipe'})
  const storage=new Map();let failWrites=false,failDraftRemoval=false,failDraftOverwrite=false,ignoreDraftClear=false
  globalThis.uni={
    getStorageSync:(key)=>storage.get(key)??'',
    setStorageSync:(key,value)=>{if(failWrites)throw Error('quota reached');if(key==='cuoshi-uni-drafts-v1'&&failDraftOverwrite)throw Error('draft overwrite denied');if(key==='cuoshi-uni-drafts-v1'&&ignoreDraftClear&&Object.keys(value).length===0)return;storage.set(key,JSON.parse(JSON.stringify(value)))},
    removeStorageSync:(key)=>{if(key==='cuoshi-uni-drafts-v1'&&failDraftRemoval)throw Error('draft removal denied');return storage.delete(key)}
  }
  let store=req(join(output,'store.js')),model=req(join(output,'model.js'))
  const date=model.localDate(),past=model.dateOffset(date,-2)
  store.initialize();ok(store.ready.value,'ready');ok(store.records.value.events.length===0,'empty')
  ok(store.changeCount(date,1),'count first');ok(store.changeCount(date,2),'count increment')
  ok(store.canUndo(date),'undo available');ok(store.reverseCount(date),'undo action')
  ok(store.records.value.days[date].count===1,'undo result');ok(store.records.value.events.length===3,'undo event persisted')
  ok(store.addNote(past,'一件过去的事'),'past note');let note=store.day(past).notes[0]
  ok(store.updateNote(past,note.id,'现在不这么想了'),'modify note')
  ok(store.day(past).notes[0].text==='现在不这么想了','new note')
  ok(store.removeNote(past,note.id),'delete note')
  ok(store.day(past).notes.length===0,'removed note')
  ok(store.saveDraft(date,'待写完的文字'),'draft save')
  ok(store.drafts.value[date]==='待写完的文字','draft memory')
  store.removeDraft(date);ok(!store.drafts.value[date],'draft deleted')
  store.saveDraft(date,'private note draft')
  ignoreDraftClear=true
  assert.throws(()=>store.removeDraft(date),/正式简记已保存，但旧草稿没有清理成功/);checks++
  ok(storage.get('cuoshi-uni-drafts-v1')[date]==='private note draft','silent draft-write failure cannot report success')
  ignoreDraftClear=false
  store.removeDraft(date)
  ok(!storage.get('cuoshi-uni-drafts-v1')[date],'recovered single-note draft cleanup verified')
  let next=JSON.parse(JSON.stringify(storage.get('cuoshi-uni-v1')))
  model.setCount(next,date,4)
  storage.set('cuoshi-uni-v1',next)
  assert.throws(()=>store.changeCount(date,5),/另一个页面/);checks++
  ok(store.records.value.days[date].count===4,'stale tab reloaded')
  ok(store.changeCount(date,5),'retry succeeds')
  const oldCount=store.records.value.days[date].count
  failWrites=true
  assert.throws(()=>store.changeCount(date,6),/quota/);checks++
  ok(store.records.value.days[date].count===oldCount,'on disk failure memory unchanged')
  ok(store.storageError.value.includes('保存失败'),'error status')
  assert.throws(()=>store.changeCount(date,7),/保存失败/);checks++
  failWrites=false
  // Import uses a new store instance, representing an app reload without storage loss.
  delete req.cache[req.resolve(join(output,'store.js'))]
  store=req(join(output,'store.js'));store.initialize()
  ok(store.records.value.days[date].count===5,'reload durable')
  const existing=store.records.value
  const replacement=model.fresh();model.setCount(replacement,past,9)
  store.replaceRecords(replacement)
  ok(store.records.value.days[past].count===9,'import replaces')
  ok(store.records.value.days[date]===undefined,'replaced other day')
  const malformed=model.cloneState(replacement);malformed.days[past].count=8
  assert.throws(()=>store.replaceRecords(malformed),/不一致/);checks++
  ok(store.records.value.days[past].count===9,'failed import non-destructive')
  // Import/deletion must not claim that all private data was cleared if a
  // storage adapter fails to remove an unsubmitted draft.
  store.saveDraft(date,'private draft before import')
  failDraftRemoval=true
  store.replaceRecords(replacement)
  ok(Object.keys(storage.get('cuoshi-uni-drafts-v1')||{}).length===0,'failed draft removal falls back to blank overwrite')
  ok(Object.keys(store.drafts.value).length===0,'fallback also clears in-memory draft')
  ok(!store.draftCleanupWarning.value,'successful fallback leaves no false cleanup warning')
  failDraftRemoval=false
  store.saveDraft(date,'private draft that must not silently survive')
  failDraftRemoval=true;failDraftOverwrite=true
  const replacing=model.fresh();model.setCount(replacing,date,3)
  assert.throws(()=>store.replaceRecords(replacing),/主记录已替换.*草稿可能仍在本机/);checks++
  ok(store.records.value.days[date].count===3,'primary replacement completed despite draft cleanup error')
  ok(storage.get('cuoshi-uni-drafts-v1')[date].includes('private draft'),'failed cleanup does not fabricate successful deletion')
  ok(store.draftCleanupWarning.value.includes('未提交草稿可能仍在本机'),'privacy failure is persistently visible in Settings')
  failDraftRemoval=false;failDraftOverwrite=false
  store.clearRecords();ok(store.records.value.events.length===0,'clear records')
  ok(!storage.has('cuoshi-uni-drafts-v1'),'successful retry removes the previously retained private draft')
  ok(!store.draftCleanupWarning.value,'successful retry clears stale privacy warning')
  ok(store.records.value.theme==='paper','theme remains')
  console.log(`PASS ${checks} simulated platform-storage / conflict / fail-closed checks`)
}finally{rmSync(dir,{recursive:true,force:true})}
