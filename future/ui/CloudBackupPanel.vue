<script setup lang="ts">
import {computed} from 'vue'
import type {createCloudSettingsController} from './cloudSettingsController'

const props=withDefaults(defineProps<{
  controller:ReturnType<typeof createCloudSettingsController>
  demonstration?:boolean
}>(),{demonstration:false})
const view=props.controller.view
const title=computed(()=>{
  switch(view.phase){
    case 'signed_out':return '只记录在这里'
    case 'loading':return '正在连接'
    case 'local_only':return '还没有开启云备份'
    case 'first_backup':return '准备第一次备份'
    case 'review_cloud':return '请先核对两端记录'
    case 'ready':return '已同步'
    case 'pending':return '还有记录等待同步'
    case 'conflict':return '需要你确认的不同记录'
    case 'offline':return '暂时还没传上去'
    case 'failure':return '操作暂未完成'
  }
})
const subtitle=computed(()=>{
  if(view.phase==='signed_out')
    return '你的数字、简记和修改历史，仍只保存在这台设备。'
  if(view.phase==='ready')
    return '这一次的完整历史已经经过云端读回核对。'
  if(view.phase==='conflict'||view.phase==='review_cloud')
    return '不会自动覆盖本机或云端已有记录。'
  return '本机记录始终保留；云端状态单独确认。'
})
const askTitle=computed(()=>{
  switch(view.confirmation){
    case 'enable':return '开启云备份？'
    case 'disable':return '关闭后续云备份？'
    case 'first':return '首次上传本机完整历史？'
    case 'logout':return '退出当前设备？'
    default:return ''
  }
})
const askDetail=computed(()=>{
  switch(view.confirmation){
    case 'enable':return '开启授权后，还需单独确认第一次上传。不会悄悄上传简记。'
    case 'disable':return '停止后续自动备份。以前保存在云端的记录不会被此操作删除。'
    case 'first':return '包括日期数字、简记、历次修改前后的文字和操作时间。云端如已有不同记录，会暂停而不覆盖。'
    case 'logout':return '仅退出当前设备并撤销本次服务端会话。本机记录保留；如果有未同步修改，会阻止退出。'
    default:return ''
  }
})
</script>

<template>
  <section class="cloud-panel" aria-label="云备份">
    <header class="head">
      <span class="eyebrow">数据与你</span>
      <h2>云备份</h2>
      <p class="intro">把过去放好，也给明天留个位置。</p>
    </header>
    <p v-if="demonstration" class="demo-flag" role="note">
      v0.5 交互预览 · 使用虚构数据，不连接真实微信或云端
    </p>

    <div class="state-block" aria-live="polite" aria-atomic="true">
      <div class="state-top"><span class="state-dot" :class="view.phase"/><span class="state-label">{{title}}</span></div>
      <p>{{subtitle}}</p>
      <p v-if="view.message" class="state-message" data-testid="cloud-message">{{view.message}}</p>
    </div>

    <div class="detail-line">
      <span>当前账号</span>
      <span class="detail-value">{{view.displayAccount}}</span>
    </div>
    <div class="detail-line">
      <span>云备份授权</span>
      <span class="detail-value">{{view.remote.enabled?'已开启':'未开启'}}</span>
    </div>
    <div class="detail-line">
      <span>上次成功云备份</span>
      <span class="detail-value">{{view.syncedTime}}</span>
    </div>

    <div v-if="view.confirmation" class="confirm" role="group" aria-label="操作确认">
      <strong>{{askTitle}}</strong>
      <p>{{askDetail}}</p>
      <div class="confirm-actions">
        <button type="button" class="secondary" :disabled="view.busy" @click="controller.cancel()">再想想</button>
        <button type="button" class="primary" data-testid="confirm-action" :disabled="view.busy" @click="controller.confirm()">我确认</button>
      </div>
    </div>

    <div class="actions">
      <button v-if="!view.account" type="button" class="primary full" data-testid="login"
        :disabled="view.busy" @click="controller.connect()">用微信登录</button>
      <template v-else>
        <button v-if="!view.remote.enabled" type="button" class="primary full" data-testid="enable"
          :disabled="view.busy" @click="controller.ask('enable')">开启云备份</button>
        <button v-if="view.remote.enabled&&!view.remote.hasStoredBackup" type="button" class="primary full"
          data-testid="first-backup" :disabled="view.busy"
          @click="controller.ask('first')">确认首次备份</button>
        <button v-if="view.remote.enabled&&view.remote.hasStoredBackup"
          type="button" class="primary full" data-testid="sync-now" :disabled="view.busy"
          @click="controller.syncNow()">检查并同步</button>
        <button type="button" class="secondary full" data-testid="refresh"
          :disabled="view.busy" @click="controller.refresh()">刷新云端状态</button>
        <button type="button" class="quiet full" data-testid="toggle-consent" :disabled="view.busy"
          @click="controller.ask(view.remote.enabled?'disable':'enable')">
          {{view.remote.enabled?'关闭云备份':'了解并开启云备份'}}
        </button>
        <button type="button" class="quiet full" data-testid="logout"
          :disabled="view.busy" @click="controller.ask('logout')">退出当前设备</button>
      </template>
    </div>

    <div class="gentle-notice">
      <p>云端不是替你判断对错的地方。</p>
      <p>只有你主动开启，才会备份记录。联网失败时，已保存的本机内容不会被清空；如果两台设备有不同修改，会先停下来让你选择。</p>
    </div>
  </section>
</template>

<style scoped>
.cloud-panel{
  --cloud-text:var(--ink,#292723);--cloud-muted:var(--muted,#6c675e);
  --cloud-line:var(--line,#ded8ce);--cloud-paper:var(--bg,#f7f3eb);
  color:var(--cloud-text);background:var(--cloud-paper);
  font-family:"PingFang SC","Noto Sans CJK SC","Microsoft YaHei",sans-serif;
  box-sizing:border-box;width:100%;max-width:440px;margin:0 auto;padding:18px 0 28px;
}
.cloud-panel *{box-sizing:border-box}
.head{padding:12px 0 26px}
.eyebrow{color:var(--cloud-muted);font-size:13px;letter-spacing:.13em}
h2{font-family:"Songti SC","Noto Serif CJK SC",Georgia,serif;font-weight:500;font-size:30px;
  line-height:1.3;letter-spacing:.02em;margin:10px 0}
.intro{color:var(--cloud-muted);font-size:14px;line-height:1.8;margin:0}
.demo-flag{border:1px dashed var(--cloud-line);border-radius:5px;padding:10px 12px;
  margin:0 0 18px;font-size:12px;color:var(--cloud-muted);line-height:1.7}
.state-block{border-top:1px solid var(--cloud-line);border-bottom:1px solid var(--cloud-line);
  padding:22px 0 21px}
.state-top{display:flex;align-items:center;gap:10px}
.state-dot{width:8px;height:8px;flex-shrink:0;border:1px solid currentColor;
  border-radius:50%;color:#77746c;background:transparent}
.state-dot.ready{color:#487568;background:#487568}
.state-dot.offline,.state-dot.pending,.state-dot.first_backup{color:#9b7952;background:#9b7952}
.state-dot.conflict,.state-dot.failure{color:#a65b4c;background:#a65b4c}
.state-label{font-family:"Songti SC","Noto Serif CJK SC",serif;font-size:21px}
.state-block p{font-size:13px;line-height:1.85;color:var(--cloud-muted);margin:11px 0 0}
.state-block .state-message{color:var(--cloud-text);font-size:13px}
.detail-line{display:flex;justify-content:space-between;gap:14px;padding:17px 0;
  border-bottom:1px solid var(--cloud-line);font-size:14px;line-height:1.6}
.detail-line>span:first-child{color:var(--cloud-muted);flex-shrink:0}
.detail-value{text-align:right;overflow-wrap:anywhere}
.actions{display:flex;flex-direction:column;gap:9px;padding:23px 0 10px}
button{font-family:inherit;font-size:15px;min-height:46px;cursor:pointer;
  border-radius:6px;padding:12px 16px;transition:opacity .15s}
button:disabled{opacity:.45;cursor:not-allowed}
button:focus-visible{outline:2px solid var(--cloud-text);outline-offset:3px}
.full{width:100%}
.primary{background:var(--cloud-text);border:1px solid var(--cloud-text);color:var(--cloud-paper)}
.secondary{background:transparent;border:1px solid var(--cloud-line);color:var(--cloud-text)}
.quiet{background:none;border:0;color:var(--cloud-muted);min-height:40px;font-size:13px}
.confirm{margin:22px 0 0;border:1px solid var(--cloud-line);border-radius:8px;padding:19px 17px}
.confirm strong{font-family:"Songti SC","Noto Serif CJK SC",serif;font-size:19px;font-weight:500}
.confirm p{margin:10px 0 17px;font-size:13px;color:var(--cloud-muted);line-height:1.9}
.confirm-actions{display:flex;gap:10px}
.confirm-actions button{flex:1}
.gentle-notice{margin-top:12px;border-top:1px solid var(--cloud-line);padding:23px 0;
  font-size:13px;line-height:1.85;color:var(--cloud-muted)}
.gentle-notice p{margin:0 0 9px}
@media(max-width:340px){
  .detail-line{font-size:13px}
  h2{font-size:28px}
  button{font-size:14px}
}
</style>
