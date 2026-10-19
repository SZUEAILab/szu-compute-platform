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

Windows 可将官方 MSI 解包到任务目录，定位 `bita.exe` 并核对版本后直接运行，不必默认做全局安装；所用解包工具是否需要提权以实际结果为准。保留来源、文件哈希与客户端版本，避免把旧目录中的同名程序当作本次下载版本。

## 认证

先用只读请求验证并复用已有认证。校园 VPN、平台登录和 SSH 是不同的认证层；SecureLink 已在线或浏览器已登录，都不等于 bita 配置已可用。

### 先分清三种凭据

| 凭据 | 用途 |
|---|---|
| 学校 CAS 密码及二次认证 | 学校统一认证，包括相应的 VPN 或平台登录流程 |
| 平台生成的 CLI 凭据 | `bita login -p`；已核实的前端使用 `pubPassword` 字段，界面可能称认证 token |
| 平台会话 token | 登录后的 API 请求头 `token`；本机 bita 配置的 `auth` 保存其 Base64 编码 |

**优先使用当前平台页面生成的完整 bita 登录命令。** 已核实的前端从 `name`、`pubPassword`、`tenantInfo.name` 生成 `-u`、`-p`、`-t`。不要默认用 CAS 账号、学号或 CAS 密码代填，也不要将 API 会话 token 直接当作 `-p`。CLI 帮助或请求体里的字段名 `password` 不能单独证明它要求学校密码。字段在新版本变化时重新核对当前前端。

| 参数或变量 | 来源 |
|---|---|
| `-u` / `SZU_BITA_ACCOUNT` | 平台生成命令中的账号，已核实前端字段为 `name` |
| `-p` / `SZU_BITA_CREDENTIAL` | 平台生成的 CLI 凭据，已核实前端字段为 `pubPassword`；在本机静默输入 |
| `-t` | 深大租户 `szdx`，不是团队名称或 ID |
| `-e` | `https://console.aicloud.szu.edu.cn`，必须覆盖客户端默认端点 |

命令参数与本机帮助一致时，可在用户可交互的本机终端执行；不要将含真实凭据的生成命令回显到聊天或日志：

```bash
(
  set -e
  umask 077
  trap 'unset SZU_BITA_CREDENTIAL' EXIT
  read -rp 'Platform CLI account: ' SZU_BITA_ACCOUNT
  read -rsp 'Platform CLI credential (not CAS password): ' SZU_BITA_CREDENTIAL
  printf '\n'
  bita login -u "$SZU_BITA_ACCOUNT" -p "$SZU_BITA_CREDENTIAL" \
    -t szdx -e https://console.aicloud.szu.edu.cn
  test -s "$HOME/.bita/config.json"
  chmod 0600 "$HOME/.bita/config.json"
  jq -e '.auths["https://console.aicloud.szu.edu.cn"].auth |
    type == "string" and length > 0' "$HOME/.bita/config.json" >/dev/null
)
```

检查整个命令的退出码；失败不继续提交。配置存在仅说明保存过凭据，还需按 [API 认证检查](web-api.md#使用边界与认证) 验证。Windows 使用等效的用户专属 ACL，不照搬 `chmod`。`-p` 会短暂出现在进程参数中，不开启 `set -x`；客户端支持更安全输入时优先使用。不要反复启动用户无法交互的工具终端来索取凭据。

### CLI 登录失败时的回退

1. 先核对凭据类型、平台账号、租户和 endpoint。HTTP 500 不能单独证明密码错误、CLI 接口永久损坏或浏览器会话失效；不重复尝试 CAS 密码。
2. 正确 CLI 凭据仍不可用时，可在已授权的平台登录范围内走官方 CAS/二次认证，取得平台会话 token。优先使用当前页面支持的流程；浏览器不可用或用户禁止 GUI 时，可按当前官方表单与脚本适配 HTTPS 会话，保留 cookie、隐藏字段和回调状态，不硬编码加密盐、票据或过期表单。
3. 二次认证由用户完成。需要本机输入页时只监听回环地址，不记录凭据/验证码，请求仅转发到已确认的学校认证端点，用完关闭。CAS 到平台的重定向仅跟随已确认的 HTTPS 域名；不要输出可能含 token 的跳转 URL。
4. 从本次正常登录回调取得 token，先以平台只读接口验证 HTTP、业务码和响应结构。确认当前客户端配置格式后，合并写入 `.auths[endpoint].auth = Base64(token)`，保留其他 endpoint 配置并限制文件权限；这一步不代表已经验证 token 可用作 `login -p`。

Base64 只是编码，CLI 凭据、会话 token、cookie 和二次认证状态均留在本机受限位置，不进入镜像或实验包。会话过期时回到相应认证流程，不绕过二次认证。

## 提交任务

按 [主流程](../SKILL.md) 查重核价，并完成 [密钥绑定](ssh-keys.md) 与 [存储挂载](storage-datasets.md)。首次初始化和后续实验的套餐、镜像选择见 [environment-image.md](environment-image.md)。

从平台创建流程或任务导出取得 YAML，核对任务类型、集群、团队、套餐、镜像、GPU、时长及单位、公钥和挂载。保留必要配置，排除登录密码、私钥和不必要的仓库凭据。

```bash
bita apply -f /absolute/path/task.yaml
SZU_APPLY_STATUS=$?
```

保存退出码与返回任务 ID。拒绝、超时或“参数无效”均不能作为成功证据；接受后仍需查询调度状态，不因响应不明重复提交。

已遇到 `apply` 退出码为 0、标准输出却没有 ID 的情况。此时查询当前集群全部相关任务，按本次唯一名称、团队、创建时间及规格核对，记录准确 ID；不要把空输出当作未提交。若出现多个匹配项或配置不符，先调查，不再盲目创建。

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
