# 控制台 API 与任务生命周期

按需查阅：[认证](#使用边界与认证)、[查询与核价](#查询与核价)、[连接状态](#排队与连接状态)、[YAML 导出](#导出任务配置)、[生命周期](#生命周期管理)、[监控](#监控与附属服务)、[零变更检查](#无资源变更的接口检查)。

## 使用边界与认证

只补足本机 `bita` 缺失的能力。内部接口不是稳定 SDK；方法、请求体与字段先从当前前端或浏览器请求确认，遇构建变化、404/405 或字段缺失时重新检查，不靠猜测写接口。

CLI 登录保存的认证位于本机 `~/.bita/config.json`。确认文件可读、权限 `600`，且 `.auths["https://console.aicloud.szu.edu.cn"].auth` 为非空字符串；格式匹配时在内存中 Base64 解码，作为请求头 `token` 的值。字段缺失、解码失败或值为空即停止认证步骤，转入 [bita 登录](bita.md#认证)，不能携带空值继续请求。

认证值不输出、不写回仓库、不复制到容器；不使用 `set -x`。需要命令行传递时避免凭据字面量，注意头参数可能短暂出现在进程列表中，完成后清除内存变量。用有权限的只读请求验证认证，不用创建任务探测。

普通响应同时检查 HTTP 2xx、`message.code == 0` 和 `data` 中目标状态。监控响应可直接使用 `metrics_data`；YAML 和日志下载返回文本，按各自格式判断。单一产品 401/403 不足以证明整体登录失效。

## 查询与核价

下表是接口定位线索，调用前确认当前部署仍使用对应结构。

| 目标 | 方法与路径 | 请求或响应 |
|---|---|---|
| 开发环境分页 | `POST /gateway/training/api/v1/job/debug/action/page` | 请求见下；响应 `data.list/total` |
| 开发环境详情 | `GET /gateway/training/api/v1/job/debug/{jobId}` | 状态、集群、团队、规格、时长、镜像、挂载和起止时间 |
| 集群 | `POST /gateway/foundation/api/v1/cluster/action/list` | 请求 `{}`，响应数组 |
| 团队分页 | `POST /gateway/foundation/api/v1/team/action/page` | 请求 `pageNum/pageSize`，响应 `data.list/total` |
| 资源池与套餐 | `POST /gateway/foundation/api/v1/resource-pool/action/list` | 请求 `sceneList:["training"]` 和 `clusterId`；响应数组及 `powerConfList` |

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

核价检查资源池 `id/teamId/publicFlag/status`，套餐 `id/cardRealName/cardNum/cardMemory/cpuNum/memoryNum/price/status/sceneList`。单位以当次页面和响应为准；不可用时不沿用旧 ID。分布式、微调和 HPO 使用各自页面状态机，不能机械替换 `debug` 路径。

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

## 生命周期管理

| 操作 | 方法与路径 |
|---|---|
| 停止开发环境 | `PUT /gateway/training/api/v1/job/debug/{jobId}/action/stop` |
| 删除开发环境 | `DELETE /gateway/training/api/v1/job/debug/{jobId}` |

按主流程确认本次停止/删除范围，重新核对 ID、名称、团队和状态。运行中先查 SSH 主进程与 GPU 工作，发现范围外活跃任务先报告。已停止直接报告，处于 `Stopping` 不重复停止；只发送一次请求，再有限轮询最终状态，超时如实报告，不假定已释放资源。

删除前确认允许的状态和将失去的元数据，完成后查详情或完整分页确认移除。不假设挂载存储随任务删除。

重启、恢复与续期以当前页面能力为准，不猜 `start/restart/resume/renew/extend`。复制若只是预填创建页，仍是新任务流程，不等于恢复旧实例。

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

401/403 结合业务码区分失效、权限及非法状态；404/405 或字段变化重新确认部署；HTTP 成功但业务失败按失败处理。列表为空而详情存在时查分页、集群及类型过滤，不立即再建任务。网页不可用也需完成查重核价才提交，不能把浏览器故障当作 API 故障。
