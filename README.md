# 错事 · v0.4 微信小程序首发候选

> 安静、非评判式的私人记录工具。这里是**待验收的首发独立分支**，不是已上线或审核通过的小程序。

- 今天：只记录自己认为做错了多少件事，区分未记录和明确 0，可撤销
- 过去：按日历回溯修改，保留数字与简记变化的完整时间历史
- 简记：完全可选，几字或一句话即可；纸张与现代两套安静主题
- 本地存储：默认不上传开发者云端；完整 JSON 备份可从微信聊天导出并确认导入
- 无账号、手机号、云同步、管理员、排行榜、道德评分、广告或付费

## 构建与检查

```sh
npm ci
npm run typecheck
npm test
npm run test:wechat:backup-bridge
npm run build:h5
npm run build:mp-weixin
npm run test:release:scope
```

Chrome H5 交互测试由 CI 执行。微信真机必须另按 W01–W12 进行真实文件分享和恢复测试。

## 发布文件

- [首发独立范围与隔离](docs/RELEASE_SCOPE_MANIFEST.md)
- [首发冻结与阻断项](docs/RELEASE_V0_4_FREEZE_GATE.md)
- [iPhone 真机验收](docs/WECHAT_IPHONE_BACKUP_QA.md)
- [微信审核资料草案](docs/WECHAT_REVIEW_PACKET_DRAFT.md)
- [隐私处理说明草案](docs/PRIVACY_NOTICE_DRAFT.md)
- [依赖风险与处置记录](docs/DEPENDENCY_AUDIT_2026-10-16.md)

**未来微信/手机号账号、云备份、同步与管理员后台仍保留在 [原 Draft PR #4](https://github.com/ysr666/cuoshi/pull/4)，不属于当前首发。** 本分支不自动合并 `main`，不对真实用户开放云功能。
