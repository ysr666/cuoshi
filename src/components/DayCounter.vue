<script setup lang="ts">
import {computed,ref} from 'vue'
import {records,changeCount,adjustCount,reverseCount,canUndo,lastUndo} from '../core/store'
import {dayOf,MAX_COUNT} from '../core/model'
import {notify} from '../core/ui'
const props=defineProps<{date:string,caption:string,compact?:boolean}>()
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
  <view class="counter" :class="{compact}">
    <view class="count-layout">
      <view class="count-heading">
        <text class="caption">{{caption}}</text>
        <text class="count-hint">只记现在的想法</text>
      </view>
      <view class="count-reading" @click="openEditor">
        <text class="number" :class="{unfilled:value===null}">{{value===null?'未记录':value}}</text>
        <text v-if="value!==null" class="suffix">件</text>
      </view>
    </view>
    <view class="counter-rule"/>
    <view class="action-line">
      <text class="unit">{{value===null?'尚未记录数字':'点按数字，可直接修改'}}</text>
      <view class="controls">
        <button class="round" aria-label="减少一件" :disabled="value===null||value===0" @click="bump(-1)">−</button>
        <button class="round primary" aria-label="增加一件" :disabled="value===MAX_COUNT" @click="bump(1)">＋</button>
      </view>
    </view>
    <view class="extra-actions">
      <text v-if="value===null" class="zero" @click="markZero">或者，明确记为 0 件</text>
      <text v-if="undoVisible" class="undo" @click="undo">撤销刚才的修改 ↶</text>
    </view>
    <view v-if="editing" class="editor">
      <text class="editor-title">修改这一天的数量</text>
      <input class="number-input" type="number" v-model="numberDraft" placeholder="0 至 9999" />
      <view class="editor-actions"><text @click="editing=false">取消</text><text @click="saveNumber">保存修改</text></view>
    </view>
  </view>
</template>
<style scoped>
.counter { margin:48rpx 0 0;padding:32rpx 0 24rpx; }
.count-layout {display:flex;align-items:flex-end;justify-content:space-between;gap:20rpx;min-height:220rpx;}
.count-heading {display:flex;flex-direction:column;align-self:flex-start;gap:15rpx;padding-top:10rpx;}
.caption {display:block;color:var(--ink);font-family:var(--display-font);font-size:32rpx;letter-spacing:1rpx;line-height:1.6;}
.count-hint {color:var(--muted);font-size:23rpx;letter-spacing:.5rpx;}
.count-reading {display:flex;align-items:baseline;justify-content:flex-end;gap:7rpx;min-width:175rpx;max-width:66%;padding-bottom:0;}
.number {display:block;color:var(--ink);font-family:var(--display-font);font-size:152rpx;letter-spacing:-4rpx;font-weight:300;line-height:1.12;font-variant-numeric:tabular-nums;}
.number.unfilled {font-size:54rpx;letter-spacing:2rpx;color:var(--soft);font-weight:400;padding-bottom:25rpx;}
.suffix {color:var(--muted);font-size:23rpx;align-self:flex-end;padding:0 0 23rpx 0;}
.counter-rule {height:1px;background:var(--line);margin-top:28rpx;}
.action-line {display:flex;align-items:center;justify-content:space-between;gap:20rpx;padding-top:26rpx;}
.unit {color:var(--muted);font-size:23rpx;letter-spacing:.5rpx;line-height:1.7;}
.controls {display:flex;align-items:center;gap:17rpx;flex-shrink:0;}
.round {display:flex;align-items:center;justify-content:center;border:1px solid var(--line);border-radius:50%;background:transparent;color:var(--ink);width:92rpx;height:92rpx;padding:0;font-size:45rpx;line-height:1;font-weight:300;}
.round.primary {border-color:var(--ink);background:var(--ink);color:var(--bg);}
.round[disabled] {opacity:.25;}
.extra-actions {display:flex;justify-content:flex-end;align-items:center;min-height:54rpx;padding-top:9rpx;gap:20rpx;}
.zero,.undo {color:var(--muted);font-size:23rpx;text-decoration:underline;line-height:1.8;text-underline-offset:4rpx;}
.editor {margin-top:24rpx;padding:25rpx 30rpx;background:var(--panel);border:1px solid var(--line);border-radius:14rpx;}
.editor-title {display:block;color:var(--muted);font-size:23rpx;text-align:center;line-height:1.7;}
.number-input {margin-top:16rpx;text-align:center;color:var(--ink);font-size:40rpx;height:70rpx;}
.editor-actions {display:flex;justify-content:space-between;padding:18rpx 20rpx 0;color:var(--ink);font-size:27rpx;}
.compact {margin-top:0;padding-top:16rpx;}
.compact .count-layout {min-height:170rpx;}
.compact .number {font-size:124rpx;}
.compact .number.unfilled {font-size:50rpx;}
.compact .count-heading {padding-top:5rpx;}
</style>