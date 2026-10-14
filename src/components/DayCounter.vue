<script setup lang="ts">
import {computed,ref} from 'vue'
import {records,changeCount,adjustCount,reverseCount,canUndo,lastUndo} from '../core/store'
import {dayOf,MAX_COUNT} from '../core/model'
import {notify} from '../core/ui'
const props=defineProps<{date:string,caption:string}>()
const value=computed(()=>dayOf(records.value,props.date).count)
const undoVisible=computed(()=>lastUndo.value?.date===props.date && canUndo(props.date))
const editing=ref(false),numberDraft=ref('')
function openEditor(){numberDraft.value=value.value===null?'':String(value.value);editing.value=true}
function saveNumber(){const n=Number(numberDraft.value);if(!/^\d+$/.test(numberDraft.value)||!Number.isInteger(n)||n>MAX_COUNT){notify('请输入 0 至 9999');return}try{changeCount(props.date,n);editing.value=false}catch(e){notify(String(e))}}
function markZero(){try{changeCount(props.date,0)}catch(e){notify(String(e))}}
function bump(amount:number){try{adjustCount(props.date,amount)}catch(e){notify(String(e))}}
function undo(){try{reverseCount(props.date);notify('已撤销；修改历史仍保留')}catch(e){notify(String(e))}}
</script>
<template>
  <view class="counter"><text class="caption">{{caption}}</text>
    <text class="number" @click="openEditor">{{value===null?'—':value}}</text>
    <text class="unit">{{value===null?'还没有记录':'件错事 · 点击数字可直接修改'}}</text>
    <view class="controls"><button class="round" :disabled="value===null||value===0" @click="bump(-1)">−</button><button class="round primary" :disabled="value===MAX_COUNT" @click="bump(1)">＋</button></view>
    <text v-if="value===null" class="zero" @click="markZero">或者，记为 0 件</text>
    <text v-if="undoVisible" class="undo" @click="undo">撤销刚才的修改</text>
    <view v-if="editing" class="editor"><input class="number-input" type="number" v-model="numberDraft" placeholder="0 至 9999" /><view class="editor-actions"><text @click="editing=false">取消</text><text @click="saveNumber">保存</text></view></view>
  </view>
</template>
<style scoped>
.counter{padding:100rpx 0 50rpx;text-align:center;display:flex;align-items:center;flex-direction:column}.caption{font-size:26rpx;letter-spacing:3rpx;color:var(--muted)}.number{font-size:210rpx;font-weight:300;line-height:1.35;min-width:160rpx;color:var(--ink)}.unit{font-size:25rpx;color:var(--muted)}.controls{display:flex;gap:55rpx;margin-top:50rpx}.round{height:106rpx;width:106rpx;border-radius:100%;background:transparent;border:1px solid var(--line);color:var(--ink);display:flex;align-items:center;justify-content:center;font-size:48rpx;font-weight:300;line-height:1}.primary{color:var(--bg);background:var(--ink)}.zero,.undo{font-size:25rpx;color:var(--muted);margin-top:28rpx;text-decoration:underline}.undo{margin-top:24rpx}.editor{margin-top:35rpx;width:75%;padding:24rpx;border:1px solid var(--line);border-radius:12rpx}.number-input{text-align:center;font-size:32rpx;height:80rpx}.editor-actions{display:flex;justify-content:space-around;color:var(--muted);margin-top:18rpx;font-size:28rpx}
</style>
