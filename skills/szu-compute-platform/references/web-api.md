# 控制台 API 与任务生命周期

按需查阅：[认证](#使用边界与认证)、[查询与核价](#查询与核价)、[创建任务](#创建任务)、[连接状态](#排队与连接状态)、[YAML 导出](#导出任务配置)、[生命周期](#生命周期管理)、[监控](#监控与附属服务)、[零变更检查](#无资源变更的接口检查)。

## 使用边界与认证

平台全部操作直接使用 Web API，不调用浏览器、Computer Use 或 bita 命令。内部接口不是稳定 SDK；方法、请求体与字段通过 HTTP 下载的当前静态前端和已有脱敏协议证据确认，遇构建变化、404/405 或字段缺失时重新检查，不靠猜测写接口。

先区分 [CLI 凭据、CAS 密码和会话 token](bita.md#先分清三种凭据)。本机 `~/.bita/config.json` 的 `auth` 不是 `login -p` 所用的 `pubPassword`。确认文件可读、POSIX 权限 `600` 或 Windows 用户专属 ACL，且 `.auths["https://console.aicloud.szu.edu.cn"].auth` 为非空字符串；当前格式匹配时在内存中 Base64 解码，作为请求头 `token` 的值。字段缺失、解码失败或值为空即停止认证步骤，转入 [bita 认证](bita.md#认证)，不能携带空值继续请求。

认证值不输出、不写回仓库、不复制到容器；不使用 `set -x`。需要命令行传递时避免凭据字面量，注意头参数可能短暂出现在进程列表中，完成后清除内存变量。用有权限的只读请求验证认证，不用创建任务探测。

普通响应同时检查 HTTP 2xx、`message.code == 0` 和 `data` 中目标状态。监控响应可直接使用 `metrics_data`；YAML 和日志下载返回文本，按各自格式判断。单一产品 401/403 不足以证明整体登录失效。

## 只读查询助手

技能内的 [platform_read.py](../scripts/platform_read.py) 仅依赖 Python 标准库，复用本机 bita 配置；可查询集群、profile、可支付团队、套餐、任务、镜像、公钥、连接状态与账户资格。它只提供已列明的查询操作，不登录、不修改认证、不创建或停止资源。接口需要重新核对时先读 [定位流程](interface-discovery.md)。

示例中的 `SZU_SKILL_DIR` 取本技能目录，集群和任务 ID 从当前查询结果取得，在同一终端中设置：

```bash
python "${SZU_SKILL_DIR:?Set the installed skill directory}/scripts/platform_read.py" clusters --out work/clusters.json
python "$SZU_SKILL_DIR/scripts/platform_read.py" jobs --cluster "${SZU_CLUSTER_ID:?Use the current cluster ID}" --out work/jobs.json
python "$SZU_SKILL_DIR/scripts/platform_read.py" job --id "${SZU_JOB_ID:?Use the current job ID}" --out work/job.json
```

列表自动读完 `total` 指定的所有页；总数变化、重复 ID、提前空页或超过上限会报错，避免把部分结果当完整快照。`jobs` 覆盖表中开发环境类型，不替代分布式训练、推理等其他页面的任务列表。`account-status --id` 使用当前 profile 的用户 ID。`--direct` 只忽略此会话的显式代理发现，不绕过 TUN 或替代校园 VPN。

结果以临时文件写完后原子替换为脱敏 JSON，终端只打印摘要；`pubPassword/token/cookie` 等字段和常见带凭据 URL 会被隐藏。不要用它导出 CLI 凭据，也不要把字段脱敏当成任意正文日志的通用清洗器。认证重定向不会自动跟随，失败转回认证或接口定位；`--out` 不能指向认证配置文件。

## 查询与核价

下表是接口定位线索，调用前确认当前部署仍使用对应结构。

| 目标 | 方法与路径 | 请求或响应 |
|---|---|---|
| 开发环境分页 | `POST /gateway/training/api/v1/job/debug/action/page` | 请求见下；响应 `data.list/total` |
| 开发环境详情 | `GET /gateway/training/api/v1/job/debug/{jobId}` | 状态、集群、团队、规格、时长、镜像、挂载和起止时间 |
| 集群 | `POST /gateway/foundation/api/v1/cluster/action/list` | 请求 `{}`，响应数组 |
| 团队分页 | `POST /gateway/foundation/api/v1/team/action/page` | 请求 `pageNum/pageSize`，响应 `data.list/total` |
| 当前用户的付费团队 | `POST /gateway/order/api/v1/team-user/team-powers/action/page` | 按当前前端确认请求与用户权限，不将所有可见团队视为可支付团队 |
| 资源池与套餐 | `POST /gateway/foundation/api/v1/resource-pool/action/list` | 请求 `sceneList:["training"]` 和 `clusterId`；响应数组及 `powerConfList` |
| 账户创建资格 | `GET /gateway/order/api/v1/comp-powers/status/{userId}` | 用户标识取当前 profile/前端调用，不使用团队 ID 代替；按当前页面解释返回状态 |

开发环境分页请求：

```json
{
  "pageNum": 1,
  "pageSize": 20,
  "jobType": "training",
  "jobSubTypes": "training-debug,notebook-job,teaching-notebook-job",
  "clusterId": "<cluster-id>"
}
```

所有分页按 `total` 读全，再按 [主流程](../SKILL.md) 查重。优先用目标任务所属集群和授权团队；新建时查集群支持场景。团队额度按其类型与页面解释，不自行把不同字段相加为可用余额。

付费资格以当前账户状态检查、团队权限和计费方式为准；单个团队余额字段为负，不足以判定不能创建任务。配置多实例时按所有实例的单价、数量和最长运行时间合计预算，并预留已知存储等费用。时长字段的单位从当前前端换算或已有限时任务导出核对；已核对的开发环境版本中 YAML `maxRunTime` 与 API `debugDuration` 使用分钟，不能直接填页面显示的小时数。

核价检查资源池 `id/teamId/publicFlag/status`，套餐 `id/cardRealName/cardNum/cardMemory/cpuNum/memoryNum/price/status/sceneList`。单位以当次页面和响应为准；不可用时不沿用旧 ID。分布式、微调和 HPO 使用各自页面状态机，不能机械替换 `debug` 路径。

## 创建任务

通过 HTTP 下载的当前静态前端定位开发环境创建函数及 HTTP 封装，确认真实方法、路径、JSON 请求体和时长单位；不要把 YAML 导出接口当创建接口，也不把 YAML 原样作为 JSON 提交。按 [主流程](../SKILL.md) 完成授权范围、价格、完整分页查重、公钥、镜像和挂载检查，将脱敏请求及准确配置留在项目记录中，再发送创建请求。保存返回的任务 ID，查询详情核对配置并等待就绪。超时、空响应或没有明确 ID 时先查询匹配，不重发创建。当前没有维护通用创建脚本，不能把只读查询助手当作提交器；字段未确认就报告缺项，不回退 bita 或浏览器。

## 排队与连接状态

| 目标 | 方法与路径 | 要点 |
|---|---|---|
| 排队统计 | `POST /gateway/training/api/v1/job/action/waiting-time` | 开发环境请求 `{"jobType":"training","jobSubType":"training-debug"}` |
| 连接入口 | `GET /gateway/training/api/v1/job/{jobId}/debug-url` | 核对 `sshState/sshUrl` 等服务状态和入口 |
| Pod 入口 | `GET /gateway/training/api/v1/job/{jobId}/pod/debug-url` | 可为空数组 |
| 排队序号 | `GET /gateway/training/api/v1/job/task/{taskId}/action/rank` | 参数取真实任务标识，不猜测与 `jobId` 相等 |

`waitingTime/waitingJobNum/maxWaitingTime` 是统计，不代替目标任务轮询。返回连接 URL 不等于入口可用，先确认任务与服务就绪；签名 URL、密码和令牌不回显。SSH 字段用法见 [remote-runtime.md](remote-runtime.md#ssh-连接)。

## 导出任务配置

`POST /gateway/training/api/v1/command/job/{jobId}/yaml/download` 成功返回 YAML 文本。保存为权限 `600` 的文件，核对内容、资源范围及 [挂载](storage-datasets.md) 和 [公钥](ssh-keys.md)；时长字段需确认单位。导出配置不等于授权重提，不把敏感 YAML 提交 Git，临时文件用后清除。

## 保存环境镜像接口

当前接口定位线索：`POST /gateway/foundation/api/v1/image` 创建镜像记录，`GET /gateway/foundation/api/v1/image/{imageId}` 查询制作状态，`POST /gateway/foundation/api/v1/image/action/page` 分页查重。先检查当前保存镜像表单：`name/tag/content/uploadType/sceneList/jobId/teamId` 及请求补入的 `clusterId`；场景取 `GET /gateway/foundation/api/v1/dict?type=image_scene`，不猜数字类型或覆盖已有标签。

保存返回的 ID 后按 [环境镜像流程](environment-image.md#保存环境镜像) 等待真正可用；当前已核对版本的 `status=2` 表示就绪，新部署仍需核对状态定义。创建结果不明先查完整镜像分页与准确名称/标签，不重复保存。接口接受请求不代表已完成或已在新实例验收。

## 生命周期管理

| 操作 | 方法与路径 |
|---|---|
| 停止开发环境 | `PUT /gateway/training/api/v1/job/debug/{jobId}/action/stop` |
| 删除开发环境 | `DELETE /gateway/training/api/v1/job/debug/{jobId}` |

按主流程确认本次停止/删除范围，重新核对 ID、名称、团队和状态。运行中先查 SSH 主进程与 GPU 工作，发现范围外活跃任务先报告。已停止直接报告，处于 `Stopping` 不重复停止；只发送一次请求，再有限轮询最终状态，超时如实报告，不假定已释放资源。

删除前确认允许的状态和将失去的元数据，完成后查详情或完整分页确认移除。不假设挂载存储随任务删除。

重启、恢复与续期以当前页面能力为准，不猜 `start/restart/resume/renew/extend`。复制若只是预填创建页，仍是新任务流程，不等于恢复旧实例。

多任务实验为每个任务保存准确 ID、名称、进程退出码和验收结果，及时启动已就绪实例；在既有停止安排内释放已验收完成的实例。收集依赖 SSH 时，在结果下载并校验前保留必要连接入口；可通过持久化存储下载时无需为取文件额外保留空闲 GPU。后台监控应有期限、状态记录和范围校验，不无限重发创建或停止请求。

费用与耗时分开报告：墙钟时间、各次训练耗时和累计 GPU 占用时长可能不同；估算费用覆盖实例空闲、安装和取结果时段。`Stopped` 证明停止，不能用尚未结算的 `charged/runHours/power=0` 宣称零费用；标明按起止时间和单价估算，实际账单以平台为准。

## 监控与附属服务

### 事件、日志和 Grafana

监控接口需核对额外 `clusterid` 头，按 `metrics_data` 检查；日志、数据源访问配置只输出诊断必需的脱敏内容。

| 功能 | 方法与路径 | 参数或边界 |
|---|---|---|
| 事件 | `GET /gateway/apis/monitoring.hero.ai/v1/events` | `task_id/start_time/end_time`，核对任务标识及纳秒时间单位 |
| 日志 | `GET /gateway/apis/monitoring.hero.ai/v1/logs` | `pods/namespaces/start_time/end_time/sort/size/containers/keyword_filter` |
| 直接下载日志 | `GET /gateway/apis/monitoring.hero.ai/v1/logs/export` | 同日志查询，返回文本；保存文件限制权限 |
| 数据源查询 | `GET /gateway/apis/monitoring.hero.ai/v1/grafana/datasource/list/{clusterId}` | 参数为集群 ID |
| 数据源创建 | `GET /gateway/apis/monitoring.hero.ai/v1/grafana/datasource/create/{clusterId}?is_master_cluster={0|1}` | 有副作用；参数取当前前端与集群类型，之后查询验证 |
| 异步日志导出 | `POST /gateway/foundation/api/v1/async-task/job/{jobId}/pod/{pod}/log/action/export` | 有副作用；体取当前页面，核对时间单位、有效 bucket 与输出路径，等待任务及文件完成 |

空响应不等于创建成功，存储路径或团队 ID 不能猜作导出 bucket ID。

### TensorBoard

```text
GET    /gateway/training/api/v1/job/{parentJobId}/tensorboard
POST   /gateway/training/api/v1/job/{parentJobId}/tensorboard
PUT    /gateway/training/api/v1/job/{tensorboardChildId}/tensorboard/action/stop
DELETE /gateway/training/api/v1/job/{tensorboardChildId}/tensorboard
```

创建体取当前前端。立即保留创建返回的独立子 ID，通过 `GET /gateway/training/api/v1/job/distributed/{id}` 验证 `jobSubType == other-tensorboard`。不能用父任务状态响应覆盖创建 ID，不能把父 ID 传入子任务写接口。

用 TensorBoard 专用接口停止，确认子任务 `Stopped` 后按删除范围处理并核验移除。ID、类型或状态不符就停止写操作重查，不猜强制停止或改用普通分布式停止接口。

## 无资源变更的接口检查

查询和直接下载可真实调用；创建、停止、删除、异步导出及有副作用的 GET 只检查前端定义，必要时用 `OPTIONS`。预检不能证明业务成功。

前后比较相关完整分页任务、团队额度、资源池/套餐和附属服务的规范化快照。差异可能来自并发操作，先报告调查，不以额外写操作恢复。不为认证、连通性或接口测试创建付费任务或改动现有资源。

## 故障判断

401/403 结合业务码区分失效、权限及非法状态；404/405 或字段变化重新确认部署；HTTP 成功但业务失败按失败处理。列表为空而详情存在时查分页、集群及类型过滤，不立即再建任务。认证或接口失败时按 HTTP 证据排查，不切换到浏览器；提交前仍需完成查重核价。
