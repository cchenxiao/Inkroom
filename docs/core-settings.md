# M0.3 人物与世界设定

入口：**创作准备 → 人物世界**。先确认有效的立意方向与风格，再填写本次补齐范围，生成一小组主要人物、事实提案和未来计划。当前真实保存范围为《浊流》main，其他作品仍明确显示演示边界。

## 作者怎么用

1. 生成只得到候选。生成记录保留原始内容、上游版本与模型调用；离开页面不会取消任务。
2. 点“编辑这组候选”，逐条修改姓名、动机、声音、硬特质引用、事实、知情人/时点及计划。
3. 每项明确选 **待确认 / 确认 / 舍弃**。可以先全部待确认保存；舍弃保留审计条目，不作为有效设定使用。修改文字会将该项改回待确认。
4. 保存建立一个新的规划版本；原始模型输出不变。确认人物硬特质时，需要同时确认引用的事实；事实或计划所属的人物、事实中明确知情的人物也需确认，系统不隐式代选。
5. 上游立意、方向或风格变化后，旧记录仍可读，但不再作为当前已确认设定。点“编辑 / 复核已保存设定”后，所有条目重置为待确认，由作者重新选择。旧候选不能直接当新候选采用。

规划保存与正式知识发布是两件事。本阶段不写正文、Bible、语义索引或角色知识集合；未来在 M0.4 交接给章纲/任务包时，只能读取有效版本里的已确认项，并继续按内容类别、故事时间与可见性过滤。

## 三类内容的边界

| 区域 | 内容 | 能否作为角色已知 |
| --- | --- | --- |
| characters | want/need/flaw/arcIntent/voice 等作者视角元数据 | 不能，包括该人物本人作为 POV 时 |
| worldFacts | 惯用手、已有关系、关键世界规则等提案 | 本阶段不进入角色上下文；后续须确认并过可见性过滤 |
| plans | 后续抉择、揭示、伏笔用途等未来计划 | 不能；确认过的计划仍不代表事件已经发生 |

`hardFactIds` 只能引用存在的 hard 事实。ID/主体/知情引用均校验；不确定的故事时间/获知时间为 null，未说明的 knownBy 为空，不自动推定全员知晓。时间使用故事时间整数，不从当前页面的章节号猜测。自然语言分类仍需作者核对，程序无法证明所有提案都分类正确。

## Agent 与应用分别负责什么

```text
当前立意 + 当前方向 + 当前已确认风格
  → PG 行锁读取并冻结输入
  → core_planner.v1 → Guard → Provider → Schema / 领域校验
  → 原始候选与调用记录
  → 作者编辑 + 每项决策
  → 版本事务 → 新规划快照
```

- Planner 只生成 `characters/worldFacts/plans`，模型契约没有确认权限或状态字段。
- 模型材料传入创作意图、已选方向、已采用 StyleRules、本次要求。**不传参考原文、风格分析原文或锚文本**，避免范文的情节人物成为设定来源。
- 同作品最多一条设定生成任务；最多 3 次模型调用（含有限重试/结构修复），整体 2 分钟；默认预算沿用配置。
- `requestId` 与完整请求匹配才返回原任务；改变材料不能复用 ID。重启把运行中任务标为 interrupted，不自动重发付费调用；started 调用记为 unknown。
- 采用由 Go 服务端控制，比较立意、方向、风格、设定四个版本；源 Job 及候选版本不能伪造。版本不符返回 409，页面保留作者文字、禁止旧编辑覆盖。
- 任务完成只保存候选，绝不覆盖作者档案。生成期间作者改了方向/风格，结果仍可保留查看，但不能直接采用。
- 复核既有档案保留 `sourceCoreVersion` 与原始 Job 来源，建立新版本。无隐式发布、无跨章传播。

## 接口

沿用独立 Go `/api/planning` 前缀，前端统一 client 通过 `/go-api` 代理。

- `GET /planning` 增加 `coreVersion/coreSelection/coreJobs`。与方向/风格处于同一个 repeatable-read 快照，返回最近 20 次生成任务及当前规划；旧快照保留在数据库，本步尚无历史快照浏览页。
- `POST /planning/core-jobs`：`{requestId, expectedInputVersion, expectedDirectionVersion, expectedStyleVersion, request}` → 202 CoreJob。正式输入由仓储读取，浏览器不能替换。
- `POST /planning/core-selection`：`{expectedInputVersion, expectedDirectionVersion, expectedStyleVersion, expectedCoreVersion, sourceCoreVersion, jobId, candidateVersion, content, decisions}` → CoreSelection。
- 新候选采用的 `sourceCoreVersion=0`；编辑/复核现有档案取当前 coreVersion。decisions 必须完整覆盖 content 中的所有 ID，值为 pending/confirmed/rejected。content 仍保留舍弃项，确认依赖不能指向未确认项。
- CoreSelection：version、inputVersion、directionVersion、styleVersion、sourceCoreVersion、jobId、candidateVersion、content、decisions、createdAt。

迁移 012 为新增表/字段，不改已应用迁移。原 Mock/章节 `docs/frontend-api.md` 契约不变。

## 学习与验证

先看 `domain/planning/core_settings.go` 的模型输出，再看 `core_records.go` 的作者决策。随后阅读 `app/core_settings.go` → `storage/postgres/core_settings.go` → `server/core_settings.go` → `BackendCoreSettings.tsx` / `CoreSettingsEditor.tsx`。

保留独立 CLI：

```bash
INKLOOM_MODEL=fake go run ./cmd/inkloom -core-settings internal/demo/core_settings.json
```

CLI 只输出 candidate，不保存；文件内部版本一致性不等于数据库采用权限。网页走真实 PG 事务。测试使用 Fake 与独立数据库，覆盖生成去重、关联确认、源记录保留、过期保存、上游复核和重启恢复；并验证 UI 保存成功与 409 后保留编辑。尚未评估真实模型输出的创作质量。

下一步 M0.4：把有效的已确认规划交给全书章纲，再展开当前章场景/Beat，仍需作者确认后才接入章节写作。
