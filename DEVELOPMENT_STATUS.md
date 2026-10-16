# 错事 · v0.4 首发候选工程状态

**分支** `release/v0.4-rc1-prep` · **状态** BLOCKED_FOR_REAL_DEVICE_AND_SECURITY_REVIEW · **日期** 2026-10-17

- 从 main 独立建发布候选分支，仅挑选 v0.4 客户端与必需测试、隐私审核、真机 QA 资料；不混入未来云端后端与管理员。
- 原始 v0.4 设计及云端代码继续在 Draft PR #4；本分支不合并、不部署，也不替换旧 H5。
- 需要跑 npm typecheck、94 项核心测试、20 项微信备份接口、H5 浏览器全回归、H5/微信编译、build 包隔离、微信 DevTools 验收。
- 依赖的历史审计报告 44 项未逐个处置，必须基于实际运行包和 CI 构建权限进行分级/兼容修复。
- W01–W12 iPhone 聊天 JSON 文件备份/恢复为首发 P0，模拟器通过不能代替真人验收。
- AppID、运营主体、备案与隐私指引均待正式后台确认。

严格发布门槛见 [docs/RELEASE_V0_4_FREEZE_GATE.md](docs/RELEASE_V0_4_FREEZE_GATE.md)。
