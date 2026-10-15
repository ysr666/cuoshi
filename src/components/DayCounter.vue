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
    <text class="caption">{{caption}}</text>
    <text class="number" :class="{unfilled:value===null}" role="button" aria-label="修改这一天的数量" @click="openEditor">{{value===null?'—':value}}</text>
    <text class="unit">{{value===null?'还没有记录':'件'}}</text>
    <view class="controls">
      <button class="round" hover-class="round-pressed" aria-label="减少一件" :disabled="value===null||value===0" @click="bump(-1)">−</button>
      <button class="round primary" hover-class="round-pressed" aria-label="增加一件" :disabled="value===MAX_COUNT" @click="bump(1)">＋</button>
    </view>
    <view class="extra-actions">
      <text v-if="value===null" class="zero" role="button" @click="markZero">或者，记为 0 件</text>
      <text v-if="undoVisible" class="undo" role="button" @click="undo">撤销刚才的修改</text>
    </view>
    <view v-if="editing" class="editor-layer" role="presentation" @click="editing=false">
      <view class="editor" role="dialog" aria-modal="true" aria-label="修改这一天的数量" @click.stop>
        <text class="editor-title">修改这一天的数量</text>
        <input class="number-input" type="number" :focus="true" :cursor-spacing="110" :adjust-position="true" v-model="numberDraft" placeholder="0 至 9999" />
        <view class="editor-actions">
          <text class="editor-action" role="button" @click="editing=false">取消</text>
          <text class="editor-action confirm" role="button" @click="saveNumber">保存</text>
        </view>
      </view>
    </view>
  </view>
</template>
<style scoped>
.counter {text-align:center;padding:64px 0 29px;}
.caption {display:block;font-size:15px;color:var(--muted);letter-spacing:.12em;line-height:1.55;}
.number {display:block;margin:15px auto 2px;padding:0 14px;font-family:var(--numeric-font);font-weight:400;font-size:clamp(100px,24vw,142px);letter-spacing:-.075em;line-height:1.13;min-width:110px;font-variant-numeric:tabular-nums;color:var(--ink);}
.number.unfilled {font-size:108px;color:var(--soft);}
.unit {display:block;color:var(--muted);font-size:14px;letter-spacing:.04em;line-height:1.65;}
.controls {display:flex;align-items:center;justify-content:center;gap:28px;margin-top:30px;}
.round {margin:0;width:58px;height:58px;padding:0;display:flex;align-items:center;justify-content:center;background:transparent;border:1px solid var(--line);border-radius:100px;color:var(--ink);font-size:29px;font-weight:300;line-height:1;}
.round-pressed {opacity:.68;}
.round.primary {border-color:var(--ink);background:var(--ink);color:var(--bg);}
.round[disabled] {opacity:.32;}
.extra-actions {display:flex;justify-content:center;align-items:center;flex-direction:column;gap:0;margin-top:4px;min-height:42px;}
.zero,.undo {display:block;padding:12px 9px;color:var(--muted);font-size:14px;line-height:1.5;text-decoration:underline;text-decoration-color:var(--line);text-underline-offset:4px;}
.editor-layer {position:fixed;inset:0;z-index:110;display:flex;justify-content:center;align-items:center;padding:24px;padding-bottom:calc(24px + env(safe-area-inset-bottom,0px));background:rgba(30,28,25,.22);}
.editor {width:100%;max-width:335px;padding:28px 26px 20px;background:var(--bg);border:1px solid var(--line);border-radius:15px;box-shadow:0 16px 55px rgba(25,22,19,.12);}
.editor-title {display:block;text-align:center;font-size:16px;color:var(--ink);font-family:var(--display-font);}
.number-input {height:55px;font-size:26px;text-align:center;color:var(--ink);margin:18px 0 13px;}
.editor-actions {display:flex;justify-content:space-around;border-top:1px solid var(--line);gap:12px;}
.editor-action {display:flex;align-items:center;justify-content:center;min-height:48px;flex:1;padding:12px 6px 0;font-size:15px;color:var(--muted);}
.editor-action.confirm {color:var(--accent);font-weight:600;}
.compact {padding:30px 0 21px;}
.compact .number {font-size:101px;margin-top:8px;}
.compact .number.unfilled {font-size:96px;}
.compact .controls {margin-top:18px;}
</style>
