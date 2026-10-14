/** Domain model shared by H5, WeChat Mini Program and native builds. No platform APIs. */
export type Skin = 'paper' | 'modern'
export type EventKind = 'initial'|'count'|'unrecord'|'note_add'|'note_edit'|'note_delete'
export type Note = { id: string; text: string; createdAt: string; updatedAt?: string }
export type Day = { count: number|null; notes: Note[] }
export type ChangeEvent = {
  id: string; at: string; opDate: string; timezone: string; targetDate: string;
  type: EventKind; before: number|null; after: number|null; delta: number|null;
  noteId?: string; oldText?: string|null; newText?: string|null;
}
export type Records = { version: 1; theme: Skin; days: Record<string,Day>; events: ChangeEvent[] }
export const MAX_COUNT = 9999
const kinds:EventKind[]=['initial','count','unrecord','note_add','note_edit','note_delete']
export const fresh = (): Records => ({version:1,theme:'paper',days:{},events:[]})
export function localDate(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`
}
export function dateFrom(key:string):Date {const [y,m,d]=key.split('-').map(Number);return new Date(y,m-1,d,12)}
export function dateValid(key:string):boolean{return /^\d{4}-\d{2}-\d{2}$/.test(key)&&localDate(dateFrom(key))===key}
export function dateOffset(key:string,days:number):string{const d=dateFrom(key);d.setDate(d.getDate()+days);return localDate(d)}
export function dayOf(state:Records,key:string):Day{return state.days[key]??{count:null,notes:[]}}
const countValid=(v:unknown):v is number=>Number.isInteger(v)&&Number(v)>=0&&Number(v)<=MAX_COUNT
const uid=()=>`e${Date.now().toString(36)}${Math.random().toString(36).slice(2,11)}`
function makeEvent(key:string,type:EventKind,before:number|null,after:number|null,extra:Partial<ChangeEvent>={}):ChangeEvent{
  const timezone=(()=>{try{return Intl.DateTimeFormat().resolvedOptions().timeZone||'local'}catch{return 'local'}})()
  return {id:uid(),at:new Date().toISOString(),opDate:localDate(),timezone,targetDate:key,type,before,after,delta:before!==null&&after!==null?after-before:null,...extra}
}
export function cloneState(s:Records):Records{return JSON.parse(JSON.stringify(s)) as Records}
/** Validates both current records and history; prevents overwrite with malformed backups. */
export function validate(s:Records):void{
  if(!s||s.version!==1||!['paper','modern'].includes(s.theme)||!s.days||typeof s.days!=='object'||Array.isArray(s.days)||!Array.isArray(s.events))throw Error('记录格式不正确')
  for(const [key,d] of Object.entries(s.days)){
    if(!dateValid(key)||!d||!(d.count===null||countValid(d.count))||!Array.isArray(d.notes))throw Error('日期数据不合法')
    const noteIds=new Set<string>()
    for(const n of d.notes){if(!n||typeof n.id!=='string'||!n.id||noteIds.has(n.id)||typeof n.text!=='string'||n.text.length>300||typeof n.createdAt!=='string'||!Number.isFinite(Date.parse(n.createdAt)))throw Error('简记不合法');noteIds.add(n.id)}
  }
  const ids=new Set<string>(),snapshots:Record<string,number|null>={}
  for(const e of s.events){
    if(!e||typeof e.id!=='string'||!e.id||ids.has(e.id)||!dateValid(e.targetDate)||!dateValid(e.opDate)||typeof e.at!=='string'||!Number.isFinite(Date.parse(e.at))||!kinds.includes(e.type)||typeof e.timezone!=='string'||!(e.before===null||countValid(e.before))||!(e.after===null||countValid(e.after)))throw Error('事件数据不合法')
    if(e.delta!==(e.before!==null&&e.after!==null?e.after-e.before:null))throw Error('变化量不一致')
    ids.add(e.id)
    if(e.type==='initial'||e.type==='count'||e.type==='unrecord'){
      const before=Object.prototype.hasOwnProperty.call(snapshots,e.targetDate)?snapshots[e.targetDate]:null
      if(before!==e.before)throw Error('历史数字断裂')
      if(e.type==='initial'&&(e.before!==null||!countValid(e.after)))throw Error('首次记录不合法')
      if(e.type==='count'&&(!countValid(e.before)||!countValid(e.after)))throw Error('数字变更不合法')
      if(e.type==='unrecord'&&e.after!==null)throw Error('撤回事件不合法')
      snapshots[e.targetDate]=e.after
    }
  }
  for(const [key,d] of Object.entries(s.days))if(d.count!==(Object.prototype.hasOwnProperty.call(snapshots,key)?snapshots[key]:null))throw Error('数字与修改历史不一致')
  for(const [key,count] of Object.entries(snapshots))if(!Object.prototype.hasOwnProperty.call(s.days,key)||s.days[key].count!==count)throw Error('缺失日期或记录不一致')
}
function ensureDate(key:string):void{if(!dateValid(key)||key>localDate())throw Error('不能修改未来的日期')}
export function setCount(s:Records,key:string,value:number|null):boolean{
  ensureDate(key)
  if(value!==null&&!countValid(value))throw Error('请输入 0 至 9999')
  const before=dayOf(s,key).count;if(before===value)return false
  const day=s.days[key]??{count:null,notes:[]};day.count=value;s.days[key]=day
  s.events.push(makeEvent(key,value===null?'unrecord':before===null?'initial':'count',before,value));return true
}
export function appendNote(s:Records,key:string,text:string):boolean{
  ensureDate(key);const body=text.trim();if(!body)return false;if(body.length>300)throw Error('简记最多 300 字')
  const day=s.days[key]??{count:null,notes:[]};const note:Note={id:uid(),text:body,createdAt:new Date().toISOString()}
  day.notes.push(note);s.days[key]=day;s.events.push(makeEvent(key,'note_add',day.count,day.count,{noteId:note.id,oldText:null,newText:body}));return true
}
export function editNote(s:Records,key:string,noteId:string,text:string):boolean{
  ensureDate(key);const body=text.trim();if(!body)throw Error('若要移除这条简记，请选择删除');if(body.length>300)throw Error('简记最多 300 字')
  const d=s.days[key],n=d?.notes.find(x=>x.id===noteId);if(!n)throw Error('简记不存在，请重新打开')
  if(n.text===body)return false
  const old=n.text;n.text=body;n.updatedAt=new Date().toISOString()
  s.events.push(makeEvent(key,'note_edit',d.count,d.count,{noteId,oldText:old,newText:body}));return true
}
export function deleteNote(s:Records,key:string,noteId:string):boolean{
  ensureDate(key);const d=s.days[key],n=d?.notes.find(x=>x.id===noteId);if(!n)throw Error('简记不存在，请重新打开')
  d.notes=d.notes.filter(x=>x.id!==noteId)
  s.events.push(makeEvent(key,'note_delete',d.count,d.count,{noteId,oldText:n.text,newText:null}));return true
}
/** Undo appends another event and never removes history. */
export function undoCount(s:Records,key:string,expected:number|null,restore:number|null):boolean{
  if(dayOf(s,key).count!==expected)throw Error('记录已变更，无法撤销')
  return setCount(s,key,restore)
}
export function countsInRange(s:Records,start:string,end:string):{total:number,days:number,withNumber:number}{
  const rows=Object.entries(s.days).filter(([key,d])=>key>=start&&key<=end&&key<=localDate()&&(d.count!==null||d.notes.length>0))
  return {total:rows.reduce((sum,[,d])=>sum+(d.count??0),0),days:rows.length,withNumber:rows.filter(([,d])=>d.count!==null).length}
}
export function monthlySeries(s:Records,year:number):Array<{month:number,value:number,filled:number}>{
  return Array.from({length:12},(_,i)=>{const prefix=`${year}-${String(i+1).padStart(2,'0')}-`;const rows=Object.entries(s.days).filter(([k,d])=>k.startsWith(prefix)&&k<=localDate()&&d.count!==null);return {month:i+1,value:rows.reduce((a,[,d])=>a+(d.count??0),0),filled:rows.length}})
}
