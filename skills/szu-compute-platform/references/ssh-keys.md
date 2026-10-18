# SSH 密钥对与公钥登记

创建任务前准备身份，连接已有任务时匹配已绑定公钥。`bita login` 不生成密钥，`bita upload` 不登记 SSH 公钥。

## 检查与选择

依次检查用户指定密钥、SSH 配置中的 `IdentityFile`、`~/.ssh/` 候选项。确认私钥可读、属于本次允许使用的身份、类型/长度满足平台导入要求；只看路径、公钥与指纹，不输出私钥。

| 情况 | 动作 |
|---|---|
| 本机私钥可用，平台已登记对应公钥 | 复用，避免重复登记 |
| 本机私钥可用，平台没有对应公钥 | 登记已有公钥 |
| 私钥可用，但 `.pub` 缺失 | 从私钥恢复公钥再查重 |
| 没有符合要求的可用本机密钥 | 本机生成新密钥对并登记公钥 |
| 已有任务绑定项与本机身份不匹配 | 找原密钥或检查能否更新绑定；新登记不会自动修复旧任务 |

比较 SHA-256 指纹或公钥的类型及 Base64 主体，不能只比较名称或注释。`SZU_SSH_KEY` 始终指向本机私钥绝对路径：

```bash
ssh-keygen -lf "$SZU_SSH_KEY.pub" -E sha256
ssh-keygen -y -f "$SZU_SSH_KEY" | ssh-keygen -lf - -E sha256
```

两条命令成功且指纹相同才确认配对。解密口令在本机终端或 SSH agent 中处理。

## 恢复或生成

仅当 `.pub` 缺失时恢复。先成功导出再创建目标文件，禁止覆盖；已有公钥不配对时先定位原因：

```bash
(
  set -e
  SZU_DERIVED_PUBLIC="$(ssh-keygen -y -f "$SZU_SSH_KEY")"
  set -o noclobber
  printf '%s\n' "$SZU_DERIVED_PUBLIC" > "$SZU_SSH_KEY.pub"
)
```

没有合适密钥时，在独立目录生成；平台支持时用 Ed25519，明确要求 RSA 时改为其允许的长度，例如 4096 位：

```bash
install -d -m 0700 "$HOME/.ssh" &&
  SZU_SSH_KEY_DIR="$(mktemp -d "$HOME/.ssh/szu-compute-XXXXXXXX")" &&
  SZU_SSH_KEY="$SZU_SSH_KEY_DIR/id_ed25519" &&
  ssh-keygen -t ed25519 -C 'szu-compute-platform' -f "$SZU_SSH_KEY"
```

成功后核对指纹、私钥 `600` 和目录 `700` 权限。用户在本机选择口令，需要自动连接时可用 agent；不自动移除已有口令，也不把空口令强设为所有任务默认值。

## 登记、绑定与交接

1. 在平台当前账号的 SSH 公钥管理入口按指纹/主体查重。缺少登记时新建名称并粘贴或上传 `$SZU_SSH_KEY.pub` 的单行 OpenSSH 公钥，只上传公钥。
2. 重新读取登记项核对内容，保留平台密钥 ID/名称用于任务配置。通过 API 时先确认当前前端的方法、路径和字段，按 [web-api.md](web-api.md) 验证响应，不编造 `bita` 公钥命令。
3. 创建/重建任务时选中登记项，审查 YAML 中实际引用或公钥内容。已有任务只在支持且本次范围允许时更新绑定，不为缺钥擅自重建付费实例。
4. 将私钥路径交给 [SSH 连接](remote-runtime.md#ssh-连接) 的 `SZU_SSH_KEY`，用实际认证验收。平台密钥 ID 不能替代私钥路径或 SSH 主机名。

已要求准备 SSH 身份时，按上述分支完成检查、必要的生成与登记，无需重复询问每一步；私钥和口令始终留在本机。
