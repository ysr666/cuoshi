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
function choose(key:string,future:boolean){if(future)return;uni.navigateTo({url:`/pages/detail/index?date=${key}`})}
const title=computed(()=>{const [y,m]=month.value.split('-');return `${y}年 ${Number(m)}月`})
</script>
<template>
  <Screen><view class="header"><text class="brand">错事</text><text class="small-date">看看过去</text></view><view class="heading">日历</view><view class="subheading">哪一天都可以重新看看。</view>
    <view class="month-row"><text @click="shift(-1)">‹</text><picker mode="date" fields="month" start="1900-01" :end="thisMonth" :value="month" @change="pickMonth"><text>{{title}} ⌄</text></picker><text :class="{dim:month>=localDate().slice(0,7)}" @click="month<localDate().slice(0,7)&&shift(1)">›</text></view>
    <text v-if="month!==thisMonth" class="jump" @click="jumpToday">回到本月</text><view class="week"><text v-for="d in ['一','二','三','四','五','六','日']" :key="d">{{d}}</text></view>
    <view class="grid"><view v-for="(d,i) in current" :key="d?d.key:'blank'+i" class="cell" :class="{today:d?.key===localDate(),future:d?.future}" @click="d&&choose(d.key,d.future)"><text v-if="d">{{d.label}}</text><view v-if="d&&(d.count!==null||d.note)" class="dot" :class="{hollow:d.count===0,only:d.count===null}"/></view></view>
    <view class="legend">● 有记录　○ 记为零　－ 只有简记</view>
  </Screen>
</template>
<style scoped>.month-row{display:flex;align-items:center;justify-content:space-between;margin-top:90rpx;font-size:35rpx}.month-row text{padding:12rpx 25rpx}.month-row .dim{opacity:.25}.week,.grid{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));text-align:center}.week{margin-top:50rpx;color:var(--muted);font-size:26rpx}.grid{margin-top:18rpx;row-gap:8rpx}.cell{height:97rpx;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:11rpx;font-size:29rpx}.cell.today text{font-weight:bold}.cell.future{opacity:.3}.dot{height:8rpx;width:8rpx;border-radius:50%;background:var(--ink)}.dot.hollow{border:1px solid var(--ink);background:none}.dot.only{width:16rpx;height:3rpx;border-radius:0}.jump{display:block;text-align:center;font-size:24rpx;text-decoration:underline;color:var(--muted);margin-top:20rpx}.legend{text-align:center;font-size:23rpx;color:var(--muted);margin-top:55rpx}</style>
