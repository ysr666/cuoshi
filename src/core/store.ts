import {ref} from 'vue'
import {fresh,cloneState,validate,setCount,appendNote,editNote,deleteNote,undoCount,dayOf,localDate,type Skin,type Records} from './model'

// Local-only data. WeChat/APP uni storage is NOT an IndexedDB transaction and is not cloud sync.
const KEY='cuoshi-uni-v1'
const DRAFTS_KEY='cuoshi-uni-drafts-v1'
export const records=ref<Records>(fresh())
export const drafts=ref<Record<string,string>>({})
export const ready=ref(false)
export const storageError=ref('')
export const draftCleanupWarning=ref('')
export const lastUndo=ref<{date:string;before:number|null;after:number|null}|null>(null)
let snapshot=''
let undoExpiry=0
let undoTimer:ReturnType<typeof setTimeout>|undefined
function read(key:string):unknown{
  const value=uni.getStorageSync(key)
  if(value===''||value===null||value===undefined)return undefined
  return typeof value==='string'?JSON.parse(value):value
}
export function initialize():void{
  if(ready.value)return
  try {
    const existing=read(KEY) as Records|undefined
    if(existing){validate(existing);records.value=existing;snapshot=JSON.stringify(existing)}
    else{records.value=fresh();snapshot=''}
    const draftData=read(DRAFTS_KEY)
    if(draftData&&typeof draftData==='object'&&!Array.isArray(draftData)){
      drafts.value=Object.fromEntries(Object.entries(draftData).filter(([key,value])=>/^\d{4}-\d{2}-\d{2}$/.test(key)&&typeof value==='string'&&value.length<=300)) as Record<string,string>
    }
    ready.value=true
  }catch(e){storageError.value='本机记录无法读取，已暂停写入，避免覆盖旧数据';console.error(e)}
}
/** A synchronous stale-write guard. This is NOT a cross-process atomic transaction. */
export function commit(fn:(next:Records)=>boolean):boolean{
  if(!ready.value)initialize()
  if(storageError.value)throw Error(storageError.value)
  const disk=read(KEY) as Records|undefined
  if((disk?JSON.stringify(disk):'')!==snapshot){
    if(disk){validate(disk);records.value=disk;snapshot=JSON.stringify(disk)}
    else{records.value=fresh();snapshot=''}
    throw Error('另一个页面更新了记录，请确认后重试')
  }
  const next=cloneState(records.value),changed=fn(next)
  if(!changed)return false
  validate(next)
  const serialized=JSON.stringify(next)
  try{
    uni.setStorageSync(KEY,next)
    if(JSON.stringify(read(KEY))!==serialized)throw Error('主记录写入后校验失败')
    records.value=next;snapshot=serialized;return true
  }catch(e){
    storageError.value='本机记录保存未能确认，请保留现有数据，重新打开后检查'
    throw Error('本机记录保存未能确认，请保留现有数据，重新打开后检查')
  }
}
export function syncFromStorage():void{
  if(!ready.value)return initialize()
  try{
    const disk=read(KEY) as Records|undefined
    if((disk?JSON.stringify(disk):'')===snapshot)return
    if(disk)validate(disk)
    records.value=disk||fresh();snapshot=disk?JSON.stringify(disk):'';lastUndo.value=null
  }catch(e){storageError.value='本机数据出现异常，已暂停写入';console.error(e)}
}
export function changeCount(key:string,value:number|null):boolean{
  const old=dayOf(records.value,key).count
  const changed=commit(s=>setCount(s,key,value))
  if(changed){
    lastUndo.value={date:key,before:old,after:value};undoExpiry=Date.now()+12000
    if(undoTimer)clearTimeout(undoTimer)
    undoTimer=setTimeout(()=>{lastUndo.value=null},12000)
  }
  return changed
}
export function adjustCount(key:string,delta:number):boolean{
  if(!ready.value)initialize()
  const before=dayOf(records.value,key).count
  if(before===null&&delta<0)return false
  const to=Math.max(0,Math.min(9999,(before??0)+delta))
  return changeCount(key,to)
}
export function canUndo(key:string):boolean{return lastUndo.value?.date===key && Date.now()<undoExpiry}
export function reverseCount(key:string):boolean{
  const pending=lastUndo.value
  if(!pending||pending.date!==key||Date.now()>=undoExpiry)throw Error('撤销窗口已结束')
  const changed=commit(s=>undoCount(s,key,pending.after,pending.before))
  lastUndo.value=null;if(undoTimer)clearTimeout(undoTimer);return changed
}
export function addNote(key:string,text:string):boolean{return commit(s=>appendNote(s,key,text))}
export function updateNote(key:string,noteId:string,text:string):boolean{return commit(s=>editNote(s,key,noteId,text))}
export function removeNote(key:string,noteId:string):boolean{return commit(s=>deleteNote(s,key,noteId))}
export function setTheme(skin:Skin):boolean{return commit(s=>{if(s.theme===skin)return false;s.theme=skin;return true})}
export function saveDraft(key:string,body:string):boolean{
  const next={...drafts.value}
  if(body)next[key]=body;else delete next[key]
  try{
    uni.setStorageSync(DRAFTS_KEY,next)
    if(JSON.stringify(read(DRAFTS_KEY))!==JSON.stringify(next))throw Error('草稿写入后校验失败')
    drafts.value=next;return true
  }catch{throw Error('草稿保存未能确认：请及时提交简记')}
}
export function removeDraft(key:string):void{
  // The note itself may already have been committed. A failed or silently
  // ignored draft removal must be surfaced, or stale text can reappear after
  // restart and invite an accidental duplicate note.
  try{
    saveDraft(key,'')
    const disk=read(DRAFTS_KEY) as Record<string,string>|undefined
    if(disk&&Object.prototype.hasOwnProperty.call(disk,key))throw Error('草稿副本仍在本机')
  }catch{
    throw Error('正式简记已保存，但旧草稿没有清理成功；重新打开后若出现相同文字，请勿重复提交。')
  }
}
export function day(key:string){return dayOf(records.value,key)}
export function recentPastChanges():number{return records.value.events.filter(e=>e.opDate===localDate()&&e.targetDate<e.opDate&&['initial','count','unrecord'].includes(e.type)).length}
/** Only erases unsubmitted drafts. Never rewrites the saved count/note/history record. */
export function retryDraftCleanup():void{
  if(!ready.value)initialize()
  // Keep this operation idempotent so a UI retry after partial failure is safe.
  try{uni.removeStorageSync(DRAFTS_KEY)}catch{console.warn('草稿删除失败，尝试覆盖为空记录')}
  try{
    let diskDrafts=read(DRAFTS_KEY)
    if(diskDrafts!==undefined&&JSON.stringify(diskDrafts)!=='{}'){
      uni.setStorageSync(DRAFTS_KEY,{})
      diskDrafts=read(DRAFTS_KEY)
    }
    if(diskDrafts!==undefined&&JSON.stringify(diskDrafts)!=='{}')throw Error('草稿清理校验失败')
    drafts.value={}
    draftCleanupWarning.value=''
  }catch{
    const message='未提交草稿可能仍在本机，暂未确认清理完成。请检查存储空间后重试。'
    draftCleanupWarning.value=message
    throw Error(message)
  }
}
/** Destructive replacement only AFTER user confirmation in UI; keep drafts until successful write. */
export function replaceRecords(next:Records):void{
  validate(next)
  if(!ready.value)initialize()
  if(storageError.value)throw Error(storageError.value)
  const disk=read(KEY) as Records|undefined
  if((disk?JSON.stringify(disk):'')!==snapshot)throw Error('另一个页面刚修改了数据，请先重新打开再导入')
  const replacement=cloneState(next),serialized=JSON.stringify(replacement)
  try{
    uni.setStorageSync(KEY,replacement)
    if(JSON.stringify(read(KEY))!==serialized)throw Error('主记录写入后校验失败')
    records.value=replacement;snapshot=serialized;lastUndo.value=null
  }catch{
    storageError.value='导入结果未能确认，已暂停后续写入；请保留备份并重新打开检查'
    throw Error(storageError.value)
  }
  try{retryDraftCleanup()}
  catch{throw Error('主记录已替换，但未提交草稿可能仍在本机。清除尚未完成，可在设置中单独重试清理草稿。')}
}
export function clearRecords():void{replaceRecords({...fresh(),theme:records.value.theme})}
