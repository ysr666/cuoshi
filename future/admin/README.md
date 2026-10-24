# 错事 · 极简管理台（v0.5，独立开发预览）

**已实现可交互管理台原型及隔离的员工工单读取 HTTP 接口；尚未接生产数据库、真实用户数据、员工登录或 MFA。不能发布为正式后台。**

## 2026-10-24 · 最高优先级：唯一管理员（已更正）

**「错事」不是企业系统。正式后台仅有一个人类管理员——项目所有者本人。** 不建设员工账号、多管理员角色、下属审批、客服团队或双人审批工单。开发早期曾错误引入该类多员工模型；以下带有「员工/工单」的旧章节仅作历史技术记录，不是现行产品要求，优先以此节和代码的实际可达路由为准。

现行**唯一管理员后台**是 `future/admin/live/`，可访问的操作仅有**运营概览、系统状态**；其独立受保护服务入口只暴露 `GET /internal/admin/overview`。旧 `/internal/admin/read-day` 已从正式后台入口移除（请求返回 404），原有 SQL 双人审批工单不再作为可执行产品流程。后台不默认读取任何人的私人简记。需要按用户查阅数据时，应另行完成合规目的、明确隐私说明和单人可审计的授权设计，不能借用过去的两人审批逻辑来冒充已完成。

服务端设置 `CUOSHI_OWNER_ADMIN_ID` 为**唯一管理员身份 ID**（8–128 位安全字符），必须与正式签发的短期后台令牌 `sub` 完全相同；不匹配的有效签名身份在访问统计数据库**之前**即被拒绝。仍保留**两个 PostgreSQL 技术登录角色**、HTTPS 可信代理、短期令牌与操作审计；这些都是机器权限隔离，**不是第二个人**。真实管理员验证还未接生产身份供应方，不能宣称现在已可以公开登录。

本地演示页面 `future/admin/public/` 同步只显示运营概览、模拟账号状态与系统情况，不再显示多人审批流程。

## 使用演示界面（无账号、无数据库、无公网）

在 Mac 项目仓库根目录安装依赖后：

```sh
CUOSHI_ADMIN_DEMO_ACK=SYNTHETIC_ADMIN_PREVIEW_ONLY npm run dev:future:admin-preview
```

只绑定 `127.0.0.1:4177`，用**运行该命令的 Mac**浏览器打开 `http://127.0.0.1:4177/`。其他手机或电脑不能直接使用该 localhost 链接。无指定确认环境变量则拒绝启动。除 `/api/preview/{overview,accounts,cases,system}` 的静态虚构 JSON 和三份页面资源外全部 404；禁止 POST 和任何公开云记录路径；无 cookie、真实 JWT、外部请求、跨站 CORS、数据库连接及账号标识。模拟数据仅用于审美和交互验收，任何“绿色”健康状态均明确为**演示正常**，不能作为上线依据。

界面有四块：运营概览（模拟聚合指标和趋势）、账号状态（只看模拟的注册及同步状态，可筛选）、工单与授权（查看模拟工单范围；真实正文查询按钮禁用）、系统状态（清楚展示真实未部署组件）。不提供全库私人简记搜索、数据导出、一键浏览他人历史或无理由账号管理。**不属于微信小程序客户端首发页面。**

## 已实现的真实服务器接口层（尚未接线）

`future/server/src/adminHttp.ts`：提供独立的 `createPrivateAdminHttpHandler(service)`，唯一的 `POST /internal/admin/read-day`，只收 `{ownerId,dayKey,caseId}` 和 `Authorization: Bearer <staff JWT>`，不接受多余用户身份、角色、Token 或 URL query。其调用 `AuthenticatedCloudService.readPrivateDay`，该服务验证独立员工签名受众与 MFA，再使用数据库内经过审计的 `cloud_read_day` 函数验证员工在职/角色、工单用途、他人审批、指定日期、短时效力；未授权则回 403 且不给原因或私人记录。成功最多返回一日的日记录和该日期事件；没有全库列表或正文导出。日志不回显 SQL/密钥/私人内容，响应禁止缓存和跨域读取。

**该 handler 故意不挂到公开 `cloudHttpHost`、公网 Caddy 或微信小程序中，也不会创建监听端口。** 真正上线前须建设独立管理员域名及入口访问限制、可信的员工账号 + MFA 签发与吊销、专门隔离的管理后端进程/受限数据库角色、审计外部持久化，以及批准范围管理；必须在真实微信及生产数据库进行隐私与安全验证。现在无法凭一段伪造的演示 JWT 访问任何真实数据。

**运营人数、七日活跃和同步成功率暂未配置生产聚合查询**。现有 SQL 最小权限没有提供这些数值（而且不能通过管理员账号直接查询全部私人 JSON 快照）。等正式云域名、员工身份和匿名聚合统计 SQL 经审核后才连上，不造数、不冒充真实运营指标。

## 自动测试

```sh
npm run test:future:admin-http
npm run test:future:admin-preview
```

前者验证私有路由、字段白名单、拒绝未认证、模拟工单拒绝和已授权精确单日读取；后者验证默认禁止启动、127.0.0.1/Host/CSP/无外链、生产路径 404、桌面和 390px 移动端页面与模拟账号搜索、工单范围、禁用真实读取按钮。CI 在 Chrome 安装后执行，所有数据均为合成样例。

## 真实匿名统计的底层数据源（尚未接入预览 UI）

`future/server/sql/005_account_cancellation.sql` 增加受限 SQL 函数 `cloud_reporting_overview()`。它只对单独的**报表角色**授予 `EXECUTE`，不会授予任何 `cloud_users`、`cloud_snapshots` 或私人 JSON 表的直接读取权；返回五个整数汇总：活跃账号总数（未注销）、目前开启云备份的账号数、存储有快照的账号数、近七日修改过快照的账号数、近七日新注册账号数。调用封装为 `src/operationalReporting.ts`，只返回已验证安全整数，不带账号、内容、简记、日期级用户行为或事件明细。

**严格区分统计口径**：近七日快照更新不等于七日活跃用户，也不能计算真实同步成功率。页面原有的模拟“418”和“99.4%”目前仍只作为显式标注的演示数据；正式运营必须接入独立员工认证及报表服务后才显示真实统计，未测量的字段标明“尚无数据”。本函数不创造任何公共 HTTP 入口，不包含演示回退到真实数据库。

## 生产方向：独立员工汇总接口（尚未开放）

`future/server/src/operationalService.ts` + `operationalHttp.ts` 提供 `GET /internal/admin/overview` 的独立受限处理函数。必须提供独立的 5 分钟员工签名会话（经过实际员工 MFA）、每次检查数据库撤销名单，再调用独立报表账号的 `cloud_reporting_overview(staff_id, mfa_verified)`。PostgreSQL **再次检查员工角色必须为在职管理员/审计员**，并记录允许/拒绝的匿名汇总访问审计；客服即使持有有效会话也不能读。用户 token、伪造员工标识、过期与撤销的会话均被拒绝，不可传递用户 ID/日期/查询参数，没有私人正文路径、批量导出或跨域读权限。

**安全限定**：此处理函数未被公网 `cloudHttpHost`、Caddy、小程序、localhost 演示页或正式服务器入口挂载；也没有提供绕过 MFA 的管理员账号签发器。需要有合法员工身份来源、独立受控管理员 HTTPS 入口和最小数据库角色的生产部署才可投入使用。演示页面仍使用清楚标记的合成数据。

## 独立管理员服务入口（仅代码，未部署）

新增 `future/server/src/staffHttpHost.ts`，限定 127.0.0.1 与可信本机代理，只允许运营汇总及经审批的工单单日查询两个精确路径。普通微信登录和私人备份路由返回 404；它没有自动注册到小程序公开服务器。员工 MFA、独立正式管理域名及安全运维配置仍需生产资源。对应 `npm run test:future:staff-host` 做隔离回归。

## 真实接口形态的独立员工管理网页（非演示页面）

新增 `future/admin/live/`：这是与原先虚构数字的预览界面**完全分开**的真实接口管理界面源文件，使用 `future/server/src/staffHttpHost.ts#createStaffConsoleAssets(绝对路径)` 显式挂到**单独的可信代理保护的员工监听器**的 `/admin/`。它通过同源受保护的 `GET /internal/admin/overview` 读取准确的五项匿名汇总，通过 `POST /internal/admin/read-day` 严格按审批工单号、指定账号和指定日期执行一次只读查阅；不提供用户全局搜索、全量记录导出、后台任意写入或模拟统计回退。界面默认不展示私人记录，不把“最近七日快照更新”称为七日活跃用户，也不伪造同步成功率。

所有凭证必须在**独立身份提供方完成真实 MFA 后**签发。网页仅接收短期员工 JWT，不生成 JWT、不会冒充 MFA、不会存储到 localStorage、sessionStorage、Cookie 或 URL；令牌仅存于当前网页内存，主动退出及离开页面会清除。使用 DOM `textContent` 而非拼接私人 JSON 到 HTML；异步请求经过 AbortController 与会话代际校验，退出后旧响应不会显示在新的会话中。静态资源同源、无外部字体/脚本/埋点、HTTPS 前置服务应设置严格 CSP、反框架嵌入与禁止缓存策略。

`npm run test:future:staff-console`：使用虚构员工令牌和本机代理构造端到端 Chrome 验收，覆盖五项真实接口字段、禁止跨域资源、员工越权、无令牌、工单允许/拒绝、清理敏感数据、移动与桌面布局、无浏览器存储等。**真实员工账号与签发服务尚未部署**，因此生产网页目前也不能登录获取真实运营数据；不得把本地模拟验证当成生产授权测试。打包/部署时必须显式携带 `future/admin/live` 和其独立 CSS，不得复用 `future/admin/public` 的合成数据接口。

## 私有员工 Node 进程与权限预检（代码完成，尚未部署）

独立进程 `future/server/src/privateStaffMain.ts` 已纳入 `npm run build:private --prefix future/server` 编译；`npm run start:staff --prefix future/server` 只有在配置齐全、经运维授权的主机上可用，**目前无真实配置会直接拒绝启动**。与普通微信用户的 `privateMain.ts` 不共用网络监听口、不共用数据库报表登录角色，也不会提供员工登录令牌签发或本地绕过。部署模板 `future/server/deploy/systemd/cuoshi-staff.service` 默认未启用，需要单独员工服务账号和 root 管理的环境文件。

正式后台进程所需的运行设置（只列名称，不能把值提交仓库）：`CUOSHI_STAFF_EDGE_ACK=ISOLATED_STAFF_LOOPBACK_ONLY`、`CUOSHI_STAFF_PORT`（独立四至五位未占用端口）、`CUOSHI_PRIVATE_PORT`（普通用户服务端口，用于防冲突）、`CUOSHI_PG_SCHEMA`、`CUOSHI_PG_STAFF_URL`、`CUOSHI_PG_REPORTING_URL`（两个不同、只具备最小权限的 TLS verify-full PG 用户）、`CUOSHI_STAFF_SIGNING_KEY_HEX`（与可信 MFA 员工签发者一致的独立服务端密钥）、`CUOSHI_STAFF_EDGE_SHARED_SECRET_HEX`（与普通用户端代理秘密分离的 32 字节随机密钥）。正式代理只可在严格的 HTTPS/访问控制下为此端口注入派生的可信 header，不能转发用户提供的同名 header。启动前每个数据库角色均须非超级用户、无直接读取账号和私人备份表权限；员工角色可执行已授权单日函数但不能执行全局报表函数，报表角色则相反。缺任一条件拒绝监听。

代码编译与权限校验只是上线准备，**未提供真实员工 MFA 身份来源、账号开通及注销流程，也没有生产证书、域名、数据库或真实用户**。此时不能把管理台 UI 提交到任何公开域名。验证：`npm run test:future:staff-config`、`npm run test:future:staff-host`、`npm run test:future:staff-console`，以及 GitHub 隔离 PostgreSQL Job 的员工角色权限检查。

### 2026-10-24 · 管理页面失效响应与 BFCache 隐私隔离

管理台在页面切换时主动中止进行中的私人单日查询；页面离开、BFCache pagehide 和退出员工会话均调用统一的内存及 DOM 清理逻辑，避免旧请求在用户离开后重新填入私人数据。Chrome 验收新增慢工单响应/离开页面/返回登录态检查；生产依然必须提供合法员工 MFA，不会自动展示私人简记。

## 2026-10-24: Sole-owner password + TOTP login (current implementation)

The sole human administrator signs in with a separate dashboard password and a six-digit authenticator code. The web UI no longer asks the user to paste a JWT. Both factors are verified server-side. A signed owner-only bearer session lasts at most five minutes and remains only in the current browser page's memory; logout writes a persistent session-revocation entry. No extra human employee, approval workflow, private-note export, or global user record listing is enabled.

Production settings are REQUIRED and must never be committed, pasted in chat, or bundled into the mini program:

- `CUOSHI_OWNER_ADMIN_ID`: fixed 8-128 character owner ID. The migration operator must enroll exactly this ID as the only active `super_admin` in `cloud_staff` (legacy schema compatibility; this is not a multi-employee system).
- `CUOSHI_OWNER_PASSWORD_SCRYPT`: `scrypt:16384:<32 hex chars of random salt>:<64 hex chars of derived key>` with scrypt `N=16384,r=8,p=1`, output length 32. No plaintext dashboard password in the environment or code.
- `CUOSHI_OWNER_TOTP_SECRET`: securely generated uppercase Base32 TOTP seed (at least 20 random bytes), enrolled locally into the owner's authenticator. Never upload the seed.
- `CUOSHI_OWNER_LOGIN_PEER_KEY_HEX`: an additional independent 32-byte random HMAC key, different from both owner JWT signing key and trusted reverse-proxy key.
- The preexisting `CUOSHI_STAFF_SIGNING_KEY_HEX`, `CUOSHI_STAFF_EDGE_SHARED_SECRET_HEX`, separate least-privileged PostgreSQL technical roles, and dedicated loopback HTTPS proxy remain required. Technical database roles are NOT human employees.

Migration `008_owner_admin_login.sql` adds atomic 5-minute PostgreSQL login limits (five per authenticated peer, 30 globally), one-use TOTP time-step consumption, and bounded maintenance cleanup. Any missing configuration, failed database, malformed secret or mismatched identity fails closed. The front end has no mock-data fallback on failed sign-in. Unit/browser/integration coverage: `npm run test:future:owner-auth`, `npm run test:future:staff-console`, and real PostgreSQL CI.

This is code readiness only. No real dashboard secrets, production database, official HTTPS domain, or live administrator enrollment have been set up. An unconfigured deployment cannot log in and must NOT be published.

## 当前新增：单管理员首次安装资料（2026-10-24）

`future/server/deploy/prepare-owner.mjs` 是独立**离线**初始化工具，按批准的 schema 生成一次性管理员 ID、随机强密码哈希、TOTP 身份验证器种子及独立签名/代理/IP 限流密钥。所有输出放在 Git 仓库外、权限 0700 的全新目录内，凭证文件 0600；用户需亲自完成 TOTP 绑定和秘密托管。`owner-enroll.sql` 只在空的历史管理员表内插入**唯一** `super_admin`；不打开额外员工身份、不接触微信用户记录、不执行真实 SQL。每小时受限维护任务已增加过期管理员登录尝试计数清理，避免把新的匿名 IP-HMAC 记录永久积累。完整操作条件与风险以 `future/server/deploy/README.md` 为准。

**本次没有初始化真实管理员，没有生成实际部署密钥、购买云服务器、部署接口或上传你的私人数据**；所有测试资料均在隔离临时目录中使用后销毁。前端历史 npm 漏洞、上线合规和真机 QA 仍是正式发布关口。
