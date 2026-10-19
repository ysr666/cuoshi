/** Test UI summary helpers with synthetic events, never real user records. */
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import ts from 'typescript'
const src=readFileSync(new URL('./historyView.ts',import.meta.url),'utf8')
const compiled=ts.transpileModule(src,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText
const module={exports:{}}
new Function('module','exports',compiled)(module,module.exports)
const {pastCountChange,localEventTime}=module.exports
const e=(before,after)=>({before,after,targetDate:'2026-10-18'})
const samples=[
 [null,0,'从未记录改为 0 件'],[null,3,'从未记录改为 3 件'],
 [0,2,'增加 2 件（0 → 2）'],[7,2,'减少 5 件（7 → 2）'],
 [3,null,'取消原来的 3 件记录'],[0,null,'取消原来的 0 件记录'],
 [2,2,'仍为 2 件']
]
for(const [before,after,label] of samples)assert.equal(pastCountChange(e(before,after)),label)
const old=process.env.TZ
try{
 process.env.TZ='Asia/Shanghai'
 assert.equal(localEventTime('2026-10-19T00:30:00.000Z'),'2026-10-19 08:30')
 process.env.TZ='America/Los_Angeles'
 assert.equal(localEventTime('2026-10-19T00:30:00.000Z'),'2026-10-18 17:30')
 assert.equal(localEventTime('bad-date'),'时间不可用')
}finally{if(old===undefined)delete process.env.TZ;else process.env.TZ=old}
console.log('PASS',samples.length+3,'native historical count changes and timezone presentation checks')
