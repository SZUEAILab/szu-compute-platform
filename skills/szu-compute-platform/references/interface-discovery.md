# 接口定位与异常分流

接口返回 404/405、字段缺失或协议未确认时执行本流程。

## 从当前前端确认行为

1. 用 HTTP 下载控制台 HTML、配置、入口 JS，沿实际 `script/module/import` 获取相关模块；不复用旧构建文件名，不渲染页面。
2. 用 `rg` 定位功能与 HTTP 封装；压缩 JS 只截取命中位置附近内容。区分 `post(path, {data: payload})` 的封装配置与最终请求体，按发送逻辑构造 JSON。
3. 先用只读 API 验证结构，再按任务授权执行写操作。接口记录只保留方法、路径、字段含义和脱敏样例。

| 已确认字段 | 使用规则 |
|---|---|
| CLI 命令的 `name/pubPassword/tenantInfo.name` | 对应账号、CLI 凭据、租户；请求体的 `password` 字段名不代表 CAS 密码 |
| YAML `maxRunTime`、API `debugDuration` | 已检查部署使用分钟；从创建表单换算逻辑和导出配置核对单位 |
| `debug-url.sshUrl`、集群 `sshProxyPath` | 按前端构造逻辑分别取任务主机、用户、SOCKS5 入口，不把内部地址当作公网入口 |
| `jobTaskList[].jobTaskImage.path` | 任务实际镜像；用 `imagePath` 提交的任务不要求 `imageId` 非空 |
| `jobTaskList[].jobTaskPowerConf` | 任务实际规格，不能用空的顶层同名字段代替 |
| 镜像 `uploadType/sceneList/status` | 按 [镜像 API](web-api.md#保存环境镜像接口) 的定义构造和验收 |

## 异常分流

| 情况 | 下一步 |
|---|---|
| 认证失败 | 核对凭据类型、账号、租户、endpoint，执行 [认证分支](bita.md#web-api-认证流程)；不凭一次 500 判定密码错误 |
| 网络或 SSH 失败 | 分开诊断 DNS、TCP/SOCKS5、SSH banner、公钥认证，见 [连接流程](remote-runtime.md#ssh-连接) |
| 创建无明确 ID，或历史 `bita apply` 退出 0 但无输出 | 完整分页查询，按唯一名称、集群、团队、时间与配置匹配；多项匹配先调查，禁止重发 |
| 快照出现其他任务变化 | 记录并调查并发活动，不停止无关任务或用写操作恢复旧快照 |

项目记录保存证据、动作、结果、下一步和准确资源 ID；账号、价格与实验参数不固化进技能。
