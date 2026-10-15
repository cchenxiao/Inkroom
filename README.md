# 墨枢 Inkloom

面向作者的多智能体中短篇小说协作工作台。稿件是主界面，AI 提交候选，作者决定方向与定稿。当前仓库已包含可运行的前端工程；Go 后端仍按原设计分模块开发。

## Go 后端：当前进度 I0–I7

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

无配置时使用离线 Fake。I3 支持 DeepSeek 与最小 HTTP / 前端轮询；I5 支持双评审与授权范围内的分级返工；I6 已接 PostgreSQL。HTTP 候选稿按章/分支持续递增版本，CLI 仍每次从 v1 离线演示。准备页的 Go 候选与工作台的 MSW 第 7 章 v3 分开；I7 已支持持久化人审与恢复，可靠 SSE 留到 I8。Fake 用量为 0，不代表真实生成成本。

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

打开 `/prepare`，展开「单段试运行 · Go 后端」，点击生成后通过 SSE 查看实时进度。`/go-api` 由 Vite 代理到 Go 的 `/api`，其余功能保持现有 MSW 数据。部署前需要同等反向代理或配置 `VITE_GO_API_BASE_URL`。I6 起需先按下节配置 PostgreSQL，结果重启后仍可查询；同一时刻只执行一条，避免误触并发付费。请求中断后可点击「恢复最近一次运行」，通过 `GET /runs/latest` 找回已保存的结果，不会重新调用模型。

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

准备页新增「已保存候选稿」、人工编辑、稿本历史和运行历史。重新生成以页面读到的版本为基准，生成新的候选版本；不是接着当前正文续写。独立人工保存后旧评审失效；I7 人审卡另提供「直改并复检」，沿同一运行恢复。事实影响分析后续接入。当前只支持内置 `ch7/main`，正文仍是单段学习样例。

按顺序读这四处：

1. [Repository 契约](internal/app/repository.go)：应用层声明需要保存/读取什么，HTTP 与 Agent 不拼 SQL。
2. [最小迁移](internal/storage/postgres/migrations/001_core.sql)：章节版本头、正文快照、段落历史、运行、评审、模型调用。定位字段用列，完整快照用 JSONB；尚未扩展完整 Bible、检索与正式 commit。
3. [版本事务](internal/storage/postgres/drafts.go)：正文快照、段历史、版本号一起成功或一起回滚。写入比较作者打开稿本时的 `draftVersion`，不符返回 `409 version_mismatch`；行锁保证检查到提交之间不被其他事务插入。
4. [执行与存储连接](internal/server/server.go)：节点完成保存进度，模型调用前记 `started`、返回后记 `finished`。迟到的 Agent 写入失败即停止，不覆盖作者稿本。

页面收到 409 保留本地文字，展示远端新稿；作者对照后才能明确保存为下一版。历史正文不可变，评审绑定对应稿本版本。服务重启将未结束运行标为 `interrupted`、未收到结果的调用标为 `unknown`，保留未知用量，**不会自动重发模型请求**。单服务数据库会话锁避免第二个进程误恢复活跃任务。I7 在此基础上增加可恢复的人审 checkpoint。

只新增一组真实数据库集成测试，复用本机 PostgreSQL，不引入 testcontainers；显式使用独立测试库，仅清理本测试创建的记录：

```bash
createdb inkloom_i6_test
INKLOOM_TEST_DATABASE_URL='postgres:///inkloom_i6_test?host=/tmp' go test -race ./internal/storage/postgres ./internal/orchestration
```

覆盖同版并发一胜一负、晚到 Agent 拒写、事务回滚、历史保留及重连后的中断标记。另已通过 HTTP 保存/409/历史查询和强制终止服务后重启检查；模型请求发给本地可控服务，不产生真实费用。

### I7：人工审核、检查点与幂等恢复

HTTP 自动创作结束后进入 `HumanGate`，等待作者时不占执行 goroutine 或模型请求。准备页支持：

- **批准当前候选**：必须是当前版本、两个必要 Critic 已完成且没有阻断问题/待裁定事实。批准不增加稿本版本，也不调用模型；正式章节 commit 留给 I9。
- **提出局部修改要求**：针对已有且范围明确的问题做一次修订，再双 Critic 复检，返回人审；不重跑 Writer。仍受原返工轮数和整次运行预算限制，不能通过恢复绕过上限。
- **直改并复检**：作者直接修改该段，保存新版本后复检。上方独立编辑入口仍会作废旧 run；要沿运行继续就用人审卡。

```text
自动创作图 → HumanGate（checkpoint + 等待状态）
                  ↓ 作者操作，检查 draftVersion + 操作 ID
               apply → recheck → HumanGate
                  └─ approve → approved（候选批准）
```

按顺序读：
1. [human.go 编排](internal/orchestration/human.go)：`StatefulInterrupt` 保存门禁局部状态；重新 `Invoke` 同一 checkpoint ID，从保存的位置继续。本图只有一个人审点，采用 Eino 的 implicit resume；以后多个门禁要改为显式指定 interrupt ID。[Eino 官方说明](https://www.cloudwego.io/zh/docs/eino/core_modules/chain_and_graph_orchestration/checkpoint_interrupt/)。
2. [人审仓储](internal/storage/postgres/human.go)：`run_actions` 保存稳定操作 ID；`run_artifacts` 保存 apply/recheck 产物，和正文版本同事务写入；`run_checkpoints` 保存 Eino 执行位置，并与等待状态/操作完成回执同事务提交。
3. [应用装配](internal/app/human.go)：模型调用编号、已知用量、未知用量预留从数据库恢复。恢复只是重新获得执行资源，不是预算清零。

**检查点和幂等解决不同问题**：检查点记执行位置，产物记录防止重做。若稿本已经保存、但检查点保存失败，再次受理同一操作时先读产物，跳过已完成的修改/复检，不重复增加版本。模型返回却还未落库时，仍可能需要重新请求；页面要求作者明确继续，未知用量继续占预算，不宣称外部模型调用恰好一次。

服务重启后，已等待的人审仍可审核；执行中的人审操作变为 `interrupted`，作者点击「继续已受理操作」。初稿生成阶段尚无 HumanGate checkpoint 的中断保留 I6 行为，只保留已落库候选。I6 旧运行不会自动补造检查点。图/序列化契约固定为 `human.v1`，不匹配的检查点拒绝恢复。

本轮新增一组 PG 工作流回归，以及一条 Fake 恢复不遗忘旧问题的回归：等待后重连、门禁拦截、指令修订、直改复检、相同操作去重、同 ID 不同内容拒绝、旧版本审批拒绝、预算延续，以及“产物已落库但 checkpoint 失败”的故障恢复。另以 HTTP 验证真实进程强杀/重启；前端继续使用轮询，SSE 在 I8。

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

### I8：可靠事件与实时进度

```text
业务事务：稿本 / 评审 / run + run_events + run_outbox 一起提交
                                    ↓
                  dispatcher → 有界 Hub → SSE → React Query / React Flow
                                    ↑
                     Last-Event-ID 从 PostgreSQL 补齐历史
```

按顺序读：
1. [事务事件](internal/storage/postgres/events.go)：每个 run 的序号在行锁内递增。快照和游标同一次读取，失败事务不会留下“幽灵进度”。`run_events` 只追加，投递任务独立存放。
2. [投递器与 Hub](internal/events)：投递成功再移除 outbox 任务，崩溃可能重复；每个连接最多缓存 64 个唤醒通知，溢出断开，不能拖慢 Agent。
3. [SSE 接口](internal/server/events.go)：先订阅、再读历史，避免交接缺口；按数据库序号发送，10 秒心跳、每次写入限时 5 秒。断线不取消创作。
4. [前端消费](src/features/prepare/hooks/useBackendEvents.ts)：只重连 GET；事件去重，旧 REST 快照不能回退新状态，游标过期重新取快照。首个查询未完成时先取消再刷新，避免漏掉最后一次更新。

准备页保存选中的 run，刷新后重取快照并续接 SSE；图上只有当前已实现的两个 Critic。节点进度、并行角色、修订回边、问题和调用记录均来自真实接口。此阶段模型仍返回完整 JSON，未实现逐 token 正文流，不伪造 `draft.delta`。

事件默认全部保留；维护方法 `PruneEvents` 只能裁掉已投递前缀，过期游标返回 410。当前单段使用完整 Run 快照，便于学习和恢复；扩展长篇时再压缩事件体并配置保留周期。

```bash
curl -N http://127.0.0.1:8080/api/runs/RUN_ID/events
# 断开后，替换为最后收到的 id（包含 run_id 和序号）
curl -N -H 'Last-Event-ID: RUN_ID:12' http://127.0.0.1:8080/api/runs/RUN_ID/events
```

### I9：上下文清单与定稿冻结

学习入口：
1. [Assembler](internal/contextassembly/assembler.go)：先装锁定 Beat、活跃人物、事实、风格和已确认上章结尾，生成来源版本 / 内容摘要 / 预算 / 排除原因。必需材料超限直接拒绝，绝不悄悄删约束。
2. [冻结输入](internal/storage/postgres/context.go)：启动事务把输入存入 `run_contexts`；执行、恢复、定稿都核对这份材料。旧运行没有清单时不能从当前配置补造。
3. [定稿事务](internal/storage/postgres/commits.go)：锁定章与 run，重查当前版本、已完成作者审批、两个必要评审、事实门禁及输入摘要；一次写入 `manuscript_commits`、`commit_refs`、run 终态与 outbox。失败全回滚，同一 ID 重试只返回原提交。

准备页流程：生成 → 双 Critic / 有限返工 → 作者批准 → 核对并确认无待同步事实 →「定稿本次试运行稿」。可以展开上下文清单与只读定稿历史；定稿后继续修改会形成新候选，已冻结正文不变。

当前范围仍为 `ch7/main` 的单段学习切片，未将 Mock 工作台整章切到真实后端。前章结尾是明确标注的已确认教学种子；M2 再从指定 commit 检索。事实自动抽取与 Bible 同步尚未实现，必须由作者确认没有待处理的新事实；已有待裁定 Finding 仍阻断，不能用勾选绕过。旧 run 需重新启动并审核后才可定稿。

`INKLOOM_CONTEXT_TOKENS` 默认 8000；采用输入 JSON 的 UTF-8 字节数保守估计，只计材料，不是供应商精确 token。模型输出另预留，调用护栏仍检查提示词、材料和输出的整体预算。

### I10a：先决定哪些旧材料能给角色看

这一小步只做 I10 的前置筛选规则，尚未接搜索、向量模型、pgvector 或 Agent 工具调用，也没有改动现有 Writer 输入。用独立教学记录演示，不把它们当作《浊流》正式设定；无需数据库或模型密钥。

```bash
go run ./cmd/inkloom -context-preview
go run ./cmd/inkloom -context-preview -pov character-luqing
```

第一条以第 7 章沈砚视角输出 2 条可用材料；第二条切换为陆青，增加她已知、沈砚尚未知的藏信事实。作者未来规划单独列出；其他分支、未确认内容、未来章节、未来故事时间及过期版本均被挡住，排除解释不携带秘密原文。听到一句谎言只意味着“听过这句话”，台词片段仍是 `passage`，不会变成世界事实 `fact`。

顺着这三处读代码：

1. [数据结构](internal/domain/memory/types.go)：`Record` 表示一个可独立授权的片段，`At` 是来源的章节/故事时间，`KnownBy.Since` 是角色获知时点；`View` 是当前写作范围。故事时间采用项目统一刻度，演示用分钟。缺失的获知记录按不可用处理，不能据此断言角色在故事里一定不知道。
2. [筛选规则](internal/domain/memory/visibility.go)：`Select` 是纯函数，依次检查项目/分支 → 确认状态 → 固定版本与摘要 → 章节/故事时间 → 当前角色获知时点。摘要覆盖正文及可见性元数据。返回角色材料、作者规划和排除原因三个独立区域；只筛选，不评价相关性。
3. [教学入口](internal/demo/memory.go)：先从可信种子建立固定版本目录，再模拟搜索返回旧版材料。真实接入时 Pin 必须来自已固定的来源目录，不能拿搜索结果自己生成摘要、自己证明有效。

**I10b 接入方式见下节**：从数据库读固定版本的旧稿，候选材料先经过上述规则，再执行关键词与向量搜索、确定性重排和装配。工具调用仍在 I11。当前规则依赖可靠的人工/系统元数据，不会自动理解段落里谁知道什么；一个片段混有不同知情范围时，必须先拆分或保守排除整段。

### I10b：数据库检索已接入 Writer

I10 建立的检索链路（I11 起由装配助手按需调用）：**读取固定版本目录 → 按角色过滤 → 关键词/向量双通道召回 → 融合与重排 → 按预算装入上下文 → 保存输入 → Writer**。恢复旧 run 仍读取原快照，不重新搜索。前端上下文清单区分“固定读取”“关键词检索”“智谱混合检索”，并明确标注教学来源。检索事实可供一致性 Critic 核对，原文/台词仍保留 `passage` 类型，不自动当作事实。

学习顺序：

1. [来源仓储](internal/storage/postgres/memory.go)：`memory_records` 保存不可变正文和知情元数据，`memory_heads` 指定当前可用版本。真实来源必须来自已定稿 commit 的原段落；更晚定稿存在时，不再召回旧定稿。修改索引不会改动已冻结的运行输入。
2. [搜索用例](internal/retrieval/service.go)：先复用 I10a 的过滤，再把可用材料送给向量模型；缓存命中后仅为新查询计算向量。中文关键词使用相邻双字；两个通道按名次融合（RRF），再按少量词面覆盖度重排。当前是确定性重排，未接另一个 LLM 或 cross-encoder。
3. [智谱适配器](internal/embedding/zhipu.go)：独立 `Embedder` 接口，固定智谱官方地址；批量请求按 `index` 还原顺序，检查维度、重复条目、零向量和异常值。默认 `embedding-3` / 1024 维。密钥仅放忽略的 `.env.backend.local`。
4. [上下文装配](internal/contextassembly/assembler.go)：相关前情是可裁剪材料，不能挤掉 Beat/硬约束/前章结尾。清单记录实际采用的版本、来源、检索方法和未纳入原因。旧 `assembler.v1` 快照仍可读取，新输入是 `assembler.v2`。

PostgreSQL 需先安装 [pgvector](https://github.com/pgvector/pgvector)，迁移 005 会在应用数据库启用扩展；本机已针对 PostgreSQL 17 编译安装。当前用精确向量扫描，未建近似索引。单次最多读取 1024 条当前来源，向量模式最多处理 128 条可见片段；超过则明确报错。I17 再处理异步索引任务。长片段当前需先拆分（智谱适配器采用每条 3000 UTF-8 字节保守上限），不会悄悄截断内容。

配置 `INKLOOM_EMBEDDER=zhipu` 后启用真实语义搜索；`none` 只做关键词搜索，`fake` 是无语义理解的离线流程验证。接口依据 [智谱文本嵌入文档](https://docs.bigmodel.cn/api-reference/模型-api/文本嵌入)。向量缓存按材料完整摘要、供应商/模型、维度和显式 revision 隔离。向量调用费用目前未合并到已有正文模型的 Run 用量栏。

已有服务占用数据库时，CLI 会拒绝并行打开，避免误恢复活动运行。以下教学命令使用独立测试库，先确保该库没有运行中的服务：

```bash
export INKLOOM_DATABASE_URL='postgres:///inkloom_i6_test?host=/tmp'
export INKLOOM_MODEL=fake
export INKLOOM_EMBEDDER=zhipu # 仅搜索使用智谱；不调用正文模型

go run ./cmd/inkloom -memory-seed
go run ./cmd/inkloom -memory-search '父亲衣物上缺少的纽子'
go run ./cmd/inkloom -memory-eval
```

`-memory-seed` 是显式教学数据导入，服务启动不自动导入。评测报告是三个教学样本的 Recall@1 和越界命中数，只是功能探针，不代表全书语义检索质量。主数据库没有可用旧稿时返回空结果，不伪装成完成了全书检索。

真实定稿材料使用 `-memory-import /absolute/path/publication.json` 发布，JSON 示例（替换提交与段落 ID）：

```json
{
  "commitId": "已有定稿提交 ID",
  "expectedVersion": 0,
  "record": {
    "projectId": "zhuoliu", "branchId": "main", "version": 1,
    "kind": "passage", "status": "confirmed", "chapterId": "ch2",
    "segmentId": "该提交中的段落 ID",
    "at": {"chapter": 2, "storyTime": 120},
    "knownBy": [{"characterId": "character-shenyan", "since": {"chapter": 3, "storyTime": 180}}]
  }
}
```

作者明确填写片段的时间和获知范围；`text` 可省略，后端从冻结提交复制原文。若提供的文本与定稿不一致，或试图将原文发布为 `fact`，请求会被拒绝。整段混有不同知情范围时应先在正文中拆分；没有知情元数据的材料不会默认开放。当前尚无自动知识抽取/发布 UI，也没有把 Mock 工作台变成真实章节库；HTTP 写作位置仍固定为 ch7/main/沈砚，整本书编排在后续扩展。


### I11a：装配助手按需调用检索工具

现在 `POST /api/runs` 先保存基础输入与运行，立即返回 202；后台执行 **装配助手判断 → 请求 search_memory → Go 校验并执行 → 工具结果交回模型 → 决定继续查询或结束 → 冻结最终上下文 → Writer**。DeepSeek 使用原生 `tool_calls`，智谱只做检索中的向量计算。材料充分时可以零查询直接结束；`ready` 是装配助手的业务判断，不是正确性证明，也不能绕过版本、预算或可见性校验。

按下面顺序读代码：

1. [模型端口](internal/agents/model/tools.go)与[DeepSeek 适配器](internal/agents/adapters/deepseek.go)：工具说明、assistant 工具请求、带 `tool_call_id` 的工具结果如何传递；协议参考 [DeepSeek Tool Calls](https://api-docs.deepseek.com/guides/tool_calls/)。普通写作仍用 JSON 模式，工具对话用原生协议。
2. [有界查询循环](internal/contextlookup/lookup.go)：只允许 `search_memory({query})`，项目/分支/时间/角色由 Go 固定；每次一个调用，最多 3 次工具请求、4 次模型决策。非法参数、重复查询、重复调用 ID、两次连续没有新来源或超限会停止，未 ready 不启动 Writer。结束输出仅为 `{"decision":"ready"}` 或 `{"decision":"insufficient"}`。
3. [来源目录快照](internal/retrieval/session.go)：一轮准备中的多次查询复用同一版本目录；每次仍先执行 I10 可见性过滤。模型拿到的是来源原文与版本，不能通过总结输出补造事实；最终按首次命中顺序去重并受材料预算裁剪。
4. [准备事务](internal/storage/postgres/preparation.go)：迁移 006 增加 `run_preparations` 保存基础输入；最终材料独立写入 `run_contexts`。封存前核对作者稿本版本，不覆盖既有快照。工具轨迹与 SSE 事件同事务；准备阶段重启标记中断，不自动重复调用。
5. [用例接入](internal/app/lookup.go)：复用 Guard，工具 schema 和历史消息计入预算估计；Writer 与人审继续使用已落库调用历史，编号和预算不重置。页面“装配查询记录”展示查询、新增来源、版本与停止原因。

I11a 负责装配；一致性 Critic 自主查证见下方 I11b。章内 CLI 演示仍使用固定输入；HTTP 才执行后台查询准备。工具请求失败不静默改成“无问题”，检索空结果不是事实不存在的证明；向量调用用量仍未合并到 Chat 用量栏。


### I11b：一致性 Critic 自主查证

与装配助手不同，Critic 拿到的是本轮正文和明确事实。它可直接给出评审，也可先请求 `search_memory`，最多 3 次查询 / 4 次模型决策，最后输出 `findings`；明确缺证无法判断时输出 `decision=insufficient` 并停止。两种角色复用同一个有界循环；模型决定查什么，Go 决定能否执行。工具模式最终 JSON/Schema/证据校验失败即停止本轮，不额外调用格式修复；失败不算通过。

学习顺序：

1. [Critic 工具入口](internal/agents/consistency_tools.go)与[提示词 v2](internal/agents/prompts/hard_consistency.v2.tmpl)：冷读当前稿本，不接 Writer 历史、大纲和 AI 味结论；查询结果仍是只读数据。
2. [证据边界](internal/domain/manuscript/evidence.go)：检索结果再次验证范围，已冻结同 ID 来源不能换版本/内容；只有 `fact` 可作硬规则，`passage` 只作原文。额外证据用于评审与授权修订，不修改 `run_contexts` 或 Bible。
3. [用例与恢复](internal/app/consistency_lookup.go)：每轮固定来源目录，复用整条 run 的 Guard 预算。已完成且正文/基础材料摘要相符的查证可复用；未完成查证只能在作者显式恢复时重试，仍受累计预算限制。
4. [证据事务](internal/storage/postgres/critic_lookup.go)：迁移 007 增加 `critic_lookups`，按 run + draftVersion 保存工具轨迹、原文和结论；与 `critic.lookup` SSE 同事务。作者改稿后拒绝迟到查证，定稿额外冻结各轮查证引用。

准备页的后端试运行面板新增“一致性查证记录”，按稿本版本展示查询、来源和结果；点击来源可读原文并区分事实/片段。零查询显示“模型判断已有材料足够”。本阶段 HTTP 的自动评审和人改复检启用工具，CLI 仍保留固定输入的学习演示。总调用预算不增加；多次查证可能提前耗尽预算并停止/上报人工。向量成本暂未并入聊天用量；查证能力仍需真实故事集评测。

本次真实验证需分开看：明确要求查证的协议样本完成一次 DeepSeek 工具调用、智谱检索和 P0 输出的结构校验（I11c 复查发现原证据“锁还在”不足以证明“锁完好”，因此不作为语义正确的证据）；自主评审样本仍出现应查前文却直接返回空清单的情况。另一个无效引用被程序拦截。因此 I11b 已接通机制，尚不能把“零问题/零查询”当作可靠查证证明；下一轮应优先补少量缺证场景评测再调整策略。


### I11c：用固定样本评测 Critic

本步学习 **Agent 评测**：预先写下期望行为，调用真实 Agent，再用程序检查“该不该查、结论和证据是否正确”，而不是只看接口有没有报错。

- 样本：[critic_cases.json](internal/evaluation/critic_cases.json)，期望标签只给评分器；真实模型只收到正文、设定及工具返回。
- 执行与评分：[critic.go](internal/evaluation/critic.go)，复用生产 Critic、工具循环、预算与关键词检索。内存教学语料隔离数据库和向量检索，固定 5 个样本。
- 入口：[critic_eval.go](cmd/inkloom/critic_eval.go)，JSON 写标准输出，摘要写标准错误；任一样本失败或执行中断，进程返回非零。报告保留模型、提示词/Schema/数据集版本与摘要、查询轨迹和用量；中断也保留全部计划样本数。

```bash
# 离线：只验证管线与评分器，不证明模型能力
INKLOOM_MODEL=fake INKLOOM_EMBEDDER=none go run ./cmd/inkloom -critic-eval

# 真实对照：读取本地配置的 DeepSeek；会产生模型费用
INKLOOM_MODEL=deepseek INKLOOM_EMBEDDER=none go run ./cmd/inkloom -critic-eval > /tmp/critic-current.json
INKLOOM_MODEL=deepseek INKLOOM_EMBEDDER=none go run ./cmd/inkloom -critic-eval -critic-eval-candidate > /tmp/critic-candidate.json
```

每样本最多 4 次模型调用、3 次工具请求；token/单次超时沿用配置，全部评测最多 3 分钟。`-critic-eval-candidate` 仅影响本次评测，不能与服务模式组合，正式链路继续使用 v2。

2026-10-15，DeepSeek `deepseek-flash` 对照结果（每版各跑两次，汇总结果相同）：

| 固定教学样本 | 正式 v2 | 实验 v3 |
| --- | --- | --- |
| 现有事实已足够 | 通过 | 通过 |
| 前文断言缺证、来源可查 | 未查询，失败 | 未查询，失败 |
| 前文断言缺证、来源不存在 | 未查询，失败 | 未查询，失败 |
| 角色台词可能撒谎，应交作者 | 失败 | P3、不确定、交作者，通过 |
| 普通新细节 | 通过 | 通过 |
| 通过数 | 2/5 | 3/5 |

第二次原始报告：[v2](docs/evaluations/2026-10-15-critic-current.json)、[v3](docs/evaluations/2026-10-15-critic-candidate.json)。对应输入/输出 tokens 为 10386/30、10086/710。报告保存后评分器进一步拒绝额外误报及把台词真伪标成确定事实；复核这些输出的判定不变。新报告另含 attempted 与顶层 error，旧报告保留原貌。

v3 调整了台词与缺证判断的提示顺序，但没有解决自主漏查，**不替换正式提示词**。五个样本不是校准准确率；Fake 的 5/5 仅证明管线可运行。教学证据专门写明“铁锁完好，没有断裂”，不把旧素材“锁还在”推断成“锁完好”。

已知问题 **I11-K1**：自主漏查暂缓优化，不阻塞 I12。缺证样本把“第三章”写进人物回忆，混淆叙事与来源定位；上述分数只描述人工样本，不能代表实际创作质量。原始样本/报告保留追溯，不再围绕其文案调提示词，也不继续实现显式查证计划。后续以自然故事文本和独立章节元数据重新评估。


### I12a：时间线、伏笔与人物知情建模

本步先建立 Go 领域模型与可运行的离线预览；还没有写入数据库、接入现有 Writer/查证工具或替换网页的 Mock Bible。使用独立教学快照，不把它当成正式作品设定。

```bash
# 同一时点：沈砚只拿到铜扣事实，陆青拿到铜扣、藏信、点灯三条事实
go run ./cmd/inkloom -knowledge-preview
go run ./cmd/inkloom -knowledge-preview -pov character-luqing

# 章节到了，故事时间未到，仍不能提前获知藏信
go run ./cmd/inkloom -knowledge-preview -chapter 8 -story-time 420
# 两个时点都到达后，沈砚可以拿到藏信事实
go run ./cmd/inkloom -knowledge-preview -chapter 8 -story-time 480
```

这里的章节编号只放在来源定位中；事实文本与人物认知不含“我记得第三章”之类的叙述。

建议顺序阅读：

1. [types.go](internal/domain/knowledge/types.go)：`Fact.Source` 记录事实出处；`InfoState.Source` 记录谁在何时获知。读者是单独主体，`belief` 是人物理解，不能转成世界事实。`TimelineEvent.causalBefore` 指向必须后发生的事件；`Foreshadow` 分开保存埋设、计划、实际回收依据。
2. [validate.go](internal/domain/knowledge/validate.go)：程序检查引用、重复状态、因果环、时间倒置和回收依据。这里只验证显式数据自洽，不判断自然语言真假。
3. [projection.go](internal/domain/knowledge/projection.go)：`Project` 将可信快照的已知事实转换成现有 `memory.Record`，复用 I10 的项目/分支、来源版本、章节、故事时间与 POV 过滤。返回值不包含作者计划、读者知识或误解文本。
4. [knowledge.json](internal/demo/knowledge.json) → [knowledge_preview.go](cmd/inkloom/knowledge_preview.go)：先看输入，再看预览如何分开输出角色材料、作者时间线、信息差矩阵与伏笔台账。整个过程不加载密钥、不调用模型。

**边界**：这版是一份快照中每个“主体—事实”一条知情记录，尚不保存误解纠正、遗忘等多次状态变化。伏笔台账展示快照状态，不按预览时点恢复历史；逾期按章节计算，绝不自动回收。回收可通过倒叙完成，因此叙事位置不能早于埋设，但不要求回收场景的故事时间晚于埋设。现有保守可见性规则仍同时要求来源章节与故事时间到达，尚未处理全知叙述等模式。

后续 I12b 再把已确认的知识快照持久化、固定版本与摘要，并接入装配/检索；人物的误解若要进入写作材料，需要独立类型和明确提示边界，不混进 facts。


### I12b：知识快照持久化与检索接入

新增迁移 `008_knowledge.sql`：`knowledge_snapshots` 保存不可变的完整作者台账，`knowledge_heads` 指向项目/分支当前版本。发布时用乐观版本检查，在一个事务内保存快照、替换对应事实的检索目录、更新 head；撤下的事实离开当前目录，旧记录仍供历史运行追溯。重复相同发布不会产生新版本，旧版本不能覆盖新 head。

只有 `known` 的角色获知记录随事实投影，查询前继续执行 I10 的可见性过滤；读者所知、误解、时间线摘要、伏笔计划不进入事实文本。投影记录使用 `knowledge/` 命名空间，其版本等于整个知识快照版本，`record.knowledge` 带原快照摘要。这样即使正文事实没变、只改了获知时点，来源版本也会更新。

**如何使用**（下列数据库命令读取本地配置；服务持有数据库独占锁，执行发布命令前需停止对应服务。建议使用独立学习数据库，不要把教学来源混进正式设定）：

```bash
# 显式导入教学快照；启动服务不会自动执行
INKLOOM_MODEL=fake INKLOOM_EMBEDDER=none go run ./cmd/inkloom -knowledge-seed
# 查看当前/指定历史版本（当前教学范围 zhuoliu/main）
go run ./cmd/inkloom -knowledge-show
go run ./cmd/inkloom -knowledge-show -knowledge-version 1
# 作者确认后导入 JSON，不自动调用模型或 embedding
go run ./cmd/inkloom -knowledge-import /absolute/path/publication.json
```

导入文件是一个对象：`expectedVersion`（首次 0）、`confirmFacts: true`、`reason` 和完整 `snapshot`。snapshot 结构见 `internal/demo/knowledge.json`，新版本必须是 expectedVersion + 1；这是作者对事实及获知来源的显式确认，不是自动判断正文真假。读写入口分别为 [knowledge.go](cmd/inkloom/knowledge.go)、[仓储事务](internal/storage/postgres/knowledge.go)。目前尚无网页编辑/变更影响预览，作者正式设定的修改仍需自行核对影响；这里不会传播改写正文。

服务运行时可 `GET /api/knowledge` 或 `GET /api/knowledge?version=1` 查看作者快照；未发布返回 404。这个接口不是 Agent 工具，完整台账不能交给 Writer。既有 `GET /api/memory/search?q=铜扣`、装配助手和 Critic 查询自动使用新目录；ContextManifest 的命中项显示“知识快照 vN”，定稿引用保留投影记录与快照摘要。

**固定范围**：每次查询阶段开始时由 `retrieval.Session` 固定目录；采用的命中再冻结进运行输入。若模型不查询或未命中，知识事实不会自动加入 Writer（I11-K1 继续暂缓）。新的查证阶段可能读取较新目录，但不能覆盖 Writer 已冻结输入；同 ID 的冲突由现有证据校验阻断。I12b 不替换原先教学 Beat/人物卡/必需事实，也不把所有知识无条件灌入模型。整份知识快照持久化，当前只有事实与知情范围接入检索；时间线、伏笔的专项审查与网页编辑仍待后续小步建设。

验证使用独立测试库：确认要求、重复发布、版本冲突、撤下事实、事务回滚、旧查询目录稳定、向量调用前过滤、上下文清单与 Fake Writer 均已检查；未调用真实模型，未向主数据库导入教学知识。

待加固的小项：008 的 SQL JSON 来源约束未完全排除 NULL；现有 Go 发布路径始终填入并校验版本/摘要，正常入口不受影响。后续用新增迁移收紧该约束，避免维护脚本绕过应用时写入不完整来源。
