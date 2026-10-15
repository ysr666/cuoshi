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
    </view>
  </Screen>
</template>
<style scoped>
.month-row { display:flex;align-items:center;justify-content:space-between;margin-top:60rpx;min-height:78rpx; }
.month-row text { display:inline-block;padding:15rpx 21rpx;color:var(--ink);font-size:34rpx; }
.month-control {min-width:44px;min-height:44px;text-align:center;}
.month-row picker text { font-family:var(--display-font);font-size:36rpx;letter-spacing:.5rpx; }
.month-row .dim { opacity:.27; }
.week { display:grid;grid-template-columns:repeat(7,minmax(0,1fr));margin-top:46rpx;padding-bottom:20rpx;border-bottom:1px solid var(--line);color:var(--muted);text-align:center;font-size:23rpx; }
.grid { display:grid;grid-template-columns:repeat(7,minmax(0,1fr));text-align:center;margin-top:21rpx;row-gap:12rpx; }
.cell { height:92rpx;min-height:44px;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:10rpx;position:relative;border-radius:10rpx;font-size:29rpx;color:var(--ink); }
.cell.today { outline:1px solid var(--soft);outline-offset:-3rpx; }
.cell.today text { font-weight:600; }
.cell.recorded:not(.today) {background:var(--panel);}
.cell.future { opacity:.23; }
.dot { width:7rpx;height:7rpx;border-radius:50%;background:var(--ink); }
.dot.hollow { width:9rpx;height:9rpx;border:1px solid var(--ink);background:none; }
.dot.only { width:14rpx;height:2rpx;border-radius:0; }
.jump { display:block;margin-top:7rpx;text-align:center;color:var(--muted);font-size:23rpx;text-decoration:underline;padding:14rpx; }
.legend { display:flex;align-items:center;justify-content:center;flex-wrap:wrap;gap:24rpx;margin-top:45rpx;color:var(--muted);font-size:21rpx;line-height:1.8; }
.legend-item {display:flex;align-items:center;gap:9rpx;}
.legend-symbol {height:8rpx;width:8rpx;border-radius:50%;}
.legend-symbol.solid {background:var(--ink);}
.legend-symbol.outline {border:1px solid var(--ink);background:transparent;}
.legend-symbol.shortline {border-radius:0;background:var(--ink);width:13rpx;height:2rpx;}
</style>