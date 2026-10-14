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
  const storage=new Map();let failWrites=false
  globalThis.uni={
    getStorageSync:(key)=>storage.get(key)??'',
    setStorageSync:(key,value)=>{if(failWrites)throw Error('quota reached');storage.set(key,JSON.parse(JSON.stringify(value)))},
    removeStorageSync:(key)=>storage.delete(key)
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
  store.clearRecords();ok(store.records.value.events.length===0,'clear records')
  ok(store.records.value.theme==='paper','theme remains')
  console.log(`PASS ${checks} simulated platform-storage / conflict / fail-closed checks`)
}finally{rmSync(dir,{recursive:true,force:true})}
