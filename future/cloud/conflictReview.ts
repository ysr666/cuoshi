/**
 * v0.5 non-destructive, metadata-only conflict inspection.
 * No merge, download, overwrite or upload operations are exposed.
 * No global uni/wx; supplied account must match authenticated cloud owner.
 */
import {sha256} from '../../src/core/backup'
import {validate,type Records,type Day} from '../../src/core/model'
import {stableJson} from './stableJson'
import type {CloudSnapshot} from './snapshotContract'

const validId=(value:unknown):value is string=>
  typeof value==='string'&&/^[A-Za-z0-9_-]{8,128}$/.test(value)
const digest=(records:Records)=>sha256(stableJson(records))
type HistoryRelation='identical'|'local_ahead'|'cloud_ahead'|'diverged'
export type ConflictDayRow={
  date:string
  kind:'local_only'|'cloud_only'|'different'
  localCount:number|null
  cloudCount:number|null
  localNotes:number
  cloudNotes:number
  notesDiffer:boolean
}
export type ConflictReview={
  kind:'identical'|'different'|'cloud_missing'
  ownerId:string
  cloudRevision:number|null
  localDigest:string
  cloudDigest:string|null
  historyRelation:HistoryRelation|null
  localEvents:number
  cloudEvents:number
  localDays:number
  cloudDays:number
  differingDays:number
  truncatedDays:boolean
  days:ConflictDayRow[]
}
function recorded(state:Records){
  return Object.entries(state.days).filter(([,day])=>
    day.count!==null||day.notes.length>0).length
}
function eventRelation(local:Records,cloud:Records):HistoryRelation{
  const min=Math.min(local.events.length,cloud.events.length)
  let prefix=true
  for(let i=0;i<min;i++){
    if(stableJson(local.events[i])!==stableJson(cloud.events[i])){
      prefix=false;break
    }
  }
  if(!prefix)return 'diverged'
  if(local.events.length>cloud.events.length)return 'local_ahead'
  if(local.events.length<cloud.events.length)return 'cloud_ahead'
  return 'identical'
}
function difference(local:Day|undefined,cloud:Day|undefined):boolean{
  if(!local||!cloud)return true
  return local.count!==cloud.count||
    stableJson(local.notes)!==stableJson(cloud.notes)
}
function validSnapshot(snapshot:CloudSnapshot|null,ownerId:string){
  if(!snapshot)return
  if(snapshot.ownerId!==ownerId)throw Error('conflict_review_wrong_owner')
  if(!Number.isSafeInteger(snapshot.revision)||snapshot.revision<1||
     typeof snapshot.digest!=='string'||!/^[a-f0-9]{64}$/.test(snapshot.digest))
    throw Error('conflict_review_invalid_cloud')
  validate(snapshot.records)
  if(digest(snapshot.records)!==snapshot.digest)
    throw Error('conflict_review_cloud_integrity')
}
/**
 * Return only dates, day counts, note counts, event totals and hashes.
 * Never include oldText, newText, any Note.text or the raw Records object.
 * The review is NOT an authorization to resolve a conflict or write data.
 */
export function previewCloudConflict(
  local:Records,cloud:CloudSnapshot|null,ownerId:string,
  maxVisibleDays=12
):ConflictReview{
  if(!validId(ownerId))throw Error('conflict_review_identity_required')
  if(!Number.isSafeInteger(maxVisibleDays)||maxVisibleDays<1||maxVisibleDays>100)
    throw Error('conflict_review_invalid_limit')
  validate(local)
  validSnapshot(cloud,ownerId)
  const localDigest=digest(local)
  const baseline={
    ownerId,cloudRevision:cloud?.revision??null,
    localDigest,cloudDigest:cloud?.digest??null,
    localEvents:local.events.length,cloudEvents:cloud?.records.events.length??0,
    localDays:recorded(local),cloudDays:cloud?recorded(cloud.records):0
  }
  if(!cloud)return {
    kind:'cloud_missing',...baseline,historyRelation:null,
    differingDays:0,truncatedDays:false,days:[]
  }
  const allKeys=new Set([...Object.keys(local.days),...Object.keys(cloud.records.days)])
  const differences:ConflictDayRow[]=[]
  for(const date of [...allKeys].sort().reverse()){
    const l=local.days[date],c=cloud.records.days[date]
    if(!difference(l,c))continue
    differences.push({
      date,
      kind:!l?'cloud_only':!c?'local_only':'different',
      localCount:l?.count??null,cloudCount:c?.count??null,
      localNotes:l?.notes.length??0,cloudNotes:c?.notes.length??0,
      notesDiffer:stableJson(l?.notes??[])!==stableJson(c?.notes??[])
    })
  }
  const relation=eventRelation(local,cloud.records)
  return {
    ...baseline,
    kind:localDigest===cloud.digest?'identical':'different',
    historyRelation:relation,
    differingDays:differences.length,
    truncatedDays:differences.length>maxVisibleDays,
    days:differences.slice(0,maxVisibleDays)
  }
}
export type ConflictReadPort={
  readLocal():Records
  readCloud():Promise<CloudSnapshot|null>
}
/**
 * Detect a local edit during the network request and fail closed. The caller
 * must not reuse a prior review after another local write or cloud revision.
 */
export async function inspectCloudConflict(args:{
  ownerId:string
  port:ConflictReadPort
}):Promise<ConflictReview>{
  const {ownerId,port}=args
  if(!validId(ownerId)||typeof port?.readCloud!=='function'||
     typeof port?.readLocal!=='function')
    throw Error('conflict_review_dependencies_required')
  const before=port.readLocal()
  validate(before)
  const seen=digest(before)
  const remote=await port.readCloud()
  const after=port.readLocal()
  validate(after)
  if(seen!==digest(after))throw Error('conflict_review_local_changed')
  return previewCloudConflict(after,remote,ownerId)
}
