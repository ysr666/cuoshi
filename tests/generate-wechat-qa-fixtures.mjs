#!/usr/bin/env node
/**
 * Synthetic chat-file QA fixtures. Never reads production storage or a real
 * user's exported backups. All generated text is obviously fictional.
 */
import assert from 'node:assert/strict'
import {execFileSync} from 'node:child_process'
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join,resolve} from 'node:path'
import {createRequire} from 'node:module'
const args=process.argv.slice(2)
const large=args.includes('--oversized')
const outDir=resolve(args.find(x=>!x.startsWith('--'))||'qa-output')
const tmp=mkdtempSync(join(tmpdir(),'cuoshi-wechat-fixture-'))
try {
  const compiled=join(tmp,'js')
  mkdirSync(compiled)
  execFileSync('tsc',['--target','ES2022','--module','CommonJS','--moduleResolution','node','--skipLibCheck','--outDir',compiled,resolve('src/core/model.ts'),resolve('src/core/backup.ts')],{stdio:'pipe'})
  const req=createRequire(import.meta.url)
  const m=req(join(compiled,'model.js')),b=req(join(compiled,'backup.js'))
  const today=m.localDate(),yesterday=m.dateOffset(today,-1)
  const state=m.fresh()
  m.setCount(state,today,2)
  m.appendNote(state,today,'测试简记 A：今天仍在学习')
  m.editNote(state,today,state.days[today].notes[0].id,'测试简记 A：重新理解')
  m.setCount(state,yesterday,0)
  m.appendNote(state,yesterday,'测试简记 B：零也是记录')
  m.validate(state)
  assert.equal(state.events.length,5)
  const valid=b.exportBackup(state)
  assert.equal(b.parseBackup(valid).events.length,5)
  const tampered=JSON.parse(valid)
  tampered.days[today].notes[0].text='测试简记 A：被故意篡改且校验和未更新'
  const invalid=JSON.stringify(tampered,null,2)
  assert.throws(()=>b.parseBackup(invalid),/备份校验失败/)
  mkdirSync(outDir,{recursive:true})
  writeFileSync(join(outDir,'错事_真机验收_有效模拟备份.json'),valid,'utf8')
  writeFileSync(join(outDir,'错事_真机验收_篡改应拒绝.json'),invalid,'utf8')
  if(large){
    // Valid JSON, but intentionally larger than the UI's 15 MiB file limit.
    // Do not add this binary-sized QA fixture to Git or CI artifacts.
    const oversized=JSON.stringify({...JSON.parse(valid),qaOnlyPadding:'x'.repeat(15*1024*1024)},null,2)
    assert.ok(Buffer.byteLength(oversized,'utf8')>15*1024*1024)
    writeFileSync(join(outDir,'错事_真机验收_超过15MB应拒绝.json'),oversized,'utf8')
  }
  console.log('Synthetic QA fixtures generated in:',outDir)
  console.log('Dates:',today,'and',yesterday,'; count 2 and explicit 0; 5 historical events')
  console.log('Files: valid backup, checksum-tampered backup'+(large?', oversized JSON':''))
  console.log('Use only with an empty dedicated test mini-program; no user data is read.')
} finally {
  rmSync(tmp,{recursive:true,force:true})
}
