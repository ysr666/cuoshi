<script setup lang="ts">
import { computed,watch } from 'vue'
import { records, initialize } from '../core/store'
initialize()
const classes=computed(()=>records.value.theme)
watch(classes,(theme)=>{
  const modern=theme==='modern'
  // #ifdef H5
  if (typeof document!=='undefined') document.body.style.backgroundColor=modern?'#f8f9fa':'#f6f2eb'
  // #endif
  try { uni.setTabBarStyle({backgroundColor:modern?'#f8f9fa':'#f6f2eb',color:modern?'#737a82':'#827b70',selectedColor:modern?'#22262b':'#302c27',borderStyle:modern?'white':'black'}) } catch { /* Tab bar not mounted yet; current theme still applies to page. */ }
},{immediate:true})
</script>
<template>
  <view class="screen" :class="classes"><view class="shell"><slot/></view></view>
</template>
<style>
.screen {
  --bg:#f6f2eb;--panel:#fbf8f2;--ink:#302c27;--muted:#827b70;--soft:#aaa297;--line:#dcd5c9;
  --display-font:"Songti SC","STSong","Noto Serif CJK SC",serif;
  min-height:100vh;background:var(--bg);color:var(--ink);font-family:"PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif;
}
.screen.modern {
  --bg:#f8f9fa;--panel:#ffffff;--ink:#22262b;--muted:#737a82;--soft:#9aa1a8;--line:#e2e5e8;
  --display-font:"PingFang SC","Helvetica Neue",sans-serif;
}
.shell { max-width:770rpx;margin:0 auto;padding:calc(40rpx + var(--status-bar-height)) 48rpx calc(165rpx + env(safe-area-inset-bottom)); }
</style>