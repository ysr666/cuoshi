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
    <DayCounter :date="date" caption="今天觉得做错了"/>
    <Notes :date="date"/>
    <view v-if="edited" class="quiet" @click="calendar">今天还修改了过去的记录 · {{edited}} 次　›</view>
  </Screen>
</template>
<style scoped>.quiet{margin-top:90rpx;border-top:1px solid var(--line);padding:26rpx 0;font-size:24rpx;color:var(--muted)}.warning{background:#fff3ed;padding:15rpx;color:#8a3b24;border-radius:8rpx;margin-top:20rpx}</style>
