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


## 数据库的七步迁移交付（离线生成，不直接写数据库）

`render-migrations.mjs` 是独立的安全迁移渲染器。首次生产部署前，必须由**有权限的独立数据库管理员**创建受控 schema 和 6 个不同 LOGIN 角色：备份、管理员、微信身份、注销、维护、汇总统计。运行时的 4 个服务角色不能拥有 schema、执行 DDL 或成为超级用户；维护/只读统计角色只用于独立管理服务，**不复用小程序的数据库账号**。

1. 由云服务管理员先核准本项目部署方案、schema 名称及各角色名；**不要把密码填进下列变量或提交给 GitHub**。准备 `CUOSHI_PG_SCHEMA`、`CUOSHI_PG_BACKUP_ROLE`、`CUOSHI_PG_ADMIN_ROLE`、`CUOSHI_PG_AUTH_ROLE`、`CUOSHI_PG_DELETION_ROLE`、`CUOSHI_PG_MAINTENANCE_ROLE`、`CUOSHI_PG_REPORTING_ROLE`，均应是符合 SQL 标识符规则的不同小写英文下划线名称。
2. 将以上仅含**非秘密角色名字**的环境变量交给离线 CLI：`npm run prepare:future:migrations -- /absolute/private/out/new-migrations`。输出必须是此前不存在的目录、在仓库之外；不会发送数据库请求、不会创建账号、不会执行 SQL。失败也不会留下部分迁移。
3. 工具按固定顺序生成 `001_initial.sql` 至 `007_login_rate_limits.sql` 和 `SHA256-MANIFEST.json`；目录权限 0700、文件 0600，带完整 SHA-256 校验和。每个 SQL 在 `BEGIN` 后显式 `SET LOCAL search_path` 指向经过严格校验的 schema，以免依赖数据库客户端默认 search_path 而错建表。
4. **人工逐项复核生成 SQL**，确认实例及 schema 与账号归属，检查是否已存在对象、角色权限、需要的维护窗口、可回滚快照以及数据库实际备份。此脚本目前面向新部署的**一次性、从空 schema 开始**的迁移，不提供在线重放/升级或自动 rollback；数据库已有数据绝不能再次跑首建 SQL。
5. 由经过授权的**独立迁移账号**按文件名顺序执行，严格核对每步的 DB 返回、对象/权限和失败日志；严禁使用运行时备份、微信身份、注销或管理员账户执行 DDL。迁移成功后才能启动私有 Node 服务，验证 4 个最小权限登录，随后再通过可信代理连接真实微信服务。

`npm run test:future:migration-render` 用 **62 项**静态与临时文件合同验证固定顺序、SQL 角色名、注入防护、只写仓库外权限隔离目录及 checksum；独立的真实 PostgreSQL CI 则直接调用相同渲染器执行 7 份迁移并验证角色权限与注销业务。这两类测试均不能代替生产实例上的审查和演练。


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
