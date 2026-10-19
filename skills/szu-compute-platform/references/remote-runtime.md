# SSH、代码同步与远程运行

## SSH 连接

任务为 `Running` 且 SSH 入口就绪后，从 [连接 API](web-api.md#排队与连接状态) 的 `sshState/sshUrl`、任务及集群响应构造参数。不对返回字符串执行 `eval`。

若响应没有完整命令，按 [字段定位流程](interface-discovery.md#从当前前端确认行为) 查集群代理入口和当前前端构造逻辑；内部 IP、集群代理域名和任务 SSH 主机是不同角色。

| 变量 | 来源 |
|---|---|
| `SZU_SSH_KEY` | [密钥流程](ssh-keys.md) 选定的本机私钥绝对路径，与任务绑定公钥配对；不是 `.pub` 或平台密钥 ID |
| `SZU_SSH_USER` | 平台命令 `user@host` 中的 `user` |
| `SZU_SSH_HOST` | 同一命令的 `host`，从连接响应取值，不用 API `jobId` 代填 |
| `SZU_SSH_PORT` | 平台命令 `-p` 的端口，未指定时为 `22` |
| `SZU_PROXY_HOST` | 平台命令 `nc -x` 中的 SOCKS5 入口域名 |
| `SZU_PROXY_PORT` | 同一 SOCKS5 入口的端口，与目标 SSH 端口分开 |

平台 SOCKS5 入口转发到目标任务；校园/VPN 路由与 [Clash 绕过](proxy-bypass.md) 分别验收。私钥负责 SSH 认证，任务 ID 不替代连接主机。

在同一终端会话中按上表赋值，检查私钥可读、`nc -h` 支持 `-X 5 -x` 后连接。Linux OpenBSD netcat：

```bash
ssh -i "$SZU_SSH_KEY" -p "$SZU_SSH_PORT" -o IdentitiesOnly=yes \
  -o "ProxyCommand=nc -X 5 -x $SZU_PROXY_HOST:$SZU_PROXY_PORT %h %p" \
  "$SZU_SSH_USER@$SZU_SSH_HOST"
```

`%h/%p` 由 SSH 自动替换，变量不跨独立命令会话保存。平台未提供 SOCKS5 时不套用此 `ProxyCommand`；其他系统使用适配工具。缺少连接信息就继续查询，不复用已停止实例的地址。

Windows 可复用 Git for Windows 附带的 `connect.exe`，先检查实际路径和本机帮助是否支持 `-5 -S`。在同一 PowerShell 会话中设置上述连接变量后，例如：

```powershell
$SZU_CONNECT_EXE = 'C:\Program Files\Git\mingw64\bin\connect.exe'
if (-not (Test-Path -LiteralPath $SZU_CONNECT_EXE)) { throw 'Locate a compatible SOCKS5 helper first' }
$SZU_PROXY_COMMAND = ('"{0}" -5 -S {1}:{2} %h %p' -f $SZU_CONNECT_EXE, $SZU_PROXY_HOST, $SZU_PROXY_PORT)
ssh.exe -i $SZU_SSH_KEY -p $SZU_SSH_PORT -o IdentitiesOnly=yes `
  -o "ProxyCommand=$SZU_PROXY_COMMAND" "$SZU_SSH_USER@$SZU_SSH_HOST"
```

`scp` 复用身份和 `ProxyCommand`，端口使用 `-P`。使用项目独立的 `UserKnownHostsFile`；首次连接采用 `StrictHostKeyChecking=accept-new`，指纹变化时拒绝并核查，不关闭主机校验。

失败时先确认任务和入口就绪，再按 [代理文档](proxy-bypass.md) 查 DNS、路由和代理端口。无路由、超时、拒绝连接与认证失败分开诊断；进入认证阶段后再查用户名、公钥绑定和私钥，不轮流尝试全部密钥。

## 挂载与代码同步

按 [storage-datasets.md](storage-datasets.md) 验收挂载后，同步当前工作区需要的源码、资源及依赖清单，包含本次所需未提交修改，不仅复制 Git HEAD。排除密钥、本机环境、无关数据与旧结果；更新远程代码前检查活跃工作，使用快照或独立目录避免覆盖运行版本。

确认上传正常结束并核对文件后再执行，避免读到仍在写入的脚本。Windows 生成并传给 Linux `bash` 的脚本使用 UTF-8 无 BOM、LF 换行；`pipefail\r` 等错误先查换行，不重建实例。

## 环境复用与修复

首次初始化和环境变更走 [environment-image.md](environment-image.md)，已有环境检查：

1. `nvidia-smi` 与任务规格一致，保留调度器的 CUDA 设备可见性，不套用宿主 GPU 编号。
2. 实际执行解释器、关键导入和所需 GPU 运算，不能仅验 CPU 导入。
3. 检查基础解释器、符号链接和动态库；持久化环境目录不保证镜像中的基础解释器存在。
4. 验收通过即复用；失败按锁文件、Python ABI、CUDA 兼容性通过包管理器修复，不混合不同版本的包目录。

裸命令 `python` 不存在不等于镜像没有 Python。先查 `python3`、镜像已有 Conda/venv 的实际解释器及版本，再显式选择创建环境的解释器；不要无意中用系统 Python 替代项目要求的版本。记录实际 GPU 环境的依赖快照，不能拿本机 CPU/其他操作系统的快照代替。

## 运行与验收

按 [主流程的运行模式](../SKILL.md#先确定运行模式) 选择初始化 dry-run、正式运行或仅开机。使用当前项目入口和本次参数，记录真实退出码，后台运行还需保存 PID 和启动命令。

每次运行独立保存配置、日志、指标、检查点及所需离线跟踪数据，路径必须位于已验证挂载。验收目标进度、有限数值、预期评估和可读产物；启动成功不代表完成，短测试不代表性能结论。

分别记录“已启动、主程序退出、产物验收通过、收集完成”。目标步数完成后仍须等待末次评估、检查点保存/恢复和哈希验收；GPU 利用率不作为停机或重启依据，用进程、日志和指标确认 JIT、训练、评估的实际阶段。

## 持久化与重建

保存代码版本、环境镜像、未完成任务及 [挂载与数据版本](storage-datasets.md#持久化与重建)。新实例不复制整个临时容器文件系统，重新验证环境、GPU、数据和产物。停止/删除按 [生命周期流程](web-api.md#生命周期管理) 执行。

## 传输测速

仅需定位传输问题时，用唯一命名、大小明确的随机临时文件完成上传和下载，不启用压缩；以单调时钟计时，核对 SHA-256 后只清理本次文件。报告 `MiB/s = bytes / 1024**2 / seconds` 或 `Mbps = bytes * 8 / 1e6 / seconds`，说明是否含建连开销；整链路吞吐不能单独定位某段瓶颈。
