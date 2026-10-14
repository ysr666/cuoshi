<script setup lang="ts">
import {ref} from 'vue'
import {onShow} from '@dcloudio/uni-app'
import Screen from '../../components/Screen.vue'
import {records,initialize,setTheme,replaceRecords,clearRecords,storageError} from '../../core/store'
import {exportBackup,parseBackup} from '../../core/backup'
import {saveBackupFile,selectBackupFile} from '../../platform/backupIO'
import {localDate} from '../../core/model'
import {notify} from '../../core/ui'
const busy=ref(false)
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
  <Screen><view class="header"><text class="brand">错事</text><text class="small-date">你自己的空间</text></view><view class="heading">设置</view><view class="subheading">让它更像你喜欢的样子。</view>
    <view v-if="storageError" class="warning">{{storageError}}</view>
    <view class="group"><text class="group-title">外观</text><view class="option" @click="select('paper')"><view><text>纸张与文字</text><text class="description">暖纸白、深灰文字，像一本私人手记</text></view><text>{{records.theme==='paper'?'●':'○'}}</text></view><view class="option" @click="select('modern')"><view><text>现代极简</text><text class="description">清爽中性色，把注意力交给数字与日期</text></view><text>{{records.theme==='modern'?'●':'○'}}</text></view></view>
    <view class="group"><text class="group-title">隐私与数据</text>
      <view class="option" @click="backup"><text>导出完整备份</text><text>↗</text></view>
      <view class="option" @click="restore"><text>导入备份</text><text>›</text></view>
      <view class="option danger" @click="clear"><text>删除全部记录</text></view>
      <text class="description">当前仅保存于此设备。没有账号登录、云同步或管理员后台；开发者不能远程读取这些记录。JSON 备份是明文文件，含私人简记与完整修改历史。请妥善保管。H5 与微信小程序支持普通备份文件交换；加密备份与原生 App 文件交换尚待实现。</text>
    </view>
    <view class="group"><text class="group-title">下一阶段</text><text class="description">微信与手机号登录、云同步和客服审核将另行接入经过安全验收的中国大陆服务端，必须先完成用户告知、权限和合规评估；不会自动上传本机数据。</text></view>
    <view class="footer">错事 · uni-app 多端预览 v0.4-alpha.3<br/>错了就错了，先放在这里吧。</view>
  </Screen>
</template>
<style scoped>
.group{margin-top:75rpx}.group-title{font-size:28rpx;color:var(--muted)}.option{display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid var(--line);padding:32rpx 0;font-size:30rpx}.option view{display:flex;flex-direction:column;gap:10rpx}.description{font-size:24rpx;color:var(--muted);line-height:1.85;display:block;margin-top:15rpx}.danger{color:#9a504a}.warning{color:#8a3b24;padding:18rpx 0}.footer{margin-top:85rpx;padding-top:30rpx;border-top:1px solid var(--line);color:var(--muted);font-size:25rpx;line-height:2}
</style>
