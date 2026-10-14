# 墨枢前端技术决策与实施顺序

## 技术决策

按需求使用 React 18、TypeScript 5 strict、Vite 5、pnpm。React Router 懒加载六页；TanStack Query 是服务端数据唯一缓存，Zustand 只保存面板、选择、分支/章节视图、命令和运行可视状态。正文采用 TipTap 自定义 Segment 和 Mark，AI 修订保留独立候选，不静默覆盖正文。

REST 和 fetch ReadableStream SSE 均经过 shared/api。Mock 以 MSW 模拟同一契约，服务端业务规则在 Mock repository 中执行：版本检查、门禁、冲突、变更传播和分支隔离。VITE_ENABLE_MOCK=false 关闭 Mock，VITE_API_BASE_URL 更换后端地址；鉴权集中在 client。

基础组件采用 shadcn/ui 的源码持有模式，以 Radix、CVA 和 Tailwind 二次封装；视觉颜色仅来自 CSS Variables。应用层组合 Bible、编辑区、编排抽屉，features 不互相导入内部实现。中文界面字符串放 shared/lib/messages，小说和业务数据来自 mocks/data。

## 目录

```
src/app                 Provider、路由、全局组合与布局
src/styles              tokens、全局布局与编辑器样式
src/shared/ui           团队基础组件
src/shared/api          REST、SSE client、缓存键与基础 hooks
src/shared/lib          UI store、文案、diff、规则和统计
src/types/domain        领域与请求响应契约
src/mocks               数据、仓储、REST handlers、SSE
src/features            prepare/workspace/bible/orchestration/review/changes/versions/reports
src/test                测试基础
```

## 实施顺序

1. 类型和 API 契约、Mock 状态规则与关键失败测试。
2. 设计 Token、共享组件、应用布局、缓存与事件流。
3. TipTap 正文编辑、版本保护、逐句 diff；Bible、编排与上下文。
4. 准备、审核、变更、版本、报告功能，通过同一服务状态联动。
5. 关键交互测试、类型与 lint、生产构建及浏览器验收。

## API 约定

领域 TypeScript 类型位于 src/types/domain/index.ts；路径由 shared/api/endpoints.ts 定义。所有写请求传 draftVersion/baseVersion；409 返回 {code:'version_mismatch',message,currentVersion}，客户端失效相关缓存并显示过期状态。GET 只读取，不做合并写入；版本分支的实际合并额外使用 POST /branches/:id/merge，GET 同路径只预览。

SSE 使用 id/event/data 格式，支持 Last-Event-ID，客户端去重、取消订阅和带退避的可取消重连。draft.delta 仅为候选预览；正式正文只在用户接受修改后写入。发生 version.stale 时禁用过期候选及审批，并刷新稿本供作者查看差异。暂停/恢复/快进通过 run actions 的补充动作实现，保持用户要求的动作不变。

## 性能与验证

编排事件的 RunState 增量写入独立 Query 缓存，正文仅在结果事件后失效重取。组件使用 Zustand selector 避免订阅整个事件数组。TipTap 的编辑状态变化使用不发出 update 的调用，防止切换视图生成伪保存；自动保存队列串行使用最新版本，409 时保留本地文本。长稿仅挂载可见分段与焦点段，图表在可见时才导入 ECharts 所需图型。

Vitest 覆盖规则、REST/SSE 仓储、分支隔离、旧版本、批注、逐句修订和门禁；Playwright 覆盖完整作者工作流。Browser Mock 使用 localStorage 保存可恢复演示，运行计时器是模拟器，不等价于持久化 Go 工作队列。
