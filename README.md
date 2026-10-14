# 墨枢 Inkloom

面向作者的多智能体中短篇小说协作工作台。稿件是主界面，AI 提交候选，作者决定方向与定稿。当前仓库已包含可运行的前端工程；Go 后端仍按原设计分模块开发。

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

## 后端开发：只看两份主文档

- **用什么建（框架）**：[后端整体框架设计](docs/backend-architecture.md) — Go + Eino + Postgres/pgvector，模块化单体、Run 引擎、分层与基础设施。
- **按什么顺序建（流程）**：[后端建设思路与增量计划](docs/backend-build-plan.md) — 评测驱动的垂直薄切片，当前只做 **M1 单章闭环**（I0–I9）。
- 实现接口时对照：[前端 API 契约](docs/frontend-api.md)（REST/SSE，字段与版本语义不得偏离）。

其余设计稿（Agent 细节、作品级编排、产品/前端设计）已移入 `docs/archive/`，需要时再查，不作为当前开发依据。

里程碑：M1 单章闭环 → M2 跨章记忆 → M3 人机共创与变更传播 → M4 评测与成本 → M5 统稿打磨。
