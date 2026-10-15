<script setup lang="ts">
import {ref} from 'vue'
import {onShow} from '@dcloudio/uni-app'
import Screen from '../../components/Screen.vue'
import {records,initialize,setTheme,replaceRecords,clearRecords,storageError} from '../../core/store'
import {exportBackup,parseBackup} from '../../core/backup'
import {saveBackupFile,selectBackupFile} from '../../platform/backupIO'
import {localDate} from '../../core/model'
import {notify} from '../../core/ui'
const busy=ref(false),privacyOpen=ref(false)
onShow(()=>initialize())
function select(s:'paper'|'modern'){try{setTheme(s)}catch(e){notify(String(e))}}
async function backup(){
  if(busy.value)return
  busy.value=true
  try{const json=exportBackup(records.value);const message=await saveBackupFile(json,`错事备份_${localDate()}.json`);uni.showModal({title:'请确认备份已保存',content:message+'。备份包含私人文字，请妥善保管。',showCancel:false})}
  catch(e){notify(String(e))}
  finally{busy.value=false}
}
async function restore(){
  if(busy.value)return;busy.value=true
  try{
    const data=await selectBackupFile()
    const restored=parseBackup(data)
    const dates=Object.keys(restored.days).length,events=restored.events.length
    uni.showModal({title:'确认导入这份备份？',content:`已通过完整性检查：${dates} 个日期、${events} 条历史。此操作会替换当前设备的全部记录并清除未提交草稿，建议先导出当前记录。`,confirmText:'替换导入',success:r=>{
      if(!r.confirm)return
      try{replaceRecords(restored);notify('备份导入完成')}
      catch(e){notify(String(e))}
    }})
  }catch(e){const msg=String(e);if(!msg.includes('已取消'))notify(msg)}
  finally{busy.value=false}
}
function clear(){uni.showModal({title:'清除全部记录？',content:'这将删除当前设备中所有日期、简记及历史。无法撤销，请先导出备份。',confirmText:'继续',success:r=>{
  if(!r.confirm)return
  uni.showModal({title:'最后确认',content:'全部本地数据将被替换为空白记录。',confirmText:'删除全部',success:r2=>{if(!r2.confirm)return;try{clearRecords();notify('本地记录已清空')}catch(e){notify(String(e))}}})
}})}
</script>
<template>
  <Screen>
    <view class="header"><text class="brand">错事</text><text class="small-date">只为自己留下</text></view>
    <view class="heading">设置</view>
    <view class="subheading">用自己觉得舒服的方式记录。</view>
    <text v-if="storageError" class="warning">{{storageError}}</text>

    <view class="group">
      <text class="group-title">外观</text>
      <view class="theme-row" @click="select('paper')">
        <view class="swatch paper-swatch"><text>记</text></view>
        <view class="theme-info"><text class="option-title">纸张与文字</text><text class="description">温暖、安静，像一本随手翻开的手记</text></view>
        <text class="selection">{{records.theme==='paper'?'●':'○'}}</text>
      </view>
      <view class="theme-row" @click="select('modern')">
        <view class="swatch modern-swatch"><text>记</text></view>
        <view class="theme-info"><text class="option-title">现代极简</text><text class="description">干净、轻盈，让内容自然成为主角</text></view>
        <text class="selection">{{records.theme==='modern'?'●':'○'}}</text>
      </view>
    </view>

    <view class="group">
      <text class="group-title">你的数据</text>
      <text class="group-subtitle">目前只保存在这台设备，没有自动上传。</text>
      <view class="option" @click="backup"><text>导出完整备份</text><text class="arrow">↗</text></view>
      <view class="option" @click="restore"><text>导入备份</text><text class="arrow">›</text></view>
      <view class="option danger" @click="clear"><text>删除全部记录</text><text class="arrow">›</text></view>
      <view class="privacy-link" @click="privacyOpen=!privacyOpen"><text>关于隐私与保存方式</text><text>{{privacyOpen?'收起 −':'了解更多 +'}}</text></view>
      <text v-if="privacyOpen" class="privacy-detail">所有数量、简记和修改历史目前都存放在本机；不需要登录，也没有云同步。导出的 JSON 备份是明文，可能包含私人文字，请自行妥善保存。删除本机记录或清除微信缓存后，未备份的内容可能无法找回。未来如增加云端功能，将另行告知并征得必要授权。</text>
    </view>

    <view class="footer"><text>错了就错了，先放在这里吧。</text><text class="version">错事 · 跨端设计预览 v0.4</text></view>
  </Screen>
</template>
<style scoped>
.group { margin-top:69rpx; }
.group-title { display:block;color:var(--ink);font-size:31rpx;font-weight:600;padding-bottom:19rpx;letter-spacing:1rpx;border-bottom:1px solid var(--line); }
.group-subtitle { display:block;margin:18rpx 0 9rpx;color:var(--muted);font-size:24rpx;line-height:1.7; }
.theme-row { display:flex;gap:24rpx;align-items:center;min-height:135rpx;padding:23rpx 0;border-bottom:1px solid var(--line); }
.swatch { width:88rpx;height:88rpx;flex-shrink:0;display:flex;align-items:center;justify-content:center;border-radius:11rpx;border:1px solid var(--line);font-size:38rpx; }
.paper-swatch { background:#ede6d9;color:#3a322c;font-family:"Songti SC",serif; }
.modern-swatch { background:#e8ebef;color:#2d3440;font-family:sans-serif;font-weight:600; }
.theme-info { display:flex;flex:1;flex-direction:column;gap:10rpx; }
.option-title { color:var(--ink);font-size:29rpx; }
.description { display:block;color:var(--muted);font-size:23rpx;line-height:1.65; }
.selection { color:var(--ink);font-size:29rpx; }
.option { display:flex;align-items:center;justify-content:space-between;gap:18rpx;min-height:105rpx;border-bottom:1px solid var(--line);font-size:29rpx; }
.arrow { color:var(--soft);font-size:32rpx; }
.danger { color:#985e55; }
.privacy-link { display:flex;justify-content:space-between;gap:20rpx;padding:33rpx 0;font-size:23rpx;color:var(--muted);line-height:1.6; }
.privacy-detail { display:block;margin:-10rpx 0 30rpx;color:var(--muted);font-size:24rpx;line-height:1.9; }
.warning { color:#995343;padding:20rpx 0;font-size:24rpx; }
.footer { display:flex;flex-direction:column;gap:20rpx;margin-top:105rpx;padding-top:35rpx;border-top:1px solid var(--line);color:var(--muted);font-family:var(--display-font);font-size:25rpx;line-height:1.7; }
.version { font-family:sans-serif;color:var(--soft);font-size:21rpx;letter-spacing:1rpx; }
</style>