# 本机登录与 CAS 二次认证

无有效平台会话时使用。已有会话先按 [Web API](web-api.md#使用边界与认证) 只读验收，不为技能更新或脚本测试重新登录。

## 附带脚本

- [login_local.cjs](../scripts/login_local.cjs)：Node.js 18+，仅依赖内置模块。提供回环输入页，执行 CAS 密码加密、回调、CLI 凭据交换和账号复核。
- [login_mfa.cjs](../scripts/login_mfa.cjs)：在同一进程中接续当前 CAS 挑战，提供发送和提交动态码界面。仅支持企业微信 `reAuthType=4`，此类型已真实验证；其他挑战停止并报告。
- [login_storage.cjs](../scripts/login_storage.cjs)：先限制空临时文件权限，再写入并原子合并 bita 配置；保留其他 endpoint，解析或结构异常时不覆盖。
- [start-login.ps1](../scripts/start-login.ps1)：Windows 后台启动、健康验收及输出到项目目录，不自动打开浏览器。

源码、脚本和引用可放技能中；账号、Cookie、token、运行日志、资源 ID、预算和实验配置放执行机器的受限配置或项目记录中。

## 启动与验收

Windows，在当前项目目录执行；`$skillDir` 取本技能实际安装位置：

```powershell
& "$skillDir/scripts/start-login.ps1" -StatusDirectory (Join-Path (Get-Location) '.szu-platform')
```

默认仅监听 `127.0.0.1:18763`，20 分钟到期。`-Port`、`-TtlMinutes`、`-ConfigPath`、`-Tenant`、`-Product` 可配置；参数不是凭据，密码和验证码只能在输入页填写。未改配置时租户/产品使用已验证部署的 `szdx/heros`。

其他系统或无头主机，保持进程存活运行：

```bash
SZU_LOGIN_STATUS_DIR="$PWD/.szu-platform" node "$SZU_SKILL_DIR/scripts/login_local.cjs"
```

其他可选环境变量：`SZU_LOGIN_PORT`、`SZU_LOGIN_TTL_MINUTES`、`SZU_LOGIN_CONFIG`、`SZU_LOGIN_TENANT`、`SZU_LOGIN_PRODUCT`。默认配置文件为执行机器的 `~/.bita/config.json`；不设置状态目录时不写项目状态文件，绝不向技能目录写运行记录。

1. 确认 `LOCAL_INPUT_READY`、`GET /health` 的 `ready=true`，记录本次 `session_id` 和到期时间，再把本机地址交给用户。启动会将项目认证状态设为本次 `verified=false`；健康接口就绪不代表认证完成。
2. 用户在同一台电脑手动打开输入页。无头主机需先建立 SSH 本地转发，两端端口相同，例如 `ssh -N -L 127.0.0.1:18763:127.0.0.1:18763 user@host`；端口和目标取当前服务及已验证 SSH 配置。不扩大监听地址，不自动操作输入页。浏览器点击受限时让用户复制地址到本机浏览器地址栏。
3. 用户提交密码后，如遇企业微信二次认证，页面自动切换到动态码界面。点击发送，在同一页面填写企业微信收到的验证码，再点击校验。原 Cookie、挑战参数和回调状态留在同一进程，不重新提交账号密码；错码后继续使用本次会话。单会话最多提交 5 次验证码，不自动猜码或重放。
4. 仅看到含本次 `session_id` 的 `AUTH_VERIFIED_AND_SAVED`，或项目 `auth-status.json` 同时满足 `verified=true` 且 `session_id` 匹配本次启动记录后，才报告本次认证成功；随后用只读助手复核账号。不使用旧状态文件或旧日志判断本次结果。输入服务在完成、取消、到期后清理会话并退出。

已有健康服务优先复用。启动参数改变时不要把旧服务当作新配置生效；先检查当前服务的状态，再决定是否需要重启。会话只在进程内存中，二次认证期间重启会丢失会话；需要改代码时先说明用户须重新登录，不使用调试器热注入。

## 已确认的二次认证协议

通过 HTTP 下载当前 `reAuth.js` 确认协议；不渲染平台页面、不执行下载的 JavaScript：

| 操作 | 官方 API 与字段 |
|---|---|
| 企业微信发送动态码 | `POST /authserver/dynamicCode/getDynamicCodeByReauth.do`，表单 `userName=reAuthUserId`、`authCodeTypeName=reAuthWChatDynamicCodeType` |
| 提交动态码 | `POST /authserver/reAuthCheck/reAuthSubmit.do`，表单 `service/reAuthType/isMultifactor/dynamicCode`、空 `password/uuid/answer1/answer2/otpCode` 和 `skipTmpReAuth=false` |
| 成功继续 CAS | 携带同一 Cookie 会话请求 `/authserver/login?service=...`，逐跳校验 HTTPS 域名后取平台 token A，再执行登录交换与复核 |

发送返回 `success/wechat_success/other_success` 时提示已发送；`code_time_fail` 提示使用最近已发送的验证码。默认冷却 120 秒，响应 `codeTime` 可调整，最多 300 秒；发送超时也保留冷却，刷新页面从服务端恢复剩余时间。

校验返回 `reAuth_failed` 时保留原会话，允许用户核对后重试；`reAuth_unauthorized` 时清除失效挑战及 Cookie，要求取消并重新启动登录。其他带字符串 `code` 的响应仅触发继续 CAS，不直接视为成功；缺少状态码时停止。最终仍须通过 token 交换及账号、租户复核。

取消或到期会使在途 HTTPS 响应失效，阻止后续交换和写入凭据。输入框提交后清空，处理结束释放密码、验证码引用；不承诺运行时内存物理擦除。进程退出即丢失未完成 CAS 会话，不能通过重新启动恢复。

`reAuthParams` 从本次挑战 HTML 中只解析所需数据字面量；不把整页、字段值、Cookie 或带 token 的跳转 URL 打印或落盘。未知参数结构、图形验证码、扫码或人脸挑战停止该分支并按 [接口定位](interface-discovery.md) 继续适配，不绕过挑战。修改接口前检查当前静态协议，不循环提交登录。

## 回归验证

```bash
node "$SZU_SKILL_DIR/scripts/test_login_mfa.cjs"
node "$SZU_SKILL_DIR/scripts/test_login_storage.cjs"
node "$SZU_SKILL_DIR/scripts/test_login_service.cjs"
```

测试只使用合成会话、随机回环端口和独立临时文件，不发送真实验证码，不触碰默认 bita 配置，也不创建算力资源。MFA 测试覆盖来源校验、重复发送、错误动态码与回调交换；存储测试覆盖权限、合并及失败保留；服务测试覆盖启动、旧状态失效及会话绑定、健康、取消和参数校验。
