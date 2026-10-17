#!/usr/bin/env node
'use strict'
// An advisory inventory is NOT a release waiver. A shrinking overall count can
// hide a newly introduced vulnerability; compare identities, not counts alone.
const fs=require('node:fs')
const assert=require('node:assert/strict')
const baseline=JSON.parse(fs.readFileSync('docs/DEPENDENCY_AUDIT_BASELINE.json','utf8'))
const severities=['critical','high','moderate','low']
const levels={low:1,moderate:2,high:3,critical:4}
function summarize(raw){
  if(!raw||typeof raw!=='object'||raw.error)throw Error('npm_audit_inconclusive')
  const source=raw.metadata?.vulnerabilities
  const inventory=raw.vulnerabilities
  if(!source||typeof source!=='object'||!inventory||typeof inventory!=='object'||Array.isArray(inventory))throw Error('npm_audit_inconclusive')
  const counts={}
  for(const key of severities){
    if(!Number.isInteger(source[key])||source[key]<0)throw Error('npm_audit_invalid_counts')
    counts[key]=source[key]
  }
  counts.total=severities.reduce((sum,key)=>sum+counts[key],0)
  if(source.total!==undefined&&source.total!==counts.total)throw Error('npm_audit_invalid_counts')
  const packages=Object.keys(inventory).sort()
  if(packages.length!==counts.total)throw Error('npm_audit_mismatched_inventory')
  const reconstructed=Object.fromEntries(severities.map(key=>[key,0]))
  const advisoryUrls=new Set()
  const direct=[]
  for(const name of packages){
    const entry=inventory[name]
    if(!entry||typeof entry!=='object'||!(entry.severity in levels)||!Array.isArray(entry.via))throw Error('npm_audit_invalid_inventory')
    reconstructed[entry.severity]++
    if(entry.isDirect===true)direct.push({name,severity:entry.severity})
    for(const via of entry.via){
      if(typeof via==='string')continue // propagated dependency; direct advisory recorded at its source
      if(!via||typeof via.url!=='string'||!/^https:\/\//.test(via.url))throw Error('npm_audit_invalid_advisory')
      advisoryUrls.add(via.url)
    }
  }
  for(const key of severities)if(reconstructed[key]!==counts[key])throw Error('npm_audit_mismatched_inventory')
  if(counts.total>0&&!advisoryUrls.size)throw Error('npm_audit_missing_advisories')
  if(!baseline.knownAffectedPackages||!Array.isArray(baseline.knownDirectAdvisoryUrls))throw Error('npm_audit_baseline_missing')
  const known=new Set(baseline.knownDirectAdvisoryUrls)
  const current=[...advisoryUrls].sort()
  const newlyAffectedPackages=packages.filter(name=>!Object.hasOwn(baseline.knownAffectedPackages,name))
  const newAdvisories=current.filter(url=>!known.has(url))
  const severityEscalations=packages.filter(name=>Object.hasOwn(baseline.knownAffectedPackages,name)
    && levels[inventory[name].severity]>levels[baseline.knownAffectedPackages[name]])
    .map(name=>({name,was:baseline.knownAffectedPackages[name],now:inventory[name].severity}))
  const changed={}
  for(const key of severities)changed[key]=counts[key]-baseline.vulnerabilities[key]
  const newCritical=counts.critical>baseline.vulnerabilities.critical
  const newHigh=counts.high>baseline.vulnerabilities.high
  return {
    result:'unresolved_inventory_only',
    observedAt:new Date().toISOString(),
    registry:'https://registry.npmjs.org',
    baseline:baseline.vulnerabilities,
    observed:counts,
    delta:changed,
    directVulnerablePackages:direct,
    directAdvisoryUrls:current,
    newAdvisories,
    newlyAffectedPackages,
    severityEscalations,
    noLongerAffectedPackages:Object.keys(baseline.knownAffectedPackages).filter(name=>!Object.hasOwn(inventory,name)).sort(),
    newCritical,newHigh,
    riskRegression:newCritical||newHigh||!!newAdvisories.length||!!newlyAffectedPackages.length||!!severityEscalations.length,
    releaseApproved:false
  }
}
function selfTest(){
  const make=()=>{
    const inventory=Object.fromEntries(Object.entries(baseline.knownAffectedPackages).map(([name,severity])=>[name,{severity,via:[],isDirect:false}]))
    const first=Object.keys(inventory)[0]
    inventory[first].via=baseline.knownDirectAdvisoryUrls.map(url=>({url}))
    inventory[first].isDirect=true
    return {metadata:{vulnerabilities:{...baseline.vulnerabilities}},vulnerabilities:inventory}
  }
  const ok=summarize(make())
  assert.equal(ok.riskRegression,false)
  assert.equal(ok.directAdvisoryUrls.length,baseline.knownDirectAdvisoryUrls.length)
  assert.equal(ok.releaseApproved,false)
  assert.equal(ok.directVulnerablePackages.length,1)
  const newUrl=make()
  newUrl.vulnerabilities[Object.keys(newUrl.vulnerabilities)[0]].via.push({url:'https://github.com/advisories/GHSA-0000-0000-0000'})
  const observed=summarize(newUrl)
  assert.equal(observed.delta.high,0,'New CVE can be hidden by identical summary counts')
  assert.equal(observed.riskRegression,true,'New advisory must block CI')
  assert.equal(observed.newAdvisories.length,1)
  const swapped=make()
  const oldName=Object.keys(swapped.vulnerabilities).find(name=>swapped.vulnerabilities[name].severity==='high'&&swapped.vulnerabilities[name].via.length===0)
  delete swapped.vulnerabilities[oldName]
  swapped.vulnerabilities['unknown-unreviewed-package']={severity:'high',via:[]}
  assert.deepEqual(summarize(swapped).newlyAffectedPackages,['unknown-unreviewed-package'])
  assert.equal(summarize(swapped).riskRegression,true)
  const escalated=make()
  const lowName=Object.keys(escalated.vulnerabilities).find(name=>escalated.vulnerabilities[name].severity==='low'&&escalated.vulnerabilities[name].via.length===0)
  escalated.vulnerabilities[lowName].severity='moderate'
  escalated.metadata.vulnerabilities.low--
  escalated.metadata.vulnerabilities.moderate++
  assert.equal(summarize(escalated).severityEscalations[0].name,lowName)
  assert.equal(summarize(escalated).riskRegression,true)
  assert.throws(()=>summarize({error:{code:'ENOTFOUND'}}),/inconclusive/)
  assert.throws(()=>summarize({metadata:{vulnerabilities:{critical:0}},vulnerabilities:{}}),/invalid_counts/)
  const mismatched=make();mismatched.metadata.vulnerabilities.total++
  assert.throws(()=>summarize(mismatched),/invalid_counts/)
  console.log('PASS npm SCA fail-closed count, package, severity and advisory-identity regression tests')
}
if(process.argv[2]==='--self-test')selfTest()
else{
  const [input,output]=process.argv.slice(2)
  if(!input||!output)throw Error('Expected npm audit JSON input and summary output paths')
  const raw=JSON.parse(fs.readFileSync(input,'utf8'))
  const summary=summarize(raw)
  fs.writeFileSync(output,JSON.stringify(summary,null,2)+'\n')
  console.log('Official npm audit (NOT release approval):',JSON.stringify(summary.observed))
  console.log('Unresolved advisory IDs:',summary.directAdvisoryUrls.length)
  console.log('Baseline:',JSON.stringify(summary.baseline),'Delta:',JSON.stringify(summary.delta))
  if(summary.riskRegression){
    console.error('::error::New/unreviewed npm package, vulnerability advisory or severity escalation: investigate and block publication')
    console.error(JSON.stringify({newAdvisories:summary.newAdvisories,newlyAffectedPackages:summary.newlyAffectedPackages,severityEscalations:summary.severityEscalations}))
    process.exitCode=1
  }else if(severities.some(key=>summary.delta[key]>0)){
    console.log('::warning::Dependency risk counts increased; manual triage required')
  }
}
