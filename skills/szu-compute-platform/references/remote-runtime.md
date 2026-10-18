# SSH、代码同步与远程运行

## SSH 连接

目标任务需为 `Running` 且 SSH 入口就绪。从该任务的连接说明取得命令，或查 [连接状态接口](web-api.md#排队与连接状态) 的 `sshState/sshUrl`。先理解响应格式，不猜字段，不对返回字符串使用 `eval`。

| 变量 | 来源 |
|---|---|
| `SZU_SSH_KEY` | [密钥流程](ssh-keys.md) 选定的本机私钥绝对路径，与任务绑定公钥配对；不是 `.pub` 或平台密钥 ID |
| `SZU_SSH_USER` | 平台命令 `user@host` 中的 `user` |
| `SZU_SSH_HOST` | 同一命令的 `host`；可能是任务标识，不默认等同 API 的 `jobId` |
| `SZU_SSH_PORT` | 平台命令 `-p` 的端口，未指定时为 `22` |
| `SZU_PROXY_HOST` | 平台命令 `nc -x` 中的 SOCKS5 入口域名 |
| `SZU_PROXY_PORT` | 同一 SOCKS5 入口的端口，与目标 SSH 端口分开 |

平台 SOCKS5 入口把连接转发到目标任务；到该入口的校园/VPN 路由与 Clash 绕过规则另行配置。私钥负责容器 SSH 认证。`bita login` 不生成这些变量，API 查询任务 ID 也不替代实际连接主机。

可从当前响应提取明确字段直接赋值；需手动填写时，在同一终端执行：

```bash
read -rp 'Local private key (absolute path): ' SZU_SSH_KEY
read -rp 'SSH user: ' SZU_SSH_USER
read -rp 'SSH target host: ' SZU_SSH_HOST
read -rp 'SSH target port [22]: ' SZU_SSH_PORT
SZU_SSH_PORT="${SZU_SSH_PORT:-22}"
read -rp 'Platform SOCKS5 host: ' SZU_PROXY_HOST
read -rp 'Platform SOCKS5 port: ' SZU_PROXY_PORT
```

检查输入、私钥可读性与本机 `nc -h` 是否支持 `-X 5 -x`。Linux OpenBSD netcat 的连接形式为：

```bash
ssh -i "$SZU_SSH_KEY" -p "$SZU_SSH_PORT" -o IdentitiesOnly=yes \
  -o "ProxyCommand=nc -X 5 -x $SZU_PROXY_HOST:$SZU_PROXY_PORT %h %p" \
  "$SZU_SSH_USER@$SZU_SSH_HOST"
```

`%h/%p` 由 SSH 自动替换，变量不跨独立命令会话保存。平台未提供 SOCKS5 时不套用此 `ProxyCommand`；其他系统使用适配工具。缺少连接信息就继续查询，不复用已停止实例的地址。

失败时先确认任务和入口就绪，再按 [代理文档](proxy-bypass.md) 查 DNS、路由和代理端口。无路由、超时、拒绝连接与认证失败分开诊断；进入认证阶段后再查用户名、公钥绑定和私钥，不轮流尝试全部密钥。

## 挂载与代码同步

按 [storage-datasets.md](storage-datasets.md) 验收挂载后，同步当前工作区需要的源码、资源及依赖清单，包含本次所需未提交修改，不仅复制 Git HEAD。排除密钥、本机环境、无关数据与旧结果；更新远程代码前检查活跃工作，使用快照或独立目录避免覆盖运行版本。

## 环境复用与修复

首次初始化和环境变更走 [environment-image.md](environment-image.md)，已有环境检查：

1. `nvidia-smi` 与任务规格一致，保留调度器的 CUDA 设备可见性，不套用宿主 GPU 编号。
2. 实际执行解释器、关键导入和所需 GPU 运算，不能仅验 CPU 导入。
3. 检查基础解释器、符号链接和动态库；持久化环境目录不保证镜像中的基础解释器存在。
4. 可用时复用；修复依据项目锁文件、Python ABI 和 CUDA 兼容性，用包管理器及兼容缓存，不直接混合不同版本的包目录。

## 运行与验收

按 [主流程的运行模式](../SKILL.md#先确定运行模式) 选择初始化 dry-run、正式运行或仅开机。使用当前项目入口和本次参数，记录真实退出码，后台运行还需保存 PID 和启动命令。

每次运行独立保存配置、日志、指标、检查点及所需离线跟踪数据，路径必须位于已验证挂载。验收目标进度、有限数值、预期评估和可读产物；启动成功不代表完成，短测试不代表性能结论。

## 持久化与重建

保存代码版本、环境镜像、未完成任务及 [挂载与数据版本](storage-datasets.md#持久化与重建)。新实例不复制整个临时容器文件系统，重新验证环境、GPU、数据和产物。停止/删除按 [生命周期流程](web-api.md#生命周期管理) 执行。

## 按需测速

仅需定位传输问题时，用唯一命名、大小明确的随机临时文件完成上传和下载，不启用压缩；以单调时钟计时，核对 SHA-256 后只清理本次文件。报告 `MiB/s = bytes / 1024**2 / seconds` 或 `Mbps = bytes * 8 / 1e6 / seconds`，说明是否含建连开销；整链路吞吐不能单独定位某段瓶颈。
