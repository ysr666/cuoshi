# 错事 v0.4 · 依赖风险初步攻击面分级
> 更新：2026-10-17，基于独立首发分支和官方 npm Registry 有效 JSON。**仅为第一轮技术分级，所有剩余风险仍未得到发布豁免。**

## 审计口径和修复证据

- 命令：`npm audit --omit=dev --registry=https://registry.npmjs.org --json`；受影响包统计从 **44 → 32**，High **27 → 21**、Moderate **11 → 2**、Low **6 → 9**、Critical **0 → 0**。层级统计变化源于依赖图重新计算，并非 12 个互不关联的漏洞全部消除。
- 六个版本固定的传递依赖补丁：`ws@8.22.0`、`postcss@8.5.30`、`source-map-js@1.2.2`、`jpeg-js@0.4.4`、`phin@3.7.1`、`adm-zip@0.6.1`。原有 DCloud/Vue 主框架版本未改。CI、锁文件、两端构建和浏览器回归必须同时通过。
- 本分支的源文件没有未来云模块，也没有后台 API；`test:release:scope` 在构建后检查运行包。**代码搜索不能单独证明某个第三方漏洞不可利用。**
- 本表的「候选攻击面」根据包职责与构建链初判，不是渗透测试结论。相同源漏洞可能波及多个 DCloud 传递包；修复时不得只看 npm 数量。

## 当前剩余受影响包（完整目录，共 32 个）

| 受影响包 | npm 风险 | 候选攻击面 | 下一步处置 |
| --- | --- | --- | --- |
| `@dcloudio/uni-app` | high | 客户端/框架运行时待核 | 对照 DCloud 官方兼容矩阵后隔离升级，需真实微信 QA |
| `@dcloudio/uni-app-uts` | high | 框架混合/间接依赖待核 | 逐项核对 advisory、是否打包及兼容补丁 |
| `@dcloudio/uni-cli-shared` | high | 框架混合/间接依赖待核 | 逐项核对 advisory、是否打包及兼容补丁 |
| `@dcloudio/uni-cloud` | high | 框架混合/间接依赖待核 | 逐项核对 advisory、是否打包及兼容补丁 |
| `@dcloudio/uni-components` | high | 客户端/框架运行时待核 | 对照 DCloud 官方兼容矩阵后隔离升级，需真实微信 QA |
| `@dcloudio/uni-h5` | high | 客户端/框架运行时待核 | 对照 DCloud 官方兼容矩阵后隔离升级，需真实微信 QA |
| `@dcloudio/uni-h5-vite` | high | 框架混合/间接依赖待核 | 逐项核对 advisory、是否打包及兼容补丁 |
| `@dcloudio/uni-h5-vue` | high | 客户端/框架运行时待核 | 逐项核对 advisory、是否打包及兼容补丁 |
| `@intlify/core-base` | high | 客户端/框架运行时待核 | 核对 9.1.x 旧 CLI 依赖与 9.14.x 客户端链，独立验证升级 |
| `@intlify/message-compiler` | high | 客户端/框架运行时待核 | 核对 9.1.x 旧 CLI 依赖与 9.14.x 客户端链，独立验证升级 |
| `@intlify/message-resolver` | high | 客户端/框架运行时待核 | 核对 9.1.x 旧 CLI 依赖与 9.14.x 客户端链，独立验证升级 |
| `@intlify/runtime` | high | 客户端/框架运行时待核 | 核对 9.1.x 旧 CLI 依赖与 9.14.x 客户端链，独立验证升级 |
| `@intlify/vue-devtools` | high | 框架混合/间接依赖待核 | 核对 9.1.x 旧 CLI 依赖与 9.14.x 客户端链，独立验证升级 |
| `@vue/server-renderer` | high | 框架混合/间接依赖待核 | 对照 DCloud 官方兼容矩阵后隔离升级，需真实微信 QA |
| `braces` | high | Node 构建/开发工具候选 | 核查构建阶段输入边界、目录扫描及 glob 模式可控性 |
| `chokidar` | high | Node 构建/开发工具候选 | 核查构建阶段输入边界、目录扫描及 glob 模式可控性 |
| `fast-glob` | high | Node 构建/开发工具候选 | 核查构建阶段输入边界、目录扫描及 glob 模式可控性 |
| `micromatch` | high | Node 构建/开发工具候选 | 核查构建阶段输入边界、目录扫描及 glob 模式可控性 |
| `unimport` | high | Node 构建/开发工具候选 | 核查构建阶段输入边界、目录扫描及 glob 模式可控性 |
| `vite` | high | Node 构建/开发工具候选 | DCloud peer 精确要求 5.2.8；不得强制升级破坏编译 |
| `vue` | high | 客户端/框架运行时待核 | 对照 DCloud 官方兼容矩阵后隔离升级，需真实微信 QA |
| `esbuild` | moderate | Node 构建/开发工具候选 | 逐项核对 advisory、是否打包及兼容补丁 |
| `postcss-selector-parser` | moderate | Node 构建/开发工具候选 | 逐项核对 advisory、是否打包及兼容补丁 |
| `@babel/core` | low | Node 构建/开发工具候选 | 逐项核对 advisory、是否打包及兼容补丁 |
| `@dcloudio/uni-app-plus` | low | 框架混合/间接依赖待核 | 逐项核对 advisory、是否打包及兼容补丁 |
| `@dcloudio/uni-app-vite` | low | 框架混合/间接依赖待核 | 逐项核对 advisory、是否打包及兼容补丁 |
| `@dcloudio/uni-console` | low | Node 构建/开发工具候选 | 逐项核对 advisory、是否打包及兼容补丁 |
| `@dcloudio/uni-mp-compiler` | low | Node 构建/开发工具候选 | 逐项核对 advisory、是否打包及兼容补丁 |
| `@dcloudio/uni-mp-vite` | low | Node 构建/开发工具候选 | 逐项核对 advisory、是否打包及兼容补丁 |
| `@dcloudio/uni-mp-weixin` | low | 框架混合/间接依赖待核 | 对照 DCloud 官方兼容矩阵后隔离升级，需真实微信 QA |
| `@dcloudio/uni-push` | low | Node 构建/开发工具候选 | 逐项核对 advisory、是否打包及兼容补丁 |
| `@dcloudio/uni-stat` | low | Node 构建/开发工具候选 | 逐项核对 advisory、是否打包及兼容补丁 |

## 具体工程决策和下一步

1. **先保留 6 个已完成的锁定补丁并维持回归门槛。** 每次继续修复前对比官方 npm JSON，不接受拿网络报错当 0 的结果。
2. **客户端运行时审查最优先**：Vue、DCloud 页面渲染、可能引入的国际化模块，逐一核对编译后的真实微信 JS 和第三方源码的漏洞触发条件，尤其处理非可信文本、模板或动态翻译时；未证明安全前不可判无风险。
3. **构建工具与小程序执行环境分离**：Vite/WS/glob/ZIP 的攻击面多在本机 DevServer、CI、构建素材或开发者工具，须审计不可信 PR 和素材是否能触达漏洞。生产用户的微信小程序没有内置 Node.js DevServer，但不能因此忽略构建供应链。
4. **Vite/SSR 与框架绑定风险**：DCloud 插件当前声明 `vite@5.2.8` 的精确 peer；Vue 锁定 3.4.21。不要将 npm 自动修复建议的 DCloud 0.x 旧版本作为可兼容修复；应另建框架升级试验、比较正式编译结果、真机 W01–W12 回归再决定。
5. 需补最终产物动态/静态第三方入口审计、服务类目/隐私核验、正式主体及真机数据恢复验收，才能给这些剩余项可追溯的修复/缓解/风险接受决定。

**发布结论：BLOCKED。** 未经明确安全验收不得因为从 44 降到 32 就创建正式 RC 标签或合并。
