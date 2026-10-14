# 错事 · uni-app v0.4 Alpha.3 — 实机编译记录

更新：2026-10-15。项目位于用户授权 Mac 的独立目录 `~/Projects/cuoshi-uniapp-lab/app`。

## 当前已验证

- Mac：macOS Apple Silicon，Node 24.5.0、npm 11.7.0。
- 修复包版本冲突：`@dcloudio/types` 固定为 `3.4.19`，保存 `package-lock.json`。
- `npm ci`（未来重建）、`npm run typecheck`、`npm test`、`npm run build:h5`、`npm run build:mp-weixin`。
- 共 94 项模型/备份/平台存储模拟断言通过。
- H5 在真实 Google Chrome 无头窗口（390×844）操作通过：数字增减、撤销、简记新增、刷新持久化、日历、统计、设置、导出 JSON、窄屏检查，且无未捕获 JS 异常。
- 修复真实浏览器检查发现的问题：`Screen.vue` 中被自动作用域化的公共头部样式无法作用到子页面；简记提交后输入框未清空；Vue `textarea` 事件的类型检查错误。H5 输入字号调整为 16px。
- 已生成 `dist/build/h5` 及 `dist/build/mp-weixin`。微信小程序 `project.config.json` 使用 `touristappid`（仅编译用）。

## 如何复现

```sh
npm ci
npm run typecheck
npm test
npm run build:h5
npm run build:mp-weixin
# 先在一个终端运行：
python3 -m http.server 4177 --bind 127.0.0.1 --directory dist/build/h5
# 再在另一个终端运行：
npm run test:h5
```

`tests/check-h5-flow.cjs` 要求 Mac 安装 Google Chrome，并以隔离浏览器上下文执行测试，不读取正式「错事」用户记录。

## 未完成 / 不可宣称

- 本 Mac 只有普通 WeChat.app，未发现「微信开发者工具」。**未完成小程序工具内预览、扫码真机、审核或发布**。
- 未配置你的小程序 AppID；需要开发者账号确认后填入，**不应提供 AppSecret**。
- 没有微信/手机号登录，也没有客服与内容安全审查后端。正式中国大陆运营前需完成适用备案、真实隐私政策、授权与访问审计流程。
- 当前仅本地数据，没有私密记录上传。原 `https://cuoshi-ysr-v02.onrender.com` 网页版没有被修改。
- 原生 Android/iOS 打包、文件导入导出仍待适配。小程序本地存储不具备通用的跨进程原子事务保证。

## 交付标准

保留全部历史修改；未记录不同于显式 0；简记独立于数字；无道德评价、打卡、排行榜。默认本地存储，未来云同步必须用户主动选择；客服与内容审核读取云端正文须限权、告知、留痕。

## 2026-10-15 后续回归（Alpha.3）

- uni-app H5 与微信小程序构建、vue-tsc 类型检查成功；94 项核心/备份/存储模拟断言通过。
- 新增 `npm run test:h5:extended`：Chrome 验证草稿刷新保留、简记编辑、主题持久化、完整 JSON 导出与恢复、超过 5 条的历史默认折叠与展开，全部通过。该浏览器测试使用全新隔离上下文，不读取真实用户记录。
- 微信开发者工具 2.02.2608080 已安装到 Mac；首次图形化初始化尚未完成，命令行打开项目会报 `.cli` 配置缺失；因此还未完成微信 IDE 模拟器与真机验收。
- 微信/手机号登录及云服务仍未接入，本地记录没有上传；正式发布需要 AppID、用户授权、隐私文档、备案和权限审计。
