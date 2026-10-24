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


### 2026-10-22 · 移除非首发依赖（v0.5 安全与体积收敛）

经源码引用检查与隔离构建验证，删除根包未用于 H5/微信端的 `@dcloudio/uni-app-plus`、显式 `vue-i18n` 直接依赖，以及未纳入首发范围的原生 App 调试脚本 `dev:app`。未来如果需要正式原生 App，应在独立产品范围和验证下恢复，不向首发小程序追加功能。没有改变微信/云端业务数据格式，v0.4 / PR #5 完全未修改。

在相同 npm Registry 版本快照下，从上一补丁的 **29（21 High / 8 Moderate / 0 Low）** 进一步减为 **25（19 High / 6 Moderate / 0 Low）**；这是传递依赖影响范围缩小，不是宣称修复了 4 条独立安全公告。剩余依赖风险仍待人工签核；修补后 H5、v0.4 编译隔离、v0.5 原生运行、核心数据测试及 GitHub CI 必须继续通过。

### 2026-10-22 · npm 10 / npm 11 跨版本锁文件一致性修复

第一次移除非首发直接依赖后，macOS npm 11 的 `npm ci` 通过，但 GitHub Node 22 / npm 10.9.9 的 `npm ci` 因旧版 DCloud NVue 的精确 `postcss@8.4.45` 嵌套锁解析失败（`EUSAGE`）。该失败并非业务测试通过，也不能被忽略。现把原仅针对 NVue 的 `postcss@8.5.31` 安全覆盖改为**统一传递依赖覆盖**，并使用 CI 同款 npm 10.9.9 重建 `package-lock.json`；必须分别通过 npm 10 清洁安装、实际根/嵌套 PostCSS 版本检查、H5/微信双端构建及 v0.5 原生离线测试后，才能推送。PostCSS 不升级至新的主版本，也不改写 DCloud 或 Vite 的精确 peer 约束。首发安全审核仍为 BLOCKED。

### 2026-10-22 · DCloud Intlify 传递依赖安全更新

对 `@dcloudio/uni-cli-shared` 仍精确要求的 `@intlify/*@9.1.9` 旧链添加**七个组件统一 9.14.5** 的 npm `overrides`：`core-base`、`message-compiler`、`message-resolver`、`runtime`、`vue-devtools`、`shared` 与 `devtools-if`。旧版本包含 `GHSA-p2ph-7g93-hw3m`（消息解析相关）及 `GHSA-x8qp-wqqm-57ph`（core-base）公告；新版锁文件确保它们不再存在于安装树。仅更新传递构建依赖，不更改 uni-app、Vue、Vite 主框架、私人记录格式或小程序产品功能。

锁文件由 GitHub CI 同款 npm 10.9.9 重建并清洁安装，`tests/check-future-patched-build-deps.mjs` 新增实装/嵌套版本的防回退断言，H5、原生微信编译、原生包安全及离线同步模拟检查均已通过。**仍有未完成安全风险**，尤其 Vue SSR、Vite、`braces` 的独立漏洞与编译器链攻击面需要持续评估。不能因构建通过而授予正式发布资格；npm 官方实时风险总数需要以本轮 GitHub Actions 采集报告为准，不能用离线估算代替。

#### 2026-10-22 · 官方 npm 实时审计与网络重试边界

安装七项补丁后使用联网 npm Registry 的 `npm audit --omit=dev --fetch-retries=0 --fetch-timeout=12000 --json` 查询，前端受影响包为 **20 个（20 High、0 Moderate、0 Low、0 Critical）**；上一次为 25 个（19 High、6 Moderate）。计数变动不能等同于修复了五个独立漏洞，且新严重程度分类由官方数据决定；Intlify 不再出现在受影响对象清单。

这次发现 GitHub 和 Mac 的 npm 审计请求可能长时间卡住，因此对仓库 CI 的前端报告与独立后端审计都设置了**一次网络重试、每请求 15 秒超时**。仍保持失败即阻断：前端需要机器可解析的无接口错误的真实报告，后端 High/Critical 或审计失败仍是 Job 失败。不要将 `npm audit --offline` 可能返回的零值冒充真实的安全结论；也不因这里的审计结果解除发布阻断。

#### GitHub PostgreSQL Job 官方安全审计兼容性修复

CI 在 Node 22 / 默认 npm 10.9.9 下使用 `npm audit --prefix future/server`，等待五分钟后被 npm Registry 旧版 `/-/npm/v1/security/audits/quick` 端点以 HTTP 400「Invalid package tree」拒绝。此处是安全审计接口失败，**绝不能**当作后端零漏洞或放宽检查。该错误发生在正式数据库集成步骤之前，并不是 PostgreSQL 断言失败。

本轮将这个独立 Job 的审计进程切换到精确版本 `npm@11.7.0`，在 `future/server` 工作目录执行，并继续使用官方 Registry、High/Critical 非零退出及有界重试。`npm ci` 和生产部署仍使用独立后端锁文件，不把 npm 11 工具包添加到产品依赖树。真实审计端点不可达、报告无效或出现高危仍使 CI 失败，不提供强制放行。

### 2026-10-24 · 账号隔离：服务端误路由响应必须在 HTTP 边界拒绝

复查发现，自动同步的高层有 ownerId 与摘要校验，但底层已登录的备份 HTTP 适配器原先对**结构正确、归属却是另一个用户**的云端 GET 快照或上传成功回执仅做字段类型检查，仍可能将其交给后续调用者；而云优先控制器对部分归属异常可能仅提示一般同步故障，未持久撤销旧账号的离线许可。

现将校验前移：GET 只允许返回当前已核验 owner 的快照；PUT 的 accepted/replayed 回执、accepted 快照都必须属于当前 owner，回执幂等键必须等于当前请求，accepted 的快照 revision/digest 必须与回执一致。若发生跨账号响应，一律抛出独立 `sync_cloud_owner_mismatch` 安全异常；自动同步及云优先控制器将其视为身份边界失效，而非网络中断，通知原生运行时锁定当前账号操作并持久隔离旧的离线权限，**不删除本地私人历史，也不将外账号记录写入本机**。

合成双账号测试涵盖 GET 混入外账号、PUT accepted/replayed 外账号回执、快照归属错误、幂等键不匹配和回执/快照不一致，同时验证合法回执与自动补传不受影响。测试采用虚构身份，不代表已在正式微信账号、真实 HTTPS 后端或双真机上验收。尚未完成生产安全与隐私签核，发布保持阻断。

### 2026-10-24 · npm 官方注册表再次核验

已使用官方 registry 在线查询：根依赖审计 24 个受影响包（19 High、2 Moderate、3 Low、0 Critical），仅统计非开发依赖仍有 15 High。问题主要集中在冻结版 DCloud/Vue 编译栈及其间接依赖，不等于这 15 项全都实际打入原生小程序；也不能据此推断无可利用漏洞。独立后端 CI 继续强制阻断 High/Critical。鉴于 DCloud 插件精确要求旧 Vite peer 版本，不能盲目执行强制升级，正式审核需验证编译产物可达性、完成框架兼容试验及实机验收。

### 2026-10-24 · DCloud Express 4.x 传递构建依赖定向修补（PR #4）

已核实冻结版 `@dcloudio/vite-plugin-uni@3.0.0-4080720251210001` 在其依赖列表中把 Express 精确固定为 `4.20.0`，而该旧版及其依赖的 `body-parser`、`qs`、`cookie`、`send`、`serve-static`、`path-to-regexp` 含已公布的 DoS/XSS 风险。此次**不改变 DCloud、Vue、Vite 主框架的版本**；仅添加根层 `overrides.express=4.22.3`，保留 Express 4.x API 合同，通过全新 `npm ci --registry=https://registry.npmjs.org --ignore-scripts` 验证真实插件读取到 Express 4.22.3，并核对其 6 个安全更新后的传递组件版本。

官方 npm registry 的同日对照（同一 Mac、同一命令、非离线估算）：根 `npm audit --json` 从 **24 包（20 High / 1 Moderate / 3 Low / 0 Critical）**降为 **17 包（17 High / 0 Moderate / 0 Low / 0 Critical）**；影响统计里的 7 个包从受影响清单消失，不等于只修复/清理了 7 条独立公告。`npm audit --omit=dev` 仍有 **15 个 High**，仍涉及 DCloud 依赖和 Vue SSR。根项目包括前端构建工具与 H5 所需框架，风险清单不是微信原生最终可达漏洞数量，不能直接解读为可发布。

`tests/check-future-patched-build-deps.mjs` 将 Express 及全部六个传递组件的准确版本、嵌套副本、DCloud 插件实际 Node 解析结果纳入 CI 防回退；原有微信输出包不含 Node 构建器文件的检查继续执行。DCloud Vite 插件仍精确依赖 `vite@5.2.8`，该版本有未关闭的 dev server 漏洞，因此 `vite.config.ts` 新增 `server.host` 与 `preview.host` 均绑定 `127.0.0.1`，实测 Vite 解析生效；**此举只缩减本地网络暴露，不修复 Vite 漏洞**。正式云端不托管开发服务器。测试包含 TypeScript、H5、微信、v0.5 独立原生构建与 v0.4 隔离，真实 CI 仍需通过后才能合并。

不要执行破坏性 `npm audit fix --force`，也不要把 Vue 3.5.x 或 Vite 主版本强制覆盖冻结 DCloud 插件。在有兼容性实验、原生包风险可达性审核、正式真机测量前，**上线安全状态仍为 BLOCKED**。本次没有访问真实生产数据、AppID、服务器或密钥。

### 2026-10-24 · Vue SSR 与旧 Vite 安全可达性新增自动化门禁（PR #4）

查阅 npm 当前（10 月 24 日）官方 Vue3 标签：`@dcloudio/{uni-app,uni-components,uni-h5,uni-mp-weixin}` 和 `@dcloudio/vite-plugin-uni` 的 Vue3 标签已推进到 `3.0.0-5030320261023001`。但检查该标签的**实际包元数据**，Vite 插件仍精确要求 `vite@5.2.8`，内部 `@vue/shared` / Vue 编译器仍精确要求 `3.4.21`，`uni-h5` 继续依赖 `@vue/server-renderer@3.4.21`。因此仅替换整套 DCloud 为这一最新版**不能视为修复**旧 Vite 与 Vue SSR 漏洞。为防破坏首发兼容性，本轮不对冻结的 DCloud/Vue/Vite 组件做无收益的盲目升级。

Vue SSR 风险 `GHSA-g2v6-rqmx-r4w6`（`@vue/server-renderer` 的动态 HTML 属性名检查未拒绝 CR 字符），官方修复于 `3.5.42`。触发前提是**服务端将外部可控 HTML 属性映射渲染成响应文本**。目前「错事」的生产云后端使用独立 `pg` 依赖、未加载 Vue SSR 运行时；H5 构建为静态客户端，微信输出为小程序包。**这只是攻击面证据，不是漏洞本身已修复、没有其他攻击路径或能够解除上线阻断。**

新增 `tests/check-future-framework-boundary.mjs`：

- 核对根 DCloud、Vue、Vite 锁版本与插件精确 peer；不允许误报已升级。
- 通过实际 `vite.resolveConfig()` 验证开发/预览监听仅限 `127.0.0.1`、禁止无意换端口。
- 完整遍历最终 H5、v0.4 微信预览、v0.5 独立微信原生包，拒绝意外的 `.env`、私钥、源码映射、npm 依赖清单、Node SSR helper 名称、Vite 开发客户端和 Node 工具链入口等**可静态识别的暴露标记**。
- 核对独立 PostgreSQL 后端运行依赖与 TypeScript 源码，防止引入 DCloud/Vue SSR/Vite/Express 作为云端执行依赖。
- 用专门的错误样本验证 SSR 动态 helper、Vite 客户端、Node 工具引用和 `.env` 检查**真的会失败**；CI 在构建完成后跑同样检查，输出 `cuoshi-framework-exposure-<run_id>` JSON 证据，里面明确 `releaseApproved=false`。

**重要局限**：静态字符串扫描不能证明混淆/压缩 JS 内不存在等价代码，也不能代表实际授权、注入路径、微信运行时、云部署或供应链已经人工验证。其价值是降低可识别的 SSR/dev 构建代码误入产品产物的概率、保证后续框架升级有可重复的回归基线。官方根依赖 17 个 High 告警仍保留；上线判定继续 `BLOCKED`，CI SUCCESS 只说明此阶段自动化检查通过。

### 2026-10-24 · Vue SSR 修复版定向兼容实验及安全落地（PR #4）

**本轮不再靠推测框架无法更新。** 使用两个与 Draft PR #4 独立的 Git worktree、官方 npm Registry、npm 10.9.9 clean install 与真实 Chrome 检查，实际比对如下：

| 隔离实验 | 官方 npm audit（全依赖） | 本地编译及运行验证 | 处置 |
| --- | --- | --- | --- |
| 原候选 Vue 3.4.21 / Vue SSR 3.4.21 | 17 High / 0 Moderate | H5 与微信当前验收通过 | 作为实验基线 |
| 全量 Vue 3.5.42（运行时及编译器） | 1 High / 1 Moderate | TypeScript、H5/微信编译、原生离线模拟通过；**H5 浏览器主页面无法挂载**，报 `Cannot assign to read only property '_'` | **禁止合入**，表明旧 DCloud H5 运行时代码与 Vue 3.5.x 存在实际不兼容 |
| **仅覆盖 `@vue/server-renderer@3.5.42`**，保留客户端 Vue 3.4.21 | **1 High / 1 Moderate** | H5 320/390/430px 计数、导航与主题重载、隐私页面；微信正常编译；v0.5 原生离线/重连、历史与账户隔离；云设置浏览器 114 项回归均通过 | **采用此定向修复** |

修复方式：根 `package.json` 仅为间接依赖添加 `overrides['@vue/server-renderer']='3.5.42'`，并锁定 npm 10.9.9 生成的 `package-lock.json`。`vue@3.4.21`、`@vue/runtime-core@3.4.21` 和 DCloud 主编译器保留不变。SSR 3.5.42 内部使用其自己的编译/运行子依赖，npm 10 的锁树以独立嵌套副本解析；不把新的 Vue 3.5 运行时混入 H5 的原根运行时。官方 npm 审计中 **15 个受影响包记录**从高危清单消失，是一条传递依赖漏洞链的影响计数变化，**不代表修了 15 条不同 CVE，也不保证 SSR 3.5.42 与所有未经测试的 DCloud 路径兼容**。

测试不仅检查锁文件：`tests/check-future-vue-ssr-patch.mjs` 实际调用由 `@dcloudio/uni-h5` 解析的 SSR `ssrRenderDynamicAttr()`，验证危险的 CR/LF/TAB 与引号/尖括号属性名不再输出 HTML；`tests/check-future-patched-build-deps.mjs` 验证根/嵌套 SSR 版本及 DCloud H5 的模块解析、保留 Vue 3.4.21 浏览器运行时。此前新增 `test:future:framework-boundary` 同步核对实际安装的修复版。**这些行为测试不是全套浏览器 XSS 渗透测试**，也不意味着其它注入风险自动消失。

`npm audit --omit=dev --json` 在本轮官方 Registry 检测为 **0 Critical、0 High、0 Moderate、0 Low**。为防未来回退，`dependency_audit` CI 的机器可读审计新增 `--enforce-runtime-no-high`：一旦**运行依赖**出现 High/Critical，或官方审计端点不可用，即阻断 CI。此门禁与独立 Node PG 后端的高危阻断互为补充。**整个根依赖仍有 1 High（`@dcloudio/vite-plugin-uni`）和 1 Moderate（`vite@5.2.8`）**，仅存在构建链；CI 不会把它们当作自动已修复。Vue 3.4.21 仍是旧版本，应继续跟踪官方其他未知公告。

剩余 Vite/DCloud 工具链因插件 `peerDependencies.vite` 精确为 `5.2.8`，不能直接升级到 Vite 7 而无视版本合同。开发服务器继续绑定 `127.0.0.1`；构建环境不持有生产用户秘密，生产 Node 只运行独立 PG 锁文件；微信正式上线仍须真实 AppID、合规审核、HTTPS/最小权限运维与**两台设备的真实同步验收**。**发布安全状态继续 BLOCKED，CI 绿灯只说明代码检查通过。**

### 2026-10-24 · Vite 6.4.5 独立升级实验与旧版开发服务 Host/Origin 加固

在 Git worktree `/tmp/cuoshi-vite645-spike-1024`（不改 PR #4）验证了 `vite@6.4.5`：官方 npm audit 全依赖 0 条当前报告告警，TypeScript、H5、微信构建、320/390/430px H5 浏览器计数及导航、v0.5 原生离线/重连、云界面 114 项检查均通过。然而其安装要求 npm 的 `--legacy-peer-deps`，且 `npm ls --all` 显示 DCloud、`@vitejs/plugin-vue`、`@vitejs/plugin-vue-jsx`、`@vitejs/plugin-legacy` 的多个 Vite peer 版本不兼容，以及 Vite 6 引入的 yaml、picomatch 解析问题；GitHub 现用无绕过的 `npm ci` 不能接受这个依赖树。**故实验不合入、未使用全局 legacy-peer-deps、也不把审计 0 视为安全签核。** 正式开发仍保留 `vite@5.2.8` 与 DCloud 精确版本合同，并继续跟踪兼容的供应商修复。

本轮在 `vite.config.ts` 增加前置 Connect HTTP Host/Origin 严格校验：仅接受 localhost / 127.0.0.1 Host，以及同源或无 Origin 的请求；其余拒绝 403 并禁止缓存。开发及预览仅绑定 IPv4 loopback、禁用跨域响应。DCloud `uni()` 配置阶段会重新打开 HMR，因此另在 `configResolved` 阶段显式关闭；禁用的 HMR 会降低本地开发时的热更新便利性，但避免了 WebSocket 绕过 HTTP Connect 校验的路径。新增 `tests/check-vite-loopback-guard.mjs`，用真实 loopback HTTP 请求对开发和预览两套入口检查恶意 Host、DNS 回绑定域名、跨站 Origin、非同源端口及非法端口；更新现有框架门禁检查最终 Vite 配置确实关闭 HMR / CORS。这是旧版开发服务的**临时防御性限制，不是 Vite 漏洞修复**，不能将开发服务暴露到公网，也不能替代供应商升级。上线阻断继续保持，生产只分发构建产物，不运行开发服务器。

### 2026-10-24 · 独立云界面预览服务器加固（仅开发工具）

复核官方 npm Registry：当前根依赖依然有 **1 High / 1 Moderate**，集中在 DCloud 精确依赖的 Vite 5.2.8 编译链；`@dcloudio/vite-plugin-uni` 要求 `peerDependencies.vite=5.2.8`，不能在正式候选中绕开 peer 合同硬升。该风险没有因以下措施而消失。

这次发现另一套 `future/preview/vite.config.ts` 独立演示工程虽监听本机 IPv4，但没有主工程的请求 Host/Origin 防护，开发模式 HMR 默认开启，且允许自动切换端口。现复用相同的请求防护逻辑：开发与预览仅监听 `127.0.0.1`、严格端口、关闭 CORS 和 HMR；带恶意 Host、DNS rebinding 域名或外站 Origin 的请求返回不可缓存的 403。主工程 `vite.config.ts` 保留独立自包含防护，因为正式微信候选测试会把该配置单独复制到隔离临时目录；让它直接引用预览模块会导致真实候选构建找不到依赖，故没有这样修改。

`tests/check-vite-loopback-guard.mjs` 扩展为覆盖**两套工程、每套开发/预览两种入口**的 120 项真实回环 HTTP 拒绝与配置检查，继续由原有 CI 门禁执行。隔离微信正式候选构建、云演示编译、主项目类型检查也纳入回归。**本地防护不能修补上游旧版 Vite，也不允许把开发服务器部署到公网；真实生产只交付静态微信包与独立 Node 云服务，发布门禁仍为 BLOCKED。**
