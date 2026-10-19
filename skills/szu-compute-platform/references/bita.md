# Web API 认证与 bita 配置

## 认证

校园 VPN、平台会话、SSH 公钥分别负责网络接入、API 认证、实例连接，三者独立。

### 先分清三种凭据

| 凭据 | 用途 |
|---|---|
| CAS 密码及二次认证 | 学校统一认证，取得平台 token A |
| `pubPassword` | 平台 CLI 登录凭据，对应 bita 的 `login -p` |
| 平台会话 token | API 请求头 `token`；bita 配置 `auth` 保存其 Base64 编码 |

Base64 是编码，不是加密。`pubPassword` 与会话 token 是不同凭据，不能通过 Base64 相互转换；本技能不赋予它 OAuth refresh token 语义。

## Web API 认证流程

完整初始化：`CAS → token A → 读取 pubPassword → 登录交换 → token B → 验证保存`。A/B 表示来源，成功与否通过账号、租户和业务响应验收，不以字符串相等或不同判断。

1. **CAS。** 请求 `https://authserver.szu.edu.cn/authserver/login`，`service` 填 `https://console.aicloud.szu.edu.cn/gateway/ram/api/v1/cas/action/login`。保留 Cookie、隐藏字段和回调状态，按本次表单及静态脚本加密密码；逐跳检查 HTTPS 目标域名，不跨域转发凭据。
2. **二次认证。** 按用户提供的部署规则，校内账号密码，校外增加企业微信 2FA；实际挑战以 CAS 响应为准。通过官方接口发送、校验验证码，用户在本机终端受限输入，不使用聊天或本地网页收码。缺少无浏览器认证通道时报告阻塞。正常回调取得 A 后验证平台账号。
3. **读取凭据。** 用请求头 `token: A` 调用 [账号资料 API](#通过-api-获取-pubpassword)，取得同一账号的 `name/pubPassword/tenantInfo.name/productId`。这是读取现有凭据，不是申请或重置。
4. **登录交换。** `POST /gateway/ram/api/v1/tenant/user/login`；请求体 `name/password/tenantName/productId` 分别取资料中的 `name/pubPassword/tenantInfo.name/productId`。已检查的部署使用租户 `szdx`、产品 `heros`。从响应取得 B，再执行下一步；不执行 bita 命令。
5. **验收保存。** 用 B 查询账号资料，检查 HTTP 2xx、`message.code == 0`，并确认账号 ID、租户与步骤 3 一致。通过后合并写入 `.auths[endpoint].auth = Base64(B)`，保留其他 endpoint；POSIX 权限 `600`，Windows 使用用户专属 ACL。失败不覆盖有效配置，报告失败阶段。

验证记录：账号资料读取已通过真实 API 测试；登录交换已确认客户端请求协议，完整交换未实测。保存 A 不能报告为完成步骤 4–5。

常规 API 任务验证有效会话后直接复用；已有有效 `pubPassword` 时从步骤 4 开始。会话检查见 [API 认证](web-api.md#使用边界与认证)。不读取浏览器存储或 Cookie 数据库。

## 通过 API 获取 pubPassword

`GET /gateway/ram/api/v1/tenant` 的已验证响应包含 `data.name/pubPassword/productId/tenantInfo`，`tenantInfo.name` 是租户名；同一响应的 `token/cmdPassword` 也属于凭据。

认证流程在内存中使用这些字段，不输出原始响应或含凭据的命令。[只读查询助手](web-api.md#只读查询助手) 保存的值已脱敏，不能用于凭据导出。字段缺失或权限不足时停止该分支并报告；字段变化按 [接口定位](interface-discovery.md#从当前前端确认行为) 核对。
