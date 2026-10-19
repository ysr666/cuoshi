# 错事 v0.5 · 上线前依赖风险分流（2026-10-20）

**发布判定：仍有待处理依赖风险，不能将 SCA Job SUCCESS 解释成漏洞已经消除。** 本文基于锁文件与 npm 官方 Registry 的只读审核结果；没有修改或更新任何依赖版本，也没有使用测试数据冒充生产验收。

## 可复现命令及当次事实

运行环境：2026-10-20 本地 Mac、项目 Draft PR #4 分支；仅执行只读查询：

```
npm audit --registry=https://registry.npmjs.org --omit=dev --json
(cd future/server && npm audit --registry=https://registry.npmjs.org --omit=dev --json)
```

| 范围 | 官方 npm advisories 审核结果 | 说明 |
| --- | --- | --- |
| 根包 `package-lock.json`（npm `--omit=dev`） | **44 个受影响包**：27 high、11 moderate、6 low、0 critical（当次报告） | uni-app/Vue 编译/运行时的依赖树均存在于根包 `dependencies`；`--omit=dev` 不等于每项都进入了最终微信 JS |
| 独立 Node 后端 `future/server/package-lock.json`（npm `--omit=dev`） | **0** 条漏洞报告（当次） | 独立生产后端的显式运行依赖为 `pg`，这是 npm advisory 当次结果，不证明不存在其他软件/配置漏洞 |

受影响项集中在 `@dcloudio/uni-*`、`@intlify/*`、Vue、Vite、Babel 及其间接依赖；列表中也包含高危级别的 `ws`、`postcss` 等工具链包。**不能**仅凭包名就断言微信客户端真的能够触发其中每一种攻击，也不能仅凭最终包扫描而宣称整条供应链没风险。

此前 Mac 默认 Registry 是 `registry.npmmirror.com`，它对 npm advisory endpoint 返回 404 `NOT_IMPLEMENTED`。**镜像站审计失败不代表“无漏洞”**；必须显式使用 `https://registry.npmjs.org` 或参考 GitHub Actions 的官方报告，并区分网络失败和有效的漏洞扫描结果。

## 发布前必须有的处置证据

1. **重新确认最新风险**：在选定最终 npm 锁文件 SHA 和候选小程序 JS 后，对官方 Registry 重新执行根包及后端两份审计，记录报告日期、准确漏洞受影响包和 CVE/GHSA。
2. **按可达性逐项评估**：对风险分别注明是否存在于最终微信小程序运行包、仅构建/上传机器、或 Node 生产环境；高危项若可从未授权输入触达，必须升级、修补或修改配置，并执行完整回归。不要把 npm 的统一严重度等同于实际暴露面。
3. **框架升级需先隔离验证**：根包使用锁定的 DCloud uni-app 编译器；不能盲目运行 `npm audit fix --force` 或让半更新的组件破坏跨设备历史、账号隔离/云同步。升级应单独 PR、在合成微信 + Chrome + 真机中全部验证后才考虑替换首发候选锁文件。
4. **无修复或业务不可达的风险**：必须留下具体 CVE、修复状态、攻击途径及为何无法从微信包/后端外部触达的证据、建议期限和运营者书面接受；没有完成风险评审不能宣称已上线安全通过。
5. **生产隔离**：后端不运行前端构建器；部署只用后端独立锁文件、Node 22+ 与受限用户，且有网络/文件权限、防火墙、密钥托管和监控的人工验证记录。对构建服务器限制外网和凭据权限，不把含私人数据的环境变量注入 npm 安装或打包流水线。

## 与自动化的边界

现有 GitHub Actions 中的 Official npm SCA inventory Job **即使 SUCCESS 也可能仅表示“收集到了报告”**，不是安全审核通过。v0.5 功能已冻结，若最终出现明确可利用漏洞，只做阻断级修复并重新验证，不顺手增加导出、AI、统计或社交。

**剩余阻断**：正式服务域名和运维账目、备份保留期限、微信 AppID/备案、两台真机和最终生产候选的全部依赖风险处置未完成。本文是记录当前风险，不是批准发布。


## 自动化阻断规则更新

独立 PostgreSQL 云后端的 GitHub CI 在 `npm ci --prefix future/server` 后，现直接执行 `npm audit --prefix future/server --omit=dev --audit-level=high --registry=https://registry.npmjs.org`；**任何 backend high/critical 报告或官方审计端点错误都会令数据库 Job 失败**，不会把网络无法审计当成 0 风险。根包的 uni-app/Vue 依赖保留既有完整 advisory 库存与上文逐项风险分流，不能为了让 CI 变绿粗暴强制更新依赖。
