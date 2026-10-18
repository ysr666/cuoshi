<script setup lang="ts">
import {ref,computed,watch} from 'vue'
import {drafts,addNote,removeDraft,saveDraft,day,updateNote,removeNote} from '../core/store'
import {notify} from '../core/ui'
import {localDate} from '../core/model'
const props=defineProps<{date:string,todayOnly?:boolean}>()
const emit=defineEmits<{(e:'refresh-date'):void}>()
function dateIsCurrent():boolean{
  if(!props.todayOnly || props.date===localDate())return true
  emit('refresh-date')
  notify('新的一天已经开始，请重新确认')
  return false
}
const input=ref(drafts.value[props.date]||'')
const composerRevision=ref(0)
const draftOkay=ref(true)
watch(()=>props.date,k=>{input.value=drafts.value[k]||'';editing.value='';draftOkay.value=true})
const notes=computed(()=>day(props.date).notes)
const editing=ref(''), editText=ref('')
function textValue(e:Event):string{const custom=e as Event & {detail?:{value?:string}};return typeof custom.detail?.value==='string'?custom.detail.value:(e.target as HTMLTextAreaElement|null)?.value||''}
function onChange(e:Event){input.value=textValue(e);try{draftOkay.value=saveDraft(props.date,input.value)}catch(err){draftOkay.value=false;notify(String(err))}}
function submit(){
  if(!input.value.trim()||!dateIsCurrent())return
  let committed=false
  try{committed=addNote(props.date,input.value)}catch(e){notify(String(e));return}
  if(!committed)return
  input.value=''
  composerRevision.value++
  try{removeDraft(props.date);draftOkay.value=true;notify('这几个字也留下了')}
  catch(e){draftOkay.value=false;notify(String(e))}
}
function begin(id:string,text:string){if(!dateIsCurrent())return;editing.value=id;editText.value=text}
function editChange(e:Event){editText.value=textValue(e)}
function saveEdit(){if(!dateIsCurrent())return;try{const changed=updateNote(props.date,editing.value,editText.value);editing.value='';if(changed)notify('简记已更新，旧文仍在历史里')}catch(e){notify(String(e))}}
function confirmRemove(id:string){if(!dateIsCurrent())return;uni.showModal({title:'删除这条简记？',content:'正文将不再显示，但修改历史仍会保留。',success:res=>{if(!res.confirm||!dateIsCurrent())return;try{removeNote(props.date,id);editing.value='';notify('已删除简记，历史仍保留')}catch(e){notify(String(e))}}})}
</script>
<template>
  <view class="notes">
    <view class="head"><text>留几个字</text><text class="hint">选填 · 与数字独立</text></view>
    <view v-for="item in notes" :key="item.id" class="note">
      <template v-if="editing===item.id">
        <textarea :value="editText" @input="editChange" maxlength="300" :cursor-spacing="148" :adjust-position="true" auto-height class="edit-field"/>
        <view class="note-actions"><text hover-class="link-pressed" :hover-start-time="0" :hover-stay-time="80" @click="editing=''">取消</text><text hover-class="link-pressed" :hover-start-time="0" :hover-stay-time="80" @click="confirmRemove(item.id)">删除</text><text hover-class="link-pressed" :hover-start-time="0" :hover-stay-time="80" @click="saveEdit">保存</text></view>
      </template>
      <template v-else><text class="note-mark"/><text class="note-body">{{item.text}}</text><text class="edit-link" hover-class="link-pressed" :hover-start-time="0" :hover-stay-time="80" @click="begin(item.id,item.text)">编辑</text></template>
    </view>
    <view class="entry">
      <textarea :key="composerRevision" :value="input" @input="onChange" maxlength="300" :cursor-spacing="148" :adjust-position="true" auto-height class="field" placeholder="想留几个字也可以……"/>
      <text class="save" :class="{inactive:!input.trim()}" role="button" hover-class="link-pressed" :hover-start-time="0" :hover-stay-time="80" @click="submit">留下</text>
    </view>
    <text v-if="input" class="foot">{{draftOkay?'草稿暂存在本机，点「留下」才会成为正式记录。':'草稿暂存失败，关闭页面可能丢失。'}}</text>
  </view>
</template>
<style scoped>
.notes {border-top:1px solid var(--line);padding:23px 0 0;margin-top:8px;}
.head {display:flex;justify-content:space-between;align-items:baseline;gap:12px;font-size:16px;font-weight:500;line-height:1.5;}
.hint {color:var(--muted);font-size:14px;font-weight:400;line-height:1.6;text-align:right;}
.note {display:flex;align-items:flex-start;gap:11px;flex-wrap:wrap;padding:13px 0;border-bottom:1px solid var(--line);}
.note-mark {flex:0 0 4px;width:4px;height:4px;background:var(--soft);border-radius:50%;margin-top:9px;}
.note-body {flex:1;color:var(--ink);font-size:16px;line-height:1.7;white-space:pre-wrap;word-break:break-word;}
.edit-link {display:flex;align-items:center;min-height:44px;padding:0 3px 0 8px;color:var(--muted);font-size:14px;}
.entry {display:flex;align-items:center;gap:8px;margin-top:18px;}
.field {flex:1;width:100%;min-width:0;min-height:47px;padding:12px 0 8px;line-height:1.6;border:0;border-bottom:1px solid var(--line);border-radius:0;background:transparent;color:var(--ink);font-size:17px;}
.save {display:flex;align-items:center;justify-content:center;min-width:44px;min-height:44px;padding:8px 0 8px 5px;color:var(--accent);font-size:15px;font-weight:600;white-space:nowrap;}
.save.inactive {color:var(--soft);font-weight:400;}
.save,.edit-link,.note-actions text {transition:opacity 110ms ease-out;-webkit-tap-highlight-color:transparent;}
.link-pressed {opacity:.62;}
.save.inactive.link-pressed {opacity:1;}
.edit-field {width:100%;min-height:56px;font-size:16px;line-height:1.7;color:var(--ink);}
.note-actions {width:100%;display:flex;justify-content:flex-end;gap:16px;color:var(--muted);font-size:14px;}
.note-actions text {display:flex;align-items:center;min-height:44px;padding:0 5px;}
@media (prefers-reduced-motion: reduce) {.save,.edit-link,.note-actions text {transition:none;}}
.foot {display:block;margin-top:7px;color:var(--muted);font-size:13px;line-height:1.5;}
</style>
