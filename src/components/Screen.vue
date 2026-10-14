<script setup lang="ts">
import { computed } from 'vue'
import { records, initialize } from '../core/store'
initialize()
const classes=computed(()=>records.value.theme)
</script>
<template>
  <view class="screen" :class="classes"><view class="shell"><slot/></view></view>
</template>
<style>
.screen{--bg:#f7f3eb;--ink:#292723;--muted:#6c675e;--line:#ded8ce;min-height:100vh;background:var(--bg);color:var(--ink)}
.screen.modern{--bg:#fcfcfc;--ink:#19202a;--muted:#626b77;--line:#e8ebee}
.shell{padding:calc(42rpx + var(--status-bar-height)) 48rpx 130rpx;max-width:860rpx;margin:0 auto}
.header{display:flex;align-items:start;justify-content:space-between;gap:15rpx}.brand{font-size:46rpx;font-weight:550;letter-spacing:6rpx}.small-date{font-size:24rpx;color:var(--muted);padding-top:15rpx}.heading{font-size:48rpx;margin-top:45rpx}.subheading{font-size:27rpx;color:var(--muted);line-height:1.8;margin-top:15rpx}
</style>
