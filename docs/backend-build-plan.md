# 墨枢 Inkloom 后端建设思路与增量迭代计划

> 配套阅读：`backend-architecture.md`（静态结构）讲"系统长什么样"；本文讲"**从哪行代码开始、按什么顺序、怎么一步步长出来**"。
> 核心方法论：Agent 工程不是先画大图再填空，而是 **评测驱动的垂直薄切片**——每一刀都端到端可跑、可测、可演示，只在被真实失败逼到时才加一个节点/工具/护栏。

---

## 1. 五条建设原则

1. **竖着切，不要横着铺**
   每个增量都是"输入一个 beat → 经过若干节点 → 产出可断言结果"的完整链路，而不是"先写完所有表 / 所有 repository / 所有 prompt"。横切层（DB、HTTP、SSE）在某一刀真正需要时才引入。

2. **Fake LLM 是默认开发驱动器，真实模型只是一个可替换适配器**
   定义 `ChatModel` 端口，测试/CI 全部用**脚本化 Fake**（返回正常稿、返回坏 JSON、截断、非法引用、拒绝、二次修复成功……）。真实模型开发机手动跑、按种子集跑；**CI 不依赖真实 LLM**（省钱、稳定、可复现）。这样编排/校验/路由逻辑从第一天就是确定性可测的。

3. **先有失败用例，再加能力**
   每个节点/工具/护栏的诞生顺序固定：先写 1–3 条"现在过不了"的用例（domain 单测或 eval 种子）→ 最简实现让它过 → 接真实模型看真实失败 → 一次只加一类复杂度 → 全量回归。**没有失败案例支撑的节点不许进图。**

4. **能简单就先假的：内存 → PG，固定上下文 → 检索，单模型 → 路由，同步 → 异步 worker，无鉴权 → 鉴权。**
   端口（interface）先定，适配器后换；业务代码不感知当前是内存还是 PG、是 Fake 还是真实模型。

5. **版本契约先于人工，事件先于流式，持久化先于续跑。**
   依赖顺序不能反：没有版本号就做不了人审并发保护；没有 run_event/outbox 就别写 SSE；没有 checkpoint 就谈不上重启恢复。

---

## 2. 单个增量的标准迭代循环（每个 I 都这么走）

```
① 写失败用例     domain 单测（规则）或 eval 种子（端到端一章），先跑红
② 最简实现       优先内存仓库 + Fake 模型，让它变绿，不提前抽象
③ 接真跑一次      换真实模型适配器，在固定种子上跑，trace 落 Langfuse/llm_calls
④ 看真实失败      判断缺口属于：提示词 / 输出校验 / 工具 / 上下文 / 路由 / 护栏 中哪一类
⑤ 只加一类复杂度  加对应节点或规则，重跑
⑥ 全量回归 + 提交 所有旧用例仍绿；记录本次 eval 数据与决策
```

每个增量的"完成定义(DoD)"：
- 自动化用例全绿（CI 用 Fake）；
- 有一条能给人看的演示（测试输出 / curl / 前端一条链路）；
- 关键决策与 prompt 版本有记录；
- `pnpm/前端` 或后端 API 至少一侧真实联通（到 I8 后要求联通）；
- 不新增 flaky 测试。

---

## 3. 从哪里开始写（第一周可落地的具体起点）

不要先建数据库。按这个顺序起手：

1. `cmd/inkloom` + `internal/config`：能启动、读配置。
2. `internal/domain/manuscript`：`Segment`、`Beat`；`internal/domain/review`：`Finding`、severity(P0–P3)、`ReviewReport`。
3. 纯规则单测先立标杆：聚合分级（去重、P0 优先）、Finding 校验。**这是第一批红→绿测试。**
4. `internal/agents/model` 定义端口：
   ```go
   type ChatModel interface {
       Generate(ctx context.Context, in ModelInput) (ModelOutput, Usage, error)
   }
   ```
   配一个 `FakeChatModel`（按脚本队列返回多轮预设响应）。
5. `internal/orchestration`：用 Eino 搭 **3 节点最小图**（writer → 一个 critic → 结束），状态先放内存 struct；写一个图测试：喂 1 个 beat，断言产出 segment、且 Fake 给的 P2 finding 被正确解析进 ReviewReport。
6. 看到这条链路绿了，再开始第 4 节的增量。

> 起步阶段的全部目的：**用最便宜、最确定的方式，把"图—状态—结构化解析—评审结果"这条主轴和契约钉死**，让后面所有能力都往里挂，而不是回头改骨架。

---

## 4. 增量序列（M1 拆细，M2–M5 给切片）

### M1 单章闭环：把"主轴 + 护栏 + 可恢复"立住

| # | 增量 | 先写的失败用例 | 最小实现 | 演示/验收 |
| --- | --- | --- | --- | --- |
| I0 | 骨架与领域 | Finding 聚合分级、引用校验单测 | config + domain + 端口 + Fake 模型 | 单测绿，`go test ./...` 通过 |
| I1 | 行走骨架（walking skeleton） | 1 beat 进，产出 1 segment + 1 finding | Eino 3 节点图，内存状态，Fake 模型 | 图测试端到端通过 |
| I2 | 结构化输出加固 | 坏 JSON(一次后修复)/截断/非法引用/拒答 | parse 管线：结构→字段→枚举→引用→范围校验，1 次修复，否则节点失败 | 五类异常各有测试，绝不"当通过" |
| I3 | 真实模型适配器 | 同一种子，真实模型能产出合格结构化 | Eino ChatModel 适配器 + 四段 prompt v1 + llm_calls 记账 | 手动跑 1 章，trace 可查；CI 仍用 Fake |
| I4 | 评审-返工闭环(先 P2) | 含禁用词的稿子必须被抓并被改掉 | ai_taste 确定性特征(禁用词/句长方差)+聚合+micro-polish+复检+2 轮上限+escalate | 改后禁用词消失且未引入新问题；超限能 escalate |
| I5 | 一致性与 P0/P1 路由 | "右手持刀 vs 左撇子"矛盾被抓 | hard_consistency critic(读最小 Bible 硬特质)+structural/scene reviser+条件边 | P0 回退到 beat、P1 场景重写的分支测试 |
| I6 | 持久化与版本 | 重启后数据在；并发改 segment 返回 409 | PG migrations + 各 repository 替换内存；segments 版本号乐观锁；testcontainers | 集成测试通过 |
| I7 | 人审与断点续跑 | approve/instruct/inline_edit；进程杀掉能恢复；旧 draftVersion 失效 | Eino Interrupt/Checkpoint 落 PG；resume 带版本校验 | 重启恢复测试 + 409 测试 |
| I8 | 事件与 SSE | 断连用 Last-Event-ID 能补齐事件 | run_event 只追加 + outbox 同事务 + dispatcher + SSE hub；最小 REST | curl 能看一章实时推进与回放 |
| I9 | 装配 v0 与定稿冻结 | 本章上下文只含固定版本材料；commit 后版本冻结 | assembler 注入 beat+活跃人物+硬规则+上章结尾，出 ContextManifest；commit_refs | 单章定稿端到端；**M1 收口** |

M1 结束时你已经有：**一条真实可跑、可中断恢复、有评审返工、有版本、能被前端实时观察的单章流水线**——这已经是一个完整的 Agent 工程故事。

### M2 跨章记忆：把 RAG/图谱能力逐层挂进去

| # | 增量 | 关键点 |
| --- | --- | --- |
| I10 | 向量召回 | embedder 端口(Fake→真实) + pgvector + 关键词混合 + rerank；**召回率评测**（埋点事实能否被找回） |
| I11 | 工具循环 | graph 抽边；`get_character/search_segments/...` 白名单只读工具；有界 ReAct（≤3 次）供 assembler 和一致性 critic 查证；工具滥用/重复查询用例 |
| I12 | 完整 Bible 与可见性 | 时间线/伏笔/信息差；章节顺序 + 故事时间 + 获知时点 + POV 过滤；伏笔 open/resolve 台账 |
| I13 | 分层摘要 | 定稿生章摘要→滚动卷摘要；**摘要推断不回写 Bible**；5–10 章连续一致性样例回归 |

### M3 人机共创：变更传播（差异化重点）

| # | 增量 | 关键点 |
| --- | --- | --- |
| I14 | ChangeSet 与直改 | diff 区分纯字句/事实级；inline_edit 路径 + 乐观锁 |
| I15 | Blast radius 预览 | 沿 graph 边遍历（防环、记原因）；rewrite/review/orphan 精确到段；`/changesets/preview` |
| I16 | 冲突裁决 | Bible/正文/旁证比对；改正文/改Bible/全局统一；台词谎言开关；content-wins 但牵连需确认 |
| I17 | 增量传播 worker | durable task + `SKIP LOCKED`；局部复检/embedding/摘要；任务带版本，旧任务不覆盖新索引 |
| I18 | 分支与合并 | commit_refs 快照、分支独立检索范围、试写、合并冲突裁决 |

### M4 评测与成本

| # | 增量 | 关键点 |
| --- | --- | --- |
| I19 | Eval runner | 种子集 + Judge rubric + 回归集（含角色撒谎）；多次运行/匿名乱序；消融开关（关记忆/关返工）+ 单 Agent baseline |
| I20 | 门禁校准与成本 | 阈值用标注样本校准，未校准项只提示；OTel→Langfuse 全量；按节点多模型路由与成本对比报告 |

### M5 打磨

| # | 增量 | 关键点 |
| --- | --- | --- |
| I21 | 全量风格/读者评审 + 统稿 | voice 跨章一致；style/reader critic；分批统稿保留动作/抒情节奏差异；导出 |

---

## 5. 引入基础设施的时机（别提前）

| 设施 | 什么时候才引入 | 之前用什么 |
| --- | --- | --- |
| 真实 LLM | I3 | FakeChatModel |
| PostgreSQL | I6 | 内存 repository |
| Checkpoint/人审 | I7 | 图直接跑完 |
| outbox / SSE | I8 | 测试里直接断言终态 |
| pgvector / embedding | I10(I10→M2) | 固定/关键词取上下文 |
| durable task 队列 | I17 | 同步执行 |
| 多模型路由 | I20 | 单模型配置 |
| 鉴权/多租户 | 有真实多用户需求时 | 单用户/API Key，字段预留 owner_id |
| 微服务/消息中间件 | **不引入** | 单体模块化 + Postgres 即可 |

---

## 6. 测试与 LLM 策略（贯穿全程）

- **测试金字塔**
  - domain 纯规则：最多、最快，无 IO（聚合、分级、冲突分类、版本冻结、可见性）。
  - 图/节点测试：FakeChatModel 脚本驱动，覆盖正常与所有异常分支。
  - 仓储集成：testcontainers 起 PG+pgvector。
  - 端到端：一章 happy path + 重启恢复 + 版本竞争 + 并行 Critic 部分失败。
- **真实模型用"录制/手动"模式**：开发机对固定少量种子手动跑，结果（响应、usage）可存成 fixture 回放；CI 全离线。对应技术文档"真实模型评测由用户显式启动"。
- **每次加 prompt/节点/工具**：跑回归集，防"改好 A 崩坏 B"；eval 结果随代码提交。

---

## 7. 明确不要早做的事

- 不要先把所有表、所有 CRUD、所有 admin 接口建完再写 Agent；
- 不要在没有失败用例时凭感觉加节点/加 Agent 数量/上自主群聊；
- 不要脱离 eval 反复"手搓 prompt 求神"；
- 不要一开始就上微服务、Kafka、Neo4j、多模型网关、多租户；
- 不要让 Eino 节点里直接写 SQL 或塞业务规则（节点保持薄）。

---

## 8. 一张图记住整体节奏

```
I0-I1 钉主轴(图/状态/解析/Fake)
I2-I5 让 Agent 变可靠(校验→真模型→返工→分级路由)     ← Agent 能力在这长出来
I6-I9 让系统能工程用(持久化→人审恢复→事件流→冻结)    ← 后端骨架在这补齐
M2    给 Agent 装记忆(RAG/图谱/工具/摘要)
M3    让"人改得动且改不坏"(变更/冲突/分支)
M4    用数据证明它有效(eval/消融/成本)
M5    把质量和质感打磨到位(风格/声音/统稿)
```

先窄后宽、先能跑后变好、先 Fake 后真实、先单章后跨章——任何一步停下来，手上都是一个能演示、能讲清取舍的完整作品，而不是一个建了一半的空壳。
