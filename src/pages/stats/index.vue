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
  <Screen>
    <view class="header"><text class="brand">错事</text><text class="small-date">不必评分</text></view>
    <view class="heading">统计</view>
    <view class="subheading">看看记录，不用给自己打分。</view>
    <view class="period">
      <text v-for="p in [{id:'week',label:'本周'},{id:'month',label:'本月'},{id:'year',label:'今年'}]" :key="p.id" :class="{active:period===p.id}" @click="setPeriod(p.id)">{{p.label}}</text>
    </view>
    <view class="stat-row">
      <view class="stat-box"><text class="stat-label">目前记录的错事</text><view class="stat-value"><text class="stat-number">{{totals.total}}</text><text class="stat-unit">件</text></view></view>
      <view class="stat-box"><text class="stat-label">有记录的日子</text><view class="stat-value"><text class="stat-number">{{totals.days}}</text><text class="stat-unit">天</text></view></view>
    </view>
    <view class="graph-area">
      <view class="graph-title"><text>记录分布</text><text class="graph-caption">{{period==='week'?'本周':period==='month'?'本月':'今年'}}{{period==='year'?'每月':'每日'}}</text></view>
      <view v-if="period==='year' && totals.days>0" class="chart" aria-label="今年每月记录分布">
        <view v-for="bar in bars" :key="bar.month" class="bar-group">
          <view class="bar" :style="{height:bar.filled===0?'0%':Math.max(2,bar.value/maxVal*100)+'%'}"/>
          <text>{{bar.month}}</text>
        </view>
      </view>
      <text v-if="totals.days===0" class="quiet-stats">暂时还没有数字记录。留下几个字也可以。</text>
      <text v-else-if="period!=='year'" class="quiet-stats">这些数字只是当前记录的汇总。</text>
    </view>
    <view class="stats-foot">这里采用各日期现在记录的数字。未记录数量的日子不会当成 0。</view>
  </Screen>
</template>
<style scoped>
.period {display:flex;align-items:center;gap:4px;padding:4px;margin:15px 0 30px;background:var(--raised);border-radius:12px;}
.period text {flex:1;display:flex;justify-content:center;align-items:center;min-height:38px;border-radius:9px;padding:10px 6px;color:var(--muted);font-size:12px;}
.period text.active {color:var(--ink);background:var(--panel);font-weight:600;}
.stat-row {display:grid;grid-template-columns:1fr 1fr;gap:18px;padding:14px 0 27px;border-bottom:1px solid var(--line);}
.stat-box {display:flex;flex-direction:column;gap:4px;}
.stat-label {color:var(--muted);font-size:12px;}
.stat-value {display:flex;align-items:baseline;gap:6px;}
.stat-number {color:var(--ink);font-family:var(--numeric-font);font-weight:400;font-size:46px;line-height:1.4;font-variant-numeric:tabular-nums;}
.stat-unit {font-size:12px;color:var(--muted);}
.graph-area {margin:37px 0 0;}
.graph-title {display:flex;justify-content:space-between;align-items:center;gap:14px;font-size:13px;}
.graph-caption {color:var(--muted);font-size:11px;}
.quiet-stats {display:block;color:var(--muted);font-size:13px;line-height:1.8;padding:37px 0 25px;}
.stats-foot {border-top:1px solid var(--line);padding:20px 0 0;margin-top:20px;color:var(--muted);font-size:12px;line-height:1.8;}
.chart {height:162px;border-bottom:1px solid var(--line);display:flex;align-items:flex-end;justify-content:space-between;gap:4px;margin-top:19px;}
.bar-group {height:100%;flex:1;display:flex;flex-direction:column;justify-content:flex-end;align-items:center;gap:8px;color:var(--muted);font-size:11px;}
.bar {width:65%;max-width:19px;min-height:0;background:var(--accent);opacity:.5;border-radius:3px 3px 0 0;}
</style>