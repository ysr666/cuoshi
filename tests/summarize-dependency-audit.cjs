#!/usr/bin/env node
'use strict'
// Audit monitoring is NOT a waiver of known vulnerable dependencies.
// On an unreachable advisory service, fail as inconclusive rather than "0 issues".
const fs=require('node:fs')
const assert=require('node:assert/strict')
const baseline=JSON.parse(fs.readFileSync('docs/DEPENDENCY_AUDIT_BASELINE.json','utf8'))
const severities=['critical','high','moderate','low']
function summarize(raw){
  if(!raw||typeof raw!=='object'||raw.error)throw Error('npm_audit_inconclusive')
  const source=raw.metadata?.vulnerabilities
  if(!source||typeof source!=='object')throw Error('npm_audit_inconclusive')
  const counts={}
  for(const key of severities){
    if(!Number.isInteger(source[key])||source[key]<0)throw Error('npm_audit_invalid_counts')
    counts[key]=source[key]
  }
  counts.total=severities.reduce((sum,key)=>sum+counts[key],0)
  const changed={}
  for(const key of severities)changed[key]=counts[key]-baseline.vulnerabilities[key]
  const direct=Object.entries(raw.vulnerabilities||{})
    .filter(([,data])=>data?.isDirect===true)
    .map(([name,data])=>({name,severity:String(data.severity||'unknown')}))
    .sort((a,b)=>a.name.localeCompare(b.name))
  return {
    result:'unresolved_inventory_only',
    observedAt:new Date().toISOString(),
    registry:'https://registry.npmjs.org',
    baseline:baseline.vulnerabilities,
    observed:counts,
    delta:changed,
    directVulnerablePackages:direct,
    newCritical:counts.critical>baseline.vulnerabilities.critical,
    releaseApproved:false
  }
}
function hasUnsafeRuntimeAdvisory(summary){
 return summary?.observed?.high>0||summary?.observed?.critical>0
}
function selfTest(){
  const ok={metadata:{vulnerabilities:{critical:0,high:28,moderate:11,low:6}},
    vulnerabilities:{sample:{isDirect:true,severity:'high'}}}
  const s=summarize(ok)
  assert.equal(s.delta.high,1)
  assert.equal(s.releaseApproved,false)
  assert.equal(s.directVulnerablePackages[0].name,'sample')
  assert.throws(()=>summarize({error:{code:'ENOTFOUND'}}),/inconclusive/)
  assert.throws(()=>summarize({metadata:{vulnerabilities:{critical:0}}}),/invalid_counts/)
  assert.equal(summarize({metadata:{vulnerabilities:{critical:1,high:27,moderate:11,low:6}}}).newCritical,true)
  assert.equal(hasUnsafeRuntimeAdvisory(s),true)
  assert.equal(hasUnsafeRuntimeAdvisory(summarize({metadata:{vulnerabilities:{critical:0,high:0,moderate:1,low:0}}})),false)
  assert.equal(hasUnsafeRuntimeAdvisory(summarize({metadata:{vulnerabilities:{critical:1,high:0,moderate:0,low:0}}})),true)
  console.log('PASS npm SCA parser and fail-closed self-tests')
}
if(process.argv[2]==='--self-test')selfTest()
else{
  const [input,output]=process.argv.slice(2)
  if(!input||!output)throw Error('Expected npm audit JSON input and summary output paths')
  const raw=JSON.parse(fs.readFileSync(input,'utf8'))
  const summary=summarize(raw)
  fs.writeFileSync(output,JSON.stringify(summary,null,2)+'\n')
  console.log('Official npm audit (not release approval):',JSON.stringify(summary.observed))
  console.log('Baseline:',JSON.stringify(summary.baseline))
  console.log('Change:',JSON.stringify(summary.delta))
  if(process.argv[4]==='--enforce-runtime-no-high'&&hasUnsafeRuntimeAdvisory(summary)){
    console.error('::error::Production-root runtime dependency high/critical advisory: release blocked')
    process.exitCode=1
  }
  if(summary.newCritical){
    console.error('::error::NEW CRITICAL npm advisory: investigate and block publication')
    process.exitCode=1
  }else if(severities.some(key=>summary.delta[key]>0)){
    console.log('::warning::Known dependency risks increased; triage before release')
  }
}
