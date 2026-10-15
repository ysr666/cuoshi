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
const headerDate=computed(()=>{const [y,m,d]=date.value.split('-').map(Number);const weekday='日一二三四五六'[new Date(y,m-1,d,12).getDay()];return m+'月'+d+'日 · 星期'+weekday})
function calendar(){uni.switchTab({url:'/pages/calendar/index'})}
</script>
<template>
  <Screen><view class="header"><text class="brand">错事</text><text class="small-date">{{headerDate}}</text></view>
    <view v-if="storageError" class="warning">{{storageError}}</view>
    <DayCounter :date="date" caption="今天觉得做错了"/>
    <Notes :date="date"/>
    <view v-if="edited" class="quiet" @click="calendar">今天还修改了过去的记录 · {{edited}} 次　›</view>
  </Screen>
</template>
<style scoped>
.warning {font-size:13px;line-height:1.8;color:#934f40;padding:15px 0;}
.quiet {display:block;border-top:1px solid var(--line);padding:14px 0;margin-top:43px;color:var(--muted);font-size:12px;line-height:1.8;}
</style>