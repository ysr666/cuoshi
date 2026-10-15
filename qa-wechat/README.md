# 微信小程序原生运行时验收

本目录是独立测试工具，不会被打包进「错事」H5 或微信小程序产物，也不使用云端真实用户数据。

## 首次准备
1. 在仓库根目录执行 `npm ci` 和 `npm run build:mp-weixin`。
2. 复制 `dist/build/mp-weixin` 到仓库之外的专用 QA 目录。在**该副本**的 `project.config.json` 中填入你有权限使用的测试 AppID（不要改仓库内的正式配置，也不要在仓库提交账号凭据）。
3. 登录微信开发者工具，并在「设置 → 安全设置」开启服务端口。
4. 在本目录执行 `npm ci` 安装隔离的自动化依赖。

## 运行

```sh
CUOSHI_WECHAT_QA_PROJECT=/path/to/isolated-wechat-build npm test --prefix qa-wechat
```

macOS 默认使用 `/Applications/wechatwebdevtools.app/Contents/MacOS/cli`，其他安装路径可通过 `WECHAT_DEVTOOLS_CLI` 指定。

测试内容：四个主入口、日历日期详情与历史、主题切换写入微信本地存储、重新打开后持久化。测试操作只针对专用 QA 副本，会修改其本地主题，因此**不得使用真实用户资料的工程**。

## 状态与边界（2026-10-15）

- 微信开发者工具 2.02.2608080、macOS：原生自动化通过；uni-app H5/微信编译及 94 项业务检查通过。
- 官方微信预览二维码已生成，但**尚未完成真实手机上的手动验收**；二维码会过期。
- 测试依赖 miniprogram-automator 0.12.1 较旧，因此单独隔离。覆盖已知的 mkdirp/minimist/jpeg-js 高危依赖版本后，本测试目录 npm audit 为 0 高危、0 严重、5 中危；这些依赖不能进入应用运行时。升级 SDK 时要重新安全检查。
- 当前版本仅本地存储；没有微信/手机号登录、云同步、客服审核后台或正式上线授权。