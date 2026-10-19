<script setup lang="ts">
import {computed,ref} from 'vue'
import {onShow} from '@dcloudio/uni-app'
import {state,start,consent,onForeground,getActions,changed,settings,retry,accountWasCancelled,restartAfterCancellation,cancellationOutcomePending,restartAfterUnconfirmedCancellation,recheckCancellationOutcome} from '../../../future/miniapp/runtime'
import {dateOffset,dateValid,localDate,type ChangeEvent} from '../../../src/core/model'
import {pastCountChange,localEventTime} from '../../../future/miniapp/historyView'
const selected=ref(localDate()),draft=ref(''),editing=ref(''),editBody=ref(''),
 numberInput=ref(''),numberOpen=ref(false),feedback=ref(''),historyExpanded=ref(false)
onShow(()=>{
 if(!dateValid(selected.value)||selected.value>localDate())selected.value=localDate()
 historyExpanded.value=false
 void start().then(()=>{onForeground();reloadDraft()})
})
const actions=computed(()=>{void state.revision;return getActions()})
const canEdit=computed(()=>state.stage==='ready'&&
 !['需要确认云端存储','需要重新确认云端存储'].includes(state.sync))
const day=computed(()=>{void state.revision;return actions.value?.day(selected.value)??{count:null,notes:[]}})
const history=computed(()=>{void state.revision
 return actions.value?.read().events.filter(e=>e.targetDate===selected.value).slice().reverse()??[]
})
const pastEdits=computed(()=>{void state.revision
 return selected.value===localDate()?actions.value?.recentPastChanges().slice().reverse()??[]:[]
})
const visibleHistory=computed(()=>historyExpanded.value?history.value:history.value.slice(0,12))
function reloadDraft(){try{draft.value=actions.value?.draft(selected.value)??''}catch{draft.value=''}}
function showDate(next:string){
 if(!dateValid(next)||next>localDate()){
  feedback.value='只能查看今天及以前的日期';return
 }
 selected.value=next
 historyExpanded.value=false
 editing.value=''
 numberOpen.value=false
 feedback.value=''
 reloadDraft()
}
function chooseDate(e:Event){
 const event=e as Event&{detail?:{value?:string}}
 showDate(typeof event.detail?.value==='string'?event.detail.value:'')
}
function shift(n:number){
 const next=dateOffset(selected.value,n)
 if(next>localDate())return
 showDate(next)
}
function recheckUnconfirmed(){
 void recheckCancellationOutcome().catch(e=>{feedback.value=e instanceof Error?e.message:'暂时无法核验'})
}
function resolveUnconfirmed(){
 uni.showModal({title:'注销结果仍未核验',
  content:'无法确定服务器是否已经完成注销。如果选择重新开始，旧账号云端记录可能仍存在。我们不会把本机旧记录迁移到新账号。请确认你理解这一点。',
  confirmText:'仍要开始',confirmColor:'#a04c3c',
  success:result=>{if(result.confirm)void restartAfterUnconfirmedCancellation().catch(e=>{
   feedback.value=e instanceof Error?e.message:'重新开始失败'
  })}
 })
}
function beginAgain(){void restartAfterCancellation().catch(e=>{feedback.value=e instanceof Error?e.message:'重新开始失败'})}
function moveToday(){showDate(localDate())}
function attempt(fn:()=>boolean,success='已保存'){
 if(!canEdit.value)return
 try{
  if(fn()){changed();feedback.value=success}
  else feedback.value='没有变化'
 }catch(e){feedback.value=e instanceof Error?e.message:String(e)}
}
function bump(n:-1|1){
 attempt(()=>actions.value!.adjustCount(selected.value,n,selected.value===localDate()))
}
function markZero(){
 attempt(()=>actions.value!.changeCount(selected.value,0,selected.value===localDate()),'已记录 0 件')
}
function editCount(){
 numberInput.value=day.value.count===null?'':String(day.value.count)
 numberOpen.value=true
}
function saveCount(){
 if(!canEdit.value){numberOpen.value=false;return}
 if(!/^\d+$/.test(numberInput.value)){feedback.value='请输入 0 至 9999';return}
 try{
  const result=actions.value!.changeCount(selected.value,Number(numberInput.value),selected.value===localDate())
  if(result)changed()
  feedback.value=result?'数字已保存':'没有变化';numberOpen.value=false
 }catch(e){feedback.value=e instanceof Error?e.message:String(e)}
}
function inputValue(e:Event):string{
 const evt=e as Event&{detail?:{value?:string}}
 return typeof evt.detail?.value==='string'?evt.detail.value:
   (evt.target as HTMLInputElement|null)?.value??''
}
function draftInput(e:Event){
 if(!canEdit.value)return
 const text=inputValue(e)
 try{actions.value!.saveDraft(selected.value,text);draft.value=text}
 catch(err){feedback.value=err instanceof Error?err.message:String(err)}
}
function leave(){
 attempt(()=>actions.value!.addDraftedNote(selected.value,selected.value===localDate()),'简记已保存')
 reloadDraft()
}
function saveNote(){
 if(!canEdit.value)return
 try{
  const changedNow=actions.value!.updateNote(selected.value,editing.value,editBody.value)
  if(changedNow)changed()
  editing.value='';feedback.value='简记已更新，历史仍完整'
 }catch(e){feedback.value=e instanceof Error?e.message:String(e)}
}
function deleteNote(id:string){
 uni.showModal({title:'删除这条简记？',content:'当前正文将不再显示，历史文字仍保留。',
  success:r=>{
   if(!r.confirm)return
   attempt(()=>actions.value!.removeNote(selected.value,id),'简记已删除，旧文仍在历史里')
   editing.value=''
  }})
}
function eventLabel(e:ChangeEvent){
 if(e.type==='note_add')return '新增简记'
 if(e.type==='note_edit')return '修改简记（旧文已保留）'
 if(e.type==='note_delete')return '删除简记（旧文已保留）'
 return (e.before===null?'未记录':e.before)+' → '+(e.after===null?'未记录':e.after)
}
async function accept(){
 try{await consent();reloadDraft()}
 catch(e){feedback.value=e instanceof Error?e.message:String(e)}
}
const dateLabel=computed(()=>{const [year,month,day]=selected.value.split('-')
 return year+'年'+Number(month)+'月'+Number(day)+'日'
})
</script>
<template>
<view class="screen">
 <view class="top"><text class="brand">错事</text>
  <text class="settings" @click="settings">设置 ›</text></view>
 <view v-if="state.stage==='notice'" class="notice">
  <text class="heading">错了就错了，先放在这里吧。</text>
  <text class="detail">错事默认自动云端保存。每日数量、可选简记、历次修改前后的文字、操作日期和时间会存到你的云端账号，方便更换设备后继续使用。</text>
  <text class="detail">只需要第一次了解并确认。网络异常时先保留本机记录，恢复网络后自动同步。</text>
  <button class="action" @click="accept">了解并开始</button>
  <text class="fine">正式发布前须完成适用的隐私政策和数据处理告知。此测试包不使用真实用户数据。</text>
 </view>
 <view v-else-if="state.stage==='connecting'" class="status-note">正在验证微信账号…</view>
 <view v-else-if="state.stage==='blocked'||state.stage==='offline'" class="notice">
  <text class="detail">{{state.message}}</text>
  <template v-if="cancellationOutcomePending()">
   <button class="secondary" @click="recheckUnconfirmed">重新核验注销结果</button>
   <button class="secondary" @click="resolveUnconfirmed">我了解风险，主动重新开始</button>
   <text class="detail" v-if="feedback">{{feedback}}</text>
  </template>
  <button v-else-if="accountWasCancelled()" class="secondary" @click="beginAgain">重新开始（创建新账号）</button>
  <button v-else class="secondary" @click="retry">重新检查连接</button>
 </view>
 <view v-else class="content">
  <view class="status" :class="{warning:state.sync!=='已同步'}">
   <text>{{state.sync}}</text><text v-if="state.sync!=='已同步'">{{state.message}}</text>
  </view>
  <view v-if="state.sync==='需要确认云端存储'||state.consentRequired" class="notice">
   <text class="detail" v-if="state.consentRequired">此微信账号的云端保存授权已关闭。原有数字、简记和每次修改历史仍保留，只有你再次主动确认才会恢复上传。</text>
   <text class="detail" v-else>此微信账号首次开启云端记录，请确认数据存储说明。</text>
   <text class="detail">恢复后将自动同步该账号的每日数量、可选简记及完整修改历史。</text>
   <button class="action" @click="accept">{{state.consentRequired?'重新确认自动云端保存':'确认自动云端保存'}}</button>
  </view>
  <view v-else>
   <view class="date-nav"><text @click="shift(-1)">‹</text>
    <picker mode="date" :value="selected" :end="localDate()" @change="chooseDate">
     <text class="date-picker">{{dateLabel}} <text class="date-chevron">⌄</text></text>
    </picker>
    <text @click="moveToday">今天</text>
    <text :class="{disabled:selected>=localDate()}" @click="shift(1)">›</text></view>
   <view class="counter">
    <text class="caption">{{selected===localDate()?'今天觉得做错了':'那一天觉得做错了'}}</text>
    <text class="number" @click="editCount">{{day.count===null?'—':day.count}}</text>
    <text class="unit">{{day.count===null?'还没有记录':'件'}}</text>
    <view class="controls">
     <button :disabled="day.count===null||day.count===0" @click="bump(-1)">−</button>
     <button class="plus" :disabled="day.count===9999" @click="bump(1)">＋</button>
    </view>
    <text v-if="day.count===null" class="markzero" @click="markZero">或者，记为 0 件</text>
    <text v-if="actions?.canUndo(selected)" class="markzero"
      @click="attempt(()=>actions!.reverseCount(selected,selected===localDate()),'已撤销，修改历史仍保留')">撤销刚才的修改</text>
   </view>
   <view class="notes">
    <view class="notes-title"><text>留几个字</text><text>选填 · 与数字独立</text></view>
    <view v-for="note in day.notes" :key="note.id" class="note">
     <template v-if="editing===note.id">
      <textarea :value="editBody" maxlength="300"
        @input="editBody=inputValue($event)"/>
      <view class="note-actions"><text @click="editing=''">取消</text>
       <text @click="deleteNote(note.id)">删除</text><text @click="saveNote">保存</text></view>
     </template>
     <template v-else>
      <text class="note-text">{{note.text}}</text>
      <text class="note-link" @click="editing=note.id;editBody=note.text">编辑</text>
     </template>
    </view>
    <view class="entry"><textarea :value="draft" maxlength="300" placeholder="想留几个字也可以……"
      @input="draftInput"/><text class="leave" @click="leave">留下</text></view>
    <text v-if="draft" class="fine">草稿只存在本机，点「留下」才会保存正式历史。</text>
   </view>
   <text v-if="feedback" class="feedback">{{feedback}}</text>
   <view v-if="pastEdits.length" class="quiet">
    <text class="past-title">今天修改了过去的记录 · {{pastEdits.length}} 次</text>
    <view v-for="item in pastEdits" :key="item.id" class="past-entry">
     <text>{{item.targetDate}} · {{pastCountChange(item)}}</text>
    </view>
   </view>
   <view class="history"><text class="history-title">这一天的修改历史 · {{history.length}} 次</text>
    <view v-for="item in visibleHistory" :key="item.id" class="event">
     <view class="event-head"><text>{{eventLabel(item)}}</text>
      <text class="stamp">{{localEventTime(item.at)}} · 本地时间</text></view>
     <text v-if="item.type==='note_add'" class="event-detail">内容：{{item.newText}}</text>
     <text v-if="item.type==='note_edit'" class="event-detail">原文：{{item.oldText}}
改为：{{item.newText}}</text>
     <text v-if="item.type==='note_delete'" class="event-detail">删除前：{{item.oldText}}</text>
    </view>
    <text v-if="history.length>12" class="history-toggle" @click="historyExpanded=!historyExpanded">{{historyExpanded?'收起历史':'展开全部 '+history.length+' 条历史'}}</text>
   </view>
  </view>
 </view>
 <view v-if="numberOpen" class="shade">
  <view class="dialog"><text>修改这一天的数量</text>
   <input type="number" :value="numberInput" @input="numberInput=inputValue($event)" />
   <view class="dialog-actions"><text @click="numberOpen=false">取消</text>
    <text @click="saveCount">保存</text></view>
  </view>
 </view>
</view>
</template>
<style scoped>
.screen{min-height:100vh;background:#f7f3eb;color:#292723;padding:58rpx 50rpx 160rpx;font-family:"PingFang SC",sans-serif}
.top{display:flex;justify-content:space-between;align-items:center}
.brand{font-family:serif;font-size:50rpx;font-weight:600;letter-spacing:6rpx}
.settings{font-size:26rpx;color:#837d73}
.notice{padding-top:85rpx}
.heading{display:block;font-size:36rpx;margin-bottom:40rpx;font-family:serif}
.detail{display:block;color:#6c675e;font-size:29rpx;line-height:2;margin-bottom:28rpx}
.action{background:#292723;color:#fff;font-size:30rpx;margin-top:42rpx;border-radius:10rpx}
.secondary{background:transparent;border:1rpx solid #ded8ce;font-size:28rpx}
.fine{display:block;font-size:23rpx;color:#837d73;line-height:1.8;margin-top:20rpx}
.status{display:flex;gap:16rpx;align-items:center;margin-top:20rpx;min-height:50rpx;font-size:24rpx;color:#56826e}
.status.warning{color:#956c46;flex-wrap:wrap}
.status-note{margin-top:100rpx;color:#6c675e}
.date-nav{display:flex;align-items:center;justify-content:flex-end;gap:30rpx;font-size:25rpx;color:#6c675e;margin-top:10rpx}
.date-nav>text:first-child,.date-nav>text:last-child{font-size:46rpx}
.date-picker{display:block;color:#554e45;font-size:27rpx;padding:12rpx 4rpx}
.date-chevron{font-size:25rpx;color:#948779}
.disabled{opacity:.25}
.counter{text-align:center;padding:65rpx 0 35rpx}
.caption{display:block;color:#6c675e;font-size:29rpx;letter-spacing:3rpx}
.number{display:block;font-family:serif;font-size:220rpx;line-height:1.18;margin-top:19rpx;min-height:270rpx}
.unit{display:block;font-size:27rpx;color:#6c675e}
.controls{display:flex;justify-content:center;gap:40rpx;margin-top:55rpx}
.controls button{width:115rpx;height:115rpx;border:1rpx solid #ded8ce;background:transparent;border-radius:99rpx;font-size:52rpx;padding:0;line-height:112rpx}
.controls .plus{background:#292723;color:white;border-color:#292723}
.controls button[disabled]{opacity:.35}
.markzero{display:block;color:#6c675e;font-size:26rpx;margin:25rpx 0}
.notes{border-top:1rpx solid #ded8ce;padding-top:40rpx}
.notes-title{display:flex;justify-content:space-between;font-size:32rpx}
.notes-title text:last-child{font-size:25rpx;color:#6c675e}
.note{padding:28rpx 0;border-bottom:1rpx solid #ded8ce;display:flex;gap:18rpx;flex-wrap:wrap}
.note-text{flex:1;line-height:1.8;font-size:30rpx;white-space:pre-wrap;word-break:break-all}
.note-link{color:#6c675e;font-size:25rpx}
.note textarea{width:100%;font-size:28rpx;min-height:100rpx}
.note-actions{width:100%;display:flex;justify-content:flex-end;gap:26rpx;color:#6c675e;font-size:26rpx}
.entry{display:flex;align-items:center;margin-top:35rpx;gap:15rpx}
.entry textarea{flex:1;min-width:0;min-height:90rpx;border-bottom:1rpx solid #ded8ce;font-size:30rpx}
.leave{font-size:27rpx;color:#675b4a}
.feedback,.quiet{display:block;padding:26rpx 0;color:#6c675e;font-size:25rpx}
.quiet{border-top:1rpx solid #ded8ce}
.past-title{display:block;margin-bottom:15rpx}
.past-entry{font-size:25rpx;line-height:1.8;padding:8rpx 0;word-break:break-all}
.history{border-top:1rpx solid #ded8ce;padding-top:33rpx;margin-top:25rpx}
.history-title{display:block;font-size:27rpx;margin-bottom:15rpx}
.event{display:flex;flex-direction:column;gap:8rpx;border-bottom:1rpx solid #ded8ce;padding:19rpx 0;font-size:24rpx}
.event-head{display:flex;justify-content:space-between;gap:15rpx;align-items:flex-start}
.event-head text:first-child{flex:1}
.event-detail{font-size:23rpx;color:#6c675e;white-space:pre-wrap;word-break:break-all;line-height:1.7}
.stamp{font-size:21rpx;color:#837d73;text-align:right}
.history-toggle{display:block;text-align:center;padding:28rpx 0;color:#6c675e;font-size:26rpx}
.shade{position:fixed;inset:0;display:flex;align-items:center;justify-content:center;background:#29272344;padding:35rpx}
.dialog{background:#f7f3eb;padding:50rpx;width:100%;max-width:680rpx;border-radius:16rpx;text-align:center}
.dialog input{height:95rpx;font-size:45rpx;margin:38rpx 0;border:1rpx solid #ded8ce}
.dialog-actions{display:flex;justify-content:space-around;font-size:28rpx}
</style>
