# 墨枢 Inkloom

面向作者的多智能体中短篇小说协作工作台。稿件是主界面，AI 提交候选，作者决定方向与定稿。当前仓库已包含可运行的前端工程；Go 后端仍按原设计分模块开发。

## Go 后端：当前进度 I0–I3

Go 1.24.1+，Eino 固定为 v0.9.21。在项目根目录运行：

```bash
INKLOOM_MODEL=fake go run ./cmd/inkloom
INKLOOM_MODEL=fake go run ./cmd/inkloom -scenario bad-json-repaired
INKLOOM_MODEL=fake go run ./cmd/inkloom -scenario invalid-quote
go run ./cmd/inkloom -list-scenarios
go vet ./...
go build ./...
```

默认执行 `writer → critic → aggregate`，stdout 输出候选正文和一条 P2 问题，stderr 输出节点日志。`bad-json-repaired` 演示一次格式修复；`invalid-quote` 在 Critic 的内容校验阶段失败并以非零状态退出，不输出成功报告。

无配置时使用离线 Fake。I3 支持 DeepSeek 与最小 HTTP / 前端轮询；尚未接数据库、自动返工或可靠 SSE。每次运行新建隔离的单段候选 v1，不更新工作台第 7 章 v3。Fake 用量为 0，不代表真实生成成本。

建议按以下顺序读代码：

1. [模型端口](internal/agents/model/model.go)：Go 接口如何隔离模型实现。
2. [正文模型](internal/domain/manuscript/types.go)：Beat、Segment、上下文材料与来源版本。
3. [Writer](internal/agents/writer.go) 和 [Critic](internal/agents/critic.go)：各自构造材料、调用模型、解析输出。
4. [章节图](internal/orchestration/chapter.go)：Eino 节点、边和沿图传递的 ChapterState。
5. [评审规则](internal/domain/review/review.go)：校验引用与版本、去重、按严重度排序。
6. [运行入口](cmd/inkloom/main.go)：把模型、演示材料和图装配起来。

修改 [演示数据](internal/demo/chapter.json) 可以观察正文、引用和评审结果的关系。此阶段不新增自动化测试文件，以编译、静态检查和 CLI 场景验收。Eino API 参考其 [官方 Graph 文档](https://www.cloudwego.io/zh/docs/eino/core_modules/chain_and_graph_orchestration/chain_graph_introduction/)。

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

日志 `model.call` 区分 `generate` 与 `repair`。正常流程调用两次模型，有格式修复时共三次；用量累加包含修复调用。`errors.As` 提取错误类别，调用方无需匹配错误文本。

本阶段校验 Finding 的引用、稿本版本和修复范围枚举，还不执行正文修改；patch 的 oldText、受保护实体与执行授权随 I4–I5 修订能力实现。Schema 合法也不等于文学判断正确，真实模型效果与修复内容是否忠实需要 I3 开始的真实样本评估。

### I3：真实模型与前端试运行

复制 `backend.env.example` 为 `.env.backend.local`，在本机填入密钥；该文件已被 Git 忽略。已有环境变量优先于文件配置，密钥不进入前端。

```bash
go run ./cmd/inkloom          # 按本地配置执行一次 Writer → Critic → 聚合
go run ./cmd/inkloom -serve   # 本机 HTTP 服务，127.0.0.1:8080
# 另一个终端
pnpm dev
```

打开 `/prepare`，展开「单段试运行 · Go 后端」，点击生成后轮询结果。`/go-api` 由 Vite 代理到 Go 的 `/api`，其余功能保持现有 MSW 数据。部署前需要同等反向代理或配置 `VITE_GO_API_BASE_URL`。试运行结果只保留在服务内存，重启清空；同一时刻只执行一条，避免误触并发付费。请求中断后可点击「恢复最近一次运行」，通过 `GET /runs/latest` 找回服务内存中的结果，避免直接重发付费请求。

学习顺序：

1. [模板渲染](internal/agents/prompts/prompts.go)：`prompts.Bind(guard)` 用同一模型接口包住护栏，每次生成和格式修复都重新渲染。角色边界与 Schema 放 system，任务与转义后的材料放 user；Schema 直接复用契约文件。
2. [DeepSeek 适配器](internal/agents/adapters/deepseek.go)：通过 Eino 调供应商，把响应转换成自己的 Output / Usage。
3. [调用护栏](internal/agents/model/guard.go)：单次 60 秒、整次运行 2 分钟；默认 6 次调用与 24000 token 预算，格式修复和重试均计入。
4. [应用用例](internal/app/chapter.go) 与 [HTTP 外壳](internal/server/server.go)：CLI / 网页调用同一张图；HTTP 立即返回 run_id，执行不依赖浏览器请求一直挂着。

调用前用 UTF-8 字节数加最大输出作保守预算估算，收到 usage 后回填实际值；未知用量保留预留量并标记 `known=false`，不能认为没有费用。仅明确的 HTTP 429/503 最多重试一次，超时不自动重发。`llm_call` 日志记录版本、耗时、用量与结果，不记录密钥、原始请求或隐藏推理。

本阶段未新增测试文件：沿用 14 个 Fake CLI 场景；本地可控 HTTP 服务验证 429 有限重试、超时、取消、缺失 usage，另检查调用/token 预算耗尽；真实模型及浏览器轮询另行验收。

DeepSeek 使用 `json_object`，字段与引用仍由 I2 管线校验；具体角色边界见 [提示词设计](docs/agent-prompts.md)。模型名可配置，当前默认 `deepseek-flash`。Go 1.24.0 存在 Sonic 链接兼容问题，因此最低要求为 1.24.1，见 [上游说明](https://github.com/bytedance/sonic/issues/771)。

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
