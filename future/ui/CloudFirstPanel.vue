<script setup lang="ts">
import {computed} from 'vue'
import type {CloudState} from '../cloud/cloudFirst'
const props=defineProps<{
 state:CloudState
 demonstration?:boolean
 busy?:boolean
 onAccept:()=>void
 onRetry:()=>void
}>()
const status=computed(()=>{
 switch(props.state.phase){
  case 'notice':return '开始使用错事'
  case 'checking':return '正在同步'
  case 'synced':return '已同步'
  case 'pending':return '等待云端同步'
  case 'offline':return '暂未同步'
  default:return '部分记录暂未同步'
 }
})
const detail=computed(()=>props.state.phase==='notice'?
 '默认使用云端保存。只需首次确认一次，之后记录会自动同步，无需每天操作。':
 props.state.message)
</script>

<template>
 <section class="cloud-first" aria-label="云端同步">
  <div class="eyebrow">错事 / 数据</div>
  <h2>云端同步</h2>
  <p class="subtitle">记下就好，剩下的交给错事。</p>
  <p v-if="demonstration" class="demo" role="note">v0.5 交互预览 · 全部为虚构数据，无真实网络连接</p>
  <div class="status" aria-live="polite" aria-atomic="true">
   <div class="status-title">
    <span class="dot" :class="state.phase"></span>
    <span data-testid="cloud-status">{{status}}</span>
   </div>
   <p data-testid="cloud-detail">{{detail}}</p>
  </div>
  <div v-if="state.phase==='notice'" class="notice">
   <p>你的每日数字、可选简记以及历次修改历史，将保存在云端，方便更换设备后继续使用。</p>
   <p>首次启用前需要了解并同意隐私说明；之后新增或修改的记录会自动同步。网络异常时会先保留本机记录，恢复网络后再尝试上传。</p>
   <button class="primary" type="button" data-testid="accept-cloud" :disabled="busy" @click="onAccept()">了解并开始</button>
   <p class="footnote">测试预览不传输任何真实资料。正式版本将提供完整隐私说明及相关选择。</p>
  </div>
  <div v-else class="actions">
   <button v-if="state.phase==='offline'||state.phase==='pending'" type="button"
    class="secondary" data-testid="retry-cloud" :disabled="busy" @click="onRetry()">立即重试</button>
  </div>
  <div class="detail-rows">
   <div><span>保存方式</span><strong>云端自动同步</strong></div>
   <div><span>本机记录</span><strong>{{state.pendingLocal?'尚有待同步内容':'保持可用'}}</strong></div>
   <div><span>网络异常</span><strong>提示并自动重试</strong></div>
  </div>
  <p class="closing">一次错误，不必一直放在心上。</p>
 </section>
</template>
<style scoped>
.cloud-first{color:var(--ink,#292723);font-family:"PingFang SC","Noto Sans CJK SC","Microsoft YaHei",sans-serif;
 max-width:440px;margin:0 auto;padding:20px 0 28px}
.cloud-first *{box-sizing:border-box}
.eyebrow{font-size:12px;letter-spacing:.12em;color:#81786e}
h2{font-family:"Songti SC","Noto Serif CJK SC",Georgia,serif;font-size:29px;
 font-weight:500;margin:13px 0 7px;line-height:1.35}
.subtitle{font-size:14px;color:#777269;margin:0 0 29px;line-height:1.8}
.demo{font-size:12px;color:#6b685f;border:1px dashed #ded8ce;
 border-radius:5px;padding:10px 12px;line-height:1.8}
.status{padding:22px 0 23px;border-top:1px solid #ded8ce;border-bottom:1px solid #ded8ce}
.status-title{display:flex;align-items:center;gap:11px;font-family:"Songti SC",serif;font-size:21px}
.dot{width:8px;height:8px;border:1px solid #8b867c;border-radius:50%}
.dot.synced{background:#528273;border-color:#528273}
.dot.pending,.dot.offline,.dot.checking{background:#9b7952;border-color:#9b7952}
.dot.attention{background:#a26c57;border-color:#a26c57}
.status p{color:#6e6961;font-size:13px;line-height:1.85;margin:12px 0 0}
.notice{padding:18px 0 0}
.notice p{color:#69655e;font-size:14px;line-height:1.9;margin:0 0 15px}
button{font-family:inherit;font-size:15px;cursor:pointer;border-radius:6px;
 min-height:47px;padding:12px 18px;width:100%}
button:focus-visible{outline:2px solid #292723;outline-offset:3px}
button:disabled{opacity:.5}
.primary{background:#292723;color:#f7f3eb;border:1px solid #292723;margin-top:8px}
.secondary{background:none;border:1px solid #ded8ce;color:#292723}
.notice .footnote{font-size:12px;margin:17px 0 0}
.actions{padding:18px 0 0}
.detail-rows{margin-top:26px}
.detail-rows div{display:flex;align-items:center;justify-content:space-between;gap:15px;
 padding:17px 0;border-bottom:1px solid #ded8ce;font-size:13px}
.detail-rows span{color:#77716a}
.detail-rows strong{font-weight:500;text-align:right}
.closing{margin-top:42px;font-size:13px;color:#8a847b}
@media(max-width:340px){h2{font-size:27px}.detail-rows div{font-size:12px}}
</style>
