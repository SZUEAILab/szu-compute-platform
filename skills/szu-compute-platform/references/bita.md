# Web API 认证与 bita 配置兼容

本技能只通过 Web API 操作平台；不执行 `bita login/apply/upload/download`，不通过浏览器取得凭据。完整 CLI 认证初始化用 HTTP 调用与 CLI 对应的登录交换接口，已有配置可直接用于会话复用。

## 认证

校园 VPN、平台会话和 SSH 是不同的认证层。SecureLink 在线不等于平台认证可用；SSH 公钥也不能替代平台会话 token。

### 先分清三种凭据

| 凭据 | 用途 |
|---|---|
| 学校 CAS 密码及二次认证 | 学校统一认证；通过正常认证回调取得平台会话 |
| 平台 CLI 登录凭据 `pubPassword` | 历史客户端的 `login -p` 输入；可用于已确认的登录交换接口 |
| 平台会话 token | 平台 API 请求头 `token`；已核实的 bita 配置将其 Base64 编码存入 `auth` |

已核实的静态前端使用 `name`、`pubPassword`、`tenantInfo.name` 生成 CLI 命令。`pubPassword` 不等于会话 token，也不能从会话 token 经 Base64 编解码得到；尚未确认其具备 OAuth refresh token 的刷新、过期与轮换语义。

## Web API 认证流程

完整 CLI 认证初始化按以下顺序执行：`CAS → 平台 token A → 账号资料中的 pubPassword → 登录交换接口 → CLI token B → 验证并保存`。A/B 仅标记取得来源，不保证字符串、权限或有效期一定不同；不能仅凭两者相等或不同判断认证成功。

1. **CAS 认证。** 通过 HTTP 客户端访问 `https://authserver.szu.edu.cn/authserver/login`，`service` 指向 `https://console.aicloud.szu.edu.cn/gateway/ram/api/v1/cas/action/login`。按当前表单与静态脚本构造请求，保持 Cookie、隐藏字段和回调状态；密码加密所需逻辑与盐值从本次响应核实，不硬编码旧票据或过期字段。只向已确认的学校/平台 HTTPS 域名发送相应凭据，逐跳核对重定向。
2. **处理校内外分支并取得 A。** 用户提供的部署经验是校内使用账号密码，校外还需企业微信二次认证；实际是否出现挑战以 CAS 响应为准，不能仅凭 IP、校园 VPN 在线或网络位置跳过认证。需要验证码时，通过已确认的官方发送、校验接口操作，用户在本机终端的受限输入中填码，不发到聊天。不得打开浏览器或本地填写页面；缺少无浏览器的认证方式就报告阻塞。正常 CAS 回调返回平台 token A 后，先核对 HTTP、业务码与账号身份。
3. **用 A 获取 CLI 凭据。** 携带请求头 `token: A` 调用 `GET /gateway/ram/api/v1/tenant`；从同一次账号资料响应取得 `name`、`pubPassword`、`tenantInfo.name` 和当前 `productId`，保持账号与租户一致。该接口读取现有凭据，不能将其说成已执行了凭据签发或重置。详情见 [凭据读取](#通过-api-获取-pubpassword)。
4. **用 pubPassword 换取 B。** 按当前部署确认的协议调用 `POST /gateway/ram/api/v1/tenant/user/login`，JSON 字段为 `name/password/tenantName/productId`，其中 `password` 填 `pubPassword`，不能填 CAS 密码或 A。字段值取本次已核对的账号资料；历史协议值为 `tenantName=szdx`、`productId=heros`。这相当于通过 HTTP 完成 CLI 登录交换，不执行 bita 命令。解析已确认的响应结构取得 B；该完整交换尚未实测成功，不能仅凭 HTTP 200 宣称完成。
5. **验证 B 后保存。** 用 B 请求只读接口，核对业务成功、账号及租户与步骤 3 一致；通过后才合并写入 `.auths[endpoint].auth = Base64(B)`，保留其他 endpoint，Windows 使用用户专属 ACL，POSIX 使用 `600`。失败时不覆盖已有有效配置，分别报告 CAS、凭据读取和 CLI 交换完成到哪一步；不能把只保存 A 宣称为完整 CLI 登录成功。

常规 API 任务已有有效会话时，按 [API 认证检查](web-api.md#使用边界与认证) 在内存中解码并验证后复用，无需重走完整初始化；已有独立、有效的 CLI 凭据时可从步骤 4 开始。不读取浏览器 cookie、存储或会话数据库，不回显凭据。字段不明先做 [静态接口定位](interface-discovery.md#从当前前端确认行为)，认证失败不反复提交账号试错，也不假定 `pubPassword` 具有自动刷新语义。

## 通过 API 获取 pubPassword

仅在本次确需 CLI 兼容凭据且已有相应授权时取值。当前真实只读测试已确认 `GET /gateway/ram/api/v1/tenant` 的 `data` 包含 `name/pubPassword/tenantInfo`，其中 `tenantInfo.name` 是租户名；同一响应也含会话 `token` 和 `cmdPassword`，均需脱敏。后续部署若缺少这些字段，从当前静态 JS 重新定位实际接口与层级，不假定其长期不变，也不猜测隐藏接口。这项读取验证不等于已验证 CLI 凭据登录交换成功。

取到后只在内存或本机受限凭据位置使用，不输出完整命令或原始认证响应。[只读查询助手](web-api.md#只读查询助手) 会脱敏该字段，因此其输出不能用来导出 `pubPassword`。若当前权限或接口不提供该值，报告限制；不得让用户改用网页复制。现有平台会话可用时，直接完成 Web API 任务，无需额外获取此字段。

## 历史 CLI 提交的排障证据

曾遇到 `bita apply` 退出码为 0、标准输出却没有 ID。接手此类未决任务时，通过 API 完整分页查询当前集群，按唯一名称、团队、创建时间及规格匹配准确 ID；空输出不等于没有提交。多个匹配或配置不符先调查，不盲目重建。后续创建改用已确认的 API，按 [主流程](../SKILL.md) 核价、查重和验收。

Base64 只是编码。CLI 凭据、会话 token、cookie 和二次认证状态始终留在本机受限位置，不进入 Git、镜像或实验产物。
