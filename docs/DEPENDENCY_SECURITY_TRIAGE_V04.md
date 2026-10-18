# 错事 v0.4 · 依赖风险初步攻击面分级
> 更新：2026-10-18，基于独立首发分支和官方 npm Registry 有效 JSON。**仅为第一轮技术分级，所有剩余风险仍未得到发布豁免。**

## 审计口径和修复证据

- 命令：`npm audit --omit=dev --registry=https://registry.npmjs.org --json`；受影响包统计从 **44 → 32 → 28 → 23 → 20 → 19**，High **27 → 21 → 19 → 14 → 13 → 19**、Moderate **11 → 2 → 0**、Low **6 → 9 → 7 → 0**、Critical **0 → 0**。层级统计变化源于依赖图重新计算，并非 12 个互不关联的漏洞全部消除。
- 六个版本固定的传递依赖补丁：`ws@8.22.0`、`postcss@8.5.30`、`source-map-js@1.2.2`、`jpeg-js@0.4.4`、`phin@3.7.1`、`adm-zip@0.6.1`。原有 DCloud/Vue 主框架版本未改。CI、锁文件、两端构建和浏览器回归必须同时通过。
- 本分支的源文件没有未来云模块，也没有后台 API；`test:release:scope` 在构建后检查运行包。**代码搜索不能单独证明某个第三方漏洞不可利用。**
- 本表的「候选攻击面」根据包职责与构建链初判，不是渗透测试结论。相同源漏洞可能波及多个 DCloud 传递包；修复时不得只看 npm 数量。

## 当前剩余受影响包（完整目录，共 19 个）

| 受影响包 | npm 风险 | 候选攻击面 | 下一步处置 |
| --- | --- | --- | --- |
| `@dcloudio/uni-app` | high | 客户端/框架运行时待核 | 对照 DCloud 官方兼容矩阵后隔离升级，需真实微信 QA |
| `@dcloudio/uni-cli-shared` | high | 框架混合/间接依赖待核 | 逐项核对 advisory、是否打包及兼容补丁 |
| `@dcloudio/uni-cloud` | high | 框架混合/间接依赖待核 | 逐项核对 advisory、是否打包及兼容补丁 |
| `@dcloudio/uni-components` | high | 客户端/框架运行时待核 | 对照 DCloud 官方兼容矩阵后隔离升级，需真实微信 QA |
| `@dcloudio/uni-h5` | high | 客户端/框架运行时待核 | 对照 DCloud 官方兼容矩阵后隔离升级，需真实微信 QA |
| `@dcloudio/uni-h5-vite` | high | 框架混合/间接依赖待核 | 逐项核对 advisory、是否打包及兼容补丁 |
| `@dcloudio/uni-h5-vue` | high | 客户端/框架运行时待核 | 逐项核对 advisory、是否打包及兼容补丁 |
| `@vue/server-renderer` | high | 框架混合/间接依赖待核 | 对照 DCloud 官方兼容矩阵后隔离升级，需真实微信 QA |
| `braces` | high | Node 构建/开发工具候选 | 核查构建阶段输入边界、目录扫描及 glob 模式可控性 |
| `chokidar` | high | Node 构建/开发工具候选 | 核查构建阶段输入边界、目录扫描及 glob 模式可控性 |
| `fast-glob` | high | Node 构建/开发工具候选 | 核查构建阶段输入边界、目录扫描及 glob 模式可控性 |
| `micromatch` | high | Node 构建/开发工具候选 | 核查构建阶段输入边界、目录扫描及 glob 模式可控性 |
| `vue` | high | 客户端/框架运行时待核 | 对照 DCloud 官方兼容矩阵后隔离升级，需真实微信 QA |
| `@dcloudio/uni-console` | high | Node 构建/开发工具候选 | 逐项核对 advisory、是否打包及兼容补丁 |
| `@dcloudio/uni-mp-compiler` | high | Node 构建/开发工具候选 | 逐项核对 advisory、是否打包及兼容补丁 |
| `@dcloudio/uni-mp-vite` | high | Node 构建/开发工具候选 | 逐项核对 advisory、是否打包及兼容补丁 |
| `@dcloudio/uni-mp-weixin` | high | 框架混合/间接依赖待核 | 对照 DCloud 官方兼容矩阵后隔离升级，需真实微信 QA |
| `@dcloudio/uni-push` | high | Node 构建/开发工具候选 | 逐项核对 advisory、是否打包及兼容补丁 |
| `@dcloudio/uni-stat` | high | Node 构建/开发工具候选 | 逐项核对 advisory、是否打包及兼容补丁 |

## 2026-10-17 · 增量风险身份证明（新增 CI 保护，不是漏洞修复）

最初将 GitHub Actions 原始报告（run `38986168245`，对应 `391d295`）中的 32 个受影响包及 23 条直接 GHSA URL 固化为监控基线。2026-10-18 在兼容精简后，以官方 npm Registry 的**实际 28 个包、8 条直接 GHSA URL**；经后续工具链组件兼容试验进一步更新为 **23 个包、6 条直接 GHSA URL**；经构建链安全试验再次收敛到 **20 个包、3 条直接 GHSA URL**；经已发布的 Babel 7.29.6 兼容安全修复最终更新为 **19 个包、2 条直接 GHSA URL**，原始新报告需随新 CI Artifact 保存。基线只代表**尚未解决风险**，绝不代表豁免或安全批准。

`tests/summarize-dependency-audit.cjs` 现会同时核对：
- 原始报告元数据、逐包数量与风险等级必须一致；npm Registry 错误、报告不完整时失败，不把失败当零风险。
- **新增公告 URL、首次受影响的包、旧包风险等级上升**，无论总告警数量上升、下降还是不变，都标为 `riskRegression`，使 CI 失败。
- 输出完整的公告 URL、直接受影响依赖、新旧包和严重性差异，便于未来定位漏洞及保留证据；每次运行 `releaseApproved` 一律为 `false`。

该机制能发现以旧漏洞减少抵消新漏洞造成的**总量假稳定**，但不能取代人工审查：相同 URL 的新版影响范围、未发布的新漏洞、与实际微信 JS 的可利用性仍需逐项分析。**剩余 19 项受影响包仍为待处置风险，发布阻断不变。**

## 编译产物核对：发现 DCloud 资源预加载（需单独真机复核）

审查 [CI run 38986168245](https://github.com/ysr666/cuoshi/actions/runs/38986168245) 对应 `391d295` 的真实 **WeChat 构建 ZIP**，对 16 个 JavaScript 文件（共约 94 KB）进行静态文本检查，发现：

- 编译的 `common/vendor.js` 中包含一个顶层初始化段：当微信环境提供 `wx.preloadAssets` 时，约 3 秒后通过该 API 预加载 **`https://cdn1.dcloud.net.cn/.../img/shadow-grey.png`**。域名在代码中由 `String.fromCharCode` 拼装，所以单纯搜索明文网络地址会遗漏此路径。
- 该调用来自框架 vendor 代码，不是「错事」业务代码，现有调用参数只有固定图片地址，**未发现夹带用户错事正文或备份内容**。但这并不能排除网络请求携带通常的 IP 等网络元信息，也不证明该路径在每个微信版本都执行。
- 此编译产物中未检出明文字面量 `wx.request`、`uni.request`、`vue-i18n`、`@intlify`、`vite`、`esbuild`，此项仅说明**文字检索未命中**，不是对所有依赖或动态请求的不可利用性证明。

**处理门槛**：正式 iPhone 微信测试时，核对该静态资源请求是否执行、是否可禁用以及是否属于必要网络处理。首发版本自称本地优先，不应在未经审查/告知的情况下接受不必要的第三方网络连接。可优先采用兼容的 DCloud 上游配置或补丁，**不得为了消除字符串而盲改压缩后的 vendor 或牺牲跨端兼容性**。此项尚未结案，不能将「没有自建账号 API」误写为「运行时绝无网络请求」。

## 2026-10-18 · 微信 CDN 隐式预加载定向规避（Mac 编译已通过）

在官方锁定版 `@dcloudio/uni-mp-weixin/dist/uni.mp.esm.js` 的 `preloadAsset()` 中，明确找到打包器生产模式触发的 `wx.preloadAssets` 和 `__UNI_PRELOAD_SHADOW_IMAGE__`。这是一项非业务必需的 DCloud 灰色阴影图片预加载，不是用户授权的上传或备份流程。

本分支通过 `vite.config.ts` 的 `enforce: pre` 插件，**只对微信正式 build** 移除调用点，不改动 `wx.preloadAssets` 全局方法，不修改 `node_modules`、H5、已有数据模型或微信文件分享 API；如果上游源码变化、找不到唯一调用点则终止构建。新增 `tests/check-wechat-no-implicit-preload.cjs`：需要真实微信构建产物存在，逐个检查打包的 JS，不允许预加载相关字符串残留；并加入 CI。

Mac 隔离工作区 `/Users/ysradmin/Projects/cuoshi-v04-privacy-audit-1018` 的微信生产编译成功，16 个构建 JS 文件检查通过。**仍需** GitHub CI 验收以及 iPhone 微信实际网络/功能测试；此修改不意味着第三方库其他依赖网络请求全部不存在。保留其余依赖安全、隐私与注册发布门槛。

## 2026-10-18 · 首发无关依赖精简试验

严格核对 `src/` 源码与 `npm explain` 后，v0.4 H5/微信首发代码没有使用直接 `vue-i18n` 入口；`@dcloudio/uni-app-plus` 是原生 App 的专用包，而首发产品并不交付原生 App。隔离工作区仅移除两个首发无需的直接依赖，及失效的 `dev:app` 脚本，不修改 `@dcloudio/uni-app`、Vue、Vite 或微信编译器版本，也不改变已有六项兼容锁定补丁。

**官方 npm Registry 新结果**：0 Critical、19 High、2 Moderate、7 Low，共 **28 个受影响包**（从原 32 减少 4）；不再报告 `@dcloudio/uni-app-plus`、`@dcloudio/uni-app-uts`、`@dcloudio/uni-app-vite` 和 `vite` 为受影响生产依赖。其余 28 个依旧需人工审查与升级/缓解。此下降取决于 `--omit=dev` 的首发生产依赖分类，不代表构建时的 Vite 开发工具永远不会有漏洞；构建环境和供应链仍需审计。

两个隔离工作区的 `dist/build/mp-weixin/common/vendor.js`、`app.js` 和 H5 `index.html` **SHA-256 完全相同**；本地 TS、核心和 H5/微信构建、隐式 CDN 预加载防护及范围隔离通过。完整浏览器/原生检查、官方 GitHub CI 通过前不视为发布可用。

## 2026-10-18 · 兼容升级 DCloud CLI 间接国际化工具依赖

`@dcloudio/uni-cli-shared` 仍然依赖旧 `@intlify/core-base@9.1.9` 工具链，包含旧版消息编译器等，属于**构建阶段调用路径**而不是「错事」自有文字渲染接口。在独立 worktree 中使用 npm overrides，将同一族 `@intlify/core-base`、`message-compiler`、`message-resolver`、`runtime`、`vue-devtools` 钉到可解析的 9.14.5；其余 DCloud、Vue、Vite 主版本不变。

**官方 npm Registry**：从 28 个受影响包（19 High / 2 Moderate / 7 Low）降到 **23 个（14 High / 2 Moderate / 7 Low）**，不再涉及上述五个旧 Intlify 间接包；6 条直接 GHSA URL 未引入新身份，仍不得视为 6 个漏洞已处置完毕。仅基于源码构建、自动化通过不等于供应链完全安全。

Mac 两个隔离 worktree 生成的 **51 个微信小程序文件及 28 个 H5 文件全部逐字节一致**，说明这轮升级没有改变当前用户可运行的前端产物。未来若更新 DCloud 主框架，需复核依赖约束和这组 overrides，不能假设永远兼容。完整浏览器回归、GitHub CI 和 W01–W12 仍按正式发布门槛独立检查。

## 2026-10-18 · 构建工具安全兼容试验（Mac 全量回归通过）

在从最新隔离工作区 `f9adf42` 创建的新 worktree 中，仅通过 npm overrides 升级 `esbuild@0.25.12`、`postcss-selector-parser@7.1.6`、`unimport@4.1.2`；仍保留 DCloud/Vue/Vite 的直接版本约束。官方 npm 审计从 23 个受影响包（14 High、2 Moderate、7 Low）进一步降至 **20 个（13 High、0 Moderate、7 Low）**；直接 GHSA 公告 URL 为 3 条，无新增风险身份、严重性上升。

Mac 上 TypeScript、94 项核心数据/历史断言、H5+微信编译、预加载隔离已通过。微信小程序 51 个文件的成员集合保持不变，只有 3 个 WXSS 文件因为 CSS minifier 处理 `@media` 空格不同而改变；H5 文件个数相同，但经 esbuild 重编译生成的新哈希与代码需完整交互回归。**Mac 上 H5 全套 320/390/430px 浏览器回归、日期/DST、导入导出、简记及按钮专项全 PASS；隔离微信开发者工具原生四入口/主题持久化与合成数据历史/统计专项全 PASS。GitHub CI 仍需在新提交上完成复核。** 这仍不等于 iPhone 微信真人 W01–W12。

仍在待处理风险中的主要根因是 Vue 服务端渲染公告及 braces 深度递归等；`braces@3.0.3` 按 2026-10-18 上游公告尚无正式修复版本，不得指定不存在的 `3.0.4` 作为漏洞修复。对这类构建侧依赖应记录输入边界、打包覆盖与上游处理，禁止自动给予永久风险豁免。

## 2026-10-18 · Babel 官方修复与风险分级人工复核

原先 `@babel/core@7.25.2` 涉及 [GHSA-4x5r-pxfx-6jf8](https://github.com/advisories/GHSA-4x5r-pxfx-6jf8) 的**构建阶段读取源映射文件**漏洞。官方已发布兼容修复 `@babel/core@7.29.6`；在独立 worktree 只对该间接依赖加 npm override，保持 DCloud、Vue、Vite 的正式版本约束。官方 npm Registry 审计由 **20 个受影响包 / 3 条直接公告**变为 **19 个受影响包 / 2 条直接公告**。

这次必须显式保留一个重要的分级现象：`@dcloudio/uni-console`、`uni-mp-compiler`、`uni-mp-vite`、`uni-mp-weixin`、`uni-push`、`uni-stat` 等 **6 个已经在旧基线中的间接受影响包**，npm 显示从 Low 变成 High。核对 `via` 后，6 个包在升级前后仍由 `@dcloudio/uni-cli-shared` 等相同的传播链引入高风险 `braces`；只是消除了 Babel Low 根公告后，npm 的传播性评分发生变化。**这是旧告警等级变化，非新增攻击面或新 GHSA**；为防止误报，安全基线在人工核对后显式更新为 19 High / 0 Low，持续阻断发布。不能把此前自动 CI 的风险升级警示悄悄忽略。

Mac 对照隔离 worktree 的生产构建表明 **51 个微信文件及 28 个 H5 文件逐字节完全一致**；前端交付代码没有因为 Babel 工具链补丁变化。该一致性不能单独证明未来构建素材都安全；CI 与真机 QA 仍必须通过。剩下两条直接公告是 Vue SSR 属性渲染 XSS 与 `braces` 递归模式拒绝服务：原生微信客户端并不向用户提供 Node.js SSR 或非可信 glob 模式执行入口；但是 H5/构建链的信任边界和实际部署方式仍应按正式交付环境复核，不自动豁免。

## 具体工程决策和下一步

1. **先保留 6 个已完成的锁定补丁并维持回归门槛。** 每次继续修复前对比官方 npm JSON，不接受拿网络报错当 0 的结果。
2. **客户端运行时审查最优先**：Vue、DCloud 页面渲染、可能引入的国际化模块，逐一核对编译后的真实微信 JS 和第三方源码的漏洞触发条件，尤其处理非可信文本、模板或动态翻译时；未证明安全前不可判无风险。
3. **构建工具与小程序执行环境分离**：Vite/WS/glob/ZIP 的攻击面多在本机 DevServer、CI、构建素材或开发者工具，须审计不可信 PR 和素材是否能触达漏洞。生产用户的微信小程序没有内置 Node.js DevServer，但不能因此忽略构建供应链。
4. **Vite/SSR 与框架绑定风险**：DCloud 插件当前声明 `vite@5.2.8` 的精确 peer；Vue 锁定 3.4.21。不要将 npm 自动修复建议的 DCloud 0.x 旧版本作为可兼容修复；应另建框架升级试验、比较正式编译结果、真机 W01–W12 回归再决定。
5. 需补最终产物动态/静态第三方入口审计、服务类目/隐私核验、正式主体及真机数据恢复验收，才能给这些剩余项可追溯的修复/缓解/风险接受决定。

**发布结论：BLOCKED。** 未经明确安全验收不得因为从 44 降到 19 就创建正式 RC 标签或合并。
