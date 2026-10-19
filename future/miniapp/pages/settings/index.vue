<script setup lang="ts">
import {onShow} from '@dcloudio/uni-app'
import {ref} from 'vue'
import {state,start,retry,consent,cancelAccount,accountWasCancelled,restartAfterCancellation,cancellationOutcomePending,restartAfterUnconfirmedCancellation,recheckCancellationOutcome,pauseCloudSaving} from '../../../future/miniapp/runtime'
import {ACCOUNT_CANCELLATION_CONFIRMATION} from '../../../future/cloud/wechatSession'
onShow(()=>{void start()})
function back(){uni.navigateBack()}
async function restartNewAccount(){
 try{await restartAfterCancellation()}
 catch(e){deletionFeedback.value=e instanceof Error?e.message:'重新开始暂不可用'}
}
async function recheckUnconfirmed(){
 try{await recheckCancellationOutcome()}
 catch(e){deletionFeedback.value=e instanceof Error?e.message:'暂时无法核验'}
}
function resolveUnconfirmed(){
 uni.showModal({title:'注销结果仍未核验',
  content:'可能已注销，也可能仍有云端记录。如主动重新开始，本机旧记录不会关联新账号，且不能将旧账号视为已删除。',
  confirmText:'仍要开始',confirmColor:'#a04c3c',
  success:async result=>{
   if(!result.confirm)return
   try{await restartAfterUnconfirmedCancellation()}
   catch(e){deletionFeedback.value=e instanceof Error?e.message:'重新开始失败'}
  }
 })
}
const pauseBusy=ref(false),pauseError=ref('')
function requestPause(){
 if(pauseBusy.value||state.cloudPaused||state.stage!=='ready')return
 uni.showModal({title:'暂停自动云端保存？',
  content:'现有云端记录不会删除。暂停后仍可在本机记录，但新修改不再自动上传；再次主动确认后才会继续同步。',
  confirmText:'暂停上传',confirmColor:'#a04c3c',
  success:async result=>{
   if(!result.confirm||pauseBusy.value)return
   pauseBusy.value=true;pauseError.value=''
   try{await pauseCloudSaving()}
   catch{pauseError.value='本机已停止自动上传，但服务器关闭授权尚未确认。请联网后重试。'}
   finally{pauseBusy.value=false}
  }
 })
}
async function retryPause(){
 if(pauseBusy.value)return
 pauseBusy.value=true;pauseError.value=''
 try{await pauseCloudSaving()}
 catch{pauseError.value='服务器仍未确认关闭云端授权；本机自动上传保持暂停。'}
 finally{pauseBusy.value=false}
}
const confirmError=ref('')
const deletionOpen=ref(false),deletionInput=ref(''),deletionBusy=ref(false),deletionFeedback=ref('')
const cancellationText=ACCOUNT_CANCELLATION_CONFIRMATION
function onInput(e:Event){
 const detail=e as Event&{detail?:{value?:string}}
 deletionInput.value=typeof detail.detail?.value==='string'?detail.detail.value:''
}
async function requestCancellation(){
 if(deletionBusy.value||deletionInput.value!==cancellationText){
  deletionFeedback.value='请完整输入确认语后再注销';return
 }
 uni.showModal({title:'最后确认注销账号？',
  content:'将清除这个微信账号的私人云记录和身份关联。不能恢复；仅保留匿名月度统计及脱敏安全审计。',
  confirmText:'确认注销',confirmColor:'#a04c3c',
  success:async result=>{
   if(!result.confirm||deletionBusy.value)return
   deletionBusy.value=true;deletionFeedback.value=''
   try{
    await cancelAccount(cancellationText)
    deletionOpen.value=false;deletionInput.value=''
    deletionFeedback.value='服务器已确认注销，旧账号本机记录已锁定。'
   }catch{
    deletionFeedback.value='注销结果尚未核验；请查看顶部账号状态。旧记录没有在本机删除。'
   }finally{deletionBusy.value=false}
  }
 })
}
async function confirmAgain(){
 confirmError.value=''
 try{await consent()}
 catch(e){confirmError.value=e instanceof Error?e.message:'暂时无法确认，请稍后重试'}
}
</script>
<template>
<view class="screen">
 <view class="header"><text class="brand">错事</text><text @click="back">‹ 返回</text></view>
 <text class="title">设置</text>
 <text class="subtitle">让它更像你喜欢的样子。</text>
 <view class="row"><text>保存方式</text><text>云端自动同步</text></view>
 <view class="row"><text>当前状态</text><text>{{state.sync||'未连接'}}</text></view>
 <text class="help">{{state.message}}</text>
 <view v-if="state.cloudPaused" class="reauthorize">
  <text>本机自动上传已暂停。云端已有记录不会因此删除，未同步的本机记录仍会保留。</text>
  <text v-if="state.pausePending">服务器尚未确认关闭授权，请联网后重试。恢复上传前需要你再次确认。</text>
  <button class="button" v-if="state.pausePending" :disabled="pauseBusy" @click="retryPause">重试关闭云端授权</button>
  <button class="button" :disabled="pauseBusy" @click="confirmAgain">重新开启自动云端保存</button>
  <text v-if="confirmError" class="confirm-error">{{confirmError}}</text>
 </view>
 <view v-else-if="state.consentRequired" class="reauthorize">
  <text>云端保存授权已关闭。你的数字、简记与每次修改历史仍然保留；只有你主动重新确认，才会恢复自动上传。</text>
  <button class="button" @click="confirmAgain">重新确认自动云端保存</button>
  <text v-if="confirmError" class="confirm-error">{{confirmError}}</text>
 </view>
 <view v-if="cancellationOutcomePending()">
  <button class="button" @click="recheckUnconfirmed">重新核验注销结果</button>
  <button class="button danger" @click="resolveUnconfirmed">无法核验：了解风险并重新开始</button>
 </view>
 <button v-else-if="accountWasCancelled()" class="button" @click="restartNewAccount">重新开始（创建新账号）</button>
 <button v-else class="button" @click="retry">检查连接状态</button>
 <view v-if="state.stage==='ready'&&!state.cloudPaused&&!state.consentRequired" class="data-control">
  <text>自动保存默认开启。你也可以主动暂停上传，原有云端内容不会被删除。</text>
  <button class="button" :disabled="pauseBusy||state.sync!=='已同步'" @click="requestPause">暂停自动云端保存</button>
 </view>
 <text v-if="pauseError" class="confirm-error">{{pauseError}}</text>
 <view class="privacy">
 <text class="label">隐私与数据</text>
 <text>在首页点击日期，就能直接回看那天的数字、简记和完整修改历史。</text>
 <text>记录的数字、可选简记及每次修改历史在首次明确同意后自动上云。
  本机未提交草稿不会上传。网络异常时会提示并保留本机记录；不静默覆盖未同步的本机内容。</text>
 <text>当前 v0.5 仅为独立技术验证包，云域名和 AppID 未配置时不进行任何微信登录或上传。
  正式上线还需要正式隐私政策、注销结果回执验证、留存规则公示与真机验收。</text>
 </view>
 <view class="account">
  <text class="label">账号管理</text>
  <text>注销将清除该账号的私人云记录和微信身份关联。本机旧记录会被锁定，不会自动关联到新账号。后台只保留匿名月度统计与已脱敏安全审计。</text>
  <button class="button danger" :disabled="state.stage!=='ready'||deletionBusy"
    @click="deletionOpen=!deletionOpen;deletionFeedback='';deletionInput=''">申请注销账号</button>
  <view v-if="deletionOpen" class="delete-confirm">
   <text>此操作不可撤销。请先输入：</text>
   <text class="confirmation">{{cancellationText}}</text>
   <input :value="deletionInput" :disabled="deletionBusy" :placeholder="cancellationText" @input="onInput"/>
   <button class="button danger" :disabled="deletionBusy||deletionInput!==cancellationText"
     @click="requestCancellation">{{deletionBusy?'正在向服务器确认…':'继续注销（还需最终确认）'}}</button>
  </view>
  <text v-if="deletionFeedback" class="confirm-error">{{deletionFeedback}}</text>
 </view>
 <text class="footer">错了就错了，先放在这里吧。</text>
</view>
</template>
<style scoped>
.screen{min-height:100vh;background:#f7f3eb;color:#292723;padding:58rpx 50rpx 135rpx;font-family:"PingFang SC",sans-serif}
.header{display:flex;justify-content:space-between;align-items:center}
.brand{font-family:serif;font-size:50rpx;font-weight:600;letter-spacing:6rpx}
.header text:last-child{font-size:27rpx;color:#6c675e}
.title{display:block;font-size:49rpx;font-family:serif;margin:75rpx 0 14rpx}
.subtitle{display:block;font-size:28rpx;color:#6c675e;margin-bottom:60rpx}
.row{display:flex;justify-content:space-between;border-bottom:1rpx solid #ded8ce;padding:35rpx 0;font-size:29rpx}
.row text:last-child{color:#6c675e}
.help{display:block;color:#6c675e;font-size:25rpx;line-height:1.9;margin-top:25rpx}
.button{background:transparent;border:1rpx solid #ded8ce;color:#292723;font-size:27rpx;margin-top:35rpx}
.reauthorize{padding:28rpx 0;font-size:26rpx;line-height:1.8;color:#6c675e}
.reauthorize text{display:block}
.reauthorize .confirm-error{color:#9c604f;margin-top:16rpx}
.data-control{margin-top:35rpx;font-size:26rpx;color:#6c675e;line-height:1.8}
.data-control text{display:block}
.confirm-error{display:block;margin-top:18rpx;font-size:24rpx;color:#9c4e3f}
.privacy{border-top:1rpx solid #ded8ce;margin-top:90rpx;padding-top:32rpx}
.privacy text{display:block;font-size:26rpx;line-height:2;color:#6c675e;margin-bottom:25rpx}
.privacy .label{color:#292723;font-size:30rpx}
.account{border-top:1rpx solid #ded8ce;margin-top:55rpx;padding-top:35rpx}
.account text{display:block;font-size:26rpx;line-height:1.9;color:#6c675e;margin-top:18rpx}
.account .label{font-size:30rpx;color:#292723;margin-top:0}
.account .confirmation{font-weight:600;color:#9c4e3f;user-select:text}
.account .confirm-error{color:#9c4e3f}
.delete-confirm input{border:1rpx solid #ded8ce;padding:20rpx;margin-top:18rpx;font-size:26rpx}
.button.danger{border-color:#b99083;color:#9c4e3f}
.button[disabled]{opacity:.45}
.footer{display:block;font-family:serif;margin-top:100rpx;color:#837d73}
</style>
