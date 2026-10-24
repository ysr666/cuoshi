# 错事 v0.5 · 公开发布的五道关口

**状态：BLOCKED，不得发布。** 本表仅针对 v0.5「今天/设置」两页、默认云端自动保存、可选简记及完整修改历史的极简微信小程序；v0.4 旧版、JSON 导出导入、统计、提醒、手机号登录均不属于此首发。工程合同全绿并不等于平台资格、个人信息义务和真实联网测试已完成。

| 发布关口 | 自动化已做的事 | 真实完成所需证据 | 当前结论 |
| --- | --- | --- | --- |
| A. AppID 与主体备案 | 支持显式输入真实 AppID；发布候选编译拒绝缺少备案编号及联系邮箱 | 微信公众平台**个人主体**实名/主体审核结果、名称/类目批准、备案编号可查，正式 AppID 确认；必要时 ICP 域名备案和服务接入资质 | BLOCKED |
| B. 中国大陆云与 HTTPS | 后端可独立编译、4 数据库受限角色、六组密钥、可信本机代理边界；只读公网探针可检 204/401/404 | 已授权的大陆云账号、服务器/数据库区域、域名归属及 ICP 信息、TLS 证书、最小权限、密钥托管、备份/WAL 删除策略、监控与恢复演练 | BLOCKED |
| C. 微信真机两设备 | 合成微信会话、离线/杀进程/账号隔离、幂等自动同步及注销有自动化测试 | 使用正式 AppID + 微信真实登录 + HTTPS 合法域名，在两台真机执行下面 QA 表，并留结果 | BLOCKED |
| D. 隐私与安全 | 注销/暂停授权/最小权限与审计已实现；源代码没有导出/手机号/订阅功能，SCA 清单持续生成 | 公开运营者联系、完整处理规则/服务商与地域、具体保存/清理期限、管理员受限读取告知、可申请查阅复制处理渠道、第三方委托协议、依赖漏洞风险评估 | BLOCKED |
| E. 微信审核与发布 | v0.5 两页发布包白名单、开发包不带生产 AppID；候选打包需要显式输入真实材料 | 真实截图、审核描述、备案、隐私指引平台审核、体验成员验收与最终 Git SHA；微信发布审核通过 | BLOCKED |

## 一、注册主体与备案（需要注册人操作）

**已选定个人主体，不再做企业/组织路线。** 具体操作见 [《个人主体注册与备案实操路径》](RELEASE_V05_PERSONAL_REGISTRATION.md)。

入口：[微信公众平台](https://mp.weixin.qq.com/)。注册人使用本人合法身份，确认个人主体可申请类目、名称、实名条件和平台实际要求，取得**自己的** AppID。通过微信平台小程序备案入口办理 **小程序自身备案（不等于域名备案）**；中国大陆后端 HTTPS 请求域名按实际云商另办 ICP 域名备案或接入备案，并在微信后台确认 request 合法域名；不能用临时测试 AppID 或未备案 IP 代替。

待填写（**不把个人身份证、家庭住址、登录口令提交 GitHub**）：
- AppID 已验证：`BLOCKED`；主体/服务类目审核：`BLOCKED`。
- 小程序备案：`BLOCKED`；公网 HTTPS 域名及合法 request 域名配置：`BLOCKED`。
- 公开联系邮箱/审核材料：`BLOCKED`；具体个人身份仅留在官方平台。

依据：工信部《工业和信息化部关于开展移动互联网应用程序备案工作的通知》（工信部信管〔2023〕105号）涵盖小程序，要求先备案再开展业务，材料齐全准确时由省级通信管理局在 20 个工作日内备案。https://www.miit.gov.cn/jgsj/xgj/wjfb/art/2023/art_dd783a581c9644a4aee10afa582811db.html

## 二、云与网关：只执行真实部署所必需的操作

1. 在个人主体实名条件允许后，选择符合法律与服务目的的中国大陆地域；开通独立 PostgreSQL。先由独立迁移账号人工审核并执行 [离线生成的 8 份受限 SQL](../future/server/deploy/README.md)；日常应用不得使用 owner/superuser，按程序分配的最小权限数据库连接分别服务于备份、微信身份、唯一管理员及必要的安全清理；技术账号不代表员工，并明确配置与迁移一致的 `CUOSHI_PG_SCHEMA`（禁止默认 public）；验证数据库 TLS 服务器名称，并执行与真实 PostgreSQL CI 共用的 `checkPrivateDatabaseReadiness` 生产启动门禁。
2. 在独立密钥管理中配置 `future/server/.env.example` 列出的服务器环境变量；AppSecret、数据库口令和签名密钥绝不能进仓库、小程序包、日志或二维码。启动 `npm run build:private --prefix future/server` 和独立的私有进程。**后端只能监听 127.0.0.1，不能直接暴露到公网。**
3. HTTPS 终止代理已有 [受保护的 Caddy 配置模板](../future/server/deploy/README.md) 和 35 项静态检查，**尚未在真实云主机运行或验证 Caddy 配置**。在同一可信主机部署真正的 HTTPS 终止代理：**必须删除外部传入的 `X-Cuoshi-Edge-Proof`、`X-Cuoshi-Client-Ip`，再由代理用私有受限密钥和自己核实的客户端 IP 重写它们**。若前面有 CDN/WAF，代理未准确识别真实客户端时只能对代理 IP 保守限流，不能无条件信任 `X-Forwarded-For`。公网 443/TLS、DNS、证书到期告警、WAF 及可用性监控需真实验证。
4. 设定真实的私人快照、WAL/物理备份、副本、审计、网关日志的保存/清理期限；明确注销后尚存备份的隔离与最终清理规则，完成一轮演练，不将匿名化与日志保全当作无限保留正文的理由。
5. **仅在部署并获授权之后**执行：`CUOSHI_V05_CLOUD_ORIGIN=https://你的实际域名 npm run check:future:public-edge`。只检查 `GET /healthz=204`、未登录 `GET /v1/backup/snapshot=401`、不存在路径 `GET /v1/not-a-real-route=404`。该检查不证明微信登录和上传可用，结果须另按真机表确认。

## 三、真实微信及双真机 QA 记录（不得用合成身份填写 PASS）

正式环境前置：AppID 归属、合法 HTTPS request 域名、隐私保护指引与真实注册微信账号；至少两台真实手机。验收使用**虚构的错事内容**，不要截图真实私人简记。

| 编号 | 真实操作与必须观察到的结果 | 状态 |
| --- | --- | --- |
| W01 | 首次打开先看到必要告知，尚未同意之前不登录、不上传私人记录 | NOT RUN |
| W02 | A 机微信核验并同意云存储，记录 0、5 和一段测试简记，修改过去日期；历史无缺失 | NOT RUN |
| W03 | B 机同一微信登录，能看见 A 的数字、原简记、旧文和完整修改历史 | NOT RUN |
| W04 | A 机断网修改、退出微信或杀进程重开；同账号仍可回看本机已保存历史 | NOT RUN |
| W05 | A 机联网恢复后待上传编辑只补传一次，B 机读取最终版本 | NOT RUN |
| W06 | 服务器断开/429/5xx 时提示暂未同步；不显示虚假的已同步、不泄漏其他账号 | NOT RUN |
| W07 | B 机切换另一个微信，不能看到前一账号数字或草稿，也不能上传前账号队列 | NOT RUN |
| W08 | 用户主动暂停自动保存：本机记录可编辑、云端快照不变；恢复须再次主动确认 | NOT RUN |
| W09 | 用户注销二次确认，云端旧私人快照不可访问，新账号不继承旧历史；按规则保留匿名统计 | NOT RUN |
| W10 | 模拟注销回执丢失/无网时不能宣称删除成功，也不能自动注册新账号 | NOT RUN |
| W11 | iPhone/Android 屏幕安全区、输入法、日期选择器、长简记、页面回切和多日历史排版正常 | NOT RUN |
| W12 | 在真实微信后台查看所声明的隐私接口、审核页面截图和实际调用一致 | NOT RUN |

填写证明：测试时间、正式候选 Git SHA、手机系统/微信版本、关联的**脱敏**日志或截图、每条 PASS/FAIL/阻断原因。不要记录 AppSecret、个人 openid、完整 JWT、用户简记正文或身份证。

## 四、隐私安全

使用 **`docs/PRIVACY_NOTICE_V05_DRAFT.md`** 核对正式文本。不得直接发布带【待确认】的草案；待确定的数据处理者、公开邮箱、云地域、服务商、具体留存/备份清理期限、必要后台访问规则和数据主体请求流程都必须有事实支撑。根据《个人信息保护法》第四十五及五十条，用户对个人信息的查阅、复制请求应有受理机制；**不要求首发界面增加 JSON 导出按钮**。依据：https://www.miit.gov.cn/zwgk/zcwj/flfg/art/2022/art_04a0f1fb5df244e39688fd5372623a8d.html

2026-10-20 的[官方 npm 依赖风险分流](RELEASE_V05_SECURITY_AUDIT_2026-10-20.md)：前端根包有 44 项受影响包（27 high / 11 moderate / 6 low），独立云后端 `--omit=dev` 当次报告 0 项；尚未逐项裁定可达性或获得安全批准。`npm audit` 生成清单成功不表示漏洞不存在。实际发布前应区分进入微信 JS 运行包的代码与只在可信构建环境中执行的供应链依赖，记录处置证据及负责人同意。当前无生产安全批准。

## 五、候选构建、审核与发布

- 平时：`npm run build:future:mp-weixin` —— 空 AppID、空云域名、绝不请求真实账户；继续用于不接触用户数据的自动回归。
- 正式候选（**仅在五项门槛材料已经真实具备时**）：设定 `CUOSHI_V05_RELEASE_CANDIDATE=1`、`CUOSHI_V05_WECHAT_APP_ID`、`CUOSHI_V05_CLOUD_ORIGIN`、`CUOSHI_V05_NOTICE_VERSION`、`CUOSHI_V05_FILING_NUMBER`、`CUOSHI_V05_CONTACT_EMAIL`，再执行同一构建命令。这里都是应在公众端可见的材料；**AppSecret、数据库口令只许放后端受控环境**。配置语法通过不证明账号归属和备案有效。
- 申请审核前先用 `docs/WECHAT_REVIEW_V05_DRAFT.md` 更新名称、类目、真实截图、入口路径、备案和隐私信息；提交微信后台隐私指引并核实平台通过。
- 固定最终 commit、四 Job CI、12 条双真机 QA、生产安全与运营者签字记录，再合并/上架；任何一个关口仍为 BLOCKED 都不得宣称上线成功。

### 2026-10-24 · 隐私告知版本的后端强制门槛

正式私有后端必须显式设置 `CUOSHI_V05_NOTICE_VERSION`，并与已审核的微信发布候选使用相同版本号。缺失、格式不合法或沿用默认测试版 `privacy-v1` 时私有服务拒绝启动。旧版小程序试图重新开启云存储时会收到 HTTP 409 `privacy_notice_outdated`，不能悄悄重新授权；用户关闭云上传仍不受旧版本限制。服务端还会比对已存储账号的 `consent_version`：旧授权对当前隐私版本无效，状态不再显示已经获当前授权，旧授权不能读取快照，也不能在数据库账号行锁保护的上传事务中继续上传。**原有云快照不会被删除**；用户更新小程序，明确阅读并重新确认新说明后才恢复同步。此处是代码合同，不表示隐私政策已获得平台审批或真实生产环境已验证。

### 生产运维安全收尾（未现场启用）

已有每小时执行一次的最小权限登录限流记录清理 timer 和独立服务，及 PostgreSQL 连接/语句/锁/事务超时限制。真实 PostgreSQL CI 验证过期记录清理；详见 [部署与留存限制](../future/server/deploy/README.md#每小时删除旧登录限流记录独立最小权限尚未启用)。实际个人主体云服务器**尚未安装和启用**该服务，留存时长不能无条件宣称为严格 24 小时；还须监控清理失败及解决数据库物理备份/WAL 的保留期限。

#### 后端健康与存量凭证清理（尚未上线）

后端正式 `/healthz` 已改为四个受限数据库角色可达性检测，数据库不可用返回 503；短期缓存和截止时间限制监控请求负载。按小时的低权限定时任务同时清理登录限流、旧注销墓碑和过期验证码/会话撤销摘要。真实 SQL 清理和无权限拒绝均由 PostgreSQL CI 核实。**正式监控告警接收人、真实服务器 timer 开启和 WAL/物理备份的留存清理仍需现场配置、运行与验收。**

### 真实环境待办：恢复与通知

CI 新增官方 `pg_dump` → 空数据库 `pg_restore` 合成记录恢复演练（验证显式 0、JSONB 历史、revision/digest、Owner 同步状态）。不代表已对真实生产数据或已加密的云数据库备份做恢复演练。另提供每 5 分钟 HTTPS `/healthz` 检测的只读低权限 systemd 模板；**未部署，未接真实告警通知渠道**。生产必须决定加密备份/WAL 保留期限和账号注销后的滞留副本销毁策略，配置通知渠道并验证断网、证书错误和数据库异常，再签核发布。

#### 前端依赖安全进展（2026-10-20）

已为 DCloud 工具链的 ws、source-map-js、adm-zip、PostCSS 4 项间接依赖加入明确安全补丁和 CI 回归，官方 npm 审计由 44 项受影响包降至 39 项（高危 27 降至 22）。完整见 [依赖审计分流](RELEASE_V05_SECURITY_AUDIT_2026-10-20.md#2026-10-20-同日新增四项定向补丁与实际安装验证draft-pr-4)。仍存在 Vue、Intlify、Vite、DCloud 等框架风险，正式上线的安全签核**没有完成**。


#### 2026-10-22 安全风险库存更新（Draft PR #4）

前述 2026-10-20 的 44→39 是历史风险基线，**不是当前剩余数量**。五项间接依赖定向补丁与移除非首发直接依赖后，官方 npm `--omit=dev` 当次复核为 **25 个受影响包（19 High、6 Moderate、0 Low、0 Critical）**，后端独立生产依赖当次为 **0 项**。完整审计明细见 [更新后的技术分流](RELEASE_V05_SECURITY_AUDIT_2026-10-20.md#2026-10-22--第二轮定向构建依赖修补draft-pr-4)。仍存在 DCloud、Vue、Vite、`braces` 等风险；**发布关口 D 继续 BLOCKED**，所有生产条件和双真机要求不变。


#### 2026-10-24 · H5 中文字体预检与 CI 超时修复

GitHub Actions #39990745284 的前三个 Job 通过，前端 Job 在执行 `apt-get update -qq && apt-get install fonts-noto-cjk` 期间被 15 分钟 Job 超时取消；Chrome 视觉回归没有运行，因此**不能把该次 CI 记录为通过**。将字体步骤改为：优先检查 runner 是否已有支持中文的字体；如无则在**120 秒上限内**使用缓存 APT 索引安装 Noto CJK，并再次检查可用性。没有绕过 Chrome 验收或把截图步骤改成可选；如字体仍不可用，明确失败，需另行解决。这项修改不涉及生产发布和 AppID。

#### 2026-10-24 · 极简管理员后台独立原型（不影响微信发布包）

已新增 `future/admin/` 极简管理台：独立本机模拟预览、可交互概览/账号状态/工单范围/系统状态；敏感读取按钮默认禁用。另有 `future/server/src/adminHttp.ts` 独立的员工工单单日读取处理函数，仍需真实员工 MFA 与合规授权，无公开监听、未接入小程序或公网代理。**所有界面统计都是明确标注的虚构示例，不代表已有真实管理后台可登录**。详见 [`future/admin/README.md`](../future/admin/README.md)。后台生产接入、权限、匿名聚合口径及运营合规验收未完成，发布关口继续 BLOCKED。


#### 2026-10-24 · 管理后台匿名运营统计查询（未部署）

后台代码继续准备独立只读汇总查询：`cloud_reporting_overview()` SQL 函数只能由单独报表角色执行，返回五个整型聚合指标，报表角色仍无用户表/私人快照直接读取权限。通过真实 PostgreSQL 集成测试验证；**没有实际用户数据、运营分析渠道、生产员工 MFA 或可访问公网后台**。不能将示例数字、快照近七日更新数误称成真实活跃用户或同步成功率。发布关口不变。

#### 2026-10-24 · 管理报表权限与审计硬化

新增受保护的后台聚合统计服务/HTTP handler：短期员工 JWT 与 MFA、撤销名单核验、SQL 再验在职管理/审计角色、允许/拒绝写入不可随意修改的审计表。公有小程序 API/域名不会挂载此端点；所有 CI 与真实 PostgreSQL 测试只使用临时合成账号。生产员工身份接入、独立 HTTPS 后台及密钥配置仍属人工提供资源后的阻断项，不可将此视为已上线。

#### 2026-10-24 · 后台专用本机监听隔离

已实现独立的 `staffHttpHost.ts`；仅限可信代理调用的内部运营汇总与授权单日查阅，不向普通小程序公网注册管理接口。正式身份提供方、管理域名及真机审批仍未接入。

#### 2026-10-24 · 管理台真实 API 前端已实现（正式身份仍待接入）

`future/admin/live/` 新增生产形态员工管理网页，使用已验证的 5 分钟员工 MFA JWT（外部身份提供方签发），仅请求真实受保护聚合接口和审批单日工单接口；不会默认展示私人正文、不存在虚构运营数回退、无浏览器令牌持久化。独立 staff host 只通过主动配置和可信代理提供四份固定静态资源。合成双尺寸 Chrome 验收包含拒绝无权限/拒绝任意工单、清除已查看正文等，详见后台 README。**正式员工 MFA 签发与公网后台域名、个人主体资质、生产数据库仍缺失**，产品上线继续阻断。

#### 2026-10-24 · 员工后台独立进程、数据库权限及模板

已经把 `privateStaffMain.ts`、`privateStaffConfig.ts`、`privateStaffReadiness.ts`、`staffDayService.ts` 加入私有后端编译，并提供独立、默认不开启的 `cuoshi-staff.service` 运维模板。安全预检要求不同的员工/报表数据库登录角色、独立可信代理凭证、合法短期 MFA 签名、独立本地监听端口和后台静态资源存在；未配置时拒绝启动。真实员工 MFA 签发与撤销运维、主体合规、后端证书和服务器尚需真实资源，**不得将模板状态称为正式部署**。


#### 2026-10-24 · 用户明确更正：管理后台仅唯一管理员

此前设计的员工、多角色、工单双人审批不符合「错事」单人运营模式，已在正式后台代码中取消其可访问入口，并从真实后台与演示 UI 移除相关导航。服务器必须配置唯一管理员 `CUOSHI_OWNER_ADMIN_ID`，拒绝其他签名正确的后台身份；保留数据库独立技术角色作最小权限隔离，不代表多人账号。旧 SQL 两人审批方案暂保留为不可达的历史研发结构，不能作为完成的生产能力。正式后台现只提供受限运营汇总和系统状态，私人简记读取默认不开放。未来独立的真实管理员验证、上线合规验收仍未完成。

#### 2026-10-24: Sole-owner two-factor dashboard authentication

The restricted dashboard login now takes a password and an authenticator code, not a pasted employee token. Isolated `ownerAuth.ts` and `ownerAuthHttp.ts`, migration 008, database-backed login rate limiting and TOTP replay guards, signed five-minute owner session, and persisted logout revocation are added with synthetic tests. No other human administrator or private-note bulk access is introduced. Production secret setup, owner enrollment, standalone HTTPS ingress, mainland cloud resources, and real-device acceptance remain required; release status remains BLOCKED.

#### 2026-10-24 · 单管理员首装资料与限流清理补齐

新增 `prepare-owner.mjs` 离线引导（随机密码哈希、TOTP 种子、密钥、仅空管理表的唯一所有者审核 SQL），严格仓库外权限 0700/0600、拒绝覆盖/打印秘密；测试不生成正式凭证。现有每小时 PostgreSQL 最小权限清理流程增加 `cloud_prune_owner_login_windows`，不直接读取账号表、用户简记或原始 IP。八步迁移需审核执行，尚未接任何正式资源；发布仍阻断。

#### 2026-10-24 · 构建链 Express 修复并锁定本地 Vite 开发服务

DCloud 旧插件固定的 Express 4.20.0 通过兼容 4.x 版本 override 定向升级到 4.22.3，并清除 6 个关联传递依赖的已知漏洞版本；回归包括 npm 官方在线 audit、冷安装、插件实际模块解析、H5/微信双平台及小程序 v0.4 隔离。根 npm audit 24 包降至 17 包；仍有 17 High，生产分发继续阻断。旧 Vite 仍为 DCloud 精确 peer 5.2.8，本地开发/预览仅允许 loopback，不表述为已修复 Vite 本身的风险。

#### 2026-10-24 · 框架攻击面运行包隔离证据

新增 npm 脚本 `test:future:framework-boundary`；在 H5、微信预览、独立 v0.5 微信包完成编译后，GitHub CI 将检索 Vue SSR/Vite 开发服务与 Node 构建器在最终分发产物的静态暴露特征，检查云端 PG 服务没有前端运行依赖，验证 loopback 限制实际生效，并上传 `cuoshi-framework-exposure-*` JSON。已证明扫描器会拒绝恶意夹带的合成包。**自动化结果明确 releaseApproved=false，不影响真实框架高危公告及真机/生产验收阻断。**

#### 2026-10-24 · Vue SSR 3.5.42 安全修复实验成功；全量 Vue 升级实测不兼容

在独立 worktree 中先实测整套 Vue 3.5.42：H5 虽编译成功，但 Chrome 报只读属性赋值异常，主页面无法加载，故没有合入。改为单独覆盖间接 SSR `@vue/server-renderer@3.5.42`，保留客户端 Vue 3.4.21，并完成 H5 三种宽度交互、隐私页面、v0.5 微信原生离线/重连、云设置 Chrome 回归及真实 `ssrRenderDynamicAttr` 安全行为测试。官方同轮根依赖受影响包 17 High 降至 1 High + 1 Moderate；`--omit=dev` 当前为 0，但剩余构建工具仍有公告且生产/真机未验收。CI 审计脚本新增运行依赖 High/Critical 强制阻断，同时继续上传完整审计证据；不作为正式安全签核。

#### 2026-10-24 · Vite 新版试跑 + 旧版回环 Host/Origin 防护

隔离实验的 Vite 6.4.5 能构建和运行，但与 DCloud 及 Vue 插件显式 peer 不兼容，必须绕过 npm peer 校验且依赖树出现额外无效项，因此不合并。正式保留 Vite 5.2.8，新增限制 Host/Origin 的 HTTP 中间件、IPv4 loopback、禁用 Vite 跨域响应，并在 DCloud 配置合并后再次关闭 HMR WebSocket。实际 60 项开发/预览 HTTP 请求安全测试和框架门禁集成 CI。风险仍存在，发布评估不能据此宣布漏洞消除。

#### 2026-10-24 · 微信正式候选包两项审核一致性修复

已区分官方下发的**小程序备案号 `省ICP备数字号-数字X`** 与网站 `-数字`、App `-数字A`：`buildConfig.mjs` 在 `CUOSHI_V05_RELEASE_CANDIDATE=1` 时拒绝非小程序格式，仅为语法校验，不代表已获管局/微信批准；部署时必须核对真实原始备案信息。参考公开 ICP 编号说明：https://docs.volcengine.com/docs/Record/BasicConceptsofFilingFAQ?lang=zh 。首次告知页现在只在测试包显示“正式发布前……”提示；正式候选包改为指向「设置」中的数据说明、备案和联系渠道，不把测试提示展示给用户。新增 `test:future:rc-build`：在**仓库外临时私有目录**内使用完全虚构 AppID、HTTPS、备案和邮箱实际编译发布路径，检查编译结果的两页、备案/联系方式、首页条件告知和独立版本标志；测试结束一律销毁，不改变正常 CI 测试包，更不冒充微信实测或已核准备案。隐私草案已统一为**唯一管理员**，取消不适用的员工和客服审批陈述；历史 v0.4 JSON 导入导出真机指引明确标为停用存档。

五项真实发布条件仍未齐全，本次没有 AppID、证件、个人资料、生产域名或云密钥接入，发布仍为 BLOCKED。

#### 2026-10-24 · 可复核私有后端部署交付包（尚未部署）

此前只有各源文件、systemd/Caddy 模板和编译后的本地二进制，真实服务器部署时仍需手工挑文件。现增加严格白名单的 `package-private-release.mjs`：将正式 PostgreSQL CI 通过的编译服务、8 份迁移、独立 server 锁文件、唯一管理员后台静态资源、保守的服务/代理模板及发布指引压缩为**不含生产 Secrets、无 node_modules**的 `cuoshi-private-deploy.tar.gz`；文件使用 `SHA256SUMS` 逐项复核并单独发布压缩文件 SHA-256。`test:future:private-release-bundle` 使用私有临时目录实际解包、校验全部文件、确认退出即清理、无凭据无法启动、唯一管理员网页资源可以独立读取。CI 打包后 Artifact 留存七天，**不自动部署、迁移、安装服务、绑定端口或签发真实管理员身份**。上线仍受全部五道真实关口约束。

#### 2026-10-24: Only-admin ingress stays on loopback behind authenticated SSH

Caddy now keeps the eight WeChat/public API paths on the approved HTTPS hostname, while serving the one owner's existing password+TOTP admin console via a different **127.0.0.1-only** listener. Seven fixed admin URL paths are forwarded to its independent loopback server with a separately derived trusted-edge proof; there is NO new public administrator site, no staff/employee account, and no user private note listing. Operator connects over authenticated SSH local forwarding, then signs in using password and a six-digit authenticator code. The Caddy environment generator now refuses colliding ports and reused signing proofs. Real Caddy adaptation CI validates the resulting listener and routing, and the file is part of the reviewed backend deployment bundle. Live SSH tunnel, cloud platform, firewall and domain validation have not occurred. Release stays BLOCKED.

#### 2026-10-24 · Complete sole-owner service configuration sample and deployment package guard

A previous handoff gap was the absence of a complete owner backend `staff.env` skeleton; it could easily lead to a valid Caddy admin route but a Node process refusing to start. Added `future/server/deploy/staff.env.example` with all twelve owner-server settings and exclusively invalid placeholders, plus a required CI parity test against `privateStaffConfig.ts` and the Caddy proxy operator configuration. The allowlisted deployment tarball now carries this template; extraction tests validate its bytes and runtime startup refusal without secrets. No account is created, no production secret is generated, and no service is enabled. All other release gates remain BLOCKED.

#### 2026-10-24 · 取消唯一管理员对旧版私人日记读取函数的数据库执行权

正式 v0.5 首次迁移 `002_runtime_permissions.sql` 不再授权管理员执行旧版 `cloud_read_day(...)`（并明确撤销旧角色权限），虽然历史源代码依然保留案例/审计函数供隔离测试。此前只有界面/API 删除了员工和私人正文读取入口，但 PostgreSQL 角色还有历史 EXECUTE 权限；现在把数据库这一层也真正收紧。**管理员只可通过独立 Reporting SQL 技术账号获取五项匿名聚合数字，不得调用旧版私人简记读取函数。** 普通微信云服务和后台服务各自的启动就绪度检查都必须拒绝管理员角色意外获得直接 SELECT 或历史正文函数 EXECUTE 权限。CI 使用一次性 PostgreSQL 角色先证实不可执行，然后在隔离测试中临时授权验证旧案例锁和审计逻辑，最后撤销并确认启动自检恢复；**测试临时授权绝不会进入生产 SQL 或部署包**。任何旧环境升级必须另审，不可擅自执行新建迁移。正式上线仍未发生。

#### 2026-10-24 · 私有发布构建彻底清除旧编译文件

独立后端 TypeScript 编译器默认**不会清理旧输出目录**。实测发现，旧版多员工/私人日期读取处理程序的 `adminHttp.js`、`staffDayService.js` 曾滞留在原编译文件夹中，先前部署打包器会把编译目录中的 JS 一并收录。这不等同于现有公网路由可访问，但不应将无用旧代码带到单管理员正式环境。本轮改为每次构建先生成全新的临时目录，TypeScript 成功后才替换构建目录；打包器另外拒绝出现两份废弃 JS。合同检查会主动插入合成旧文件，分别验证重编译清除与未清除时打包拒绝；不接触真实数据库、凭证或个人简记。原来八份 SQL 迁移、线上服务及微信包均未修改，五道真实发布门槛仍 BLOCKED。

### 2026-10-24 · Render 公开模拟预览（已部署，非生产环境）

使用运营者既有的 Render 工作区，独立新建 `cuoshi-v05-synthetic-preview` 静态网站，手动部署 Draft PR #4 的 `future/preview` 云优先 UI 演示；可访问 <https://cuoshi-v05-synthetic-preview.onrender.com/>。首轮 Render 部署 `dep-dbe627qvcj2c73br0uc0` 为 `live`，远端 HTTPS 首页返回 200，不存在的私人备份 API 路径返回 404；首次部署提交为 `207510a`。服务设置 `autoDeploy=no`，后续代码修改必须手动重新部署。原有旧版 `cuoshi-ysr-v02` 静态站点未改。

该演示使用进程内的虚构账号与模拟云合同，**没有接入真实微信、生产数据库、真实云存储、管理员服务或私人笔记**。公开演示页显示“仅模拟数据，不会同步云端，请勿输入私人内容”，并添加 `noindex,nofollow,noarchive`，独立 Chrome 测试锁定这两项提醒。部署采用 Render 海外静态 CDN，**不能作为中国大陆生产个人信息存储方案，也不满足五道发布关口中任何真实联网/实名/备案要求**。Render 静态网站本身可免费部署，但使用已有工作区流量及构建分钟配额，额度外是否计费以工作区实际账单规则为准。将正式云端接入与本演示彻底隔离。

### 2026-10-24 · 独立目标机发布验包闭环（完成开发，尚未在生产执行）

部署 ZIP/TAR 获得方不再只依赖人工查看文件列表。后端候选压缩包现在**随包附带** `future/server/deploy/verify-private-release.mjs`，目标 Linux 在部署目录刚解压、安装运行依赖及生产 Secrets **之前**运行，逐项核对全部发布文件 SHA-256、8 份 SQL、单管理员/云/维护入口、Caddy/systemd 模板和真实 Git 提交信息。意外混入文件、删除或修改文件、遗留废弃员工私密读取处理器、额外密钥/源码文件及符号链接均拒绝；不会触及公网、个人数据或数据库。测试在独立临时 tar 解包目录真实执行检查器，并注入篡改后确认拒绝。使用前必须独立验证受信任 GitHub Actions 给出的外层 tar SHA-256，包内 SHA256SUMS **不是数字签名**，不得仅靠其宣称可信。参见 [后端部署说明](../future/server/deploy/README.md#新增目标机不带任何生产凭据的首轮验包)。

这项工作使获授权的 Linux 部署能够先完成可重复的静态验收，不意味着已有合法云主机、实际 AppID、备案/HTTPS 证书、已执行迁移、生产可达性或真实双真机记录。五关 BLOCKED 不变。
