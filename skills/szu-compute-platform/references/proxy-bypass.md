# 深大域名的 DNS、Fake-IP 与代理绕过

先按 [campus-network.md](campus-network.md) 确认校园内网接入可用，再核对代理配置。

按实际接管流量的层选择必要修改，先保存原值并保留其他规则。系统代理例外、Clash/Mihomo 分流和 TUN/DNS 是不同配置；记录实际改动的层，不把只改系统绕过列表报告成修改了 Clash 订阅。

## 目标范围与匹配语法

DNS 绕过、Fake-IP 绕过和代理绕过都按 `*.szu.edu.cn` 这类通配规则覆盖深大服务，不逐个维护主机。需要匹配根域时一并覆盖 `szu.edu.cn`；注意平台入口属于多级子域名。

| 配置位置 | 覆盖根域与所有子域的写法 |
|---|---|
| Mihomo DNS/Fake-IP 域名列表 | `'+.szu.edu.cn'`；该位置的 `*` 一次只匹配一级子域 |
| Mihomo 连接路由规则 | `DOMAIN-SUFFIX,szu.edu.cn,DIRECT` |
| 系统代理绕过界面 | `szu.edu.cn` 与 `*.szu.edu.cn`，确认界面的多级通配语义 |
| `NO_PROXY` / `no_proxy` | `szu.edu.cn,.szu.edu.cn`，按工具验证后缀匹配 |

修改前从运行进程的可执行文件、启动参数和控制器确认当前使用的配置与内核，避免误改旧目录或未启用的配置。将规则加入当前配置的持久化覆写项，保留其他规则，避免订阅更新覆盖。

## Clash/Mihomo 配置

### DNS 解析绕过

深大域名使用校园或 VPN 提供且当前可达的真实 DNS，避免代理节点远端解析，以及不支持校园内网的公共或加密解析器。客户端有 DNS 绕过列表时添加相应通配域名；内置 DNS 仍接管查询时，为这些域名指定正确上游。

Mihomo 的 `dns.nameserver-policy` 使用 `'+.szu.edu.cn'` 指向当前校园/VPN DNS，优先于通用 `nameserver/fallback`。配置了 `direct-nameserver` 时，它也需使用正确上游，或由支持的 `direct-nameserver-follow-policy` 遵循域名策略。DNS 地址按当前网络获取，不固定 IP。

### Fake-IP 绕过

对目标域名返回真实地址，按当前 `fake-ip-filter-mode` 配置：

- `blacklist`：将 `'+.szu.edu.cn'` 加入 `fake-ip-filter`。
- `rule`：将 `DOMAIN-SUFFIX,szu.edu.cn,real-ip` 放在其他匹配规则及兜底之前。
- `whitelist`：只有匹配项才使用 Fake-IP，应确保深大域名不落入 Fake-IP 匹配范围，不能套用黑名单写法。

保留当前模式，不为单一域名改变整个客户端行为。

### 连接代理绕过

规则模式中，将 `DOMAIN-SUFFIX,szu.edu.cn,DIRECT` 放在其他匹配代理规则和 `MATCH` 前并验证命中；全局代理模式不作为分流规则生效证据。

这里的直连仍经本机校园/VPN 路由；平台提供的 SSH SOCKS5 入口继续按连接说明使用。`DIRECT`、真实 DNS 上游和 Fake-IP 排除需分别检查，系统代理例外也不能替代 TUN/DNS 接管中的规则。

## 系统与 HTTP 客户端

- 系统“不使用代理/绕过地址”覆盖根域与所有子域；PAC 中对应分支返回 `DIRECT`，位于通用代理分支之前。
- 工具受 `HTTP_PROXY`、`HTTPS_PROXY`、`ALL_PROXY` 等变量影响时，在已有 `NO_PROXY` 和 `no_proxy` 中追加域名后缀例外，保留原值；不同工具的匹配能力单独验证。
- 对应 API 明确应走校园直连时，Python `requests.Session().trust_env=False` 可让该会话忽略自动发现的代理；它不会关闭 Clash TUN、改变系统路由或解决 Fake-IP。使用会话级设置，避免为单一任务清空全局代理变量。

## 验证生效

1. 用当前校园 DNS 查询目标域名，再检查系统与代理接管后的解析结果，确认真实地址可达。不要用固定 IP 或修改 hosts 作为默认修复。
2. 重载后检查解析是否仍使用旧 DNS/Fake-IP；仍用旧值则清理对应缓存并重建 HTTP 连接，再核对 DNS 上游、规则命中和出口。
3. 验证 API 只读请求与 SSH 代理端口。核实响应来自目标服务后，HTTP 401/403 转入认证或权限检查；DNS 失败、超时和无路由继续网络诊断。
