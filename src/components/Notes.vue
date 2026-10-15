<script setup lang="ts">
import {ref,computed,watch} from 'vue'
import {drafts,addNote,removeDraft,saveDraft,day,updateNote,removeNote} from '../core/store'
import {notify} from '../core/ui'
const props=defineProps<{date:string}>()
const input=ref(drafts.value[props.date]||'')
const composerRevision=ref(0)
const draftOkay=ref(true)
const composerFocused=ref(false)
watch(()=>props.date,k=>{input.value=drafts.value[k]||'';editing.value='';draftOkay.value=true})
const notes=computed(()=>day(props.date).notes)
const editing=ref(''), editText=ref('')
function textValue(e:Event):string{const custom=e as Event & {detail?:{value?:string}};return typeof custom.detail?.value==='string'?custom.detail.value:(e.target as HTMLTextAreaElement|null)?.value||''}
function onChange(e:Event){input.value=textValue(e);try{draftOkay.value=saveDraft(props.date,input.value)}catch(err){draftOkay.value=false;notify(String(err))}}
function submit(){if(!input.value.trim())return;try{if(addNote(props.date,input.value)){removeDraft(props.date);input.value='';composerRevision.value++;notify('这几个字也留下了')}}catch(e){notify(String(e))}}
function begin(id:string,text:string){editing.value=id;editText.value=text}
function editChange(e:Event){editText.value=textValue(e)}
function saveEdit(){try{updateNote(props.date,editing.value,editText.value);editing.value='';notify('简记已更新，旧文仍在历史里')}catch(e){notify(String(e))}}
function confirmRemove(id:string){uni.showModal({title:'删除这条简记？',content:'正文将不再显示，但修改历史仍会保留。',success:res=>{if(!res.confirm)return;try{removeNote(props.date,id);editing.value='';notify('已删除简记，历史仍保留')}catch(e){notify(String(e))}}})}
</script>
<template>
  <view class="notes"><view class="head"><text>简记</text><text class="hint">有些话，可以留在这里</text></view>
    <view v-for="item in notes" :key="item.id" class="note">
      <template v-if="editing===item.id"><textarea :value="editText" @input="editChange" maxlength="300" class="edit-field" :cursor-spacing="148" :adjust-position="true" auto-height/><view class="note-actions"><text @click="editing=''">取消</text><text @click="confirmRemove(item.id)">删除</text><text @click="saveEdit">保存</text></view></template>
      <template v-else><text class="note-body">{{item.text}}</text><text class="edit-link" @click="begin(item.id,item.text)">编辑</text></template>
    </view>
    <view class="entry" :class="{focused:composerFocused}">
      <textarea :key="composerRevision" :value="input" @input="onChange" @focus="composerFocused=true" @blur="composerFocused=false" maxlength="300" :cursor-spacing="148" :adjust-position="true" auto-height class="field" placeholder="想写什么，就写什么……"/>
      <view class="entry-footer">
        <text class="entry-hint">{{input.length>0?input.length+' / 300':'只有点「留下」才算正式记录'}}</text>
        <view class="save" :class="{inactive:!input.trim()}" role="button" :aria-label="input.trim()?'留下简记':'先输入简记'" @click="submit">留下</view>
      </view>
    </view>
    <text v-if="input" class="foot">{{draftOkay?'草稿暂存在本机，点「留下」才会成为正式记录。':'草稿暂存失败，关闭页面可能丢失。'}}</text>
  </view>
</template>
<style scoped>
.notes { border-top:1px solid var(--line);padding:33rpx 0 15rpx;margin-top:20rpx; }
.head { display:flex;justify-content:space-between;align-items:baseline;gap:20rpx;font-size:30rpx;font-weight:500; }
.hint { color:var(--muted);font-size:23rpx;font-weight:400;letter-spacing:.1rpx;text-align:right;line-height:1.65; }
.entry { margin-top:27rpx;padding:27rpx 25rpx 16rpx;border:1px solid var(--line);border-radius:14rpx;background:var(--panel);transition:border-color .15s ease; }
.entry.focused {border-color:var(--soft);}
.field { display:block;width:100%;min-height:112rpx;font-size:16px;line-height:1.8;color:var(--ink);background:transparent; }
.entry-footer { display:flex;align-items:center;justify-content:space-between;gap:14rpx;margin-top:15rpx; }
.entry-hint { color:var(--muted);font-size:21rpx;line-height:1.6; }
.save { display:flex;align-items:center;justify-content:center;gap:12rpx;min-width:78px;min-height:44px;padding:8rpx 20rpx;border-radius:80rpx;font-size:25rpx;letter-spacing:.2rpx;background:var(--ink);color:var(--bg); }
.save.inactive {background:transparent;color:var(--muted);border:1px solid var(--line);}
.save-arrow {font-size:23rpx;}
.note { display:flex;align-items:flex-start;justify-content:space-between;gap:16rpx;flex-wrap:wrap;padding:28rpx 0 27rpx;border-bottom:1px solid var(--line); }
.note-body { flex:1;font-size:29rpx;line-height:1.9;white-space:pre-wrap;word-break:break-word; }
.edit-link { display:flex;align-items:center;min-height:44px;color:var(--muted);font-size:24rpx;padding:6rpx 2rpx 6rpx 15rpx; }
.edit-field { width:100%;min-height:110rpx;font-size:16px;line-height:1.85;color:var(--ink); }
.note-actions { width:100%;display:flex;justify-content:flex-end;align-items:center;gap:32rpx;font-size:25rpx;color:var(--muted); }
.note-actions text {display:flex;align-items:center;min-height:44px;padding:0 8rpx;}
.foot { display:block;margin-top:13rpx;font-size:22rpx;line-height:1.75;color:var(--muted); }
</style>