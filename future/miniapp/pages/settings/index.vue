<script setup lang="ts">
import {onShow} from '@dcloudio/uni-app'
import {ref} from 'vue'
import {state,start,retry,consent} from '../../../future/miniapp/runtime'
onShow(()=>{void start()})
function back(){uni.navigateBack()}
const confirmError=ref('')
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
 <view v-if="state.consentRequired" class="reauthorize">
  <text>云端保存授权已关闭。你的数字、简记与每次修改历史仍然保留；只有你主动重新确认，才会恢复自动上传。</text>
  <button class="button" @click="confirmAgain">重新确认自动云端保存</button>
  <text v-if="confirmError" class="confirm-error">{{confirmError}}</text>
 </view>
 <button class="button" @click="retry">检查连接状态</button>
 <view class="privacy">
 <text class="label">隐私与数据</text>
 <text>记录的数字、可选简记及每次修改历史在首次明确同意后自动上云。
  本机未提交草稿不会上传。网络异常时会提示并保留本机记录；不静默覆盖未同步的本机内容。</text>
 <text>当前 v0.5 仅为独立技术验证包，云域名和 AppID 未配置时不进行任何微信登录或上传。
  正式上线还需要账号注销、数据处理说明与真机验收。</text>
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
.privacy{border-top:1rpx solid #ded8ce;margin-top:90rpx;padding-top:32rpx}
.privacy text{display:block;font-size:26rpx;line-height:2;color:#6c675e;margin-bottom:25rpx}
.privacy .label{color:#292723;font-size:30rpx}
.footer{display:block;font-family:serif;margin-top:100rpx;color:#837d73}
</style>
