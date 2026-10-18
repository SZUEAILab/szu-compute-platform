# 深圳大学算力调度平台技能

用于管理深圳大学算力调度平台的开发环境和实验任务，技能调用名为 `$szu-compute-platform`。

覆盖校园网与 SecureLink 接入、代理绕过、bita 登录与提交、SSH 密钥、公钥登记、工作区和数据集挂载，以及环境初始化、镜像复用和任务生命周期。

## 默认运行方式

- 查询和诊断按所需范围执行。
- 仅开机时验收 SSH、GPU 和挂载，保持环境供用户使用。
- 首次跑代码时选择满足要求的最低价实例，配置环境、完成最小 dry-run，通过后保存环境镜像。
- 后续实验使用已验收的兼容镜像，恢复挂载并同步当前源码。
- 环境依赖发生实质变化时制作新镜像版本。

## 使用

仓库根目录即技能目录。可在目标项目根目录执行：

```bash
git clone https://github.com/SZUEAILab/szu-compute-platform.git \
  .agents/skills/szu-compute-platform
```

在支持该技能格式的 Codex 环境中，通过 `$szu-compute-platform` 指定本次操作，例如：

> 使用 $szu-compute-platform 检查校园网连接和平台已有任务，报告当前资源与价格。

> 使用 $szu-compute-platform 为当前项目准备运行环境，先使用最低价适用实例完成 dry-run，验收后保存环境镜像。

具体账号、团队、资源、时长及费用范围由本次任务确定。

## 文档

| 入口或主题 | 文件 |
|---|---|
| 技能范围、运行模式与文档导航 | [SKILL.md](SKILL.md) |
| 校园网判断与 SecureLink | [campus-network.md](references/campus-network.md) |
| DNS、Fake-IP 与代理绕过 | [proxy-bypass.md](references/proxy-bypass.md) |
| bita 安装、认证、提交与传输 | [bita.md](references/bita.md) |
| SSH 密钥检查、生成、公钥登记 | [ssh-keys.md](references/ssh-keys.md) |
| 工作区、数据集与持久化 | [storage-datasets.md](references/storage-datasets.md) |
| 首次 dry-run、环境镜像与复用 | [environment-image.md](references/environment-image.md) |
| SSH 连接、代码同步与运行 | [remote-runtime.md](references/remote-runtime.md) |
| 控制台 API、调度与生命周期 | [web-api.md](references/web-api.md) |

## 维护

技能仅保存通用流程。任务、镜像、依赖版本及验证记录保存在使用方项目或任务产物中。更新时检查本地文件引用、命令示例与元数据；平台内部接口按当前部署确认方法和字段。
