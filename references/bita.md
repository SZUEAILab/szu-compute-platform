# bita 客户端操作

## 能力与安装

检查 `command -v bita`、`bita version` 和 `bita --help`，复用来源明确且可运行的版本。常用命令为 `login`、`apply`、`upload`、`download`，参数以本机帮助为准；缺失能力转到 [web-api.md](web-api.md)。

| 系统 | 客户端下载入口 |
|---|---|
| Linux x86-64 | `https://miniogw.aicloud.szu.edu.cn/file-open/bita` |
| Windows | `https://miniogw.aicloud.szu.edu.cn/file-open/bita.msi` |
| macOS Intel | `https://miniogw.aicloud.szu.edu.cn/file-open/bita_x86-64.pkg` |
| macOS Apple Silicon | `https://miniogw.aicloud.szu.edu.cn/file-open/bita_arm64.pkg` |

下载前确认入口和架构，检查文件类型、大小、SHA-256 与版本。自算哈希是文件标识，不等同于官方校验。Linux 默认安装至 `~/.local/bin/bita` 并检查 `PATH`；系统级安装使用相应权限，不修改目录为全员可写或擅自改 shell 启动文件。

## 认证

先复用有效 CLI 认证。SecureLink/CAS 用于校园接入，浏览器会话也不会自动变成 CLI 认证。

| 参数或变量 | 来源 |
|---|---|
| `-u` / `SZU_BITA_ACCOUNT` | 本次指定的算力平台账号 |
| `-p` / `SZU_BITA_CREDENTIAL` | 该账号的 CLI 登录凭据，在本机静默输入 |
| `-t` | 深大租户 `szdx`，不是团队名称或 ID |
| `-e` | `https://console.aicloud.szu.edu.cn`，必须覆盖客户端默认端点 |

本机版本通过 `-p` 接收密码时，在交互终端运行：

```bash
(
  set -e
  umask 077
  trap 'unset SZU_BITA_CREDENTIAL' EXIT
  read -rp 'Bita account: ' SZU_BITA_ACCOUNT
  read -rsp 'Bita credential: ' SZU_BITA_CREDENTIAL
  printf '\n'
  bita login -u "$SZU_BITA_ACCOUNT" -p "$SZU_BITA_CREDENTIAL" \
    -t szdx -e https://console.aicloud.szu.edu.cn
  test -s "$HOME/.bita/config.json"
  chmod 0600 "$HOME/.bita/config.json"
  jq -e '.auths["https://console.aicloud.szu.edu.cn"].auth |
    type == "string" and length > 0' "$HOME/.bita/config.json" >/dev/null
)
```

检查整个命令的退出码；失败不继续提交。配置存在仅说明保存过凭据，还需按 [API 认证检查](web-api.md#使用边界与认证) 的只读请求确认有效。账号未知时询问账号，密码在本机输入；`-p` 会短暂出现在进程参数中，不开启 `set -x`，客户端支持更安全输入时优先使用。

## 提交任务

按 [主流程](../SKILL.md) 查重核价，并完成 [密钥绑定](ssh-keys.md) 与 [存储挂载](storage-datasets.md)。首次初始化和后续实验的套餐、镜像选择见 [environment-image.md](environment-image.md)。

从平台创建流程或任务导出取得 YAML，核对任务类型、集群、团队、套餐、镜像、GPU、时长及单位、公钥和挂载。保留必要配置，排除登录密码、私钥和不必要的仓库凭据。

```bash
bita apply -f /absolute/path/task.yaml
SZU_APPLY_STATUS=$?
```

保存退出码与返回任务 ID。拒绝、超时或“参数无效”均不能作为成功证据；接受后仍需查询调度状态，不因响应不明重复提交。

## 文件传输

从当前文件存储页面取得 `SZU_CLUSTER_ID`、`SZU_BUCKET`、`SZU_OBJECT_PATH`，本地路径填 `SZU_LOCAL_PATH`；不把团队 ID、数据集 ID 或挂载路径猜作存储桶 ID。先读本机 `upload/download --help`，在同一命令会话赋值后执行：

```bash
bita upload -c "$SZU_CLUSTER_ID" -b "$SZU_BUCKET" \
  -l "$SZU_LOCAL_PATH" -o "$SZU_OBJECT_PATH" \
  -e https://console.aicloud.szu.edu.cn

bita download -c "$SZU_CLUSTER_ID" -b "$SZU_BUCKET" \
  -o "$SZU_OBJECT_PATH" -l "$SZU_LOCAL_PATH" \
  -e https://console.aicloud.szu.edu.cn
```

按本次方向选择命令，不默认两条都运行。上传前核对覆盖范围，之后验证大小及必要校验值。存储已挂到容器时可直接写入持久化路径；文件传输不等于公钥或数据集登记。

## 故障定位

找不到命令时查 `PATH` 和版本遮蔽；本地权限错误区分执行位与目录写权限。HTTP 400 查字段、资源 ID 和时长单位；401/403 结合业务码区分认证与权限。网络问题按 [校园接入](campus-network.md) 和 [代理绕过](proxy-bypass.md) 排查，不反复提交任务测试连接。
