# 深圳大学算力调度平台技能

遵循 Agent Skills 格式的技能仓库，提供 `szu-compute-platform`。可通过 Skills CLI 或 Codex 的 skill-installer 按名称/路径发现并安装。

技能覆盖校园网诊断、DNS/Fake-IP/代理绕过、Web API 认证与任务管理、SSH 密钥、公钥登记、工作区及数据集挂载、环境镜像和任务生命周期。

平台认证与操作仅使用 Web API，禁止浏览器、浏览器自动化、Computer Use 和 GUI 回退，不要求用户打开网页复制命令或凭据。可通过 HTTP 下载静态 HTML/JS 离线定位接口；已有 bita 配置仅用于认证兼容，不执行 bita 命令。SSH/SCP 用于远端运行与产物传输。

## 仓库结构

```text
szu-compute-platform/
├── README.md
└── skills/
    └── szu-compute-platform/
        ├── SKILL.md
        ├── agents/
        │   └── openai.yaml
        ├── references/
        └── scripts/
```

`skills/szu-compute-platform/` 是完整、可独立安装的技能目录；其目录名与 `SKILL.md` 的 `name` 一致。`references/` 跟随技能一起安装，`agents/openai.yaml` 提供 Codex 展示元数据。

## 使用 Skills CLI 安装

在目标项目中执行（需要 Node.js/npm）：

```bash
npx skills add SZUEAILab/szu-compute-platform --skill szu-compute-platform
```

只安装到 Codex：

```bash
npx skills add SZUEAILab/szu-compute-platform \
  --skill szu-compute-platform --agent codex
```

使用 `--agent claude-code` 可选择 Claude Code；加 `--global` 安装到用户范围。仅查看仓库可发现的技能：

```bash
npx skills add SZUEAILab/szu-compute-platform --list
```

## 使用 Codex skill-installer 安装

在 Codex 对话中发送：

```text
$skill-installer install https://github.com/SZUEAILab/szu-compute-platform/tree/main/skills/szu-compute-platform
```

调用安装器脚本时，对应参数为 `--repo SZUEAILab/szu-compute-platform --path skills/szu-compute-platform`。安装完成后，在下一轮对话使用 `$szu-compute-platform`。

## 手动安装

克隆仓库后，将完整技能子目录复制到目标项目，而不是将整个仓库作为技能目录：

```bash
git clone https://github.com/SZUEAILab/szu-compute-platform.git
mkdir -p /path/to/project/.agents/skills
cp -R szu-compute-platform/skills/szu-compute-platform \
  /path/to/project/.agents/skills/
```

复制前确认目标没有同名技能，避免与已有版本合并。

## 默认运行方式

- 查询和诊断按所需范围执行。
- 仅开机时验收 SSH、GPU 和挂载，保持环境供用户使用。
- 首次跑代码时选择满足要求的最低价实例，配置环境、完成最小 dry-run，通过后保存环境镜像。
- 后续实验复用已验收的兼容镜像，恢复挂载并同步当前源码；环境实质变化时生成新版本。

具体账号、团队、资源、时长及费用范围由本次任务确定。

## 文档

| 入口或主题 | 文件 |
|---|---|
| 技能范围、运行模式与文档导航 | [SKILL.md](skills/szu-compute-platform/SKILL.md) |
| 校园网判断与 SecureLink | [campus-network.md](skills/szu-compute-platform/references/campus-network.md) |
| DNS、Fake-IP 与代理绕过 | [proxy-bypass.md](skills/szu-compute-platform/references/proxy-bypass.md) |
| Web API 认证、pubPassword 与 bita 配置兼容 | [bita.md](skills/szu-compute-platform/references/bita.md) |
| SSH 密钥检查、生成、公钥登记 | [ssh-keys.md](skills/szu-compute-platform/references/ssh-keys.md) |
| 工作区、数据集与持久化 | [storage-datasets.md](skills/szu-compute-platform/references/storage-datasets.md) |
| 首次 dry-run、环境镜像与复用 | [environment-image.md](skills/szu-compute-platform/references/environment-image.md) |
| SSH 连接、代码同步与运行 | [remote-runtime.md](skills/szu-compute-platform/references/remote-runtime.md) |
| 控制台 API、调度与生命周期 | [web-api.md](skills/szu-compute-platform/references/web-api.md) |
| 接口字段定位与失败后的判断 | [interface-discovery.md](skills/szu-compute-platform/references/interface-discovery.md) |
| 自动分页、脱敏保存的只读 API 查询脚本 | [platform_read.py](skills/szu-compute-platform/scripts/platform_read.py) |

## 维护

技能只保存通用流程，任务、镜像、依赖及验证记录留在使用方项目或产物中。修改后检查技能目录的元数据、相对引用和安装结果；平台内部接口按当前部署确认。

在仓库根目录运行离线回归测试（仅依赖 Python 标准库，不访问平台或读取真实凭据）：

```bash
python -B -m unittest discover -s tests -v
```
