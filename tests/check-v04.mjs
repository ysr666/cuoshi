import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import {execFileSync} from 'node:child_process'
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join,resolve} from 'node:path'
import {createRequire} from 'node:module'
const dir=mkdtempSync(join(tmpdir(),'cuoshi-v04-'))
const require=createRequire(import.meta.url)
let checks=0
const check=(x,why)=>{assert.ok(x,why);checks++}
try{
  const out=join(dir,'js');mkdirSync(out)
  execFileSync('tsc',['--target','ES2022','--module','CommonJS','--moduleResolution','node','--skipLibCheck','--outDir',out,resolve('src/core/model.ts'),resolve('src/core/backup.ts')],{stdio:'pipe'})
  const m=require(join(out,'model.js')),b=require(join(out,'backup.js'))
  const date=m.localDate(),yesterday=m.dateOffset(date,-1),before=m.dateOffset(date,-2)
  const state=m.fresh()
  check(state.version===1,'version')
  check(m.dayOf(state,date).count===null,'unrecorded != 0')
  check(m.setCount(state,date,0),'zero is explicit')
  check(state.days[date].count===0,'zero persisted')
  check(!m.setCount(state,date,0),'duplicate no change')
  check(m.setCount(state,date,3),'change count')
  check(m.undoCount(state,date,3,0),'undo')
  check(state.events.length===3,'undo adds history')
  check(m.setCount(state,date,null),'withdraw record')
  check(state.days[date].count===null,'withdraw not 0')
  check(m.appendNote(state,yesterday,'  其实也没什么  '),'notes only')
  check(state.days[yesterday].count===null,'notes distinct')
  const note=state.days[yesterday].notes[0]
  check(note.text==='其实也没什么','trim')
  check(m.editNote(state,yesterday,note.id,'  重新看待  '),'edit note')
  check(state.days[yesterday].notes[0].text==='重新看待','edited note')
  check(state.events.at(-1).oldText==='其实也没什么','old note in history')
  check(m.deleteNote(state,yesterday,note.id),'delete note')
  check(state.days[yesterday].notes.length===0,'no current notes')
  check(state.events.at(-1).oldText==='重新看待','deleted text in history')
  check(m.setCount(state,before,5),'past count')
  check(m.setCount(state,before,4),'past reinterpretation')
  check(m.countsInRange(state,before,date).total===4,'current sum')
  check(m.countsInRange(state,before,date).days===1,'withdrawn and deleted not count')
  check(m.monthlySeries(state,m.dateFrom(before).getFullYear()).reduce((n,x)=>n+x.value,0)>=4,'month data')
  m.validate(state);checks++
  check(state.events.at(-1).opDate===date,'operation date')
  const encoded=b.exportBackup(state),imported=b.parseBackup(encoded)
  check(imported.events.length===state.events.length,'backup roundtrip')
  check(encoded.includes('checksumSha256'),'checksum present')
  check(encoded.includes('backupFormat'),'v2 backup format')
  check(b.sha256('abc')===crypto.createHash('sha256').update('abc').digest('hex'),'sha simple')
  for(const s of ['错了就错了。','🙂🙃😀!\\/','\n中文汉字'+'a'.repeat(1000),'你好🌍'.repeat(10000),'']){
    check(b.sha256(s)===crypto.createHash('sha256').update(s).digest('hex'),'sha unicode')
  }
  check(b.sha256(b.canonical(state))===crypto.createHash('sha256').update(b.canonical(state)).digest('hex'),'canonical sha compat')
  const corrupted=JSON.parse(encoded);corrupted.days[before].count=77
  assert.throws(()=>b.parseBackup(JSON.stringify(corrupted)),/不一致/);checks++
  corrupted.days[before].count=4;corrupted.days[before].notes.push({id:'fake',text:'tamper',createdAt:new Date().toISOString()})
  assert.throws(()=>b.parseBackup(JSON.stringify(corrupted)),/校验失败/);checks++
  const old=JSON.parse(encoded);delete old.backupFormat;delete old.checksumSha256
  check(b.parseBackup(JSON.stringify(old)).version===1,'legacy plain import')
  assert.throws(()=>b.parseBackup(JSON.stringify({encryptedFormat:1})),/加密备份/);checks++
  const invalid=m.cloneState(state);invalid.events.at(-1).delta=99
  assert.throws(()=>m.validate(invalid),/变化量/);checks++
  const duplicated=m.cloneState(state);duplicated.events.push(duplicated.events.at(-1))
  assert.throws(()=>m.validate(duplicated),/事件数据/);checks++
  assert.throws(()=>m.undoCount(state,before,99,0),/无法撤销/);checks++
  assert.throws(()=>m.editNote(state,yesterday,note.id,''),/删除/);checks++
  assert.throws(()=>m.setCount(state,m.dateOffset(date,1),1),/未来/);checks++
  assert.throws(()=>m.setCount(state,date,10000),/9999/);checks++
  check(state.events.every(e=>e.id&&e.at&&e.opDate&&e.timezone),'event metadata')
  // Wire format from existing HTML backups must be byte-for-byte canonical before hashing.
  check(b.canonical(state)===JSON.stringify({version:1,theme:state.theme,days:state.days,events:state.events}),'canonical format')
  console.log(`PASS ${checks} cross-platform model / JSON backup / integrity assertions`)
}finally{rmSync(dir,{recursive:true,force:true})}
