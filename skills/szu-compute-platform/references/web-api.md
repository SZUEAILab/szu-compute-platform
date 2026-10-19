# 控制台 API 与生命周期

导航：[认证](#使用边界与认证) · [查询核价](#查询与核价) · [创建](#创建任务) · [连接](#排队与连接状态) · [YAML](#导出任务配置) · [镜像](#保存环境镜像接口) · [停止删除](#生命周期管理) · [监控](#监控与附属服务)

## 使用边界与认证

内部接口按已检查的部署维护；404/405、字段缺失或业务失败进入 [接口定位](interface-discovery.md)。写操作遵循 [主流程](../SKILL.md) 的任务范围。

复用 `~/.bita/config.json` 时读取 `.auths["https://console.aicloud.szu.edu.cn"].auth`，在内存中 Base64 解码为请求头 `token`。文件权限为 POSIX `600` 或 Windows 用户专属 ACL。文件、字段、解码或只读验证失败即转 [认证流程](bita.md#web-api-认证流程)，不发送空 token。

普通 JSON 响应检查 HTTP 2xx、`message.code == 0` 和非空 `data`；监控检查 `metrics_data`；YAML、日志按文本格式验收。单个接口的 401/403 需区分认证与权限。凭据不放入命令行字面量、日志、Git 或容器。

## 只读查询助手

[platform_read.py](../scripts/platform_read.py) 仅依赖 Python 标准库，从本机配置取得认证，只提供查询；不登录、不修改认证、不提交或停止资源。`SZU_SKILL_DIR` 指向本技能，集群与任务 ID 从查询结果取得：

```bash
python "${SZU_SKILL_DIR:?Set the installed skill directory}/scripts/platform_read.py" clusters --out work/clusters.json
python "$SZU_SKILL_DIR/scripts/platform_read.py" jobs --cluster "${SZU_CLUSTER_ID:?Use the current cluster ID}" --out work/jobs.json
python "$SZU_SKILL_DIR/scripts/platform_read.py" job --id "${SZU_JOB_ID:?Use the current job ID}" --out work/job.json
```

- 按 `total` 读完分页；总数变化、重复 ID、提前空页、超过页数上限均报错。`jobs` 只覆盖开发环境类型，`account-status --id` 使用账号 ID。
- 原子写入脱敏 JSON，终端只打印摘要；隐藏 `pubPassword/token/cookie/vncPwd` 等字段和带凭据的 URL。不用该输出导出凭据，也不把字段脱敏当作日志正文清洗。
- 不跟随认证重定向，禁止 `--out` 覆盖认证配置。`--direct` 只忽略会话的显式代理发现，不改变 TUN、路由或校园接入。

## 查询与核价

| 目标 | 方法与路径 | 字段 |
|---|---|---|
| 开发环境分页 | `POST /gateway/training/api/v1/job/debug/action/page` | 请求见下；响应 `data.list/total` |
| 开发环境详情 | `GET /gateway/training/api/v1/job/debug/{jobId}` | `state`、集群、团队、规格、镜像、挂载、起止时间 |
| 账号资料 | `GET /gateway/ram/api/v1/tenant` | `data.name/pubPassword/productId/tenantInfo/token/cmdPassword`；凭据脱敏 |
| 集群 | `POST /gateway/foundation/api/v1/cluster/action/list` | 请求 `{}`；响应数组 |
| 团队分页 | `POST /gateway/foundation/api/v1/team/action/page` | `pageNum/pageSize`；响应 `data.list/total` |
| 可支付团队 | `POST /gateway/order/api/v1/team-user/team-powers/action/page` | 核对当前账号的支付权限 |
| 资源池/套餐 | `POST /gateway/foundation/api/v1/resource-pool/action/list` | `sceneList:["training"]`、`clusterId`；响应含 `powerConfList` |
| 创建资格 | `GET /gateway/order/api/v1/comp-powers/status/{userId}` | 账号 ID；状态含义从前端映射核对 |

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

完整分页后查重。资源池核对 `id/teamId/publicFlag/status`；套餐核对 `id/cardRealName/cardNum/cardMemory/cpuNum/memoryNum/price/status/sceneList`。团队可见性不代表支付权限，单个余额字段不能代替账户资格与计费方式。

预算合计所有实例的单价、数量、最长占用时间及已知存储费用。已检查部署的 YAML `maxRunTime`、API `debugDuration` 使用分钟；提交前对照表单换算与导出配置核对单位。不可用资源不复用旧 ID。

## 创建任务

从静态前端的创建函数与 HTTP 封装取得方法、路径、JSON 字段和单位；字段未确认则停止提交。YAML 导出接口不用于创建，YAML 不原样作为 JSON 发送。完成主流程核价、查重、镜像、公钥与挂载核对后提交一次，保存 ID 并查详情、调度状态。超时、空响应或无 ID 时先按唯一名称和配置查询，禁止重发。只读助手不是提交器。

## 排队与连接状态

| 目标 | 方法与路径 | 参数/响应 |
|---|---|---|
| 排队统计 | `POST /gateway/training/api/v1/job/action/waiting-time` | `{"jobType":"training","jobSubType":"training-debug"}` |
| 连接入口 | `GET /gateway/training/api/v1/job/{jobId}/debug-url` | `sshState/sshUrl`、服务状态；隐藏 `vncPwd` |
| Pod 入口 | `GET /gateway/training/api/v1/job/{jobId}/pod/debug-url` | 数组；空数组不代表连接就绪 |
| 排队序号 | `GET /gateway/training/api/v1/job/task/{taskId}/action/rank` | `taskId` 取真实任务标识，不用 `jobId` 代填 |

`waitingTime/waitingJobNum/maxWaitingTime` 是统计，目标任务按准确 ID 轮询；取得 URL 后仍需验收入口。连接参数见 [SSH](remote-runtime.md#ssh-连接)。

## 导出任务配置

`POST /gateway/training/api/v1/command/job/{jobId}/yaml/download` 返回 YAML 文本。受限保存并核对资源、时长、公钥、挂载。导出不授权重提，敏感 YAML 不进入 Git。

## 保存环境镜像接口

| 操作 | 方法与路径 |
|---|---|
| 创建记录 | `POST /gateway/foundation/api/v1/image` |
| 查询制作状态 | `GET /gateway/foundation/api/v1/image/{imageId}` |
| 分页查重 | `POST /gateway/foundation/api/v1/image/action/page` |
| 镜像场景 | `GET /gateway/foundation/api/v1/dict?type=image_scene` |

创建字段为 `name/tag/content/uploadType/sceneList/jobId/teamId/clusterId`，类型与枚举从前端定义取得。已检查部署的 `status=2` 表示就绪。保存 ID 后按 [镜像流程](environment-image.md#保存环境镜像) 验收；无明确 ID 时先按名称、标签完整查重，不重复保存。

## 生命周期管理

| 操作 | 方法与路径 |
|---|---|
| 停止开发环境 | `PUT /gateway/training/api/v1/job/debug/{jobId}/action/stop` |
| 删除开发环境 | `DELETE /gateway/training/api/v1/job/debug/{jobId}` |

核对授权范围、ID、团队、状态和活跃进程。`Stopped` 不再停止，`Stopping` 只轮询；发送一次停止请求并有界等待，超时报告未确认释放。删除后查详情或完整分页确认移除；任务删除与存储清理分别处理。重启、恢复、续期的接口未确认时不猜路径；分布式、微调、HPO 不套用开发环境路径。

多任务分别保存 ID、退出码和验收结果，及时启动已就绪实例。依赖 SSH 收集时，下载与哈希核验完成后再停机。分别报告墙钟时间、训练耗时、累计占用时长；费用估算包含安装、空闲、收集时段。未结算的 `charged/runHours/power=0` 不作为零费用证据。

## 监控与附属服务

### 事件、日志和 Grafana

监控核对额外 `clusterid` 头和 `metrics_data`；响应与日志先脱敏。

| 功能 | 方法与路径 | 参数/边界 |
|---|---|---|
| 事件 | `GET /gateway/apis/monitoring.hero.ai/v1/events` | `task_id/start_time/end_time`，时间单位纳秒 |
| 日志 | `GET /gateway/apis/monitoring.hero.ai/v1/logs` | `pods/namespaces/start_time/end_time/sort/size/containers/keyword_filter` |
| 日志下载 | `GET /gateway/apis/monitoring.hero.ai/v1/logs/export` | 同日志查询；返回文本，受限保存 |
| 数据源查询 | `GET /gateway/apis/monitoring.hero.ai/v1/grafana/datasource/list/{clusterId}` | 集群 ID |
| 数据源创建 | `GET /gateway/apis/monitoring.hero.ai/v1/grafana/datasource/create/{clusterId}?is_master_cluster={0|1}` | 有副作用；参数取集群类型，创建后查询验收 |
| 异步日志导出 | `POST /gateway/foundation/api/v1/async-task/job/{jobId}/pod/{pod}/log/action/export` | 有副作用；请求体从静态前端取得，核对时间单位、bucket、路径并等待导出完成 |

存储路径、团队 ID 不代替 bucket ID，空响应不作为创建成功证据。

### TensorBoard

```text
GET    /gateway/training/api/v1/job/{parentJobId}/tensorboard
POST   /gateway/training/api/v1/job/{parentJobId}/tensorboard
PUT    /gateway/training/api/v1/job/{tensorboardChildId}/tensorboard/action/stop
DELETE /gateway/training/api/v1/job/{tensorboardChildId}/tensorboard
```

创建体取静态前端；保存独立子 ID，通过 `GET /gateway/training/api/v1/job/distributed/{id}` 验证 `jobSubType == other-tensorboard`。停止和删除均用子 ID 与专用接口；不以父任务响应覆盖子 ID。类型或状态不符时停止写操作重查。

## 无资源变更的接口检查

只调用查询与直接下载；创建、停止、删除、异步导出和有副作用的 GET 只检查静态定义，`OPTIONS` 不作为业务成功证据。比较前后完整任务、团队、资源池快照；差异先调查，不用写操作恢复，不创建测试用付费任务。

## 故障判断

401/403 区分认证、权限与非法状态；404/405 或结构变化重新定位协议；HTTP 成功但业务失败仍判失败。列表为空而详情存在时检查分页、集群、类型过滤，不重复创建。
