# 作品层：书架、总览与四步向导

## 使用

- `/` 跳到 `/library`：三本示例书、新建、继续写、打开总览。
- `/book/:projectId`：三幕章纲、当前章节、字数/定稿/Beat 进度、最严重问题、人物/伏笔/文风与全书质量摘要。
- `/library/new`：先填写基本资料，再逐步生成和确认方向、文风、人物世界、章纲。只展开首章场景与 Beat。可回退、解锁、保存草稿退出。
- 旧六页路径保留，URL 的 `projectId`、`chapterId`、`branchId` 记录归属；无作品参数的旧链接仍属于《浊流》。`section` 指向准备段，`segmentId` 定位原文。

## 实现与边界

领域类型在 `src/types/domain/library.ts`，请求入口在 `src/features/library/api`；页面与字段组件按 feature 拆分。服务端状态用 Query，当前作品/章节/分支用 UI store，并由 URL 恢复。

`src/mocks/library` 独立保存新作品，不切换原有全局 db。对新作品未支持的操作直接返回 501，未知作品/章节返回 404，不会穿透到《浊流》的处理器。原 409、canFinalize、旧审批失效不改。

数据存于 `inkloom-library-v1` 的 localStorage，正文未保存输入仍有 sessionStorage 备份；这不是 Go 持久化，不支持不同设备同步。向导候选是可编辑模板，不调用模型或网络搜索。清理浏览器数据会丢失本地作品。

新作品可手动编辑首章和建立独立试写分支；其他章节的场景展开、Agent 执行、人审定稿、事实同步、版本合并与评测不在本次范围。准备规划编辑主线；试写分支保存建立时的独立稿本与设定快照。Go 入口仍只允许原《浊流》main 上的已有流程。

## Mock 请求（不属于新增 Go 契约）

| 请求 | 用途 |
| --- | --- |
| GET /api/projects | 书架摘要 |
| POST /api/projects | 用 BookBrief 新建本地作品与规划草稿 |
| GET /api/projects/:id/overview?branchId= | 作品总览 |
| GET /api/projects/:id/planning | 恢复规划 |
| PATCH /api/projects/:id/planning | expectedVersion + PlanAction，返回新规划版本 |

沿用章节、正文、设定、分支等既有资源命名，通过 `projectId` 隔离。没有修改 `docs/frontend-api.md` 或 Go 接口。

规划更新在副本上校验后原子发布。只有锁定项进入总览；上游改变使下游解锁，候选记录上游内容基准，过期候选不能再次锁定。人物与规则必须逐条确认。重锁章纲同步场景/Beat 元数据，保留正文，拒绝删除已有正文所依赖的结构。正文自动保存绑定开始编辑时的作品，换书不会改变保存目标。

## 验证

覆盖跨作品隔离、未知操作拒绝、分支隔离、旧版本 409、四步锁定/失效、草稿恢复、未确认设定隐藏、伏笔定位、快速离开时的保存归属。浏览器验收包括默认首页、新建至首章试写、保存退出与刷新恢复。候选内容质量和真实多作品后端另行接入。
