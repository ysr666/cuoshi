<script lang="ts">
export default {}
</script>
<style>
page { min-height:100%; background:#f6f2eb; font-size:14px; }
view,text,button,input,textarea { box-sizing:border-box; }
button { font-size:inherit; } button::after { border:none; }
.header { display:flex;align-items:flex-start;justify-content:space-between;gap:20rpx;padding:0 0 30rpx;border-bottom:1px solid var(--line);min-height:72rpx; }
.brand { font-family:var(--display-font);font-size:44rpx;font-weight:500;letter-spacing:5rpx;color:var(--ink);line-height:1.35; }
.small-date { font-size:23rpx;letter-spacing:1rpx;color:var(--muted);text-align:right;line-height:1.6;padding-top:10rpx; }
.heading { display:block;font-family:var(--display-font);font-size:62rpx;font-weight:500;letter-spacing:2rpx;margin-top:62rpx;line-height:1.22; }
.subheading { display:block;font-size:25rpx;color:var(--muted);line-height:1.75;margin-top:18rpx;letter-spacing:.3rpx; }
/* #ifdef MP-WEIXIN */
.header { position:relative;min-height:110rpx; }
.header .small-date { position:absolute;right:0;top:66rpx;padding-top:0; }
/* #endif */
</style>