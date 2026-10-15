<script setup lang="ts">
import { computed,ref } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import Screen from '../../components/Screen.vue'
import { records,initialize } from '../../core/store'
import { dayOf,dateOffset,localDate } from '../../core/model'
const month=ref(localDate().slice(0,7))
onShow(()=>initialize())
const thisMonth=computed(()=>localDate().slice(0,7))
function pickMonth(e:{detail:{value:string}}){month.value=e.detail.value.slice(0,7)}
function jumpToday(){month.value=thisMonth.value}
const current=computed(()=>{const [y,m]=month.value.split('-').map(Number);const first=new Date(y,m-1,1,12);const length=new Date(y,m,0,12).getDate();const pad=(first.getDay()+6)%7;const cells: Array<{key:string,label:string,count:number|null,note:boolean,future:boolean}|null> = Array(pad).fill(null)
  for(let i=1;i<=length;i++){const key=`${y}-${String(m).padStart(2,'0')}-${String(i).padStart(2,'0')}`;const d=dayOf(records.value,key);cells.push({key,label:String(i),count:d.count,note:d.notes.length>0,future:key>localDate()})}return cells})
function shift(d:number){const [y,m]=month.value.split('-').map(Number);const next=new Date(y,m-1+d,1,12);month.value=`${next.getFullYear()}-${String(next.getMonth()+1).padStart(2,'0')}`}
function dayAccessibility(d:{key:string,count:number|null,note:boolean,future:boolean}|null):string{if(!d)return "";
  const info=d.count===null?(d.note?"只有简记":"尚未记录"):d.count===0?"明确记录为零":"记录了"+d.count+"件";return d.key+"，"+(d.future?"未来日期":info)+(d.note&&d.count!==null?"，有简记":"")
}
function choose(key:string,future:boolean){if(future)return;uni.navigateTo({url:`/pages/detail/index?date=${key}`})}
const title=computed(()=>{const [y,m]=month.value.split('-');return `${y}年 ${Number(m)}月`})
</script>
<template>
  <Screen><view class="header"><text class="brand">错事</text><text class="small-date">看看过去</text></view><view class="heading">日历</view><view class="subheading">哪一天都可以重新看看。</view>
    <view class="month-row"><text class="month-control" role="button" aria-label="上个月" @click="shift(-1)">‹</text><picker mode="date" fields="month" start="1900-01" :end="thisMonth" :value="month" @change="pickMonth"><text>{{title}} ⌄</text></picker><text class="month-control" role="button" aria-label="下个月" :class="{dim:month>=localDate().slice(0,7)}" @click="month<localDate().slice(0,7)&&shift(1)">›</text></view>
    <text v-if="month!==thisMonth" class="jump" @click="jumpToday">回到本月</text><view class="week"><text v-for="d in ['一','二','三','四','五','六','日']" :key="d">{{d}}</text></view>
    <view class="grid"><view v-for="(d,i) in current" :key="d?d.key:'blank'+i" class="cell" :class="{today:d?.key===localDate(),future:d?.future,recorded:d?.count!==null&&d?.count!==undefined&&d.count>0}" :role="d&&!d.future?'button':undefined" :aria-label="dayAccessibility(d)" @click="d&&choose(d.key,d.future)"><text v-if="d">{{d.label}}</text><view v-if="d&&(d.count!==null||d.note)" class="dot" :class="{hollow:d.count===0,only:d.count===null}"/></view></view>
    <view class="legend">
      <view class="legend-item"><view class="legend-symbol solid"/><text>有数字记录</text></view>
      <view class="legend-item"><view class="legend-symbol outline"/><text>记为零</text></view>
      <view class="legend-item"><view class="legend-symbol shortline"/><text>只有简记</text></view>
      <view class="legend-item"><view class="legend-symbol unfilled"/><text>未记录</text></view>
    </view>
    <view class="calendar-hint">数字是你现在对那一天的判断。点开日期，可以查看、修改，也能看到从前怎么想。</view>
  </Screen>
</template>
<style scoped>
.month-row {display:flex;align-items:center;justify-content:space-between;margin-top:22px;min-height:65px;}
.month-row text {display:inline-block;padding:12px;color:var(--ink);font-size:23px;}
.month-row picker text {font-family:var(--display-font);font-size:20px;letter-spacing:0;}
.month-control {min-width:44px;min-height:44px;text-align:center;}
.month-row .dim {opacity:.27;}
.week {display:grid;grid-template-columns:repeat(7,minmax(0,1fr));margin-top:17px;margin-bottom:11px;padding:0;color:var(--muted);text-align:center;font-size:14px;}
.week text {padding:4px 0;}
.grid {display:grid;grid-template-columns:repeat(7,minmax(0,1fr));text-align:center;row-gap:0;}
.cell {aspect-ratio:.84;min-height:46px;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:6px;border-radius:14px;font-size:15px;font-variant-numeric:tabular-nums;color:var(--ink);}
.cell.today {box-shadow:inset 0 0 0 1px var(--ink);}
.cell.today text {font-weight:600;}
.cell.future {opacity:.28;}
.cell.recorded:not(.today) {background:var(--raised);}
.dot {width:5px;height:5px;border-radius:50%;background:var(--accent);}
.dot.hollow {width:6px;height:6px;border:1px solid var(--accent);background:none;}
.dot.only {width:11px;height:2px;border-radius:2px;}
.jump {display:block;margin-top:2px;text-align:center;color:var(--muted);font-size:14px;text-decoration:underline;padding:10px;}
.legend {display:flex;align-items:center;justify-content:center;flex-wrap:wrap;gap:13px;margin-top:24px;color:var(--muted);font-size:13px;line-height:1.7;}
.legend-item {display:flex;align-items:center;gap:6px;}
.legend-symbol {height:6px;width:6px;border-radius:50%;}
.legend-symbol.solid {background:var(--accent);}
.legend-symbol.outline {border:1px solid var(--accent);background:transparent;}
.legend-symbol.shortline {border-radius:0;background:var(--accent);width:10px;height:2px;}
.legend-symbol.unfilled {background:var(--line);}
.calendar-hint {border-top:1px solid var(--line);margin-top:32px;padding-top:20px;font-size:14px;line-height:1.8;color:var(--muted);}
</style>
