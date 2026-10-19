---
name: szu-compute-platform
description: 通过 Web API 管理深圳大学算力平台的认证、开发环境、任务和镜像。禁止浏览器与 Computer Use；首次以最低价适用实例完成 dry-run 并保存镜像，后续实验复用。
---

# 深圳大学算力平台

平台：`https://console.aicloud.szu.edu.cn`。

## 操作边界

平台操作只用 Web API，禁止浏览器、Computer Use、GUI 和 bita 命令；不得要求用户打开网页复制凭据。接口定位通过 HTTP 下载静态 HTML/JS，不渲染页面。SSH/SCP 用于远端运行和传输，已有 bita 配置用于会话复用。

私钥和认证凭据留在本机受限位置，平台只登记公钥。项目保存资源 ID、配置、版本和验证记录，技能只维护通用流程。

## 先确定运行模式

| 需求 | 执行范围 |
|---|---|
| 查询或诊断 | 只读，不创建实例 |
| 仅开机供用户使用 | 验收 SSH、GPU、挂载后保持运行 |
| 首次运行或依赖、解释器、CUDA/架构变化 | 最低价适用实例 → 配置 → dry-run → 保存镜像 |
| 已有兼容镜像 | 复用镜像、恢复挂载、同步代码并验收 |

只改源码时同步并验证，不重建环境镜像。

## 执行顺序

1. **接入与认证。** 验证校园/VPN 路由与已有会话。完整 CLI 初始化执行 CAS → token A → `pubPassword` → 登录交换 → token B → 验证保存，见 [认证](references/bita.md#web-api-认证流程)。
2. **创建前。** 核对账号、支付团队、规格、时长、总预算；查实时价格，完整分页查重 `Pending/Queuing/Running/Stopping`，复用匹配任务。核对镜像、公钥和挂载；提交结果不明先查询，禁止重复创建。
3. **执行。** 按准确 ID 有限轮询；多任务分别跟进调度和启动。按上表运行并验收退出码、评估、检查点和产物，完成收集后按既定停止安排释放实例。
4. **交付。** 报告状态、产物、未完成步骤及费用。已授权的停止不重复询问，删除须有明确授权；仅开机模式保持运行。标价乘占用时长写为估算，结算费用取平台账单。

## 按阶段读取

| 阶段 | 文档 |
|---|---|
| 校园网/VPN 诊断 | [campus-network.md](references/campus-network.md) |
| DNS、Clash/TUN、系统代理 | [proxy-bypass.md](references/proxy-bypass.md) |
| CAS、CLI 凭据与会话 | [bita.md](references/bita.md) |
| SSH 密钥登记与绑定 | [ssh-keys.md](references/ssh-keys.md) |
| 工作区、数据集、持久化 | [storage-datasets.md](references/storage-datasets.md) |
| dry-run、镜像制作与复用 | [environment-image.md](references/environment-image.md) |
| SSH、同步、运行验收 | [remote-runtime.md](references/remote-runtime.md) |
| API、核价、生命周期、只读脚本 | [web-api.md](references/web-api.md) |
| 接口定位与异常分流 | [interface-discovery.md](references/interface-discovery.md) |
