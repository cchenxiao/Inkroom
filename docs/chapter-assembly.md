# M0.4c3：整章组稿

入口：《浊流》main → 章节写作 → 组稿与复审 → 整章组稿（细纲仍在创作准备页确认）。使用 Go/PostgreSQL 的真实规划与提交，不读取 Mock 工作台的 ch7 正文。

## 使用

1. 在“规划正文试写”选择要写的 Beat。默认使用 Brief 原选定项，切换目标不更改细纲版本；每个 Beat 的稿本独立。
2. 生成、审核并提交每个 Beat。当前仍只支持第一章；生成不自动消费相邻段，组稿时需要检查重复、跳跃与衔接。
3. 组稿按已确认细纲的场景、Beat 顺序，默认选择各段最新有效提交。可查看来源并选择其他有效提交；缺段、过期或生成中会说明原因。
4. 阅读连续正文，勾选确认后保存章稿。历史快照可展开查看正文、细纲/知识版本和每段来源。

**单段提交 ≠ 整章定稿。** 本阶段保存状态固定为 `awaiting_chapter_review`。它没有经过全章 Critic，不参与后续章前情，不回写事实库，不显示虚假门禁通过。

## 技术边界

- Writer、双 Critic、人工批准与单段 commit 沿用既有链路。本阶段组稿由确定性代码完成，不调用模型，也不让 LLM 自行决定收录哪段。
- `beatId` 成为启动请求的可选字段。省略时兼容旧 Brief；实际 Beat 写入 frozen WritingTask、Run.planning、幂等请求和独立物理稿本 ID。完整原细纲快照不被改写。
- 组稿保存先锁规划头，读取确认链和知识头，再锁涉及的稿本头。版本必须匹配当前细纲、知识与正文；作者直改或新运行会让旧预览失效。
- `previewDigest` 对版本化章稿材料计算摘要。保存时服务端重新查询、排序和计算，客户端不能上传正文冒充审核提交；必须为每个 Beat 提交准确 commit ID。
- 数据分为 `chapter_assemblies`（不可变章稿与原请求）和 `chapter_assembly_sources`（Beat→commit 外键）。它独立于 `manuscript_commits`，不伪造整章 run、评审或批准记录。
- 保存带 `expectedVersion`；同一 `requestId` 同一请求返回原回执，改请求重用 ID 拒绝。来源或并发版本变化 409。历史章稿不会随源稿修改，界面明确标记历史快照。
- 预览只读，保存不更新既有 commit。迁移 016 随 Go 服务启动执行。

## API

路径以 `/api` 开头，浏览器用 `/go-api` 代理。

| 方法 | 路径 | 内容 |
| --- | --- | --- |
| GET | `/planning/chapter-runs?chapterId=…&beatId=…` | 新增可选目标 Beat，返回实际 beatId、其稿本版本和最近运行 |
| POST | `/planning/chapter-runs` | 既有请求新增可选 beatId；不改细纲 |
| POST | `/planning/chapter-assemblies/preview` | `{chapterId,choices?:{beatId:commitId}}` → ready/reason、slots、draft、expectedVersion、previewDigest、history（最近20版） |
| POST | `/planning/chapter-assemblies` | `{requestId,chapterId,choices,expectedVersion,previewDigest,confirm:true}` → 不可变 ChapterAssembly |

原 Mock `docs/frontend-api.md` 契约不变。当前项目边界仍为 `zhuoliu/main`；作品库与工作台的多作品演示不等于后端已经支持多作品。

## 验证与下一步

关键回归复用真实 PG 规划链与 Fake Writer：缺段、跨 Beat 引用、完整组稿顺序、显式确认、请求去重、并发旧预览、人工改稿后失效、历史回执保留；前端验证勾选确认、失败重试沿用请求、409 取消确认。未为验收调用付费模型。

M0.4c4 已接 [整章复审与作者决定](chapter-review.md)。组稿快照本身保持待审状态，独立的复审任务和作者决定记录后续进度；全章最终定稿与前章交接随后接入。
