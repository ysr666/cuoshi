<script setup lang="ts">
import { computed,ref } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import Screen from '../../components/Screen.vue'
import DayCounter from '../../components/DayCounter.vue'
import Notes from '../../components/Notes.vue'
import {records,initialize,changeCount} from '../../core/store'
import {dateOffset,localDate,dateValid} from '../../core/model'
import {dateTitle} from '../../core/ui'
const date=ref(localDate());onLoad((args)=>{initialize();if(args?.date && dateValid(String(args.date)))date.value=String(args.date)})
function back(){uni.navigateBack()}
function step(n:number){const next=dateOffset(date.value,n);if(next>localDate())return;date.value=next;showCompleteHistory.value=false}
function unrecord(){uni.showModal({title:'撤回这一天的数字？',content:'会恢复为「未记录」，而不是 0；简记与修改历史保留。',success:r=>{if(!r.confirm)return;try{changeCount(date.value,null)}catch(e){uni.showToast({title:String(e),icon:'none'})}}})}
const events=computed(()=>records.value.events.filter(e=>e.targetDate===date.value).slice().reverse())
const showCompleteHistory=ref(false)
const visibleEvents=computed(()=>showCompleteHistory.value?events.value:events.value.slice(0,5))
function eventText(e:{type:string;before:number|null;after:number|null;oldText?:string|null;newText?:string|null}):string{
  if(e.type==='note_add')return `留下简记「${e.newText||''}」`
  if(e.type==='note_edit')return `修改简记「${e.oldText||''}」→「${e.newText||''}」`
  if(e.type==='note_delete')return `移除简记「${e.oldText||''}」`
  if(e.type==='unrecord')return '撤回为未记录'
  return `${e.before===null?'未记录':e.before} → ${e.after===null?'未记录':e.after}`
}
</script>
<template>
  <Screen><text class="back" @click="back">‹ 返回日历</text>
    <text v-if="records.days[date]?.count!==null && records.days[date]" class="unrecord" @click="unrecord">撤回数字记录</text>
    <view class="detail-date"><text @click="step(-1)">‹</text><text>{{dateTitle(date)}}</text><text :class="{inactive:date===localDate()}" @click="step(1)">›</text></view>
    <DayCounter :date="date" caption="现在觉得这一天有"/><Notes :date="date"/>
    <view class="history"><text class="history-title">修改历史 · {{events.length}} 条</text>
      <view v-for="event in visibleEvents" :key="event.id" class="event"><text class="meta">{{event.opDate}} · {{event.timezone}}</text><text>{{eventText(event)}}</text></view><text v-if="events.length===0" class="meta">还没有修改历史。</text><text v-if="events.length>5" class="history-toggle" @click="showCompleteHistory=!showCompleteHistory">{{showCompleteHistory?'收起完整历史':'展开完整历史 · '+events.length+' 条'}}　{{showCompleteHistory?'⌃':'⌄'}}</text>
    </view>
  </Screen>
</template>
<style scoped>.unrecord{display:block;text-align:right;color:var(--muted);font-size:24rpx;padding:15rpx 0}.back{font-size:28rpx;color:var(--muted);padding:28rpx 0}.detail-date{margin-top:65rpx;display:flex;align-items:center;justify-content:space-between;font-size:35rpx}.detail-date text{padding:12rpx}.inactive{opacity:.25}.history{border-top:1px solid var(--line);margin-top:40rpx;padding-top:30rpx;display:flex;flex-direction:column;gap:14rpx}.history-title{font-size:30rpx;margin-bottom:18rpx}.event{display:flex;flex-direction:column;gap:8rpx;border-bottom:1px solid var(--line);padding:18rpx 0;font-size:27rpx}.meta{color:var(--muted);font-size:22rpx}.history-toggle{padding:24rpx 0;text-align:center;color:var(--muted);font-size:25rpx}</style>
