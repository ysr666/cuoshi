<script setup lang="ts">
import {computed,ref,watch} from 'vue'
import {dateOffset,type ChangeEvent} from '../../src/core/model'
import type {createCloudRecordActions} from '../cloud/cloudRecordActions'
import type {CloudState} from '../cloud/cloudFirst'

const props=defineProps<{
  actions:ReturnType<typeof createCloudRecordActions>
  state:CloudState
  date:string
  revision:number
}>()
const emit=defineEmits<{
  (event:'date',date:string):void
  (event:'changed'):void
}>()
const feedback=ref(''),editor=ref(false),numberText=ref(''),
  noteInput=ref(''),editing=ref(''),editBody=ref('')
const today=computed(()=>props.actions.now())
const targetDay=computed(()=>{void props.revision;return props.actions.day(props.date)})
const history=computed(()=>{void props.revision;return props.actions.read().events.filter(
  item=>item.targetDate===props.date).slice().reverse()
})
const pastCount=computed(()=>{void props.revision;return props.actions.recentPastChanges().length})
const canUndo=computed(()=>{void props.revision;return props.actions.canUndo(props.date)})
const dateTitle=computed(()=>{
  const [y,m,d]=props.date.split('-').map(Number)
  return m+'月'+d+'日 · 星期'+'日一二三四五六'[new Date(y,m-1,d,12).getDay()]
})
function perform(fn:()=>boolean,done=''){
  try{
    const changed=fn()
    feedback.value=done||(changed?'已记录':'没有变化')
    if(changed)emit('changed')
  }catch(e){feedback.value=e instanceof Error?e.message:String(e)}
}
function shift(n:number){
  const next=dateOffset(props.date,n)
  if(next>props.actions.now())return
  emit('date',next)
}
function editNumber(){
  numberText.value=targetDay.value.count===null?'':String(targetDay.value.count)
  editor.value=true
}
function setTyped(){
  if(!/^\d+$/.test(numberText.value)){feedback.value='请输入 0 至 9999';return}
  try{
    const changed=props.actions.changeCount(props.date,Number(numberText.value),
      props.date===today.value)
    if(changed)emit('changed')
    feedback.value=changed?'数字已保存':'没有变化'
    editor.value=false
  }catch(e){feedback.value=e instanceof Error?e.message:String(e)}
}
function adjust(n:-1|1){
  perform(()=>props.actions.adjustCount(props.date,n,props.date===today.value),'数字已保存')
}
function zero(){perform(()=>props.actions.changeCount(props.date,0,
  props.date===today.value),'已记录 0 件')}
function undo(){perform(()=>props.actions.reverseCount(props.date,
  props.date===today.value),'已撤销；旧记录仍保留')}
function noteDraftChange(value:string){
  noteInput.value=value
  try{props.actions.saveDraft(props.date,value)}
  catch(e){feedback.value=e instanceof Error?e.message:String(e)}
}
function saveNote(){
  try{
    const changed=props.actions.addDraftedNote(props.date,props.date===today.value)
    if(changed){noteInput.value='';feedback.value='简记已保存，修改历史仍完整';emit('changed')}
  }catch(e){feedback.value=e instanceof Error?e.message:String(e)}
}
function beginEdit(id:string,text:string){editing.value=id;editBody.value=text}
function saveEdit(){
  try{
    const changed=props.actions.updateNote(props.date,editing.value,editBody.value)
    if(changed)emit('changed')
    feedback.value=changed?'简记已更新，旧文仍保留':'没有变化'
    editing.value=''
  }catch(e){feedback.value=e instanceof Error?e.message:String(e)}
}
function remove(id:string){
  try{
    const changed=props.actions.removeNote(props.date,id)
    if(changed)emit('changed')
    feedback.value='简记已删除，旧文仍保留'
    editing.value=''
  }catch(e){feedback.value=e instanceof Error?e.message:String(e)}
}
function description(item:ChangeEvent){
  const before=item.before===null?'未记录':String(item.before)
  const after=item.after===null?'未记录':String(item.after)
  if(item.type==='note_add')return '新增简记'
  if(item.type==='note_edit')return '修改简记（保留旧文）'
  if(item.type==='note_delete')return '删除简记（保留旧文）'
  return before+' → '+after+
    (item.delta&&item.delta!==0?'（'+(item.delta>0?'+':'')+item.delta+'）':'')
}
watch(()=>props.date,(value)=>{
  feedback.value='';editing.value='';editor.value=false
  try{noteInput.value=props.actions.draft(value)}
  catch{noteInput.value=''}
},{immediate:true})
</script>
<template>
  <section class="today" data-testid="cloud-today">
    <div class="header"><strong>错事</strong><span>{{dateTitle}}</span></div>
    <div class="date-nav" aria-label="浏览日期">
      <button type="button" aria-label="前一天" data-testid="previous-day" @click="shift(-1)">‹</button>
      <button type="button" class="today-link" data-testid="back-today"
        @click="emit('date',today)">回到今天</button>
      <button type="button" aria-label="后一天" data-testid="next-day"
        :disabled="date>=today" @click="shift(1)">›</button>
    </div>
    <div class="counter">
      <span class="caption">{{date===today?'今天觉得做错了':'那一天觉得做错了'}}</span>
      <button type="button" class="number" data-testid="count-display"
        aria-label="修改这个日期的错事数量" @click="editNumber">
        {{targetDay.count===null?'—':targetDay.count}}
      </button>
      <span class="unit">{{targetDay.count===null?'还没有记录':'件'}}</span>
      <div class="controls">
        <button type="button" aria-label="减少一件" data-testid="minus"
          :disabled="targetDay.count===null||targetDay.count===0" @click="adjust(-1)">−</button>
        <button type="button" class="plus" aria-label="增加一件"
          data-testid="plus" :disabled="targetDay.count===9999" @click="adjust(1)">＋</button>
      </div>
      <div class="extra">
        <button v-if="targetDay.count===null" type="button" class="subtle"
          data-testid="mark-zero" @click="zero">或者，记为 0 件</button>
        <button v-if="canUndo" type="button" class="subtle"
          data-testid="undo" @click="undo">撤销刚才的修改</button>
      </div>
    </div>
    <section class="notes">
      <div class="notes-head"><span>留几个字</span><span>选填 · 与数字独立</span></div>
      <div v-for="note in targetDay.notes" :key="note.id" class="note">
        <template v-if="editing===note.id">
          <textarea v-model="editBody" maxlength="300" aria-label="编辑简记"
            data-testid="edit-note-input"/>
          <div class="note-actions">
            <button type="button" @click="editing=''">取消</button>
            <button type="button" data-testid="remove-note" @click="remove(note.id)">删除</button>
            <button type="button" data-testid="save-note-edit" @click="saveEdit">保存</button>
          </div>
        </template>
        <template v-else>
          <span class="note-text">{{note.text}}</span>
          <button type="button" data-testid="edit-note" @click="beginEdit(note.id,note.text)">编辑</button>
        </template>
      </div>
      <div class="entry">
        <textarea data-testid="note-draft" :value="noteInput" maxlength="300"
          aria-label="可选的错事简记" placeholder="想留几个字也可以……"
          @input="noteDraftChange(($event.target as HTMLTextAreaElement).value)"/>
        <button type="button" data-testid="save-note" :disabled="!noteInput.trim()"
          @click="saveNote">留下</button>
      </div>
      <span v-if="noteInput" class="hint">草稿只保存在本机，点「留下」后才会进入云端历史。</span>
    </section>
    <div v-if="feedback" class="feedback" role="status" data-testid="record-feedback">{{feedback}}</div>
    <div v-if="pastCount" class="quiet" data-testid="past-change-summary">
      今天还修改了过去的记录 · {{pastCount}} 次
    </div>
    <section class="history">
      <div class="history-title">这一天的修改历史 <span>{{history.length}} 次</span></div>
      <div v-for="item in history.slice(0,12)" :key="item.id" class="event">
        <span>{{description(item)}}</span>
        <time>{{item.at.slice(0,16).replace('T',' ')}} UTC</time>
      </div>
      <p v-if="history.length>12">还有 {{history.length-12}} 次修改，历史仍完整保存在数据中。</p>
    </section>
  </section>
  <div v-if="editor" class="modal" role="dialog" aria-modal="true" aria-label="修改当天数量">
    <div class="dialog">
      <div>修改这一天的数量</div>
      <input v-model="numberText" type="number" min="0" max="9999"
        data-testid="number-input" aria-label="错事数量"/>
      <div class="dialog-actions">
        <button type="button" @click="editor=false">取消</button>
        <button type="button" data-testid="number-save" @click="setTyped">保存</button>
      </div>
    </div>
  </div>
</template>
<style scoped>
.today{--line:#ded8ce;--ink:#292723;--muted:#6c675e;
  color:var(--ink);font-family:"PingFang SC","Microsoft YaHei",sans-serif}
button,textarea,input{font-family:inherit;box-sizing:border-box}
button{cursor:pointer}button:disabled{opacity:.35;cursor:default}
.header{display:flex;justify-content:space-between;align-items:flex-start;min-height:45px}
.header strong{font-family:"Songti SC","STSong",serif;font-weight:600;
  letter-spacing:.12em;font-size:25px}
.header span{color:var(--muted);font-size:13px;margin-top:9px}
.date-nav{display:flex;gap:12px;justify-content:flex-end;align-items:center}
.date-nav button{border:0;background:transparent;color:var(--muted);font-size:22px;
  min-width:34px;min-height:38px}
.date-nav .today-link{font-size:12px}
.counter{text-align:center;padding:33px 0 18px}
.caption{display:block;color:var(--muted);font-size:15px;letter-spacing:.09em}
.number{display:block;border:0;background:transparent;color:var(--ink);
  margin:15px auto 2px;min-height:124px;font-family:"Iowan Old Style","Baskerville",
  "Times New Roman",Georgia,serif;font-size:clamp(94px,24vw,140px);
  font-weight:400;line-height:1.12;font-variant-numeric:tabular-nums}
.unit{display:block;font-size:14px;color:var(--muted);min-height:24px}
.controls{display:flex;align-items:center;justify-content:center;gap:28px;margin-top:25px}
.controls button{width:58px;height:58px;border:1px solid var(--line);border-radius:50%;
  background:transparent;font-size:28px;color:var(--ink);transition:transform .12s ease}
.controls button:active{transform:scale(.93)}
.controls .plus{background:var(--ink);border-color:var(--ink);color:#f7f3eb}
.extra{min-height:49px;display:flex;align-items:center;justify-content:center;gap:10px}
.subtle{border:0;background:transparent;color:var(--muted);font-size:13px;
  text-decoration:underline;text-underline-offset:4px;padding:12px 3px}
.notes{border-top:1px solid var(--line);padding-top:22px}
.notes-head{display:flex;justify-content:space-between;align-items:baseline;gap:10px;font-size:16px}
.notes-head span:last-child{font-size:13px;color:var(--muted)}
.note{display:flex;align-items:flex-start;gap:11px;padding:12px 0;border-bottom:1px solid var(--line)}
.note-text{flex:1;white-space:pre-wrap;overflow-wrap:anywhere;font-size:16px;line-height:1.75}
.note button,.note-actions button{border:0;background:transparent;color:var(--muted);
  font-size:13px;min-height:34px}
.note textarea{width:100%;min-height:55px;border:1px solid var(--line);font-size:16px}
.note:has(textarea){display:block}
.note-actions{display:flex;justify-content:flex-end;gap:10px}
.entry{display:flex;gap:12px;align-items:center;margin-top:14px}
.entry textarea{min-width:0;flex:1;min-height:45px;border:0;border-bottom:1px solid var(--line);
  background:transparent;font-size:16px;resize:vertical;padding:10px 0 6px;color:var(--ink)}
.entry button{border:0;background:transparent;font-size:15px;color:#675b4a}
.hint{font-size:12px;color:var(--muted);line-height:1.7}
.feedback,.quiet{font-size:13px;color:var(--muted);padding:12px 0;line-height:1.7}
.quiet{border-top:1px solid var(--line)}
.history{border-top:1px solid var(--line);margin-top:13px;padding-top:17px;font-size:13px}
.history-title{display:flex;justify-content:space-between;margin-bottom:9px}
.history-title span,.history p{color:var(--muted)}
.event{display:flex;justify-content:space-between;gap:12px;border-bottom:1px solid var(--line);
  padding:10px 0;line-height:1.5}
.event time{font-size:11px;color:var(--muted);text-align:right;white-space:nowrap}
.modal{position:fixed;inset:0;display:flex;justify-content:center;align-items:center;
  background:#29272333;padding:20px;z-index:100}
.dialog{background:#f7f3eb;border:1px solid var(--line);border-radius:13px;
  width:100%;max-width:350px;padding:24px;text-align:center}
.dialog input{width:100%;font-size:27px;text-align:center;margin:20px 0;padding:9px;
  border:1px solid var(--line);background:transparent}
.dialog-actions{display:flex;justify-content:space-around;gap:12px}
.dialog-actions button{border:0;background:transparent;min-height:40px}
@media(max-width:340px){.number{min-height:110px;font-size:100px}
  .notes-head span:last-child{font-size:12px}}
@media(prefers-reduced-motion:reduce){.controls button{transition:none}}
</style>
