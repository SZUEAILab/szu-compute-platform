---
name: szu-compute-platform
description: 仅通过 Web API 管理深圳大学算力调度平台的认证、开发环境和实验任务，禁止浏览器与 Computer Use。支持校园网诊断、SSH、公钥、挂载与环境镜像；首次低价 dry-run 后保存镜像，后续实验复用。
---

# 深圳大学算力调度平台

控制台：`https://console.aicloud.szu.edu.cn/`；开发环境页面：`/console/task-debug`。以当前用户需求、会话配置与授权确定操作范围。

## 操作通道

平台认证、查询、创建、停止、镜像、公钥和存储管理仅通过 Web API 完成，不使用浏览器、内置浏览器、浏览器自动化、Computer Use 或 GUI 回退，也不要求用户打开网页、复制命令、cookie 或 token。HTTP 客户端可下载当前 HTML/JS 作离线接口定位，不渲染或执行页面。`bita` 仅作为已有认证配置的兼容来源和协议参考，不调用其登录、提交或传输命令。SSH/SCP、本机文件与进程操作用于远端代码运行和产物传输。

校园接入未就绪时按网络参考处理；缺少已确认的无浏览器认证方式时说明具体阻塞，不切换到浏览器。

## 先确定运行模式

| 本次需求 | 执行范围 |
|---|---|
| 查询、诊断或文档维护 | 完成所需检查，不创建算力实例 |
| 仅启动环境供用户使用 | 验收 SSH、GPU 与挂载，保持运行；不自动训练或制作镜像 |
| 首次运行代码，尚无兼容环境镜像 | 选满足要求的最低价实例，配置环境 → 最小 dry-run → 保存镜像 |
| 后续实验，已有兼容环境镜像 | 使用该镜像，恢复挂载与当前源码，验收后按正式配置运行 |
| 依赖、解释器或 CUDA/架构实质变化 | 重新初始化并保存新镜像版本；只改源码时同步并验证即可 |

## 按需读取

只读取当前阶段需要的文档；步骤已内化，不依赖外部教程。

| 阶段 | 文档 |
|---|---|
| 校园网判断与 SecureLink 接入 | [campus-network.md](references/campus-network.md) |
| DNS、Fake-IP、Clash/TUN 和系统代理绕过 | [proxy-bypass.md](references/proxy-bypass.md) |
| Web API 认证、pubPassword、CAS/MFA 与 bita 配置兼容 | [bita.md](references/bita.md) |
| 本机密钥检查、生成、公钥登记与绑定 | [ssh-keys.md](references/ssh-keys.md) |
| `/workspace`、数据集、挂载与持久化 | [storage-datasets.md](references/storage-datasets.md) |
| 首次最低价初始化、dry-run 与镜像复用 | [environment-image.md](references/environment-image.md) |
| SSH 变量、代码同步与运行验收 | [remote-runtime.md](references/remote-runtime.md) |
| 查询、核价、调度与生命周期 API | [web-api.md](references/web-api.md) |
| CLI/接口行为不明、响应字段定位和失败后的判断 | [interface-discovery.md](references/interface-discovery.md) |

已有有效 bita 配置时，可用 [只读查询助手](references/web-api.md#只读查询助手) 取得分页完整、凭据脱敏的 JSON 快照；它不负责登录、提交或停止任务。

## 执行顺序与共同约束

1. **接入与认证。** 确认校园网或 VPN 可达。常规任务优先验证并复用已有有效会话；完整 CLI 认证初始化按 [HTTP 认证流程](references/bita.md#web-api-认证流程) 执行 CAS（校内账号密码、校外按需企业微信二次认证）→ 平台 token → 获取 `pubPassword` → 登录交换取得 CLI token → 验证保存。平台操作直接调用当前部署已确认的 Web API。
2. **创建前。** 核对账号、支付团队、资源要求、时长与费用范围；分页检查同配置的 `Pending / Queuing / Running / Stopping` 任务，优先复用或等待。查询现价，再审查 API 创建请求、可导出的 YAML、公钥绑定及挂载，不猜测配置字段。提交结果不明时先查询，不重复创建。
3. **执行与验收。** 轮询准确任务 ID，直到目标状态、明确失败或本次等待时限到达。多任务逐个跟进调度、验收和启动，避免只看首个任务而让其他已就绪实例空转。按运行模式执行；进程启动、HTTP 200 或目录存在分别不能代替任务完成、业务成功或持久化验证。
4. **结束与报告。** 保留产物，按本次停止安排处理实例；已包含的停止授权无需重复询问，仅开机供使用时保持运行。删除需独立、明确授权。报告任务状态、结果位置、未完成部分；账单以平台为准，标价乘时长标为估算。

私钥、认证令牌留在本机，只有公钥登记到平台。镜像保存运行环境；挂载保存源码、数据与产物，不能假定两者互相包含。任务、镜像、依赖与验证记录放在当前项目或任务产物中，技能只维护通用流程；遵循工作区的 Git 跟踪与忽略规则。
