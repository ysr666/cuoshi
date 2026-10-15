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
  <view class="counter" :class="{compact}"><text class="caption">{{caption}}</text>
    <text class="number" @click="openEditor">{{value===null?'—':value}}</text>
    <text class="unit">{{value===null?'还没有记录':'件错事 · 点击数字可直接修改'}}</text>
    <view class="controls"><button class="round" :disabled="value===null||value===0" @click="bump(-1)">−</button><button class="round primary" :disabled="value===MAX_COUNT" @click="bump(1)">＋</button></view>
    <text v-if="value===null" class="zero" @click="markZero">或者，记为 0 件</text>
    <text v-if="undoVisible" class="undo" @click="undo">撤销刚才的修改</text>
    <view v-if="editing" class="editor"><input class="number-input" type="number" v-model="numberDraft" placeholder="0 至 9999" /><view class="editor-actions"><text @click="editing=false">取消</text><text @click="saveNumber">保存</text></view></view>
  </view>
</template>
<style scoped>
.counter { display:flex;align-items:center;flex-direction:column;text-align:center;padding:96rpx 0 72rpx; }
.caption { display:block;font-size:25rpx;color:var(--muted);letter-spacing:3rpx; }
.number { display:block;font-family:var(--display-font);font-size:216rpx;font-weight:300;letter-spacing:-9rpx;line-height:1.1;margin:37rpx 0 13rpx;min-width:180rpx;font-variant-numeric:tabular-nums;color:var(--ink); }
.unit { font-size:23rpx;color:var(--muted);line-height:1.6; }
.controls { display:flex;align-items:center;gap:56rpx;margin-top:56rpx; }
.round { display:flex;align-items:center;justify-content:center;width:104rpx;height:104rpx;padding:0;border:1px solid var(--line);border-radius:50%;background:transparent;color:var(--ink);font-size:46rpx;font-weight:300;line-height:1;box-shadow:none; }
.round.primary { background:var(--ink);border-color:var(--ink);color:var(--bg); }
.round[disabled] { opacity:.3; }
.zero,.undo { display:block;min-height:44rpx;margin-top:25rpx;color:var(--muted);font-size:24rpx;line-height:1.8;text-decoration:underline;text-underline-offset:6rpx; }
.editor { width:min(100%,450rpx);margin-top:35rpx;padding:27rpx;background:var(--panel);border:1px solid var(--line);border-radius:18rpx; }
.number-input { font-size:36rpx;color:var(--ink);text-align:center;height:72rpx; }
.editor-actions { display:flex;justify-content:space-around;font-size:27rpx;margin-top:22rpx;color:var(--muted); }
.compact { padding:65rpx 0 55rpx; }
.compact .number { font-size:174rpx;margin:27rpx 0 10rpx; }
.compact .controls { margin-top:40rpx; }
</style>