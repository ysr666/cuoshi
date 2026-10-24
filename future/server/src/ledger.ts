/** Server-only note ledger reconstruction; complements v0.4 count validation. */
import {validate,type Records} from '../../../src/core/model'
import {stableJson} from '../../cloud/stableJson'

const noteEvents=new Set(['note_add','note_edit','note_delete'])
export function validateCloudRecordLedger(records:Records):void{
  validate(records)
  const perDay=new Map<string,Map<string,string>>()
  for(const event of records.events){
    if(!noteEvents.has(event.type))continue
    const id=event.noteId
    if(typeof id!=='string'||!id)throw Error('invalid_note_event')
    const notes=perDay.get(event.targetDate)??new Map<string,string>()
    perDay.set(event.targetDate,notes)
    const previous=notes.get(id)
    if(event.type==='note_add'){
      if(previous!==undefined||event.oldText!==null||
         typeof event.newText!=='string'||!event.newText.trim()||
         event.newText.length>300)throw Error('invalid_note_history')
      notes.set(id,event.newText)
    }else if(event.type==='note_edit'){
      if(previous===undefined||event.oldText!==previous||
         typeof event.newText!=='string'||!event.newText.trim()||
         event.newText.length>300||event.newText===previous)throw Error('invalid_note_history')
      notes.set(id,event.newText)
    }else{
      if(previous===undefined||event.oldText!==previous||event.newText!==null)
        throw Error('invalid_note_history')
      notes.delete(id)
    }
  }
  for(const [dayKey,day] of Object.entries(records.days)){
    const expected=perDay.get(dayKey)??new Map<string,string>()
    if(expected.size!==day.notes.length)throw Error('note_ledger_mismatch')
    for(const note of day.notes){
      if(expected.get(note.id)!==note.text)throw Error('note_ledger_mismatch')
      if(note.updatedAt!==undefined&&
         (typeof note.updatedAt!=='string'||!Number.isFinite(Date.parse(note.updatedAt))))
        throw Error('note_metadata_invalid')
    }
  }
}
export function preservesExistingHistory(before:Records,after:Records):boolean{
  if(after.events.length<before.events.length)return false
  for(let i=0;i<before.events.length;i++){
    if(stableJson(before.events[i])!==stableJson(after.events[i]))return false
  }
  // Existing note metadata cannot silently change in the absence of
  // an appended edit event. Historical note identities are never reused.
  const later=after.events.slice(before.events.length)
  const edited=new Set(later.filter(e=>e.type==='note_edit').map(e=>e.noteId))
  for(const [dayKey,day] of Object.entries(before.days)){
    const target=after.days[dayKey]
    if(!target)return false
    for(const old of day.notes){
      const now=target.notes.find(note=>note.id===old.id)
      if(now&&now.createdAt!==old.createdAt)return false
      if(now&&now.updatedAt!==old.updatedAt&&!edited.has(old.id))return false
    }
  }
  return true
}
