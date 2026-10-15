# 墨枢 Inkloom

面向作者的多智能体中短篇小说协作工作台。稿件是主界面，AI 提交候选，作者决定方向与定稿。当前仓库已包含可运行的前端工程；Go 后端仍按原设计分模块开发。

## Go 后端：当前进度 I0–I6

Go 1.24.1+，Eino 固定为 v0.9.21。在项目根目录运行：

```bash
INKLOOM_MODEL=fake go run ./cmd/inkloom
INKLOOM_MODEL=fake go run ./cmd/inkloom -scenario bad-json-repaired
INKLOOM_MODEL=fake go run ./cmd/inkloom -scenario invalid-quote
go run ./cmd/inkloom -list-scenarios
go vet ./...
go build ./...
```

默认执行 `writer → 双 Critic 并行 → aggregate → 按需分级修订 → 双 Critic 复检`，stdout 输出候选正文、逐轮 patch 和评审历史，stderr 输出节点日志。`bad-json-repaired` 演示一次格式修复；`invalid-quote` 在 Critic 的内容校验阶段失败并以非零状态退出，不输出成功报告。

无配置时使用离线 Fake。I3 支持 DeepSeek 与最小 HTTP / 前端轮询；I5 支持双评审与授权范围内的分级返工；I6 已接 PostgreSQL。HTTP 候选稿按章/分支持续递增版本，CLI 仍每次从 v1 离线演示。准备页的 Go 候选与工作台的 MSW 第 7 章 v3 分开；可靠 SSE 留到 I8。Fake 用量为 0，不代表真实生成成本。

建议按以下顺序读代码：

1. [模型端口](internal/agents/model/model.go)：Go 接口如何隔离模型实现。
2. [正文模型](internal/domain/manuscript/types.go)：Beat、Segment、上下文材料与来源版本。
3. [Writer](internal/agents/writer.go) 和 [Critic](internal/agents/critic.go)：各自构造材料、调用模型、解析输出。
4. [章节图](internal/orchestration/chapter.go)：Eino 节点、边和沿图传递的 ChapterState。
5. [评审规则](internal/domain/review/review.go)：校验引用与版本、去重、按严重度排序。
6. [运行入口](cmd/inkloom/main.go)：把模型、演示材料和图装配起来。

修改 [演示数据](internal/demo/chapter.json) 可以观察正文、引用和评审结果的关系。I0–I3 以编译、静态检查和 CLI 场景验收；I4 增加循环边界、patch 原子校验、指标三组关键测试；I5 增加一组路由、并发与失败保护测试。Eino API 参考其 [官方 Graph 文档](https://www.cloudwego.io/zh/docs/eino/core_modules/chain_and_graph_orchestration/chain_graph_introduction/)。

### I2：模型输出如何变成可信数据

[parse.Generate[T]](internal/agents/parse/generate.go) 由 Writer/Critic 共用：

```text
供应商完成状态 → JSON 解析 → Schema 校验 → Go 响应类型 → 领域校验
                    ↓ 仅语法/包装损坏
                修复一次 → 重新走完整校验；仍失败则停止
```

Schema 与响应类型放在 [contracts](internal/agents/contracts/contracts.go)，约束必填项、类型、枚举、范围和额外字段。使用 [jsonschema 官方库](https://github.com/santhosh-tekuri/jsonschema) 做本地校验，同一份 Schema 随模型请求传出，注入提示词并由本地校验；DeepSeek 的 JSON 模式仅保证 JSON 形式，不替代 Schema 校验。

| 场景参数 | 预期结果 |
| --- | --- |
| `normal` / `no-findings` | 成功；后者必须明确返回 `findings: []` |
| `bad-json-repaired` / `writer-repaired` | Critic / Writer 格式修复一次后成功 |
| `repair-exhausted` | 一次修复后仍无效，报 `invalid_json`，不进行第二次修复 |
| `missing-field` / `invalid-enum` / `invalid-scope` | 报 `invalid_schema`，不靠补造字段修复 |
| `invalid-quote` / `invalid-version` / `repair-invalid-quote` | 报 `invalid_content`，修复后的内容也不能绕过业务校验 |
| `refused` / `truncated` / `empty` | 分别报 `model_refused` / `model_truncated` / `empty_response`，不修复 |

日志 `model.call` 区分 `generate` 与 `repair`。I5 仅初审（`-auto-revise=false`，默认不授权局部重写）调用三次模型：Writer + 两个 Critic；每轮返工另需一个 Reviser 和两个 Critic，共三次。格式修复另外计入调用预算，用量均累加。`errors.As` 提取错误类别，调用方无需匹配错误文本。

本阶段校验 Finding 的引用、稿本版本和修复范围枚举，I4 在此基础上加入 patch 的 oldText、受保护词与执行授权校验。Schema 合法也不等于文学判断正确，真实模型效果与修复内容是否忠实需要 I3 开始的真实样本评估。

### I3：真实模型与前端试运行

复制 `backend.env.example` 为 `.env.backend.local`，在本机填入密钥；该文件已被 Git 忽略。已有环境变量优先于文件配置，密钥不进入前端。

```bash
go run ./cmd/inkloom          # 按本地配置执行一次 Writer → Critic → 聚合
go run ./cmd/inkloom -serve   # 本机 HTTP 服务，127.0.0.1:8080
# 另一个终端
pnpm dev
```

打开 `/prepare`，展开「单段试运行 · Go 后端」，点击生成后轮询结果。`/go-api` 由 Vite 代理到 Go 的 `/api`，其余功能保持现有 MSW 数据。部署前需要同等反向代理或配置 `VITE_GO_API_BASE_URL`。I6 起需先按下节配置 PostgreSQL，结果重启后仍可查询；同一时刻只执行一条，避免误触并发付费。请求中断后可点击「恢复最近一次运行」，通过 `GET /runs/latest` 找回已保存的结果，不会重新调用模型。

学习顺序：

1. [模板渲染](internal/agents/prompts/prompts.go)：`prompts.Bind(guard)` 用同一模型接口包住护栏，每次生成和格式修复都重新渲染。角色边界与 Schema 放 system，任务与转义后的材料放 user；Schema 直接复用契约文件。
2. [DeepSeek 适配器](internal/agents/adapters/deepseek.go)：通过 Eino 调供应商，把响应转换成自己的 Output / Usage。
3. [调用护栏](internal/agents/model/guard.go)：单次 60 秒、整次运行 2 分钟；默认 10 次调用与 24000 token 预算，格式修复和重试均计入。
4. [应用用例](internal/app/chapter.go) 与 [HTTP 外壳](internal/server/server.go)：CLI / 网页调用同一张图；HTTP 立即返回 run_id，执行不依赖浏览器请求一直挂着。

调用前用 UTF-8 字节数加最大输出作保守预算估算，收到 usage 后回填实际值；未知用量保留预留量并标记 `known=false`，不能认为没有费用。仅明确的 HTTP 429/503 最多重试一次，超时不自动重发。`llm_call` 日志记录版本、耗时、用量与结果，不记录密钥、原始请求或隐藏推理。

I3 验收未新增测试文件：沿用 14 个 Fake CLI 场景；本地可控 HTTP 服务验证 429 有限重试、超时、取消、缺失 usage，另检查调用/token 预算耗尽；真实模型及浏览器轮询另行验收。

DeepSeek 使用 `json_object`，字段与引用仍由 I2 管线校验；具体角色边界见 [提示词设计](docs/agent-prompts.md)。模型名可配置，当前默认 `deepseek-flash`。Go 1.24.0 存在 Sonic 链接兼容问题，因此最低要求为 1.24.1，见 [上游说明](https://github.com/bytedance/sonic/issues/771)。

### I4：P2 句级修订与有限返工

```text
Writer → Critic（正文 + 程序统计）→ Aggregate
                                   ├─ 无 P2 → completed（仅语言检查完成）
                                   ├─ 未授权 → waiting_human
                                   ├─ 达返工上限 → escalated
                                   └─ Polisher → 校验并应用 patch → 新版本 → Critic
```

页面的「允许自动微改本次候选稿」决定是否自动应用；默认最多 2 轮，可选 3。CLI 默认授权隔离候选稿，可用 `-auto-revise=false` 关闭。正式稿本与 Bible 均不更新。初审不计返工轮数；一次 Polish 尝试计一轮，JSON 格式修复只占调用预算。

```bash
INKLOOM_MODEL=fake go run ./cmd/inkloom
INKLOOM_MODEL=fake go run ./cmd/inkloom -scenario revise-limit
INKLOOM_MODEL=fake go run ./cmd/inkloom -scenario revise-limit -max-rounds 3
INKLOOM_MODEL=fake go run ./cmd/inkloom -scenario revise-stale
INKLOOM_MODEL=fake go run ./cmd/inkloom -scenario revise-unsafe
INKLOOM_MODEL=fake go run ./cmd/inkloom -auto-revise=false
go test ./...
```

- [条件图](internal/orchestration/chapter.go)：`AddBranch` 决定回到 Polisher 还是结束；`WithMaxRunSteps` 是图执行的额外兜底，业务轮数仍由 state 判断。
- [Patch 规则](internal/domain/revision/patch.go)：基准版本、P2 授权、引文唯一命中（包括重叠命中）、整批范围不重叠、受保护实体/阿拉伯数字/带常见量词的中文数量/否定词检查。只允许替换或删除引文及紧邻必要标点。全批验证成功后才生成新切片并递增版本；失败交人，原稿不变。
- [程序统计](internal/domain/style/metrics.go)：作者明确的禁用短语不能被模型漏报绕过；句长均值、总体方差、burstiness 为未校准提示，不能阻断。句界为句末标点/换行，长度为非空白非标点的 Unicode 字符数。
- [Polisher](internal/agents/polisher.go)：只得到命中问题、对应段和保护词，不收到 Writer 的解释或大纲。输出 Schema 与模板单独版本化。

`POST /api/runs` 新增 `autoRevise`（未传为 false）和生效的 `maxRounds`（2/3）。轮询返回当前节点、候选版本、轮次，以及 `result.revisions/reviews/metrics/stopReason`。本版未复检时不展示旧版评审为通过；预算耗尽、失败也保留最后候选。`waiting_human/escalated` 当前是停止态，续跑与持久化人审留待后续迭代。

默认 Fake 一轮删除套话后到 v2；`revise-limit` 刻意来回换套话，证明第 2 轮失败停在 v3，不启动第 3 轮。当前词级保护不等于语义一致性证明；I5 已补一致性 Critic 复检，但未提供的事实和含蓄因果变化仍可能漏报。

### I5：双 Critic 并行与分级修复

```text
冻结 Context → Writer → [一致性 Critic ∥ AI 味 Critic] → barrier → Aggregate
                              ↑                              ├─ P0 → 当前 Beat 修订
                              │                              ├─ P1 → 当前场景修订
                              └──── 新候选版本 ← 范围校验 ←───┤─ P2 → 句级微改
                                                             └─ 越权/事实裁决 → needs_human
```

按这个顺序读代码：
1. `internal/domain/manuscript/context.go`：深拷贝人物硬特质/knows 与事实来源，固定版本；knows 不被当成全知名单。
2. `internal/agents/consistency.go`：一致性角色只拿正文与事实；`critic.go` 继续只拿正文与语言统计。相同模型通过不同材料与契约扮演独立角色。
3. `internal/orchestration/critics.go`：两个 goroutine 各写一个结果槽，`WaitGroup.Wait()` 是 barrier；任一失败取消同伴并阻断本轮，不能拿另一份通过代替。主协程再统一写 state。
4. `internal/domain/review/route.go`：纯程序按 P0/P1/P2 决定范围，再判断授权；P3 仅提示，明确事实裁决除外。
5. `internal/agents/reviser.go` 与 `internal/domain/revision/scoped.go`：模型提局部重写 patch，程序校验基准版本、目标和全文锚点；应用后返回双 Critic。模型不拥有改设定/存储权限。

```bash
INKLOOM_MODEL=fake go run ./cmd/inkloom -scenario hard-conflict
INKLOOM_MODEL=fake go run ./cmd/inkloom -scenario hard-conflict -allow-local-rewrite
INKLOOM_MODEL=fake go run ./cmd/inkloom -scenario scene-gap -allow-local-rewrite
INKLOOM_MODEL=fake go run ./cmd/inkloom -scenario cross-chapter -allow-local-rewrite
INKLOOM_MODEL=fake go run ./cmd/inkloom -scenario dialogue-lie
INKLOOM_MODEL=fake go run ./cmd/inkloom -scenario handedness
go test -race ./internal/domain/... ./internal/orchestration/...
```

第一条 P0 停在 v1 等作者，第二条在授权内修复到 v2 并双重复检；跨章和台词真伪始终交人。“左撇子”样例仅 P3，不误判为右手功能障碍。`critic-failed/invalid-rule/rewrite-stale/rewrite-unsafe` 分别演示必要评审失败、伪造事实引文、过期和越界 patch。

`POST /api/runs` 新增 `allowLocalRewrite`（默认 false）与 `scenario`（默认 normal，其他场景仅 Fake）。`GET /api/health` 返回可用场景。准备页展开「单段试运行」可选择 Fake 场景、分别授权微改与局部重写，查看双 Critic、路由、证据版本与 diff。返回的 `result.criticReviews` 为本轮独立结果，`reviews` 仅保存收齐并校验后的聚合历史。

I5 使用内置单段，I6 已将候选稿与运行记录落库；双 Critic 是 Eino 的一个并行评审节点，内部 fan-out/barrier，不伪装为四角色全部落地。`needs_human` 是停止态，恢复留到 I7。冻结输入固定本次模型材料，I6 数据库乐观锁另行保护落库版本。局部重写只是候选，模型语义检查仍可能漏报，章末必须人工审核。默认模型调用上限升至 14，覆盖三轮双评审及少量格式修复；token 预算仍为 24000。

### I6：持久化候选稿与乐观并发

先启动本机 PostgreSQL（已验证 17.5），创建专用数据库：

```bash
createdb inkloom_learning
# 在 .env.backend.local 中设置：
# INKLOOM_DATABASE_URL=postgres:///inkloom_learning?host=/tmp
go run ./cmd/inkloom -serve
```

`createdb` 仅首次运行；已有数据库无需重建。使用 TCP/密码连接时按本机实际配置填写 URL。启动自动执行内嵌迁移，已应用文件有校验和；后续变更新增迁移，不能修改已应用版本。CLI 不依赖数据库。

准备页新增「已保存候选稿」、人工编辑、稿本历史和运行历史。重新生成以页面读到的版本为基准，生成新的候选版本；不是接着当前正文续写。人工保存后旧评审失效，事实影响分析与复检流程后续接入。当前只支持内置 `ch7/main`，正文仍是单段学习样例。

按顺序读这四处：

1. [Repository 契约](internal/app/repository.go)：应用层声明需要保存/读取什么，HTTP 与 Agent 不拼 SQL。
2. [最小迁移](internal/storage/postgres/migrations/001_core.sql)：章节版本头、正文快照、段落历史、运行、评审、模型调用。定位字段用列，完整快照用 JSONB；尚未扩展完整 Bible、检索与正式 commit。
3. [版本事务](internal/storage/postgres/drafts.go)：正文快照、段历史、版本号一起成功或一起回滚。写入比较作者打开稿本时的 `draftVersion`，不符返回 `409 version_mismatch`；行锁保证检查到提交之间不被其他事务插入。
4. [执行与存储连接](internal/server/server.go)：节点完成保存进度，模型调用前记 `started`、返回后记 `finished`。迟到的 Agent 写入失败即停止，不覆盖作者稿本。

页面收到 409 保留本地文字，展示远端新稿；作者对照后才能明确保存为下一版。历史正文不可变，评审绑定对应稿本版本。服务重启将未结束运行标为 `interrupted`、未收到结果的调用标为 `unknown`，保留未知用量，**不会自动重发模型请求**。单服务数据库会话锁避免第二个进程误恢复活跃任务。可恢复的人审 checkpoint 属于 I7。

只新增一组真实数据库集成测试，复用本机 PostgreSQL，不引入 testcontainers；显式使用独立测试库，仅清理本测试创建的记录：

```bash
createdb inkloom_i6_test
INKLOOM_TEST_DATABASE_URL='postgres:///inkloom_i6_test?host=/tmp' go test -race ./internal/storage/postgres ./internal/orchestration
```

覆盖同版并发一胜一负、晚到 Agent 拒写、事务回滚、历史保留及重连后的中断标记。另已通过 HTTP 保存/409/历史查询和强制终止服务后重启检查；模型请求发给本地可控服务，不产生真实费用。

## 启动

推荐 Node.js 22+，pnpm 11（当前验证环境 Node 23、pnpm 11.25）。

```bash
pnpm install
pnpm dev
```

打开终端输出的地址，默认 `http://127.0.0.1:5173/workspace`。不需要后端、数据库或模型密钥。MSW Service Worker 已放在 `public/`。

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm test:e2e
```

端到端测试优先使用 macOS 已安装的 Chrome；其他环境先运行 `pnpm exec playwright install chromium`。可用 `PLAYWRIGHT_CHANNEL` 指定已安装浏览器。`pnpm preview` 查看生产构建。

## 如何体验

初始打开《浊流》第七章「夜谈」v3：一处 P0、两处 P1、三处 P2，返工 2/2，一条「左撇子 / 右手持刀」冲突。

- 点正文侧边的 P0/P2 标记，查看证据、生成建议、逐句采纳或放弃。建议生成不会覆盖原文。
- 直接改正文，自动保存候选稿；选中文字可加批注、下指令、埋设伏笔或标记人物误解。
- 展开底部 Agent 工作台，查看编排、节点输入输出和上下文来源。启动后可暂停、继续或快进；下次返工上限可选 2/3。
- 在 Bible 编辑设定，先预览影响，再选择标记待办或传播。到「变更与冲突」保留理由并裁决。
- 「版本与分支」创建独立试写、对照提交、恢复与合并；「全稿与评测」查看样本、统稿和导出。
- 命令面板提供模拟外部保存入口，验证旧审批失效；P0 和未通过的已校准指标会拦截定稿。
- 自动保存遇到版本冲突时保留本地草稿；刷新后并列展示远端正文与本地修改，作者明确确认后才重新保存。

快捷键：`⌘/Ctrl K` 命令面板，`⌘/Ctrl B` 系统信念，`⌘/Ctrl Enter` 接受当前候选，`Esc` 关闭浮层/退出专注，工作台问题列表中 `j/k` 或方向键定位。演示修改保存在浏览器 localStorage；命令面板中的「恢复《浊流》演示数据」可回到初始状态。

## 工程结构

```text
src/
  app/                    Provider、路由、顶栏、导航、布局、运行订阅
  styles/                 CSS Variables、Tailwind、全局样式
  shared/
    api/                  REST client、SSE client、缓存键、请求 hooks
    ui/                   Radix 组件、设计系统、懒加载图表
    lib/                  UI store、中文文案、diff、门禁和 SSE 解析
  types/domain/           领域模型、写请求契约
  mocks/
    data/                 小说数据、分支快照、仓储与版本规则
    handlers.ts           REST 资源接口
    runs.ts               流式运行计划、事件、暂停与恢复
    browser.ts / node.ts  浏览器与测试环境入口
  features/
    prepare/              创作准备、锁定、建议与导入
    workspace/            TipTap、虚拟分段、自动保存、批注、内联 diff
    bible/                六类系统信念与影响预览
    orchestration/        React Flow、节点检查、ContextManifest
    review/               人工审批、门禁、旧版本失效
    changes/              影响传播与事实冲突裁决
    versions/             提交、试写、恢复、三方合并
    reports/              ECharts、实验、回归、统稿、导出
  test/                   REST/SSE 与编辑器回归测试
e2e/                      作者工作流浏览器测试
```

应用层组合业务模块；各 feature 不导入其他 feature 内部组件。服务端数据只进 TanStack Query，面板和选中状态进 Zustand。正文使用 TipTap Segment 节点及独立标记；超过 30 段使用虚拟滚动，保留焦点段与未保存草稿。

## 接入 Go

复制 `.env.example` 为 `.env.local`，设置：

```dotenv
VITE_ENABLE_MOCK=false
VITE_API_BASE_URL=http://127.0.0.1:8080/api
```

实现 [REST / SSE 契约](docs/frontend-api.md)，鉴权统一加入 `src/shared/api/client.ts` 的 `apiHeaders()`。SSE 复用同一鉴权头，通过 fetch 流读取，支持事件 ID 去重及重连。后端需允许对应源的 CORS 与 `Last-Event-ID` 请求头，或使用同源反向代理。

所有资源 ID、branchId、chapterId 和版本字段必须保持契约。409 返回 `{code,message,currentVersion}`；候选、审批和传播均须核验原始 draftVersion。浏览器门禁只是交互提示，Go 必须重新执行门禁和并发校验。

Mock 是确定性的业务模拟器：审稿结论、生成文案与实验数据是演示材料，并未接入真实 LLM。它用于学习前端工作流、演示权限边界和验证协议；真实检索、模型质量、成本统计与持久化由 Go 后端实现。

## 文档

前端：
- [前端技术决策](docs/frontend-architecture.md)
- [前端 API 契约](docs/frontend-api.md)（后端实现接口照此，字段与版本语义不得偏离）

后端（当前只做 M1）：
- **用什么建（框架）**：[后端整体框架设计](docs/backend-architecture.md) — Go + Eino + Postgres/pgvector，模块化单体、Run 引擎、分层与基础设施。
- **按什么顺序建（流程）**：[后端建设思路与增量计划](docs/backend-build-plan.md) — 评测驱动的垂直薄切片，M1 单章闭环 I0–I9。
- **整个流程怎么跑（编排）**：[Agent 编排与开发详解](docs/agent-orchestration.md) — 两层编排、每个 Agent 职责与交互、状态图/结构化输出/上下文工程/评审修订/人审/评测技术。
- **各角色提示词（I3 参考）**：[Agent 提示词设计](docs/agent-prompts.md) — 四段式外壳、上下文隔离矩阵、Writer/Critic/Polisher 可落地模板与输出契约、温度与版本纪律、代码组织。
- 实现接口对照：[前端 API 契约](docs/frontend-api.md)（REST/SSE，字段与版本语义不得偏离）。

里程碑：M1 单章闭环 → M2 跨章记忆 → M3 人机共创与变更传播 → M4 评测与成本 → M5 统稿打磨。
