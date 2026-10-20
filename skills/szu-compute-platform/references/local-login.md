# 登录输入页与企业微信二次认证

## 何时使用

先按 [API 认证](web-api.md#使用边界与认证) 只读验收已有会话。会话失效或用户明确要求验证登录链路时启动输入服务；常规任务直接复用有效会话。完整凭据交换见 [认证流程](bita.md#web-api-认证流程)。

附带脚本仅用 Node.js 内置模块，已在 24.21.0 测试：

| 脚本 | 用途 |
|---|---|
| [login_local.cjs](../scripts/login_local.cjs) | 回环输入页、CAS 密码加密、回调、登录交换及账号复核 |
| [login_mfa.cjs](../scripts/login_mfa.cjs) | 在原 CAS 会话中发送和校验企业微信验证码，仅支持 `reAuthType=4` |
| [login_storage.cjs](../scripts/login_storage.cjs) | 先限制空临时文件权限，再原子合并会话配置；异常不覆盖 |
| [start-login.ps1](../scripts/start-login.ps1) | Windows 后台启动、健康验收，不自动打开浏览器 |

## 启动与地址交付

以下示例先将 `$skillDir`（PowerShell）或 `SZU_SKILL_DIR`（Shell）设为技能安装目录，再在项目目录执行。Windows：

```powershell
& "$skillDir/scripts/start-login.ps1" -StatusDirectory (Join-Path (Get-Location) '.szu-platform')
```

其他系统或无头主机保持进程运行：

```bash
SZU_LOGIN_STATUS_DIR="$PWD/.szu-platform" node "$SZU_SKILL_DIR/scripts/login_local.cjs"
```

默认监听 `127.0.0.1:18763`，20 分钟到期，配置保存到执行机器的 `~/.bita/config.json`。Windows 参数为 `-Port/-TtlMinutes/-ConfigPath/-StatusDirectory/-Tenant/-Product`；对应环境变量由 `SZU_LOGIN_` 前缀加 `PORT/TTL_MINUTES/CONFIG/STATUS_DIR/TENANT/PRODUCT` 构成，例如 `SZU_LOGIN_TTL_MINUTES`。租户/产品默认 `szdx/heros`。运行记录和认证配置均放在技能目录外，且使用不同文件；不设置状态目录时不写项目状态文件。

向用户给出地址前，检查 `LOCAL_INPUT_READY` 与 `GET /health` 的 `ready=true`、`configuration_id`、`session_id` 和 `expires_at`。只交付当前服务的实际地址，并附有效期。已有健康服务且配置一致时复用；配置不同则先完成或取消原会话，不能把旧服务当作新参数已生效。

用户在页面填写账号、密码；出现企业微信挑战后点击发送、填写验证码、校验。代理只读取状态，不操作页面。无头主机先在用户机器建立两端端口相同的 SSH 转发，例如 `ssh -N -L 127.0.0.1:18763:127.0.0.1:18763 user@host`；目标与端口取当前配置。服务不监听公网。

## 会话与完成判断

- **等待输入。** 交付地址后保持服务和 CAS 会话存活，直至完成、取消或到期。代码更新延后至本次会话结束；重启会丢失待完成挑战，不能恢复原内存会话，不使用调试器热注入。
- **成功。** 只有含本次 `session_id` 的 `AUTH_VERIFIED_AND_SAVED`，或同一会话的 `auth-status.json` 满足 `verified=true`，才报告本次登录成功。启动会把状态重置为未认证，旧日志、旧成功记录及健康检查均不能代替本次结果；之后用只读 API 复核账号。
- **关闭。** 完成、取消或到期后清理会话并关闭服务。主动替换或撤下已交付的入口时，明确告知旧地址及待填提示失效，并说明是否仍需输入。
- **无法访问或延迟回复。** 先核对对应地址的监听、健康信息、有效期与会话标识；已关闭就说明原因。仅在仍需登录时重新启动、验收并交付新地址；已有有效会话则直接继续任务。

输入页校验 Host、Origin、随机 nonce 和有效期，禁用缓存与第三方资源。密码、验证码只通过同源 POST 进入该进程，再由后端请求学校/平台 HTTPS API，不进入 URL、浏览器存储、聊天或日志。输入框提交后清空，处理结束释放引用；不承诺运行时内存物理擦除。Cookie 按学校和平台域名分开，取消或到期使在途响应失效，阻止后续交换和凭据写入。

## 二次认证协议

通过 HTTP 下载当前 `reAuth.js` 核对协议；不渲染页面、不执行下载的 JavaScript。只从本次挑战解析 `reAuthParams` 所需数据字面量，不输出原始页面、Cookie、参数值或含 token 的跳转 URL。

| 操作 | 官方 API 与字段 |
|---|---|
| 发送 | `POST /authserver/dynamicCode/getDynamicCodeByReauth.do`；`userName=reAuthUserId`、`authCodeTypeName=reAuthWChatDynamicCodeType` |
| 校验 | `POST /authserver/reAuthCheck/reAuthSubmit.do`；原 `service/reAuthType/isMultifactor`、用户的 `dynamicCode`、空 `password/uuid/answer1/answer2/otpCode`、`skipTmpReAuth=false` |
| 继续 | 携原 Cookie 请求 `/authserver/login?service=...`，逐跳校验 HTTPS 域名，取得 A 后执行登录交换与账号复核 |

发送返回 `success/wechat_success/other_success` 时提示已发送；`code_time_fail` 使用最近已发送的验证码。默认冷却 120 秒，按响应 `codeTime` 调整且最多 300 秒；超时也保留冷却，刷新页面从服务端恢复剩余时间。

校验最多提交 5 次：`reAuth_failed` 保留会话供核对重试；`reAuth_unauthorized` 清除失效挑战和 Cookie，要求取消后重新启动。其他带字符串 `code` 的响应仅触发继续 CAS，不直接判成功；缺少状态码则停止。图形验证码、其他认证类型或未知结构按 [接口定位](interface-discovery.md) 处理，不绕过挑战或循环提交密码。

## 回归验证

在当前项目目录运行附带隔离测试：

```bash
node "$SZU_SKILL_DIR/scripts/test_login_mfa.cjs"
node "$SZU_SKILL_DIR/scripts/test_login_storage.cjs"
node "$SZU_SKILL_DIR/scripts/test_login_service.cjs"
```

分别覆盖验证码流程、配置权限与合并、服务健康及会话绑定。测试只用合成会话、回环端口和临时文件；不发送真实验证码，不触碰默认认证配置或创建算力资源。真实登录只在需要该项验收时由用户填写输入页，并单独报告结果。
