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
    case 'first':return view.firstPreview?.status==='already_on_cloud'?
      '关联这台设备？':'首次上传本机完整历史？'
    case 'logout':return '退出当前设备？'
    default:return ''
  }
})
const differenceLabel=(kind:string)=>kind==='local_only'?'仅本机':
  kind==='cloud_only'?'仅云端':'两端不同'
const countLabel=(count:number|null)=>count===null?'未记录':String(count)
const historyLabel=computed(()=>{
  switch(view.conflictPreview?.historyRelation){
    case 'identical':return '修改历史目前一致'
    case 'local_ahead':return '本机新增了修改历史'
    case 'cloud_ahead':return '云端新增了修改历史'
    case 'diverged':return '两边的修改历史已有分叉'
    default:return '尚未取得完整云端历史'
  }
})
const askDetail=computed(()=>{
  switch(view.confirmation){
    case 'enable':return '开启授权后，还需单独确认第一次上传。不会悄悄上传简记。'
    case 'disable':return '停止后续自动备份。以前保存在云端的记录不会被此操作删除。'
    case 'first':return view.firstPreview?
      `本机记录 ${view.firstPreview.localRecordedDays} 天，含 ${view.firstPreview.localEventCount} 条完整修改历史。`+
      (view.firstPreview.status==='already_on_cloud'?
        '已核对云端内容完全相同，只建立设备关联，不重复上传。':
        '包括修改前后文字与时间。确认后才开始上传；云端有不同记录则不会覆盖。'):
      '需要先核对本机和云端历史。'
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

    <section v-if="view.conflictPreview" class="difference" aria-label="本机和云端记录差异" data-testid="conflict-review">
      <div class="diff-intro">
        <strong>两端记录核对</strong>
        <p>这里只对照日期、数字和简记条数，不展示简记正文，也不修改任何记录。这是本次核对时的快照，之后的修改需要重新核对。</p>
      </div>
      <div class="diff-summary">
        <div><span>本机已记录</span><b>{{view.conflictPreview.localDays}} 天 · {{view.conflictPreview.localEvents}} 次修改</b></div>
        <div><span>云端已记录</span><b>{{view.conflictPreview.cloudDays}} 天 · {{view.conflictPreview.cloudEvents}} 次修改</b></div>
        <div><span>不同日期</span><b>{{view.conflictPreview.differingDays}} 天</b></div>
        <p>{{historyLabel}}</p>
      </div>
      <div v-for="day in view.conflictPreview.days" :key="day.date" class="diff-day">
        <div class="diff-day-heading"><span>{{day.date}}</span><span>{{differenceLabel(day.kind)}}</span></div>
        <div class="diff-values">
          <span>本机 {{countLabel(day.localCount)}} 件 · {{day.localNotes}} 条简记</span>
          <span>云端 {{countLabel(day.cloudCount)}} 件 · {{day.cloudNotes}} 条简记</span>
        </div>
        <p v-if="day.notesDiffer">简记内容或数量也不同</p>
      </div>
      <p v-if="view.conflictPreview.truncatedDays" class="diff-footnote">
        这里只显示最近的部分不同日期，完整差异仍需要进一步核对。
      </p>
      <p class="diff-footnote">当前仅提供查看。请先分别保留两端记录；在安全合并流程上线前，不提供强制覆盖操作。</p>
    </section>

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
        <button v-if="view.remote.enabled&&(!view.remote.hasStoredBackup||view.phase==='review_cloud')" type="button" class="primary full"
          data-testid="first-backup" :disabled="view.busy"
          @click="controller.reviewFirst()">{{view.remote.hasStoredBackup?'核对并关联这台设备':'查看首次备份内容'}}</button>
        <button v-if="view.remote.enabled&&view.remote.hasStoredBackup&&view.phase!=='review_cloud'"
          type="button" class="primary full" data-testid="sync-now" :disabled="view.busy"
          @click="controller.syncNow()">检查并同步</button>
        <button v-if="view.remote.enabled&&(view.phase==='conflict'||view.phase==='review_cloud')"
          type="button" class="secondary full" data-testid="review-conflict"
          :disabled="view.busy" @click="controller.reviewConflict()">查看本机与云端差异</button>
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
.difference{margin:19px 0 0;border:1px solid var(--cloud-line);border-radius:8px;
  padding:17px 15px;font-size:13px;line-height:1.8}
.diff-intro strong{font-family:"Songti SC","Noto Serif CJK SC",serif;font-weight:500;font-size:19px}
.diff-intro p,.diff-footnote,.diff-day p{margin:7px 0;color:var(--cloud-muted);font-size:12px}
.diff-summary{padding:11px 0;border-bottom:1px solid var(--cloud-line)}
.diff-summary div{display:flex;align-items:center;justify-content:space-between;gap:10px;margin:9px 0}
.diff-summary span{color:var(--cloud-muted)}
.diff-summary b{font-weight:500;text-align:right}
.diff-summary p{font-size:12px;margin:12px 0 1px;color:var(--cloud-text)}
.diff-day{border-bottom:1px solid var(--cloud-line);padding:11px 0}
.diff-day-heading{display:flex;justify-content:space-between;font-weight:500}
.diff-day-heading span:last-child{color:var(--cloud-muted);font-size:12px}
.diff-values{display:flex;flex-direction:column;color:var(--cloud-muted);font-size:12px;gap:2px;margin:7px 0 0}
.diff-footnote{line-height:1.8;margin:12px 0 0}
@media(max-width:340px){
  .detail-line{font-size:13px}
  h2{font-size:28px}
  button{font-size:14px}
}
</style>
