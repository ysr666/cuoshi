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
const weekday=computed(()=>{const [y,m,d]=date.value.split('-').map(Number);return '星期'+'日一二三四五六'[new Date(y,m-1,d,12).getDay()]})
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
    <view class="detail-date">
      <text class="date-arrow" role="button" aria-label="前一天" @click="step(-1)">‹</text>
      <view class="detail-center"><text>{{dateTitle(date)}}</text><text class="weekday">{{weekday}}</text></view>
      <text class="date-arrow" role="button" aria-label="后一天" :class="{inactive:date===localDate()}" @click="step(1)">›</text>
    </view>
    <DayCounter :date="date" :caption="date===localDate()?'今天觉得做错了':'现在觉得这一天做错了'" compact/><Notes :date="date"/>
    <view class="history"><text class="history-title">修改历史</text>
      <view v-for="event in visibleEvents" :key="event.id" class="event"><text class="meta">{{event.opDate}} · {{event.timezone}}</text><text>{{eventText(event)}}</text></view><text v-if="events.length===0" class="meta">这一天还没有变更历史。</text><text v-if="events.length>5" class="history-toggle" @click="showCompleteHistory=!showCompleteHistory">{{showCompleteHistory?'收起完整历史':'展开完整历史 · '+events.length+' 条'}}　{{showCompleteHistory?'⌃':'⌄'}}</text>
    </view>
  </Screen>
</template>
<style scoped>
.back {display:flex;align-items:center;min-height:44px;color:var(--muted);font-size:13px;margin:-12px 0 0;padding:8px 4px 8px 0;}
.unrecord {display:block;text-align:right;color:var(--muted);font-size:12px;padding:12px 0;text-decoration:underline;}
.detail-date {display:flex;align-items:center;justify-content:space-between;gap:6px;margin-top:17px;text-align:center;}
.detail-center {display:flex;flex-direction:column;align-items:center;gap:4px;font-family:var(--display-font);font-size:25px;color:var(--ink);}
.weekday {font-family:sans-serif;font-size:12px;line-height:1.5;color:var(--muted);}
.date-arrow {display:flex;align-items:center;justify-content:center;width:44px;min-height:44px;color:var(--muted);font-size:27px;}
.date-arrow.inactive {opacity:.25;}
.history {display:flex;flex-direction:column;border-top:1px solid var(--line);margin-top:46px;padding-top:22px;gap:0;}
.history-title {display:block;font-size:15px;font-weight:500;margin-bottom:19px;}
.event {display:flex;flex-direction:column;gap:7px;padding:14px 0 18px;border-top:1px solid var(--line);font-size:13px;line-height:1.75;word-break:break-word;}
.meta {color:var(--muted);font-size:12px;line-height:1.6;}
.history-toggle {display:block;min-height:44px;padding:14px 0;text-align:center;font-size:12px;color:var(--muted);}
</style>