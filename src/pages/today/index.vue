<script setup lang="ts">
import { computed,ref } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import Screen from '../../components/Screen.vue'
import DayCounter from '../../components/DayCounter.vue'
import Notes from '../../components/Notes.vue'
import { localDate } from '../../core/model'
import { initialize,recentPastChanges,storageError,records } from '../../core/store'
import { dateTitle } from '../../core/ui'
const date=ref(localDate())
onShow(()=>{initialize();date.value=localDate()})
const edited=computed(()=>recentPastChanges())
const pastEvents=computed(()=>records.value.events.filter(e=>
  e.opDate===localDate() && e.targetDate<e.opDate &&
  (e.type==='initial'||e.type==='count'||e.type==='unrecord')
).slice(-3).reverse())
function pastChangeText(e:{targetDate:string;before:number|null;after:number|null}):string{
  const [,month,day]=e.targetDate.split('-').map(Number)
  const before=e.before===null?'未记录':String(e.before)
  const after=e.after===null?'未记录':String(e.after)
  const delta=e.before!==null&&e.after!==null?e.after-e.before:null
  const direction=delta===null?'':delta>0?' · 增加 '+delta+' 件':delta<0?' · 减少 '+Math.abs(delta)+' 件':''
  return month+'月'+day+'日 · '+before+' → '+after+direction
}
const headerDate=computed(()=>{const [y,m,d]=date.value.split('-').map(Number);const weekday='日一二三四五六'[new Date(y,m-1,d,12).getDay()];return m+'月'+d+'日 · 星期'+weekday})
function calendar(){uni.switchTab({url:'/pages/calendar/index'})}
</script>
<template>
  <Screen><view class="header"><text class="brand">错事</text><text class="small-date">{{headerDate}}</text></view>
    <view v-if="storageError" class="warning">{{storageError}}</view>
    <DayCounter :date="date" caption="今天觉得做错了"/>
    <Notes :date="date"/>
    <view v-if="edited" class="quiet">
      <view class="quiet-title" role="button" @click="calendar">今天还修改了过去的记录 · {{edited}} 次 <text aria-hidden="true">›</text></view>
      <text v-for="event in pastEvents" :key="event.id" class="quiet-change">{{pastChangeText(event)}}</text>
      <text v-if="edited>pastEvents.length" class="quiet-more" role="button" @click="calendar">其余 {{edited-pastEvents.length}} 次，可在日历中查看</text>
    </view>
  </Screen>
</template>
<style scoped>
.warning {font-size:13px;line-height:1.8;color:#934f40;padding:15px 0;}
.quiet {display:block;border-top:1px solid var(--line);padding:10px 0;margin-top:22px;color:var(--muted);font-size:14px;line-height:1.75;}
.quiet-title {display:flex;align-items:center;justify-content:space-between;min-height:44px;gap:12px;color:var(--ink);font-size:14px;}
.quiet-title text {color:var(--muted);font-size:18px;}
.quiet-change {display:block;padding:3px 0;font-size:13px;line-height:1.8;overflow-wrap:anywhere;}
.quiet-more {display:block;padding:10px 0;min-height:40px;color:var(--soft);font-size:13px;}
</style>
