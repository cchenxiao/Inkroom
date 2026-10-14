# 墨枢 Inkloom 后端整体框架设计

> 依据：`docs/agent-development.md`（业务编排与 Agent 契约）、`docs/product-design.md`（产品流程）、`docs/frontend-engineering-prompt.md`（REST/SSE 接口契约）。
> 技术栈：**Go + Eino（显式 Graph/Interrupt/Checkpoint）+ PostgreSQL/pgvector + OpenTelemetry→Langfuse**。
> 本文只定框架与边界：分层、模块、运行时模型、一致性、数据与接口；代码级签名随各里程碑细化。

---

## 1. 架构目标与约束

| 目标 | 设计含义 |
| --- | --- |
| 显式可控 | 流程是确定性状态图；模型只在指定节点做判断，不能绕过人审、不能自增无限调用 |
| 可中断/可恢复 | 人审可暂停释放资源，审批后从断点继续；进程重启可恢复等待中的 run |
| 强一致可追溯 | 正文、Bible、大纲版本匹配提交；任何修改是 ChangeSet；结果带来源与版本 |
| 人机并发安全 | 乐观版本 + 单 run 占用；迟到结果不能覆盖作者新稿；旧审批随版本失效 |
| 可评测可观测 | 每次 run/node/tool/model 调用留痕，token/成本/返工可统计，评测可回放 |
| 简单可演进 | **单体模块化（modular monolith），不做微服务**；M1 单二进制起步，按 M1–M5 加模块 |

三条不可破坏的依赖规则：

1. `domain` 不 import 任何框架/DB/Eino/HTTP，只含实体与不变量。
2. Eino 节点是**薄适配层**：只做「取状态 → 调应用服务/Agent → 写状态增量 + 发事件」，业务规则不写进节点闭包和 prompt。
3. 所有外部副作用（发 SSE、重建索引、跑摘要）由**事件/任务**驱动，不在模型调用链路里同步硬做。

---

## 2. 进程与部署拓扑

```
┌─────────────────────────────── 单个 Go 二进制 inkloom ───────────────────────────────┐
│                                                                                       │
│  HTTP Server (REST + SSE)          Orchestration Engine (Eino Graph runtime)          │
│  static: go:embed 前端构建产物       固定数量 worker 协程（每章一条 run，受信号量限制）    │
│                                                                                       │
│  Async Workers（同进程，消费 durable task 表）：索引重建 / 摘要滚动 / embedding / 评测    │
└───────────────┬───────────────────────────────────────────────────┬───────────────────┘
                │                                                   │
        ┌───────▼────────┐                                  ┌───────▼────────┐
        │  PostgreSQL     │ 业务数据/版本/边/run/事件/outbox/任务 │  LLM Provider  │
        │  + pgvector     │  Eino Checkpoint 也落 PG            │  Embedding 供应商│
        └───────┬────────┘                                  └────────────────┘
                │ OTLP (trace/metrics)
        ┌───────▼────────┐
        │   Langfuse      │
        └────────────────┘
```

- 单体但**模块边界物理隔离**（internal 分包 + import 规则 + lint 检查），未来要拆服务时按 feature 拆，不重写领域。
- 不引入消息中间件：用 Postgres 的 **outbox + durable task 表 + `FOR UPDATE SKIP LOCKED`** 实现可靠异步任务（M1 甚至可先同步，接口不变）。
- 前端构建产物 `go:embed` 进二进制，同源提供，省去跨域与独立部署。

---

## 3. 分层架构（六边形 / 整洁架构）

```
interfaces      api/（HTTP handler、DTO、错误模型、SSE 端点）  server/（路由、中间件、静态）
   │ 依赖
application     app/（用例服务：Run/Review/Change/Version/Project/Report） orchestration/（图）
   │ 依赖
domain          domain/manuscript · domain/bible · domain/review · domain/change · domain/version（纯 Go + 端口接口）
   ▲ 端口由基础设施实现
infrastructure  store/postgres · store/pgvector · store/checkpoint · agents/model · memory/embed · observability
```

- 应用层通过**端口接口**（repository、ChatModel、Embedder、EventPublisher、TaskQueue）编排；`main` 做依赖注入。
- `orchestration` 是特殊的应用层：它描述「图」，节点内部调用 `app` 用例和 `agents`，不直接碰 SQL。
- 横切：认证、日志、trace、限流、预算、幂等都在 middleware / platform 层，不进业务。

---

## 4. 代码模块（Go package 布局）

```text
cmd/inkloom/main.go                 # 装配：配置→DB→仓库→模型→图→服务→路由→启动 worker
internal/
  config/                           # env/文件配置，feature flag（各期启用哪些 Critic）
  server/                           # http server、路由注册、中间件、静态托管、SSE hub
  api/
    dto/                            # 请求/响应结构体（与 domain 分离）
    handler_project.go handler_run.go handler_review.go
    handler_change.go handler_version.go handler_report.go
    sse.go                          # /runs/:id/events，断点续传(Last-Event-ID)
    errors.go                       # 统一错误码（含 409 version_mismatch）
  app/                              # 用例服务（事务边界、端口编排）
    project.go chapter.go run.go review.go change.go version.go report.go
    ports.go                        # 对 infra 的端口接口
  domain/
    manuscript/   bible/   review/   change/   version/
    *_test.go                       # 不变量单测（分级聚合、冲突分类、版本冻结等纯规则）
  orchestration/
    graph.go                        # 构建 Eino Graph：节点 + 条件边 + 分支 + 并行
    state.go                        # GraphState / GlobalState / ChapterState（传引用与 run 内数据）
    nodes/                          # assembler writer critics aggregator revisers
                                    # instruction_reviser human_gate bible_updater commit
    router/                         # P0/P1/P2/通过 条件路由、escalate、预算护栏
  agents/
    roles/                          # 各角色 prompt 模板（go:embed，独立版本号，四段式）
    schema/                         # 结构化输出 JSON Schema
    parse/                          # 解码→结构/字段/引用/修改范围校验→一次修复→否则节点失败
    model/                          # Eino ChatModel 工厂、按节点选模型、用量回传
  tools/                            # get_character/query_timeline/get_open_foreshadows/
                                    # search_segments/get_fact_evidence：白名单+参数校验+只读
  memory/
    bible/    graph/                # 关系边读写、沿边取证、blast radius 遍历
    summary/                        # 章摘要→卷摘要滚动
    retrieval/                      # 混合检索 + rerank + 可见性过滤 + 装配 + ContextManifest
    embed/
  quality/
    features/                       # 确定性中文文本统计（句长/burstiness/对话占比/标点/词表）
    aitaste/  style/  judge/        # 多信号打分、LLM 语义评审、阈值与权重版本
  changes/
    diff.go classify.go blastradius.go conflict.go propagation.go
  events/                           # 领域事件定义、总线、outbox 投递
  worker/                           #  durable task 消费者（index/summary/embed/eval）
  store/
    postgres/   pgvector/   checkpoint/   outbox/   migrations/
  observability/                    # otel 初始化、Langfuse exporter、metrics、结构化日志
  platform/                         # idgen/clock/retry/限流/调用与 token 预算/errgroup 并发
  eval/                             # 量表、回归集、消融实验 runner
web/                                # 前端 dist（go:embed）
migrations/                         # SQL 迁移（编号，含 pgvector 扩展）
```

> Eino 的 Graph/Lambda/State/Interrupt/Checkpoint 具体 API 以 M1 锁定的框架版本为准（参考 cloudwego.io Eino 文档）；本设计对其的依赖仅限「图编排、中断恢复、ChatModel/Tool/Retriever 组件」三件事。

---

## 5. 运行时模型：Run 引擎（系统心脏）

### 5.1 三套"状态"各司其职，不要混用

| 状态 | 载体 | 职责 |
| --- | --- | --- |
| 业务版本状态 | Postgres（正文/Bible/大纲的版本化数据） | 事实真相；按**固定版本**读取，不拼"最新值" |
| 图执行状态 | Eino State + PG Checkpoint | 当前走到哪个节点、节点输入版本、轮次、中断恢复点 |
| 运行事件流 | `run_event` 只追加表 | 给前端/SSE/审计/时间线用，可重放 |

run 启动时**冻结版本集合**（project/chapter/outline/bible/style 的具体版本 + draft_version），整轮 run 只读这些版本；作者改动产生新版本，不影响已在跑的 run 的输入。

### 5.2 一次章节 run 的生命周期

```
POST /runs（chapterId, branchId）
  → 占用：本章本分支仅一条活动 run（部分唯一索引/咨询锁）
  → 写 run(status=running, epoch=1) + run_event run.started（同一事务，outbox）
  → 构建并 Invoke Eino Graph（注入已冻结版本、预算、模型配置）
       节点内：读固定版本 → 调 Agent/工具/确定性服务 → 在一个事务里：
               写产物版本 + 追加 findings/revisions + 追加 run_event（outbox）
       并行 Critic：errgroup + 信号量，读同一 draft_version，barrier 聚合
       HumanGate：调用 Eino interrupt → 状态落 checkpoint → run=waiting_human → 释放协程
  → SSE 由 outbox dispatcher 推送；新订阅者从 Last-Event-ID 回放 run_event
POST /runs/:id/actions（approve|redirect|instruct|inline_edit|cancel，带 draftVersion）
  → 校验版本（不符 → 409 + version.stale 事件）→ Resume Graph，传入恢复载荷
  → Commit 节点在单事务冻结相互匹配的正文/Bible/大纲版本，run=completed
```

### 5.3 事件目录（与前端 SSE 契约一致）

`run.started / node.started / node.finished / draft.delta / findings.ready /
revise.round(x,max) / gate.waiting / escalated / conflict.created /
index.updating / run.finished / run.failed / version.stale`

- **outbox 模式**：业务写库与事件追加同事务；dispatcher 异步发布，保证"库改了事件必达"，不依赖模型调用成功与否。
- 事件携带 `run_id、node、round、draft_version、版本引用、用量`，前端据此驱动 React Flow 高亮、Findings、返工进度。

### 5.4 失控防护（确定性护栏，集中在 router/platform）

- 返工 `revise_round ≤ 2`（可配 3），超限 → `escalate`（带历轮 diff 与未决问题）。
- 每节点工具调用 ≤3、结果大小上限、重复无增益查询即停；ReAct 只存在于有边界的查证。
- 每次模型调用前检查 **总调用数 / token / 金额预算**（结构修复、重试、工具循环都计入）。
- 写入按 `(run_id,node,round,input_version,attempt)` **幂等去重**；外部模型超时结果未知不假装未扣费，交由作者选择重试。
- Critic 必要项失败不得由其他 Critic 的通过替代（barrier，不是投票）。

---

## 6. Agent / 模型层

- **ChatModel 抽象**：Eino ChatModel 适配器 + 按节点模型配置（规划/关键章强模型，初稿可便宜模型，M4 做成本对比）；供应商 key 在服务端，可挂独立网关。
- **四段式 prompt**（职责边界 / 输出 Schema / 任务要求 / 故事材料），模板 go:embed、带版本号，写入 trace 与 run_event。
- **结构化输出管线**：JSON 解码 → 结构校验 → 字段/枚举校验 → 引用有效性（segment/fact 必须存在且版本匹配）→ 修改范围授权校验。**合法 JSON ≠ 合法证据**。无法解析最多一次结构修复，仍失败则节点失败，绝不当作审稿通过。拒绝、截断、空响应分别处理。
- **角色上下文隔离**：每角色独立消息；Critic 只看正文与证据，不看 writer 的自我辩解；reader 视角独立。
- **工具安全**：白名单 + 参数校验 + 项目/版本隔离 + 结果必含来源；只读工具直接执行；写类工具只生成**事实/修改提案**，由 bible_updater/change 服务校验提交；模型不接触任意 SQL。

---

## 7. 记忆与上下文子系统（M2，接口 M1 预留）

| 组件 | 职责 |
| --- | --- |
| `memory/bible` | 人物/规则/时间线/伏笔/信息差仓储；按实体与故事时间查询 |
| `memory/graph` | 节点表+边表（mentions/depends/plants/resolves/appears_in/causally_before/knows），边记来源 segment 与版本；同时服务"取证召回"与"影响传播" |
| `memory/summary` | 定稿后生成章摘要，滚动聚合成卷摘要；**摘要推断不自动回写 Bible** |
| `memory/retrieval` | 关键词 + pgvector 混合召回 → 应用层融合与 rerank；章节顺序 + 故事时间/获知时点 + POV 三重可见性过滤 |
| `memory/retrieval/assembler` | 按 token 预算优先级装配，产出 **ContextManifest**（材料、来源版本、检索方式、token 估计、未纳入材料） |

作者的未来伏笔规划与角色当前可知内容**分区传入**，避免把"作者知道"当"角色知道"。

---

## 8. 变更传播引擎（ChangeSet，M3，接口先行）

```
人工/AI 修改
  → changes.Diff：判定 纯字句 vs 事实级（事实级才触发抽取与对齐）
  → 生成 ChangeSet(origin,target,old,new,reason,parent_commit)
  → POST /changesets/preview：
       graph 遍历 blast radius（visited 防环、记录原因）
         强依赖 depends → rewrite；弱提及 mentions → needs_review；伏笔失依 → orphan
       抽取差异与 Bible 比对 → 生成 Conflict 候选（区分台词谎言/角色误解 vs 世界事实）
  → 作者选择：mark_only | propagate
  → POST /changesets/:id/apply：
       受影响对象入 durable task（重写/增量复检/局部 embedding/摘要重算）
       任务带"基于版本"，写入前比对当前版本，旧任务不得覆盖新索引
  → Conflict 裁决（改正文/改Bible/全局统一）形成新 ChangeSet，递归到影响清零
```

- 模型抽取的关系可能遗漏：**空结果不等于无影响**，覆盖不全时扩大复检范围并提示。
- BibleUpdate 在 Commit **前**只产候选变化；有冲突回 HumanGate；未确认事实不暴露给下一章。

---

## 9. 质量引擎（quality/）

- **确定性特征**（Go 纯算）：句长分布/burstiness、对白占比、标点指纹、禁用词表命中、"的"字链、句首重复、段落长度雷同。
- **语义判断**（模型）：叙事距离、潜台词、感官、动机可信度、读者意愿——必须返回分数 + 原文证据 + 理由。
- 评分记录特征/权重/归一化/版本；阈值用项目标注样本校准；**未校准特征标 disabled，不伪造**困惑度、声音相似度，也不作为唯一拒绝理由。
- micro-edit 后由编排保证**同时复跑风格/AI 味与受影响一致性检查**（修正原稿流程图只回风格审查的不一致）。

---

## 10. 数据库（PostgreSQL，表族）

```
项目结构：projects, chapters, scenes, beats
正文版本：segments(当前) + segment_versions(历史), style_stats
Bible：characters, character_knows, world_rules, timeline_events,
       foreshadows, info_states, style_profiles, voice_profiles
关系图：graph_nodes, graph_edges(来源 segment_id+version)
评审修订：findings, revision_patches, review_rounds
运行：runs, run_events(只追加), checkpoints(Eino), context_manifests,
      llm_calls, tool_calls（用量/成本/幂等键）
变更：changesets, change_affected, conflicts
版本：branches, commits, commit_refs（对象→冻结版本映射）
异步：outbox, durable_tasks
向量：segment_embeddings(pgvector，M2)
```

关键约束：

- 版本号 + 乐观锁：`segments.version` 等，PATCH 带期望版本，不匹配返回 409。
- 部分唯一索引保证 `(chapter_id, branch_id)` 只有一条活动 run。
- Commit 用 `commit_refs` 一次性冻结各对象版本，形成可回滚、可比较的快照。
- 分支隔离：所有表带 `branch_id`，检索与取证按分支版本范围过滤。
- 迁移用编号 SQL，M1 只建单章闭环所需表，M2/M3 再加记忆与变更表（见 agent 文档分期）。

---

## 11. HTTP / SSE 接口（与前端契约对齐）

REST：项目与树、章节版本读取、segment PATCH（409）、bible CRUD（保存触发预览）、
`/changesets/preview|apply`、`/conflicts/:id/resolve`、`/comments`、
`/runs`、`/runs/:id/actions`、`/runs/:id/context-manifest`、
`/commits`、`/branches`、`/branches/:id/merge`、`/reports/*`。

- 统一错误模型 `{code,message,details}`；`409 version_mismatch` 携带当前版本供前端刷新。
- SSE：`GET /runs/:id/events`，支持 `Last-Event-ID` 断线回放与按 run 鉴权。
- 认证：M1 单用户/API Key 中间件即可，表结构预留 owner_id，不提前做多租户。

---

## 12. 可观测、评测与测试

- **Trace**：一章一条 root span，模型/工具/检索/评审/修订/人决各一子 span；OTLP→Langfuse，映射模型、token、评分；不记录隐藏思维链。
- **指标**：一次过审率、平均返工轮数、token/千字成本、人审干预率、节点延迟、任务积压。
- **评测**：固定种子跑 单 Agent / 多 Agent 无记忆 / 完整系统 + 消融（关记忆、关返工）；多次运行、匿名乱序、保留失败案例；回归集含硬伤/时间线/提前获知/伏笔遗漏/套话/正常文本/**角色撒谎**。
- **测试金字塔**：
  - domain 纯规则单测（聚合分级、冲突分类、版本冻结、可见性）；
  - 节点测试用 **脚本化 Fake ChatModel**（正常/拒绝/截断/非法引用/二次修复）驱动图；
  - 仓储集成测试用 testcontainers 起 PG+pgvector；
  - SSE 断线回放、版本竞争、并行 Critic 部分失败做并发测试。

---

## 13. M1 落地顺序（最小可跑后端）

1. 骨架：config / DB / migrations / 路由 / 健康检查 / 单章假数据。
2. domain + 表：Segment/Finding/ChapterState/角色输出 Schema；segments、runs、run_events、checkpoints、llm_calls。
3. agents/model：接一个 ChatModel，跑通 writer + 结构化解析（含失败/截断/非法引用用例）。
4. orchestration：Assemble→Draft→一致性/AI味两 Critic（并行 barrier）→Aggregate→条件路由→修订→复检，2 轮上限。
5. store/checkpoint：PG Checkpoint；HumanGate interrupt/resume（approve/instruct/inline_edit）+ 409。
6. events/outbox + SSE hub（回放）；ContextManifest 基础版。
7. app 用例与 REST 串通前端工作台；Commit 冻结版本；单章定稿 e2e。

M2 加完整记忆/pgvector/工具循环；M3 加 ChangeSet/影响传播/冲突/分支；M4 加评测与多模型成本；M5 加 style/reader 全量与统稿。**接口与表从第一天就预留，不靠删模块来"分期"。**

---

## 14. 关键取舍（可直接用于答辩）

- 选**单体模块化**而非微服务：规模是单人/单作品、重逻辑不重吞吐，模块化包边界已足够，避免分布式代价。
- 选 **Eino 显式图**而非自由群聊：可控、可测、可恢复，自主边界清晰。
- 用 **outbox + 同进程 worker** 而非 MQ：Postgres 已是依赖，可靠性够，部署一个二进制。
- 业务状态与 Checkpoint **分离**：框架中断可重跑节点，故写入必须幂等；不把恢复正确性押在框架"恰好一次"上。
- 检索用 Postgres 边表而非先上图库：关系遍历规模可控，接口隔离后可平滑替换。
