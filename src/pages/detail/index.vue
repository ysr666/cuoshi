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
    <DayCounter :date="date" caption="现在觉得这一天有" compact/><Notes :date="date"/>
    <view class="history"><text class="history-title">修改历史 · {{events.length}} 条</text>
      <view v-for="event in visibleEvents" :key="event.id" class="event"><text class="meta">{{event.opDate}} · {{event.timezone}}</text><text>{{eventText(event)}}</text></view><text v-if="events.length===0" class="meta">还没有修改历史。</text><text v-if="events.length>5" class="history-toggle" @click="showCompleteHistory=!showCompleteHistory">{{showCompleteHistory?'收起完整历史':'展开完整历史 · '+events.length+' 条'}}　{{showCompleteHistory?'⌃':'⌄'}}</text>
    </view>
  </Screen>
</template>
<style scoped>
.back { display:inline-block;color:var(--muted);font-size:25rpx;padding:16rpx 0 10rpx; }
.unrecord { display:block;text-align:right;color:var(--muted);font-size:23rpx;padding:15rpx 0;text-decoration:underline; }
.detail-date { margin-top:47rpx;display:flex;align-items:center;justify-content:space-between;gap:8rpx;color:var(--ink);font-family:var(--display-font);font-size:36rpx; }
.detail-date text { padding:16rpx 12rpx; }
.inactive { opacity:.24; }
.history { display:flex;flex-direction:column;border-top:1px solid var(--line);margin-top:48rpx;padding-top:33rpx;gap:13rpx; }
.history-title { display:block;font-size:29rpx;font-weight:500;margin-bottom:16rpx; }
.event { display:flex;flex-direction:column;gap:11rpx;padding:19rpx 0 24rpx;border-bottom:1px solid var(--line);font-size:26rpx;line-height:1.75;word-break:break-word; }
.meta { color:var(--muted);font-size:22rpx;line-height:1.6; }
.history-toggle { padding:24rpx 0;text-align:center;font-size:24rpx;color:var(--muted); }
</style>