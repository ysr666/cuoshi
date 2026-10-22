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

## 2026-10-20 同日新增：四项定向补丁与实际安装验证（Draft PR #4）

以保持 DCloud 主版本、`vue@3.4.21`、Vite 编译器对端不变为前提，根 `package.json` 对几个间接构建依赖增加明确 `overrides` 并用官方 npm Registry 重新安装固定的 `package-lock.json`：

| 依赖/入口 | 原先 | 修补后 | 措施 |
| --- | --- | --- | --- |
| DCloud 微信构建工具引入的 `ws` | 8.18.0 | 8.22.0 | 针对 `@dcloudio/uni-mp-weixin` 仅覆盖对应 WebSocket 解析库 |
| `source-map-js` | 根目录 1.2.1，其他位置部分 1.2.2 | 所有解析副本 1.2.2 | 锁文件去掉重复旧版本，防止 source-map 解析 DoS 回归 |
| `adm-zip` | 0.5.16 | 0.6.1 | 构建工具解析压缩包的安全修补，防止旧版 ZIP 风险重入 |
| NVue 样式处理的 `postcss` | 8.4.45（根目录本来是已修补的 8.5.30） | NVue 8.5.31、根目录 8.5.30 | 仅替换有漏洞的嵌套副本；不重写根项目 Vue / DCloud 版本 |

在当前官方 npm advisory 快照（`npm audit --omit=dev --registry=https://registry.npmjs.org --json`）下，**受影响包**由 **44（27 high / 11 moderate / 6 low）下降到 39（22 high / 9 moderate / 8 low）**；低危受影响包数量有所上升，不应将整体解释为全覆盖解决。`ws`、`source-map-js`、`adm-zip`、`postcss`、`@dcloudio/uni-nvue-styler` 不再出现在当次漏洞对象中，具体引用的漏洞报告取决于 npm advisory 数据库变动。

CI 新增 `npm run test:future:patched-build-deps`，核对**锁文件所有嵌套副本**都高于审计公布的受影响范围，真实 `@dcloudio/uni-mp-weixin`/NVue 运行时解析到修补后的库，并检查微信原生打包 JS 不直接引用这些 Node 专用构建库。**没有把 Node 构建库未出现在小程序 JS 解释成完整安全认证**：仍需要确认由 DCloud 生成的 Vue runtime/模板是否有可达的 XSS 路径。

**未修复、必须保留为上线阻断的依赖风险**：`vue@3.4.21`、`@vue/server-renderer`、`@intlify` 旧子包、`vite@5.2.8`、DCloud 相关包以及其余构建工具链依赖。尤其 `@dcloudio/vite-plugin-uni@3.0.0-4080720251210001` 的 `peerDependencies.vite` **精确指定为 5.2.8**，直接改成新版 Vite 会违反插件的兼容合同，所以此轮**没有**强制升级 Vite、Vue 或 DCloud。下一次根框架升级需要单独隔离分支、完整兼容实验与两台真实微信设备验收，不能将 `npm audit fix --force` 当作可靠修复。

**因此仍未通过发布安全签核**。本次只是减少了已知暴露面，并建立针对性的版本回归门禁；SCA inventory Job 成功仍然只是采集成功。


## 2026-10-22 · 第二轮定向构建依赖修补（Draft PR #4）

在独立干净的 `design/editorial-ui-v04-preview` 工作区中，对五个**间接构建依赖**补充可独立验证的锁定：`@babel/core@7.29.6`（GHSA-4x5r-pxfx-6jf8）、`jpeg-js@0.4.4`（GHSA-xvf7-4v9q-58w6）、`phin@3.7.1`（GHSA-x565-32qp-m3vf）、`postcss-selector-parser@7.1.6`（GHSA-rj75-hqrm-r3gf）及 `esbuild@0.25.12`（GHSA-67mh-4wv8-2f99）。不改变已冻结的 DCloud、Vue、Vite 主包；`npm audit fix --force` **未使用**。

`npm audit --registry=https://registry.npmjs.org --omit=dev --json` 的同机对照：**39（22 High、9 Moderate、8 Low）→ 29（21 High、8 Moderate、0 Low）**，Critical 仍为 0。计数表示 npm 判定的受影响包数量，不代表消除了 10 条独立漏洞，更不代表整个前端安全通过。相关测试在 `tests/check-future-patched-build-deps.mjs` 校验全锁文件嵌套版本与实际安装版本；构建需保留 DCloud 的精确 Vite 5.2.8 peer 契约。

**仍阻断真实上线**：`braces`（当前 npm 公告覆盖现有 3.x）、`@vue/server-renderer` / Vue、`@intlify`、Vite 与 DCloud 间接依赖，以及最终微信 JS 可达性和供应链风险的人工审查。前端 CI SCA SUCCESS 表示完成审计采集，不能用作安全签字。发布必须等真实 AppID/备案/合法域名、国内云监控备份及两台真机完成。
