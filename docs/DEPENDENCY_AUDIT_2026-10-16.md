# 错事 · 生产依赖树安全审计（2026-10-16）

> 当前首发状态：**阻断正式发布；截至 2026-10-17 补丁测试后暂余 32 个受影响包，仍需按可利用性、运行包影响、修复兼容性与验证结果逐项处置。**
>
> 命令：`npm audit --omit=dev --registry=https://registry.npmjs.org --json`，基于当前 `package-lock.json`。本机默认 npm 镜像不实现 audit 接口，已改用 npm 官方注册表并取得有效 JSON；并非把镜像的错误响应误认为 0 漏洞。

## 原始报告（2026-10-16，修复前）

- Critical：0
- High：27
- Moderate：11
- Low：6
- Total：44

**重要解释**：这是 npm 标记为生产依赖的整个依赖树，不等同于微信小程序最终约 272 KB 的运行包中含有 44 个可被最终用户利用的漏洞。uni-app 把一部分编译/构建子依赖也包含在此依赖树中；必须分别审核构建流程攻击面与用户端运行时攻击面。

同样地，**不能因为打包体积小就证明安全**，也不能为了降低警告数而无测试地升级一整套 `@dcloudio/*` 或降级 Vue。多个 npm 的自动建议涉及 major 版本或奇怪的旧版本，不能直接采用。

## 原始单包风险清单（修复前历史快照，并非当前风险清单）

| 包名 | 风险 | 顶层直接依赖？ | 自动修复提示 |
| --- | --- | --- | --- |
| @babel/core | low | 否 | major/跨版本:   |
| @dcloudio/uni-app | high | 是 | major/跨版本:   |
| @dcloudio/uni-app-plus | high | 是 | major/跨版本: @dcloudio/uni-app-plus 0.0.253 |
| @dcloudio/uni-app-uts | high | 否 | 可能有修复 |
| @dcloudio/uni-app-vite | moderate | 否 | 可能有修复 |
| @dcloudio/uni-cli-shared | high | 否 | major/跨版本:   |
| @dcloudio/uni-cloud | high | 否 | 可能有修复 |
| @dcloudio/uni-components | high | 是 | major/跨版本:   |
| @dcloudio/uni-console | low | 否 | major/跨版本:   |
| @dcloudio/uni-h5 | high | 是 | major/跨版本: @dcloudio/uni-h5 0.9.0 |
| @dcloudio/uni-h5-vite | high | 否 | 可能有修复 |
| @dcloudio/uni-h5-vue | high | 否 | 可能有修复 |
| @dcloudio/uni-mp-compiler | low | 否 | 可能有修复 |
| @dcloudio/uni-mp-vite | low | 否 | 可能有修复 |
| @dcloudio/uni-mp-weixin | moderate | 是 | major/跨版本: @dcloudio/uni-mp-weixin 0.0.973 |
| @dcloudio/uni-nvue-styler | moderate | 否 | 可能有修复 |
| @dcloudio/uni-push | low | 否 | 可能有修复 |
| @dcloudio/uni-stat | low | 否 | 可能有修复 |
| @intlify/core-base | high | 否 | 可能有修复 |
| @intlify/message-compiler | high | 否 | 可能有修复 |
| @intlify/message-resolver | high | 否 | 可能有修复 |
| @intlify/runtime | high | 否 | 可能有修复 |
| @intlify/vue-devtools | high | 否 | 可能有修复 |
| @jimp/core | moderate | 否 | 可能有修复 |
| @jimp/custom | moderate | 否 | 可能有修复 |
| @jimp/jpeg | moderate | 否 | 可能有修复 |
| @jimp/types | moderate | 否 | 可能有修复 |
| @vue/server-renderer | high | 否 | major/跨版本: @dcloudio/uni-h5 0.9.0 |
| adm-zip | high | 否 | 可能有修复 |
| braces | high | 否 | 可能有修复 |
| chokidar | high | 否 | 可能有修复 |
| esbuild | moderate | 否 | 指定版本: vite 5.4.21 |
| fast-glob | high | 否 | 可能有修复 |
| jimp | moderate | 否 | 可能有修复 |
| jpeg-js | high | 否 | 可能有修复 |
| micromatch | high | 否 | 可能有修复 |
| phin | moderate | 否 | 可能有修复 |
| postcss | high | 否 | 可能有修复 |
| postcss-selector-parser | moderate | 否 | major/跨版本: @dcloudio/uni-h5 0.9.0 |
| source-map-js | high | 否 | 可能有修复 |
| unimport | high | 否 | 可能有修复 |
| vite | high | 是 | 指定版本: vite 5.4.21 |
| vue | high | 是 | major/跨版本: @dcloudio/uni-h5 0.9.0 |
| ws | high | 否 | major/跨版本: @dcloudio/uni-mp-weixin 0.0.973 |

## 下一步处置（阻断发布的工作）

1. 对 **High/Moderate** 风险区分：是否进入 `dist/build/mp-weixin` 运行包；是否仅供构建工具本地运行；是否实际触达用户输入或网络；是否有可复现利用路径。
2. 对微信端运行时涉及的依赖（特别是 Vue、国际化模板等）优先研究同一 DCloud 官方兼容矩阵支持的无漏洞版本，必须完整重跑 H5/微信原生回归、历史数据及文件备份。
3. 对仅构建时使用的漏洞，明确其攻击入口：npm 安装包可信性、CI 最小权限、未授权 PR 工作流，以及供链安全；记录隔离措施和仍未修复的风险。
4. 检查微信开发者工具上传的**真实最终编译包**、无明文 AppSecret、无意外网络请求或第三方 SDK。现在仅完成第一方源码初查，不能宣称完整 SCA/渗透测试。
5. 整理发布前批准记录：风险等级、影响版本、处置 commit、回归证据、残余风险决策。没有该记录之前，冻结门槛保持 BLOCKED。

## 备注

运行时本身采用用户操作触发的文件分享，不包含运营者云同步。此审计不判断隐私政策或微信正式审核是否通过；它们是独立门槛。

## 新增：CI 持续追踪（2026-10-16）

GitHub Actions 增加独立的 `dependency_audit` 任务，固定使用官方 npm Registry 和当前提交的 `package-lock.json`，原始审计 JSON 与去噪摘要随 Actions Artifact 保存 14 天。检查会公开报告与 `DEPENDENCY_AUDIT_BASELINE.json` 的差异：出现新增 Critical 时阻断 CI，High/Moderate/Low 增加时发出警告。

**注意**：这是自动化风险监测，**不是清零或修复漏洞**；当前 v0.4 正式发布依然被 44 项尚未逐个评估的历史报告阻断。源代码、打包产物、攻击面和官方兼容升级仍需逐项人工与自动化验收。网络或审计格式出错时应当以 `inconclusive` 失败退出，而不是报告 0 漏洞。


## 2026-10-17 首发候选独立分支：已经验证的兼容补丁

在独立 `release/v0.4-rc1-prep` 分支仅使用锁定的 npm `overrides` 替换六个构建/工具链间接依赖，**不提升 uni-app 主框架、不改 Vue 运行时 API**：

| 固定依赖 | 补丁版本 | 作用边界 |
| --- | --- | --- |
| ws | 8.22.0 | 微信编译插件的 Node.js WebSocket 依赖 |
| postcss | 8.5.30 | 编译期 CSS 解析（包括子树旧版本） |
| source-map-js | 1.2.2 | 构建、编译期 Source Map |
| jpeg-js | 0.4.4 | Jimp/微信编译资源处理 |
| phin | 3.7.1 | Jimp 的字体/图片工具子依赖 |
| adm-zip | 0.6.1 | DCloud CLI 构建期 ZIP 读取 |

**官方 npm 审计对比（受影响依赖包数，并非独立漏洞数）：**

| 风险等级 | 原始 | 本轮补丁后 |
| --- | ---: | ---: |
| Critical | 0 | 0 |
| High | 27 | 21 |
| Moderate | 11 | 2 |
| Low | 6 | 9 |
| 合计 | **44** | **32** |

升级导致一部分框架级间接风险从较高级别下降到 Low，**这不表示新增了三项低危漏洞，也不能将剩余 32 项默认接受**。最新机器可读基线在 `docs/DEPENDENCY_AUDIT_BASELINE.json`，CI 发现新增 High/Critical 会失败。

剩余风险与实际攻击面分类见 [首发剩余依赖分级](DEPENDENCY_SECURITY_TRIAGE_V04.md)。`vite@5.2.8` 与当前 `@dcloudio/vite-plugin-uni` 存在**精确版本 peer 约束**；`vue@3.4.21` 与 DCloud 组件/渲染栈紧耦合。现阶段**不能直接根据 npm 的建议降级到早年 DCloud 0.x、强制升级 Vite 或 Vue 后就宣称兼容**。实际新框架适配需要独立分支、真实微信原生回归和数据迁移验收。

**未关闭发布阻断。** 部分构建依赖的漏洞可能仅能由安装/CI/本地 DevServer 触发，但只要未形成逐项可验证的攻击面判定与可接受风险决策，状态仍为 BLOCKED。
