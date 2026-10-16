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

## 进一步的原生页面验收（隔离记录）

在上述专用预览目录构建完毕后，可执行：

```sh
CUOSHI_WECHAT_QA_PROJECT=/path/to/isolated-wechat-build npm run test:refinement --prefix qa-wechat
```

该检查会创建编译后小程序的**临时副本**，只在临时副本的启动脚本注入测试记录，验证首页大数字和历史修改摘要、统计页正数/零值标记、日期详情历史时间，并保存临时截图到 `/tmp/cuoshi-native-refined-*.png`。脚本结束自动移除临时工程，**不会修改原预览工程或真实用户数据**。要求具有测试 AppID 权限、开发者工具已登录及服务端口已开启。

当前的 `miniprogram-automator@0.12.1` 无法直接穿透 uni-app 自定义组件查询内部子节点，因此只通过原生运行时的组件渲染数据核对首页数字，其余直接使用可见页面元素；这不等于完成了真机触摸验收。

## 状态与边界（2026-10-15）

- 微信开发者工具 2.02.2608080、macOS：原生自动化通过；uni-app H5/微信编译及 94 项业务检查通过。
- 官方微信预览二维码已生成，但**尚未完成真实手机上的手动验收**；二维码会过期。
- 测试依赖 miniprogram-automator 0.12.1 较旧，因此单独隔离。覆盖已知的 mkdirp/minimist/jpeg-js 高危依赖版本后，本测试目录 npm audit 为 0 高危、0 严重、5 中危；这些依赖不能进入应用运行时。升级 SDK 时要重新安全检查。
- 当前版本仅本地存储；没有微信/手机号登录、云同步、客服审核后台或正式上线授权。


## 上线前：文件分享专项与真机证据

微信开发者工具的自动化 SDK 可能无法真实打开或完成 `wx.shareFileMessage` 的 iPhone 聊天选择流程。因此，根工程另有 `npm run test:wechat:backup-bridge`，使用模拟原生 API 测试导出/选择/读取/清理的控制流，**这不属于真机 PASS**。

真正的上线阻断测试见 [WECHAT_IPHONE_BACKUP_QA.md](../docs/WECHAT_IPHONE_BACKUP_QA.md)，由持有测试预览权限的 iPhone 用户逐条进行，并把非敏感结果记录在该文档中。不要公开真实 JSON 文件或个人简记。
