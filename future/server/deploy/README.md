# 错事 v0.5 · 中国大陆 HTTPS 代理部署模板（尚未实际部署）

本目录只有**模板和离线检查代码**，不代表已购买服务器、完成 ICP 备案、配置公网 DNS、取得微信 AppID 或完成安全验收。请严格依据 `docs/RELEASE_V05_FIVE_GATES.md` 的上线关口，待个人主体账户及资源具备后使用。只为首发两页小程序提供 `/v1/...` 和 `/healthz`，不添加产品功能。

## 结构

- `Caddyfile`：可审查的同机 HTTPS 入口模板。只转发当前私有服务的 8 条白名单路径，其他一律 404；后端目标始终为 `127.0.0.1` 的配置端口。Caddy 使用其正常 ACME 机制申请真实域名的 TLS 证书，公网证书与 DNS 必须先就绪。
- `prepare-proxy-env.mjs`：在**获授权的服务器**上从服务端已有的 `CUOSHI_EDGE_SHARED_SECRET_HEX` 计算内部代理头的派生值，**只写入指定的绝对路径文件**、权限 0600、拒绝覆盖旧文件与写入源代码仓库；不会将密钥或派生值打印出来。
- `tests/check-future-proxy-deploy.mjs`：离线验证静态网关合同、私有头覆写规则、8 条必需路由和凭据文件权限；它不运行真实 Caddy 或 TLS，不能替代现场验证。

## 运营者完成正式实名、备案与购买后，执行前核对

1. 使用个人主体云账号及已经备案、可在微信后台配置的 API 域名；选择合规国内地域的 Linux 主机和 PostgreSQL 服务，完成四受限账户、迁移和 TLS 身份验证。**禁止**在使用个人身份信息或秘密的 shell 命令中开启 shell tracing（`set -x`）。
2. 单机部署 Caddy 和服务端 Node.js 22+；Caddy 对外监听 443/TLS，Node 服务继续**只监听 127.0.0.1**。主机防火墙不开放私有业务端口（示例 18765），不得配置将其转发到公网的容器映射、内网穿透或代理。
3. 将 `future/server/deploy/Caddyfile` 安装到实际 Caddy 配置路径。设置只允许受限管理员读取的 Caddy 环境文件，例如 `/etc/cuoshi/caddy.env`，提供 `CUOSHI_PUBLIC_DOMAIN`（仅主机名）、`CUOSHI_PRIVATE_PORT`（与 Node 端口一致）和 `CUOSHI_EDGE_PROOF_HEX`（由脚本生成的代理凭据）。不要将 `CUOSHI_EDGE_SHARED_SECRET_HEX` 放进 Caddy 环境；该原始密钥只用于 Node 服务配置和安全派生。
4. 在安全环境里通过进程环境/秘密管理器临时提供 `CUOSHI_EDGE_SHARED_SECRET_HEX`、`CUOSHI_PUBLIC_DOMAIN` 与 `CUOSHI_PRIVATE_PORT`，调用 `node future/server/deploy/prepare-proxy-env.mjs /etc/cuoshi/caddy.env` **只创建新文件**。建议由有权限的账户直接创建在最终保护目录；如需更新密钥，先以有审计的方式停服务、备份旧配置，再显式替换，不要把凭据粘贴进终端日志、GitHub issue 或 CI。
5. 通过系统服务管理器把受限环境文件注入 Caddy 进程；需要在**目标服务器已安装的 Caddy CLI** 里做 `caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile`，确认配置和实际受限路由及 HTTPS 才可启动；此模板将 Caddy 管理 API 关闭（`admin off`），变更时需按受控运维流程重启服务，不能依赖需要管理 API 的热重载命令。Caddy 的 `header_up` 会先剥离访问者提供的 `X-Cuoshi-Edge-Proof`、`X-Cuoshi-Client-Ip`，再用本机凭据/实际 TCP 连接 IP 重设。服务端还会验证请求来自本机回环与代理凭据，不能仅靠 Caddy 配置作为唯一安全边界。
6. 若前置 CDN、负载均衡或 WAF，`{http.request.remote.host}` 默认为**直接连接到 Caddy 的对端 IP**。此时服务端按该地址做保守限制，**不擅自信任外部 `X-Forwarded-For`**。想识别终端真实 IP 必须另外评估 CDN 固定可信网段、头重写/禁止欺骗和 IP 限流策略；不满足条件不得对外发布。
7. 仅在上述配置真实生效后，使用授权环境执行 `CUOSHI_V05_CLOUD_ORIGIN=https://实际合法域名 npm run check:future:public-edge` 验证 204/401/404。随后用正式微信 AppID 和**两台真实手机**完成 12 项 QA。Caddy 命令成功本身不能证明个人信息保护已符合要求。

## 运维安全前提

- **机密信息只留服务器**：AppSecret、数据库登录密码、JWT 签名私钥和 Caddy 派生代理头不能放小程序、GitHub、公开二维码、CI 变量回显或截图。
- **无法核验的直接阻断上线**：TLS 证书链与自动更新、合法 request 域名、腾讯云/实际服务商备案、可回溯脱敏安全审计、私有记录权限、服务器时间、备份生命周期、异常告警、WAL/灾备副本清理演练及注销后处置协议。
- 当前仓库没有可重复的真实 Caddy 启动或 HTTPS 探针通过证据，也没有真实私有云账号。此模板需要在未来的受控运行环境**执行原生命令验证并做安全复核**，不能称为已部署成功。


## 数据库的八步迁移交付（离线生成，不直接写数据库）

`render-migrations.mjs` 是独立的安全迁移渲染器。首次生产部署前，必须由**有权限的独立数据库管理员**创建受控 schema 和 6 个不同 LOGIN 角色：备份、管理员、微信身份、注销、维护、汇总统计。运行时的 4 个服务角色不能拥有 schema、执行 DDL 或成为超级用户；维护/只读统计角色只用于独立管理服务，**不复用小程序的数据库账号**。

1. 由云服务管理员先核准本项目部署方案、schema 名称及各角色名；**不要把密码填进下列变量或提交给 GitHub**。准备 `CUOSHI_PG_SCHEMA`、`CUOSHI_PG_BACKUP_ROLE`、`CUOSHI_PG_ADMIN_ROLE`、`CUOSHI_PG_AUTH_ROLE`、`CUOSHI_PG_DELETION_ROLE`、`CUOSHI_PG_MAINTENANCE_ROLE`、`CUOSHI_PG_REPORTING_ROLE`，均应是符合 SQL 标识符规则的不同小写英文下划线名称。
2. 将以上仅含**非秘密角色名字**的环境变量交给离线 CLI：`npm run prepare:future:migrations -- /absolute/private/out/new-migrations`。输出必须是此前不存在的目录、在仓库之外；不会发送数据库请求、不会创建账号、不会执行 SQL。失败也不会留下部分迁移。
3. 工具按固定顺序生成 `001_initial.sql` 至 `008_owner_admin_login.sql` 和 `SHA256-MANIFEST.json`；目录权限 0700、文件 0600，带完整 SHA-256 校验和。每个 SQL 在 `BEGIN` 后显式 `SET LOCAL search_path` 指向经过严格校验的 schema，以免依赖数据库客户端默认 search_path 而错建表。
4. **人工逐项复核生成 SQL**，确认实例及 schema 与账号归属，检查是否已存在对象、角色权限、需要的维护窗口、可回滚快照以及数据库实际备份。此脚本目前面向新部署的**一次性、从空 schema 开始**的迁移，不提供在线重放/升级或自动 rollback；数据库已有数据绝不能再次跑首建 SQL。
5. 由经过授权的**独立迁移账号**按文件名顺序执行，严格核对每步的 DB 返回、对象/权限和失败日志；严禁使用运行时备份、微信身份、注销或管理员账户执行 DDL。迁移成功后才能启动私有 Node 服务，验证 4 个最小权限登录，随后再通过可信代理连接真实微信服务。

`npm run test:future:migration-render` 用 **67 项**静态与临时文件合同验证固定顺序、SQL 角色名、注入防护、只写仓库外权限隔离目录及 checksum；独立的真实 PostgreSQL CI 则直接调用相同渲染器执行 8 份迁移并验证角色权限与注销业务。这两类测试均不能代替生产实例上的审查和演练。


### 必须配置的 PostgreSQL schema（已修复生产启动阻断）

服务端的四个运行时连接现在统一使用 `CUOSHI_PG_SCHEMA`（例如 `cuoshi_prod`），必须与七份迁移脚本中的 `CUOSHI_PG_SCHEMA` **完全一致**。这是服务端独立必需环境变量，值只允许小写英文/数字/下划线且不能是 `public`、PostgreSQL 内部 schema 或危险标识符。Node 的 `pg.Pool` 明确发送 `-c search_path=<schema>,pg_catalog` 并验证 `current_schema()` 与 `to_regclass('cloud_users')`，不再依赖 PostgreSQL 默认的 `public`，也不允许 DSN 中用 `options=` 绕过。

新建空 schema 后必须由独立迁移账号在此 schema 执行 SQL；**不能**为了让服务启动而把表建到 `public`，也不能给业务账号 schema 所有权。真实 PostgreSQL CI 有反例证明「没有 search_path 的业务连接看不到表」，并对四个生产同款连接配置逐一验证 schema 可见性。

## 真实 Linux 主机 systemd 服务模板（此处只提供文件，不启动）

- `systemd/cuoshi-cloud.service`：云服务以**专用系统用户 `cuoshi`** 启动，固定入口 `/opt/cuoshi/current/future/server/.private-build/future/server/src/privateMain.js`（与构建实际产物一致），配置由 `/etc/cuoshi/cloud.env` 按 0600 文件权限注入；使用 `NoNewPrivileges`、只读系统目录、禁用内核/设备/提权能力、私有临时目录。**此服务绝不能以 root 启动。**
- `systemd/caddy.service.d/cuoshi.conf`：仅给服务商安装的 Caddy 服务注入独立的 `/etc/cuoshi/caddy.env`，不重写 Caddy 官方启动命令或服务用户/绑定 443 所需能力；文件中是**派生边缘凭据**而非 Node 根密钥。

只有运营者实际具有**备案域名、合法云资源、受控迁移与六组真实独立密钥**，并完成对实例的直接授权后，部署人员才可以：

1. 在真实 Linux 主机安装符合安全基线的 Node 22+ 与 Caddy，并核实 `command -v node` 对应模板中的 `/usr/bin/node`；不同发行版安装路径不同，不应复制模板就盲目启动。以无 shell 登录权的低权限 `cuoshi` 系统用户部署应用，只授予已编译代码读取权限。禁用普通用户对部署目录的写入权限；对单机数据库或云厂商托管数据库另行审计网络出站权限。
2. 使用受保护的秘密管理流程生成 **`/etc/cuoshi/cloud.env`**。此文件仅含服务端 `future/server/.env.example` 定义的真实环境变量，目录仅管理员可访问，文件必须是 root 管理的 0600 权限，不允许放入 Git/备份公开桶、聊天记录或常规 CI 日志。按上文说明生成另外一份仅供 Caddy 使用的 `/etc/cuoshi/caddy.env`，不允许把 AppSecret/JWT 根签名密钥放进去。
3. 将 Caddyfile 审核后安装到 `/etc/caddy/Caddyfile`，再安装 `cuoshi-cloud.service` 到 systemd 的服务目录及 Caddy 的相应 drop-in。由授权系统管理员运行 `systemd-analyze verify`、`caddy validate`、`systemctl daemon-reload` 等真实宿主环境命令，核对 systemd 读入的 `EnvironmentFile`、服务文件完整性及 Caddy TLS、DNS 和证书路径。**本地 Mac CI 只会做静态检查，并没有 systemd 或 Caddy 二进制可用**。
4. 首次启动服务前检查数据库的 7 份迁移已在独立数据库迁移身份下完成、角色分离、实例 SSL 证书链、域名备案和业务允许路径，确保后端端口只监听 loopback 且防火墙不允许公网入站。启动 Caddy 前必须核对其派生代理凭据与 Node 端根密钥来自同一受控秘密材料，且对外不能直接发起针对私有业务端口的请求。
5. 真实上电后只用无私人数据的 GET 探针及虚构测试记录做联调；验证 401 未认证拒绝、404 未知路径、防伪造请求头、限流、连接断开、被暂停的自动云授权、双机同步与注销。服务启动和操作事件日志必须屏蔽 AppSecret、用户简记、原始 openid 与 JWT。运行 `systemctl enable/start` 是**单独的实际授权操作**，当前仓库工具从未执行。

`npm run test:future:systemd-deploy` 有 **22 项**纯静态检查，用于阻止任何修改把 root 运行、嵌入密钥、绕过编译入口或宽松 systemd 权限重新引入；**不能代替**目标 Linux 上的 systemd 原生命令验证和人工网络/防火墙评审。


## 官方 Caddy 二进制的离线解析门禁（CI）

为避免只通过模板字符串检查而遗漏真实语法/路由含义，GitHub Actions 新增 `Official Caddy offline config adaptation (synthetic)` Job：通过固定的官方 `caddy:2.11.7-alpine` 容器执行 `caddy adapt`，容器禁用网络、只读挂载 Caddyfile，输入**虚构**域名、端口和派生凭据。`tests/check-future-caddy-adapt.mjs` 解析 Caddy **真正生成的 JSON 配置**，检查管理 API 关闭、唯一 localhost 上游、八条路由、伪造内部头被剥离和重设、404 回退。若官方配置解析失败或与预期合同不符，CI 必须失败。这里无 TLS 申请、外网代理、真实域名注册或用户数据，不代表生产 Caddy 已实际启动；目标 Linux 仍须再做现场 `caddy validate`、域名、证书、负载均衡及网络隔离检查。


## 真实运行依赖不可遗漏（2026-10-20）

已经编译出的 `future/server/.private-build/future/server/src/privateMain.js` **并不内置 PostgreSQL 驱动**。正式 Linux 主机必须从 `future/server/package-lock.json` 另行执行 `npm ci --prefix future/server --omit=dev --ignore-scripts --registry=https://registry.npmjs.org`，核实产物位于 `/opt/cuoshi/current/future/server/node_modules/pg`；绝对不能把根项目的前端开发依赖作为生产服务依赖安装，或只复制 `.private-build` 就启动服务。服务端 `pg` 模块由编译后的入口逐级向上解析到其独立 `future/server/node_modules`，并按后端独立锁文件固定版本。

`npm run test:future:private-runtime-package` 在实际编译之后，用**真实 Node 模块解析和已安装的 pg 驱动**验证 Linux systemd 入口路径、锁文件版本、独立依赖位置、`sslmode=verify-full` 的 TLS 模式、PostgreSQL startup schema 参数以及没有部署密钥时的启动拒绝。该检查已加入真实 PostgreSQL CI，**没有联网查询微信，也没有监听生产端口**。原来仅靠 `tsc --noEmit` 与模拟 PostgreSQL 的测试不足以证明独立模块真实可加载。若这个测试失败，禁止制作正式服务器发布包。

## 每小时删除旧登录限流记录（独立、最小权限、尚未启用）

- `systemd/cuoshi-login-prune.timer`：`OnCalendar=hourly`，`Persistent=true`；由运营者**明确批准后**在真实 Linux 主机启用。未正式部署的当前仓库没有正在运行的维护定时任务。
- `systemd/cuoshi-login-prune.service`：独立 `cuoshi-maint` 无特权服务身份，`Type=oneshot`，执行已经编译的 `privateMaintenance.js`；使用**与业务服务完全分离**的 `/etc/cuoshi/maintenance.env`（root 管理 0600），不加载微信 AppSecret、JWT/备份密钥或管理账号口令。
- `maintenance.env.example`：仅列必需的 `CUOSHI_MAINTENANCE_ACK=PRUNE_LOGIN_WINDOWS_ONLY`、迁移时的 `CUOSHI_PG_SCHEMA`、**专用维护角色** TLS 验证 PostgreSQL URL。配置或 PostgreSQL 角色/权限不符合要求就拒绝执行。
- 程序只能以维护角色执行 migration 007 的 `cloud_prune_wechat_login_windows()`，执行前验证不是 superuser、没有 DDL/复制等权力、不能直接 `SELECT` 或 `DELETE` 登录尝试表；仅输出汇总删除条数，不输出 IP、令牌或用户记录。若数据库不可用或校验失败，脚本以非零退出码失败，**不尝试以超级用户绕过**。
- 真实 PostgreSQL CI 会插入**合成**的 24 小时以前及几分钟前记录，执行与生产完全相同的维护函数，验证只有过期数据被清掉、重复运行不会影响新限流数据，其他四类业务账号无法执行维护任务。`npm run test:future:maintenance` 与 `node tests/check-future-maintenance-static.mjs` 验证编译后的真实入口、缺配置时拒绝启动及 systemd 定时器约束。

**留存期限说明**：数据库函数每次删除比执行时早于 24 小时的登录限流窗口，但每小时才运行一次，因此**健康连续运行时实际最长可能接近 25 小时，加上定时器调度误差**；如果服务器停机、PostgreSQL 故障或定时器未启用，残留会更久，不能把「24 小时严格删除保证」写进正式隐私政策。正式发布前需要监控 `systemctl --failed` / timer last-run、异常日志和数据库过期窗口数量，并明确故障后的补偿清理与可披露的上界。数据库物理备份/WAL 的保留周期是**另一套独立待审批规则**，本任务不触碰这些副本。

## PostgreSQL 网络故障的资源上界

所有四条私有业务连接及维护连接复用 `privatePoolConnectionOptions()`：5 秒 TCP 连接超时、15 秒 PostgreSQL 语句超时、4 秒锁等待超时、10 秒事务空闲超时和 20 秒 Node 查询超时。真数据库集成测试检查服务器实际收到的三个 `current_setting`，客户端检查 `pg` 驱动有效参数；避免数据库锁死或后端网络中断时请求无限悬挂。参数仅针对私有服务，不改变微信记录界面。


## 云端健康与故障可见性（上线前仍须接运维告警）

生产专用的 `GET /healthz` 在通过 Caddy 的**内网认证代理**之后，会短时间缓存探测结果，读取四个受限 PostgreSQL 连接的 `SELECT 1`；四个都可达才返回 204，任何一个出错、拒绝或超时返回通用 503（绝不包含用户内容、错误 SQL 或连接密钥）。成功最多缓存 15 秒，失败最多缓存 5 秒，单次探测约 2.5 秒截止，并且同一时刻多个请求合并为一轮检查，防止监控造成数据库负载。`Caddyfile` 仍只允许既有 `/healthz` 路由，不增加任何公开调试或管理员接口。

`npm run test:future:private-health` 已用真实 HTTP 监听、数据库失败、恢复、并发请求与超时模拟验证响应；真实 PostgreSQL CI 另校验四个正式数据库角色的可达性。这是**在线应用就绪度**，不保证微信外部服务商随时可用，也不证明物理备份可以恢复。生产接入后还必须配置有可达通知通道的外部可用性告警，验证故障、维护任务上次成功时间和备份年龄；当前仓库**没有接入真实告警接收人或正式监控平台**。

每小时维护程序现在同时执行三个现有受控 SQL 函数：过期登录限流窗口、注销超过安全期的账号墓碑、过期的一次性微信登录代码及已撤销会话摘要。仅执行限定的 `SECURITY DEFINER` 函数，依然**无用户记录或表级删除读取权限**。每种保留有独立 SQL 截止时间；断网、停机、timer 没启用时无法保证精确期限。生产数据库物理备份、WAL、异地副本和云厂商自动快照不由该程序删除，必须另外设置实际保留与销毁策略并完成恢复演练。


## CI 原生 pg_dump / pg_restore 恢复演练（不会产生用户导出功能）

GitHub 真实 PostgreSQL Job 在完成 8 份正式 schema 迁移并上传**合成**零件数/简记修改历史后，使用与数据库版本一致的官方 `postgres:16-alpine` 客户端、非 root 容器运行 `pg_dump --format custom`，将测试 schema 备份到 CI 宿主的私有临时目录，再以 `pg_restore --exit-on-error` **恢复至另一座新建的空数据库**。恢复后核验：JSONB 中显式 0、完整历史事件数量、原 revision 和 digest、所有者授权以及原库不被更改；还校验 `PGDMP` 文件头及备份 SHA-256 未变，最后删除测试恢复库与临时文件。额外静态校验禁止生产域名、其他数据库名、异常 SQL schema 和非合成 owner ID。

这个演练**只在 GitHub Actions `CI=true`、`GITHUB_ACTIONS=true`、`CUOSHI_TEST_RESTORE_DRILL=SYNTHETIC_POSTGRES_ONLY` 及回环地址的临时测试库允许执行**。测试备份不可包含生产个人信息，且**不会上传到 CI Artifacts**，不存在对用户开放的数据导出或设备恢复功能。

**非常重要**：`pg_dump -Fc` 是 PostgreSQL 的自定义格式，**不是加密备份**。生产环境必须使用经批准的云数据库加密备份、受限密钥管理、独立安全备份账户、备份不可变/保留策略，以及灾难恢复演练；历史物理备份和 WAL 中可能仍含已经注销的个人数据。必须明确这部分的保留、访问和销毁策略，不得声称账号注销后全部历史备份立即物理清零。

## 只读 HTTPS 五分钟巡检（尚未启用、未连接告警通道）

`deploy/check-public-health.mjs` 仅接受规范的非内网、非保留域名字符串，以系统 HTTPS 客户端向备案的 `https://<域名>/healthz` 发起一次无凭据的 GET。只有 HTTP 204 算正常；TLS 证书/域名校验失败、超时、跳转、200 或 503 一律使脚本非零退出，且日志只打印固定错误代号，不包含服务端密钥或用户记录。`systemd/cuoshi-health.service` 用独立 `cuoshi-monitor` 低权限身份与 `/etc/cuoshi/monitor.env`（仅含公开域名），定时器 `systemd/cuoshi-health.timer` 每五分钟执行，错误可通过 `systemctl status`、`journalctl` 被运维监控检测。单独的 `monitor.env.example` 是**不可直接用于正式运行的模板**。

`npm run test:future:health-monitor` 以模拟 HTTPS 返回和实际 Node 启动验证错误状态、域名限制、独立 systemd 配置。**仓库尚未接入实际运维通知接收人，脚本失败并不自动发送短信或微信消息**；在真实云开通后须由账号主体确认通知人员，配置云平台服务监控/告警策略并通过断网、数据库暂停、证书错误三类现场演练。切勿因为 CI 的合成健康检查成功就认为已配置监控或正式备份。

## 唯一管理员首次初始化（只提供离线工具，绝不自动接管生产）

正式后台只允许项目所有者一人使用，**没有员工体系或双人审批**。在真实合规服务器、独立 PostgreSQL 空 schema 和受控迁移就绪前，**不要执行正式初始化**。`prepare-owner.mjs` 仅生成离线私有资料，不访问网络、数据库，也不会在命令行打印账号密码或 TOTP 种子。

在受信任的运维主机上，准备一个**已经存在、仅当前操作者可写的私人父目录**（不能是仓库内或可公开读取目录），为已经审核的 schema 指定 `CUOSHI_PG_SCHEMA`，然后执行 `npm run prepare:future:owner -- /绝对/私人/父目录/全新的管理员资料夹`。输出目录必须此前不存在，工具拒绝覆盖和父目录的宽松权限。新目录采用 `0700`、内含四个 `0600` 文件：

- `owner-auth.env.fragment`：仅用于服务端秘密管理器或 `/etc/cuoshi/staff.env` 的管理员认证变量。**它不是完整部署环境文件**；另需数据库 TLS URL、管理端口、独立代理和受控的所有生产配置。
- `owner-onboarding.txt`：含一次性生成的强密码和身份验证器 Base32 种子。所有者应只在本地导入 TOTP 应用（时间型、SHA-1、六位码、30 秒），将密码安全保存到自己的密码管理器；完成后由本人按正式保密流程销毁这一临时资料，避免泄露或误传。
- `owner-enroll.sql`：用审核过的 schema 明确设置事务 `search_path`，并且**只有 `cloud_staff` 表完全为空时**才插入唯一 `super_admin` ID；存在任何旧管理身份时一律报错，不会覆盖、重建、删除原表。此 SQL **只可由真实独立迁移身份人工审查执行一次**，绝不能由运行时管理员数据库用户或公网接口自动执行。它不含密码、验证码种子或私有记录。
- `SHA256-MANIFEST.txt`：对环境片段与初始化 SQL 的完整校验清单；不能把哈希文件误认为加密。

生成的秘密片段仍须配置到有权限保护的云端安全存储。登录接口只有在 `CUOSHI_OWNER_ADMIN_ID` 与唯一 `super_admin` 记录一致、密码哈希/TOTP 种子正确、可信 HTTPS 代理与两个独立 PostgreSQL 最小权限账号就绪时才会开放。测试使用全虚构、临时创建后立即销毁的密钥材料；`npm run test:future:owner-bootstrap` 检查输出权限、密码哈希可验证性、TOTP 格式、schema 限定、拒绝覆盖和不在日志泄漏秘密。

升级注意：迁移 `008_owner_admin_login.sql` 为单人后台添加额外的登录限流与验证码使用状态，运行时维护任务现在也清理过期管理员 IP-HMAC 时间窗口。历史文档的七步迁移说明已被八步替代；迁移执行前仍需真实数据库管理员按顺序复核并做好备份、回滚方案。不存在自动生产迁移或“一键上线”。

## 私有后端部署交付包（只打包，不安装、不开网、不启服务）

自 Draft PR #4 的 2026-10-24 起，**真实 PostgreSQL 全部回归成功之后**，CI 用 `npm run package:future:private-release -- <私有绝对目录>` 产生 `cuoshi-private-deploy.tar.gz` 和旁边的 SHA-256 校验记录；GitHub Actions 提供 `cuoshi-private-release-<run_id>` Artifact。只有获授权的部署人员应将该文件视为审核后的**候选部署输入**，不能把 Artifact SUCCESS 理解为已经部署、已备案或已通过微信审核。仓库 public，Artifact 不允许含生产密钥及用户数据。

包严格白名单包含：经 `npm run build:private --prefix future/server` 编译的 CommonJS 云服务、唯一管理员服务、每小时维护服务及核心模型；`future/server/package.json`、独立 `package-lock.json`（**不附加 node_modules**）；8 份经审核的 SQL 迁移；Caddy HTTPS 代理/systemd/service timer 模板；独立管理员网页四份受限静态资源；本 README 及五道发布关口指引。`RELEASE.txt` 标记 Git commit 和 `NOT AN INSTALLED DEPLOYMENT`，`SHA256SUMS` 覆盖每个实际文件的内容。压缩包权限 0600，临时组包目录创建后即清理，不放到 Git 目录或微信小程序中。

`npm run test:future:private-release-bundle` 会对生成物执行**实际 tar 解包、超过 300 项逐文件摘要复核、危险路径与 `.env`/源码/`node_modules` 排除、真正的唯一管理员 HTML/CSS 资源装载**，并从解包后的三种独立可执行服务中抽查主服务及后台在缺密钥时明确拒绝启动。CI 和本地不会执行迁移、联网接触任何微信账号、写生产数据或激活 systemd。下载后用 `sha256sum -c cuoshi-private-deploy.tar.gz.sha256` 验证外层下载完整性，再校验 `SHA256SUMS`，才能由授权部署人员在**合法部署目标机**使用独立锁文件安装 `pg` 运行依赖、审查迁移/权限、注入正式 Secrets 并进行全套现场验收。

切勿把这份技术部署压缩包当成微信审核上传包；微信候选版来自独立的 `build:future:mp-weixin`，生产云必须独立持有用户数据与秘密。管理员只有项目所有者一人；独立的技术数据库角色不是员工账号。正式域名和服务端密钥在所有发布包中一律不存在。

## Sole-owner SSH-only Caddy ingress (2026-10-24; not deployed)

The Caddyfile now contains TWO strictly separated sites: the existing public HTTPS API hostname with exactly eight WeChat/public paths, and a LOCALHOST-ONLY owner console at `http://127.0.0.1:CUOSHI_ADMIN_GATE_PORT` using `bind 127.0.0.1`. The owner gateway only exposes `/admin/`, its three fixed static assets, `/internal/admin/login`, `/internal/admin/logout`, and `/internal/admin/overview`. All other paths return 404. Its upstream is the independent `CUOSHI_STAFF_PORT`, NOT the public `CUOSHI_PRIVATE_PORT`. Its proxy proof derives from a DIFFERENT server-only `CUOSHI_STAFF_EDGE_SHARED_SECRET_HEX`, not the public edge secret. The proxy environment generator now rejects absent admin settings, equal ports, or equal edge secrets. Do not put raw server edge secrets in Caddy's environment.

Authorized operator workflow AFTER deploying and validating the real production services: provide `CUOSHI_PUBLIC_DOMAIN`, `CUOSHI_PRIVATE_PORT`, `CUOSHI_STAFF_PORT`, `CUOSHI_ADMIN_GATE_PORT`, `CUOSHI_EDGE_SHARED_SECRET_HEX` and `CUOSHI_STAFF_EDGE_SHARED_SECRET_HEX` to `prepare-proxy-env.mjs` through an approved on-host secret-management process. That creates the separately protected `/etc/cuoshi/caddy.env`, containing ONLY derived proofs. Review that Caddy is actually listening on `127.0.0.1:CUOSHI_ADMIN_GATE_PORT`, and that firewall/container/NAT rules never expose this port externally. To reach the owner console, the authorized operator may establish an encrypted SSH tunnel from their computer: `ssh -N -L 127.0.0.1:18767:127.0.0.1:18767 <approved-SSH-host-alias>` (example ports only), then open `http://127.0.0.1:18767/admin/` locally and complete password+TOTP login. The HTTP hop is ONLY local to each host; the inter-host hop is encrypted by SSH. Never use `GatewayPorts yes`, SSH `-g`, public reverse tunnels or a public admin domain. SSH accounts and port-forward permissions need independent hardening and audit.

The offline official Caddy adaptation CI must confirm the owner listener is exactly `127.0.0.1:18767`, the seven owner routes never appear on any public HTTP/TLS listener, and both private proofs and upstream ports remain separated. Success only confirms reviewed configuration behavior; actual SSH credentials, TLS domain, database secrets, network ACLs and owner login have NOT been deployed or tested on an authorized production host. These remain release blockers.
