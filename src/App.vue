<script lang="ts">
export default {}
</script>
<style>
page { min-height:100%;background:#f7f3eb;font-size:14px; }
view,text,button,input,textarea {box-sizing:border-box;}
button {font-size:inherit;}
button::after {border:none;}
.header { display:flex;align-items:flex-start;justify-content:space-between;gap:12px;min-height:92px; }
.brand {font-family:var(--display-font);font-size:25px;font-weight:600;letter-spacing:.12em;line-height:1.3;}
.small-date {font-size:14px;color:var(--muted);letter-spacing:.02em;padding-top:9px;line-height:1.5;text-align:right;}
.heading {display:block;font-family:var(--display-font);font-size:27px;font-weight:500;margin-top:6px;line-height:1.45;}
.subheading {display:block;font-size:15px;color:var(--muted);line-height:1.8;margin-top:8px;margin-bottom:24px;}
/* #ifdef MP-WEIXIN */
.header {position:relative;min-height:106px;}
.header .small-date {position:absolute;right:0;top:39px;padding-top:0;}
/* #endif */
</style>