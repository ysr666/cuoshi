import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { mkdtempSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const output=mkdtempSync(join(tmpdir(),'cuoshi-core-'))
try {
  execFileSync('tsc',['--target','ES2022','--module','ES2022','--moduleResolution','Bundler','--outDir',output,resolve('src/core/model.ts')],{stdio:'pipe'})
  const model=await import(pathToFileURL(join(output,'model.js')).href+'?v=1')
  const {fresh,validate,setCount,appendNote,dateOffset,dayOf,countsInRange,cloneState,localDate}=model
  const s=fresh(),today=localDate(),yesterday=dateOffset(today,-1),beforeYesterday=dateOffset(today,-2)
  assert.equal(s.version,1)
  assert.equal(dayOf(s,today).count,null)
  assert.equal(setCount(s,today,0),true)
  assert.equal(dayOf(s,today).count,0)
  assert.equal(setCount(s,today,0),false)
  assert.equal(setCount(s,today,1),true)
  assert.equal(setCount(s,today,0),true)
  assert.equal(setCount(s,today,null),true)
  assert.equal(dayOf(s,today).count,null)
  assert.equal(appendNote(s,yesterday,'昨晚想起的事'),true)
  assert.equal(dayOf(s,yesterday).count,null)
  assert.equal(dayOf(s,yesterday).notes.length,1)
  assert.equal(setCount(s,beforeYesterday,5),true)
  assert.equal(setCount(s,beforeYesterday,4),true)
  assert.equal(s.events.at(-1).delta,-1)
  assert.equal(s.events.at(-1).targetDate,beforeYesterday)
  assert.equal(s.events.at(-1).opDate,today)
  assert.deepEqual(countsInRange(s,beforeYesterday,today),{total:4,days:2,withNumber:1})
  const copied=cloneState(s);validate(copied)
  copied.days[beforeYesterday].count=33
  assert.throws(()=>validate(copied),/不一致/)
  assert.throws(()=>setCount(s,today,10000),/9999/)
  assert.throws(()=>setCount(s,dateOffset(today,1),1),/未来/)
  console.log('PASS 16 core assertions (cross-platform business logic)')
} finally {rmSync(output,{recursive:true,force:true})}
