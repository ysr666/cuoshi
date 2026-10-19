/**
 * v0.5 account-scoped real daily record actions.
 * This is the same v0.4 append-only model and semantics, but commits go
 * through a verified owner-specific store. Never imports v0.4 global store.
 */
import {
  localDate,dateValid,dayOf,setCount,appendNote,editNote,deleteNote,undoCount,MAX_COUNT,
  type Records,type Note,type ChangeEvent
} from '../../src/core/model'
import {sha256} from '../../src/core/backup'
import {stableJson} from './stableJson'
import type {AccountRecordStorage} from './uniAccountRecords'
type RecordStore={read():Records;commit(change:(draft:Records)=>boolean):boolean}
const keyOf=(owner:string)=>'cuoshi-future-v05-drafts-v1:'+sha256(stableJson(owner))
const dateFormat=/^\d{4}-\d{2}-\d{2}$/
export function createCloudRecordActions(args:{
  ownerId:string
  storage:AccountRecordStorage
  store:RecordStore
  clock?:()=>Date
}){
  const {storage,store}=args
  if(typeof store?.read!=='function'||typeof store?.commit!=='function'||
     typeof storage?.getStorageSync!=='function'||typeof storage?.setStorageSync!=='function'||
     !/^[A-Za-z0-9_-]{8,128}$/.test(args.ownerId))
    throw Error('cloud_record_actions_invalid')
  const draftKey=keyOf(args.ownerId)
  const now=()=>localDate(args.clock?.()??new Date())
  let undo:{target:string;before:number|null;after:number|null;until:number}|null=null
  function validTarget(date:string,strictToday=false){
    if(!dateValid(date)||date>now()||
       strictToday&&date!==now())throw Error('新的一天已经开始，请重新确认')
  }
  function day(date=now()){return dayOf(store.read(),date)}
  function recentPastChanges(date=now()):ChangeEvent[]{
    return store.read().events.filter(e=>e.opDate===date&&
      e.targetDate<e.opDate&&
      ['initial','count','unrecord'].includes(e.type))
  }
  function changeCount(date:string,value:number|null,strictToday=false):boolean{
    validTarget(date,strictToday)
    if(value!==null&&(!Number.isInteger(value)||value<0||value>MAX_COUNT))
      throw Error('请输入 0 至 9999')
    const before=dayOf(store.read(),date).count
    const changed=store.commit(next=>setCount(next,date,value))
    if(changed)undo={target:date,before,after:value,until:Date.now()+12000}
    return changed
  }
  function adjustCount(date:string,amount:-1|1,strictToday=false):boolean{
    validTarget(date,strictToday)
    const current=dayOf(store.read(),date).count
    if(amount<0&&(current===null||current===0))return false
    if(amount>0&&current===MAX_COUNT)return false
    return changeCount(date,Math.max(0,Math.min(MAX_COUNT,(current??0)+amount)),strictToday)
  }
  function canUndo(date:string){return undo?.target===date&&Date.now()<undo.until}
  function reverseCount(date:string,strictToday=false){
    validTarget(date,strictToday)
    const action=undo
    if(!action||action.target!==date||Date.now()>=action.until)
      throw Error('撤销窗口已结束')
    const changed=store.commit(next=>undoCount(next,date,action.after,action.before))
    if(changed)undo=null
    return changed
  }
  function addNote(date:string,text:string,strictToday=false){
    validTarget(date,strictToday)
    return store.commit(next=>appendNote(next,date,text))
  }
  function updateNote(date:string,id:string,text:string,strictToday=false){
    validTarget(date,strictToday)
    return store.commit(next=>editNote(next,date,id,text))
  }
  function removeNote(date:string,id:string,strictToday=false){
    validTarget(date,strictToday)
    return store.commit(next=>deleteNote(next,date,id))
  }
  function readDrafts():Record<string,string>{
    const raw=storage.getStorageSync(draftKey)
    if(raw===undefined||raw===null||raw==='')return {}
    let data:unknown=raw
    if(typeof raw==='string'){
      try{data=JSON.parse(raw)}catch{throw Error('简记草稿无法读取')}
    }
    if(!data||typeof data!=='object'||Array.isArray(data))throw Error('简记草稿格式不正确')
    return Object.fromEntries(Object.entries(data).filter(([date,body])=>
      dateFormat.test(date)&&typeof body==='string'&&body.length<=300)) as Record<string,string>
  }
  function draft(date:string){validTarget(date);return readDrafts()[date]??''}
  function saveDraft(date:string,body:string){
    validTarget(date)
    if(typeof body!=='string'||body.length>300)throw Error('简记最多 300 字')
    const data=readDrafts()
    if(body)data[date]=body
    else delete data[date]
    storage.setStorageSync(draftKey,data)
    const saved=readDrafts()
    if(stableJson(data)!==stableJson(saved))throw Error('简记草稿保存失败')
  }
  function addDraftedNote(date:string,strictToday=false){
    validTarget(date,strictToday)
    const text=draft(date)
    if(!text.trim())return false
    const changed=addNote(date,text,strictToday)
    if(changed)saveDraft(date,'') // note persists even if draft cleanup fails
    return changed
  }
  function read(){return store.read()}
  return {read,day,now,changeCount,adjustCount,canUndo,reverseCount,
    addNote,updateNote,removeNote,draft,saveDraft,addDraftedNote,recentPastChanges}
}
