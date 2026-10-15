<script setup lang="ts">
import {ref,computed,watch} from 'vue'
import {drafts,addNote,removeDraft,saveDraft,day,updateNote,removeNote} from '../core/store'
import {notify} from '../core/ui'
const props=defineProps<{date:string}>()
const input=ref(drafts.value[props.date]||'')
const composerRevision=ref(0)
const draftOkay=ref(true)
watch(()=>props.date,k=>{input.value=drafts.value[k]||'';editing.value='';draftOkay.value=true})
const notes=computed(()=>day(props.date).notes)
const editing=ref(''), editText=ref('')
function textValue(e:Event):string{const custom=e as Event & {detail?:{value?:string}};return typeof custom.detail?.value==='string'?custom.detail.value:(e.target as HTMLTextAreaElement|null)?.value||''}
function onChange(e:Event){input.value=textValue(e);try{draftOkay.value=saveDraft(props.date,input.value)}catch(err){draftOkay.value=false;notify(String(err))}}
function submit(){try{if(addNote(props.date,input.value)){removeDraft(props.date);input.value='';composerRevision.value++;notify('这几个字也留下了')}}catch(e){notify(String(e))}}
function begin(id:string,text:string){editing.value=id;editText.value=text}
function editChange(e:Event){editText.value=textValue(e)}
function saveEdit(){try{updateNote(props.date,editing.value,editText.value);editing.value='';notify('简记已更新，旧文仍在历史里')}catch(e){notify(String(e))}}
function confirmRemove(id:string){uni.showModal({title:'删除这条简记？',content:'正文将不再显示，但修改历史仍会保留。',success:res=>{if(!res.confirm)return;try{removeNote(props.date,id);editing.value='';notify('已删除简记，历史仍保留')}catch(e){notify(String(e))}}})}
</script>
<template>
  <view class="notes"><view class="head"><text>简记</text><text class="hint">有些话，可以留在这里</text></view>
    <view v-for="item in notes" :key="item.id" class="note">
      <template v-if="editing===item.id"><textarea :value="editText" @input="editChange" maxlength="300" class="edit-field" auto-height/><view class="note-actions"><text @click="editing=''">取消</text><text @click="confirmRemove(item.id)">删除</text><text @click="saveEdit">保存</text></view></template>
      <template v-else><text class="note-body">{{item.text}}</text><text class="edit-link" @click="begin(item.id,item.text)">编辑</text></template>
    </view>
    <view class="entry"><textarea :key="composerRevision" :value="input" @input="onChange" maxlength="300" auto-height class="field" placeholder="想写什么，就写什么……"/><text class="save" @click="submit">留下</text></view>
    <text v-if="input" class="foot">{{draftOkay?'草稿暂存在本机，点「留下」才会成为正式记录。':'草稿暂存失败，关闭页面可能丢失。'}}</text>
  </view>
</template>
<style scoped>
.notes { border-top:1px solid var(--line);padding:40rpx 0 15rpx;margin-top:6rpx; }
.head { display:flex;justify-content:space-between;align-items:baseline;gap:20rpx;font-size:29rpx;font-weight:500; }
.hint { color:var(--muted);font-size:22rpx;font-weight:400;letter-spacing:.4rpx; }
.entry { display:flex;flex-direction:column;gap:16rpx;margin-top:28rpx;padding:28rpx 28rpx 21rpx;border:1px solid var(--line);border-radius:16rpx;background:var(--panel); }
.field { display:block;width:100%;min-height:100rpx;font-size:29rpx;line-height:1.7;color:var(--ink);background:transparent; }
.save { display:block;align-self:flex-end;padding:9rpx 24rpx;border-radius:80rpx;font-size:25rpx;letter-spacing:1rpx;background:var(--ink);color:var(--bg); }
.note { display:flex;align-items:flex-start;justify-content:space-between;gap:16rpx;flex-wrap:wrap;padding:25rpx 0 26rpx;border-bottom:1px solid var(--line); }
.note-body { flex:1;font-size:29rpx;line-height:1.85;white-space:pre-wrap;word-break:break-word; }
.edit-link { color:var(--muted);font-size:24rpx;padding:6rpx 2rpx 6rpx 12rpx; }
.edit-field { width:100%;min-height:100rpx;font-size:29rpx;line-height:1.8;color:var(--ink); }
.note-actions { width:100%;display:flex;justify-content:flex-end;gap:38rpx;font-size:25rpx;color:var(--muted);padding:12rpx 0; }
.foot { display:block;margin-top:17rpx;font-size:23rpx;line-height:1.7;color:var(--muted); }
</style>