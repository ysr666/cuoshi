<script setup lang="ts">
import {ref,computed} from 'vue'
import {onShow} from '@dcloudio/uni-app'
import Screen from '../../components/Screen.vue'
import { records,initialize } from '../../core/store'
import {countsInRange,dateOffset,localDate,monthlySeries} from '../../core/model'
type Period = 'week'|'month'|'year'
const period=ref<Period>('month')
function setPeriod(p:string){if(p==='week'||p==='month'||p==='year')period.value=p}
onShow(()=>initialize())
const bars=computed(()=>{
  const year=Number(localDate().slice(0,4))
  return monthlySeries(records.value,year)
})
const maxVal=computed(()=>Math.max(1,...bars.value.map(b=>b.value)))
const totals=computed(()=>{const now=new Date(),nowKey=localDate();let first='';if(period.value==='week'){const offset=(now.getDay()+6)%7;first=dateOffset(nowKey,-offset)}else if(period.value==='month')first=nowKey.slice(0,7)+'-01';else first=nowKey.slice(0,4)+'-01-01';return countsInRange(records.value,first,nowKey)})
</script>
<template>
  <Screen><view class="header"><text class="brand">错事</text><text class="small-date">不必评分</text></view><view class="heading">统计</view><view class="subheading">看看记录，不用给自己打分。</view>
    <view class="period"><text v-for="p in [{id:'week',label:'本周'},{id:'month',label:'本月'},{id:'year',label:'今年'}]" :key="p.id" :class="{active:period===p.id}" @click="setPeriod(p.id)">{{p.label}}</text></view>
    <view v-if="totals.days>0" class="stat-row"><view><text class="stat-label">目前记录的错事</text><text class="stat-number">{{totals.total}}</text><text>件</text></view><view><text class="stat-label">有记录的日子</text><text class="stat-number">{{totals.days}}</text><text>天</text></view></view>
    <view v-else class="empty-stats"><text class="empty-title">还没有数字记录</text><text>没有留下记录的日子，并不代表零。</text></view>
    <view v-if="period==='year'" class="chart" aria-label="今年每月记录分布">
      <view v-for="bar in bars" :key="bar.month" class="bar-group"><view class="bar" :style="{height:bar.filled===0?'0%':Math.max(2,bar.value/maxVal*100)+'%'}"/><text>{{bar.month}}</text></view>
    </view>
    <text v-if="period==='year'" class="small-notice">一年中的每个月 · 没有记录的月份并不代表 0 件</text>
    <text class="subheading">统计采用各日期现在记录的数字。没有记录数字的日子，不等于零。</text>
  </Screen>
</template>
<style scoped>
.period { display:flex;gap:22rpx;margin-top:62rpx;border-bottom:1px solid var(--line); }
.period text { position:relative;flex:1;text-align:center;padding:17rpx 5rpx 25rpx;color:var(--muted);font-size:27rpx; }
.period text.active { color:var(--ink);font-weight:600; }
.period text.active::after { content:"";position:absolute;bottom:-1px;left:25%;width:50%;height:3rpx;background:var(--ink); }
.stat-row { display:flex;justify-content:space-between;gap:15rpx;margin-top:75rpx;padding-bottom:60rpx;border-bottom:1px solid var(--line); }
.empty-stats {display:flex;flex-direction:column;gap:16rpx;margin-top:68rpx;padding:48rpx 0 60rpx;border-top:1px solid var(--line);border-bottom:1px solid var(--line);font-size:25rpx;line-height:1.7;color:var(--muted);}
.empty-title {color:var(--ink);font-family:var(--display-font);font-size:38rpx;}
.stat-row > view { display:flex;flex:1;flex-direction:column;align-items:flex-start;gap:12rpx;font-size:24rpx; }
.stat-row > view + view { border-left:1px solid var(--line);padding-left:30rpx; }
.stat-label { color:var(--muted);font-size:23rpx;line-height:1.6; }
.stat-number { color:var(--ink);font-family:var(--display-font);font-size:94rpx;line-height:1.2;font-weight:300;font-variant-numeric:tabular-nums; }
.chart { height:255rpx;border-bottom:1px solid var(--line);display:flex;align-items:flex-end;justify-content:space-between;gap:13rpx;margin-top:68rpx; }
.bar-group { height:100%;flex:1;display:flex;flex-direction:column;justify-content:flex-end;align-items:center;gap:12rpx;color:var(--muted);font-size:20rpx; }
.bar { width:50%;background:var(--ink);min-height:0;opacity:.68; }
.small-notice { display:block;font-size:23rpx;color:var(--muted);margin-top:23rpx;line-height:1.8; }
</style>