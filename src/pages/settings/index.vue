<script setup lang="ts">
import {ref} from 'vue'
import {onShow} from '@dcloudio/uni-app'
import Screen from '../../components/Screen.vue'
import {records,initialize,syncFromStorage,setTheme,replaceRecords,clearRecords,storageError} from '../../core/store'
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
  try{
    syncFromStorage()
    if(storageError.value)throw Error('当前数据无法读取，已暂停导出，避免生成错误备份；请保留设备里的原始数据')
    const json=exportBackup(records.value)
    const message=await saveBackupFile(json,`错事备份_${localDate()}.json`)
    uni.showModal({title:'请确认备份已保存',content:message+'。备份包含私人文字，请妥善保管。',showCancel:false})
  }
  catch(e){notify(String(e))}
  finally{busy.value=false}
}
async function restore(){
  if(busy.value)return;busy.value=true
  try{
    const data=await selectBackupFile()
    const restored=parseBackup(data)
    const dates=Object.keys(restored.days).length,events=restored.events.length
    // Keep the import lock until the user has answered the destructive
    // confirmation; file selection and a second import cannot overlap it.
    await new Promise<void>((resolve,reject)=>uni.showModal({
      title:'确认导入这份备份？',
      content:`已通过完整性检查：${dates} 个日期、${events} 条历史。此操作会替换当前设备的全部记录并清除未提交草稿，建议先导出当前记录。`,
      confirmText:'替换导入',
      success:r=>{
        if(!r.confirm)return
        try{replaceRecords(restored);notify('备份导入完成')}
        catch(e){notify(String(e))}
      },
      fail:()=>reject(Error('无法显示导入确认，请稍后重试')),
      complete:()=>resolve()
    }))
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
    <view class="header"><text class="brand">错事</text><text class="small-date">你自己的空间</text></view>
    <view class="heading">设置</view>
    <view class="subheading">让它更像你喜欢的样子。</view>
    <text v-if="storageError" class="warning">{{storageError}}</text>
    <view class="group">
      <text class="group-title">外观</text>
      <view class="theme-row" role="button" @click="select('paper')">
        <view class="theme-info"><text class="option-title">纸张与文字</text><text class="description">暖纸白、深灰文字，像一本私人手记</text></view>
        <text class="selection">{{records.theme==='paper'?'◉':'◯'}}</text>
      </view>
      <view class="theme-row" role="button" @click="select('modern')">
        <view class="theme-info"><text class="option-title">现代极简</text><text class="description">清爽中性色，把注意力交给数字与日期</text></view>
        <text class="selection">{{records.theme==='modern'?'◉':'◯'}}</text>
      </view>
    </view>
    <view class="group">
      <text class="group-title">数据</text>
      <view class="option" role="button" @click="backup"><text>导出完整备份 ↗</text></view>
      <view class="option" role="button" @click="restore"><text>导入备份</text></view>
      <view class="option danger" role="button" @click="clear"><text>删除全部记录</text></view>
      <text class="privacy-detail">数字、简记和修改历史默认只保存在当前设备。清理缓存或更换设备可能丢失记录；导出的 JSON 含有私人文字，分享到微信聊天后请自行保管。未提交的草稿不在备份中。</text>
      <view class="option privacy-toggle" role="button" :aria-expanded="privacyOpen" @click="privacyOpen=!privacyOpen">
        <text>隐私与数据说明</text><text class="privacy-arrow">{{privacyOpen?'−':'＋'}}</text>
      </view>
      <view v-if="privacyOpen" class="privacy-expanded">
        <text>记录内容：你输入的数字、可选简记、未提交草稿、历史修改时间、操作时区以及外观偏好。</text>
        <text>本预览版没有账号、云同步或开发者自建的数据上传接口；不主动读取通讯录、定位、相册或微信聊天。</text>
        <text>仅当你主动导出或导入时，才会调用微信文件分享或聊天文件选择功能。普通 JSON 备份未加密，发送给聊天对象后，对方可能读取其中的文字和历史。</text>
        <text>你可以在日历中查看和修改记录，在设置中导出备份或删除本机全部记录。删除本机记录不会删除你以前分享或另行保存的备份。</text>
      </view>
    </view>
    <view class="footer"><text>错了就错了，先放在这里吧。</text><text class="version">错事 · 本地记录预览版</text></view>
  </Screen>
</template>
<style scoped>
.group {margin-top:38px;}
.group-title {display:block;color:var(--muted);font-size:14px;font-weight:400;padding-bottom:15px;}
.theme-row {display:flex;align-items:center;justify-content:space-between;gap:12px;padding:17px 0;min-height:79px;border-bottom:1px solid var(--line);}
.theme-info {display:flex;flex:1;flex-direction:column;gap:6px;}
.option-title {color:var(--ink);font-size:16px;font-weight:600;}
.description {color:var(--muted);font-size:14px;line-height:1.7;}
.selection {color:var(--ink);font-size:23px;min-width:28px;text-align:right;}
.option {display:flex;align-items:center;min-height:57px;border-bottom:1px solid var(--line);color:var(--ink);font-size:16px;}
.option.danger {color:#a3574b;}
.privacy-detail {display:block;margin-top:14px;color:var(--muted);font-size:14px;line-height:1.8;}
.privacy-toggle {justify-content:space-between;margin-top:12px;}
.privacy-arrow {color:var(--muted);font-size:20px;}
.privacy-expanded {display:flex;flex-direction:column;gap:11px;padding:14px 0 5px;}
.privacy-expanded text {display:block;color:var(--muted);font-size:14px;line-height:1.9;}
.warning {font-size:13px;color:#995343;padding:12px 0;}
.footer {display:flex;flex-direction:column;gap:14px;margin-top:60px;padding:23px 0;border-top:1px solid var(--line);font-family:var(--display-font);font-size:15px;color:var(--ink);}
.version {font-family:sans-serif;font-size:13px;color:var(--muted);line-height:1.7;}
</style>
