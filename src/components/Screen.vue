<script setup lang="ts">
import { computed,watch } from 'vue'
import { records, initialize } from '../core/store'
initialize()
const classes=computed(()=>records.value.theme)
watch(classes,(theme)=>{
  const modern=theme==='modern'
  // #ifdef H5
  if (typeof document!=='undefined') document.body.style.backgroundColor=modern?'#fcfcfc':'#f7f3eb'
  // #endif
  try { uni.setTabBarStyle({backgroundColor:modern?'#fcfcfc':'#f7f3eb',color:modern?'#818a95':'#837d73',selectedColor:modern?'#19202a':'#292723',borderStyle:modern?'white':'black'}) } catch { /* Tab bar not mounted yet; current theme still applies to page. */ }
},{immediate:true})
</script>
<template>
  <view class="screen" :class="classes"><view class="shell"><slot/></view></view>
</template>
<style>
.screen {
  --bg:#f7f3eb;--panel:#f7f3eb;--ink:#292723;--muted:#6c675e;--soft:#837d73;
  --line:#ded8ce;--raised:#f0ebe1;--accent:#675b4a;
  --display-font:"Songti SC","STSong","Noto Serif CJK SC","SimSun",Georgia,serif;
  --numeric-font:"Iowan Old Style","Baskerville","Times New Roman",Georgia,"Songti SC",serif;
  min-height:100vh;background:var(--bg);color:var(--ink);
  font-family:"PingFang SC","Noto Sans CJK SC","Microsoft YaHei",sans-serif;
}
.screen.modern {
  --bg:#fcfcfc;--panel:#fff;--ink:#19202a;--muted:#626b77;--soft:#818a95;
  --line:#e8ebee;--raised:#f1f3f5;--accent:#263c50;
  --display-font:"PingFang SC","Noto Sans CJK SC","Microsoft YaHei",sans-serif;
  --numeric-font:"Inter","SF Pro Display","Helvetica Neue",system-ui,sans-serif;
}
.shell { max-width:430px;margin:0 auto;padding:calc(32px + var(--status-bar-height,0px)) 25px calc(116px + env(safe-area-inset-bottom,0px)); }
@media (max-width:340px){.shell {padding-left:20px;padding-right:20px;}}
</style>