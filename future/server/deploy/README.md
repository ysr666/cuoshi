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
