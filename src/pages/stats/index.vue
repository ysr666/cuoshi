<script setup lang="ts">
import {ref,computed} from 'vue'
import {onShow} from '@dcloudio/uni-app'
import Screen from '../../components/Screen.vue'
import { records,initialize } from '../../core/store'
import {countsInRange,dateOffset,dateFrom,monthlySeries,dayOf} from '../../core/model'
import {useLiveDay} from '../../core/liveDay'
type Period = 'week'|'month'|'year'
const period=ref<Period>('month')
const {today:todayKey}=useLiveDay()
function setPeriod(p:string){if(p==='week'||p==='month'||p==='year')period.value=p}
onShow(()=>initialize())
const bars=computed(()=>{
  const year=Number(todayKey.value.slice(0,4))
  return monthlySeries(records.value,year)
})
const maxVal=computed(()=>Math.max(1,...bars.value.map(b=>b.value)))
const dailyBars=computed(()=>{
  const today=todayKey.value
  const first=period.value==='week'
    ?dateOffset(today,-((dateFrom(today).getDay()+6)%7))
    :today.slice(0,7)+'-01'
  const end=period.value==='week'?dateOffset(first,6)
    :today.slice(0,7)+'-'+String(new Date(Number(today.slice(0,4)),Number(today.slice(5,7)),0).getDate()).padStart(2,'0')
  const result:Array<{key:string;count:number|null;label:string;future:boolean}>=[]
  for(let key=first;key<=end;key=dateOffset(key,1)){
    const index=result.length
    const future=key>today
    const value=future?null:dayOf(records.value,key).count
    const day=Number(key.slice(-2))
    const label=period.value==='week'?'一二三四五六日'[index]:(day===1||day%5===0?String(day):'')
    result.push({key,count:value,label,future})
  }
  return result
})
const maxDaily=computed(()=>Math.max(1,...dailyBars.value.map(d=>d.count??0)))
const totals=computed(()=>{const nowKey=todayKey.value;let first='';if(period.value==='week'){const offset=(dateFrom(nowKey).getDay()+6)%7;first=dateOffset(nowKey,-offset)}else if(period.value==='month')first=nowKey.slice(0,7)+'-01';else first=nowKey.slice(0,4)+'-01-01';return countsInRange(records.value,first,nowKey)})
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
      <view v-if="period==='year' && totals.withNumber>0" class="chart" aria-label="今年每月记录分布">
        <view v-for="bar in bars" :key="bar.month" class="bar-group">
          <view class="bar" :class="{zero:bar.filled>0 && bar.value===0}" :style="{height:bar.filled===0?'0px':bar.value===0?'2px':Math.max(2,bar.value/maxVal*100)+'%'}"/>
          <text>{{bar.month}}</text>
        </view>
      </view>
      <view v-if="period!=='year' && totals.withNumber>0" class="daily-chart" :aria-label="period==='week'?'本周每日数字记录':'本月每日数字记录'">
        <view v-for="bar in dailyBars" :key="bar.key" class="daily-group" :class="{future:bar.future}">
          <view v-if="bar.count!==null" class="daily-bar" :class="{zero:bar.count===0}" :style="{height:bar.count===0?'2px':Math.max(6,bar.count/maxDaily*100)+'%'}"/>
          <text class="daily-label">{{bar.label}}</text>
        </view>
      </view>
      <text v-if="totals.withNumber===0" class="quiet-stats">{{totals.days>0?'这段时间只留下了简记，还没有数字记录。':'暂时还没有数字记录。留下几个字也可以。'}}</text>
    </view>
    <view class="stats-foot">这里采用各日期现在记录的数字。未记录数量的日子不会当成 0。</view>
  </Screen>
</template>
<style scoped>
.period {display:flex;align-items:center;gap:4px;padding:4px;margin:15px 0 30px;background:var(--raised);border-radius:12px;}
.period text {flex:1;display:flex;justify-content:center;align-items:center;min-height:38px;border-radius:9px;padding:10px 6px;color:var(--muted);font-size:14px;}
.period text.active {color:var(--ink);background:var(--panel);font-weight:600;}
.stat-row {display:grid;grid-template-columns:1fr 1fr;gap:18px;padding:14px 0 27px;border-bottom:1px solid var(--line);}
.stat-box {display:flex;flex-direction:column;gap:4px;}
.stat-label {color:var(--muted);font-size:14px;}
.stat-value {display:flex;align-items:baseline;gap:6px;}
.stat-number {color:var(--ink);font-family:var(--numeric-font);font-weight:400;font-size:46px;line-height:1.4;font-variant-numeric:tabular-nums;}
.stat-unit {font-size:14px;color:var(--muted);}
.graph-area {margin:37px 0 0;}
.graph-title {display:flex;justify-content:space-between;align-items:center;gap:14px;font-size:15px;}
.graph-caption {color:var(--muted);font-size:13px;}
.quiet-stats {display:block;color:var(--muted);font-size:14px;line-height:1.8;padding:37px 0 25px;}
.daily-chart {display:flex;align-items:flex-end;justify-content:space-between;gap:3px;height:138px;margin-top:22px;border-bottom:1px solid var(--line);}
.daily-group {display:flex;flex:1;min-width:0;height:100%;flex-direction:column;align-items:center;justify-content:flex-end;position:relative;padding-bottom:20px;}
.daily-group.future {opacity:.22;}
.daily-bar {width:65%;max-width:18px;min-width:2px;background:var(--accent);opacity:.47;border-radius:2px 2px 0 0;}
.daily-bar.zero {width:55%;min-width:4px;opacity:.6;border-radius:0;}
.daily-label {position:absolute;bottom:0;min-height:17px;color:var(--muted);font-size:11px;line-height:1.4;text-align:center;}
.stats-foot {border-top:1px solid var(--line);padding:20px 0 0;margin-top:20px;color:var(--muted);font-size:14px;line-height:1.8;}
.chart {height:162px;border-bottom:1px solid var(--line);display:flex;align-items:flex-end;justify-content:space-between;gap:4px;margin-top:19px;}
.bar-group {height:100%;flex:1;display:flex;flex-direction:column;justify-content:flex-end;align-items:center;gap:8px;color:var(--muted);font-size:12px;}
.bar {width:65%;max-width:19px;min-height:0;background:var(--accent);opacity:.5;border-radius:3px 3px 0 0;}
.bar.zero {width:55%;max-width:16px;opacity:.72;border-radius:0;}
</style>
