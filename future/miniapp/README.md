# 错事 v0.5 · 独立微信原生测试包

此目录只属于 Draft PR #4；`npm run build:future:mp-weixin` 在被 git 忽略的
`future/.generated-mp` 中生成独立源码和 `dist/build/mp-weixin`。
与 v0.4 的 `src/main.ts`、`src/pages.json`、`dist/build/mp-weixin` 完全分开。

可将生成目录导入微信开发者工具观察真实原生页面和首次告知。
默认 **无公网服务域名、无 AppID、不登录、不上传记录**。接真实服务须显式提供
`CUOSHI_V05_CLOUD_ORIGIN=https://...` 与经批准的隐私告知版本，再由微信
开发者工具配置合法 AppID、请求域名白名单，并准备对应真实后端。切勿把任何
AppSecret、令牌、用户数据或真实个人信息写入该构建配置。

保存完整历史/简记和账号归属由 `future/cloud/uniCloudHost.ts`、
`uniAccountRecords.ts`、`cloudRecordActions.ts` 负责。页面只在完成云端
告知和受验证的微信身份后启用记录操作。无法接云时提示而不会假装备份成功。

这是可编译的**原生开发测试包**，不是已通过真机的生产服务；UI 与实际
微信沙箱的账号登录、双机同步、杀进程恢复、离线授权、备案与隐私合规需要继续验收。
