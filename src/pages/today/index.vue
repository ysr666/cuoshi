<script setup lang="ts">
import { computed,ref } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import Screen from '../../components/Screen.vue'
import DayCounter from '../../components/DayCounter.vue'
import Notes from '../../components/Notes.vue'
import { localDate } from '../../core/model'
import { initialize,recentPastChanges,storageError } from '../../core/store'
import { dateTitle } from '../../core/ui'
const date=ref(localDate())
onShow(()=>{initialize();date.value=localDate()})
const edited=computed(()=>recentPastChanges())
function calendar(){uni.switchTab({url:'/pages/calendar/index'})}
</script>
<template>
  <Screen><view class="header"><text class="brand">错事</text><text class="small-date">{{dateTitle(date)}}</text></view>
    <view v-if="storageError" class="warning">{{storageError}}</view>
    <view class="today-intro"><text class="today-heading">今天</text><text class="today-aside">有多少，随时都可以改。</text></view>
    <DayCounter :date="date" caption="今天觉得做错了"/>
    <Notes :date="date"/>
    <view v-if="edited" class="quiet" @click="calendar">今天还修改了过去的记录 · {{edited}} 次　›</view>
  </Screen>
</template>
<style scoped>
.today-intro {display:flex;align-items:baseline;justify-content:space-between;gap:18rpx;margin-top:72rpx;}
.today-heading {font-family:var(--display-font);font-size:74rpx;line-height:1.15;letter-spacing:2rpx;color:var(--ink);}
.today-aside {color:var(--muted);font-size:23rpx;white-space:nowrap;}

.warning { font-size:25rpx;line-height:1.7;color:#934f40;padding:22rpx 0; }
.quiet { display:block;border-top:1px solid var(--line);padding:26rpx 0;margin-top:75rpx;color:var(--muted);font-size:24rpx;line-height:1.8; }
</style>