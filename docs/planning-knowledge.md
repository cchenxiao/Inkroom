# M0.4c2 初始设定发布为正式知识

入口：**创作准备 → 知识快照 → 发布初始设定**。前提是方向、风格、核心设定均已确认且依赖当前版本。发布不调用模型。

## 使用流程

1. 查看预览：待发布事实、人物获知时点、未发布项及原因。
2. 填理由并勾选事实确认，再发布。当前目录若为教学数据，页面明确提示将替换教学知识目录；历史快照和正文保留。
3. 返回大纲确认细纲，用选定 Beat 写作。新 run 必须引用与当前设定一致的已发布知识；未发布时不能开工。
4. 运行页面显示知识版本，提交会冻结完整知识来源。正文仍按 POV 与故事时间过滤，不把整份作者台账交给模型。

本入口只用于开工前初始化：已有同作品/分支正文提交后，或者已有非规划的正式知识时，禁止替换，需后续变更影响分析。确认的未来计划、人物 want/need/flaw 不发布为世界事实；事实时间未知则排除整条，获知时间未知只排除该条知情声明。未来才获知的事实可以存入作者台账，但在时点到达前不会进入该角色材料。

## 技术学习重点

**发布不是又加一个 Agent。** 模型已产出设定候选，作者已做选择；这里用确定性程序落实决定，避免模型自行把提案升格为事实。

- `internal/app/planning_knowledge.go`：把确认集合转换成知识快照，并列出排除项。仅初始来源可使用章节位置 0，表示“尚无正文出处”，不是“第 0 章”。来源包含条目 ID、核心设定版本及摘要；正文来源仍必须有真实 chapter/segment。
- `internal/storage/postgres/planning_knowledge.go`：发布时重新读取当前规划，比较四个依赖版本、知识版本和预览摘要，不接收浏览器提供的事实内容。规划头锁→知识发布锁→知识头，与 run 的规划头→知识头→稿本→run 顺序相容。
- `knowledge_snapshots` 与 `memory_records/memory_heads` 同事务更新。无需新表；新字段均 optional/omitempty，旧快照 JSON 与摘要兼容。相同原请求重试返回原结果，版本变化返回 409；页面保留理由并撤销旧确认。
- `knowledge.Location.initial` 与 `memory.Record.initial` 区分作者初始声明和正文证据；`memory.Select` 仍先做项目、分支、版本、故事时间、POV 过滤，再允许检索使用。未知时间不能默认成 0。
- 新 run 冻结 `writingTask.knowledge={version,digest}`；启动时还比较发布内容与当前设定的确定性投影。人审和提交在锁内检查知识 head，旧结果不能套用新知识；旧版本完整可读。旧 M0.4c1 未绑定知识的 run 仍保留原冻结输入，不补造来源。

当前规划写作仍使用固定知识子集，不开放跨章自主检索；发布只让检索目录具备真实来源。首章之外、前章定稿引用和整章组装尚待后续。

## API

沿用 `/go-api` 前端代理、后端 `/api` 前缀，旧 Mock 契约不变。

| 方法 | 路径 | 内容 |
| --- | --- | --- |
| GET | `/planning/knowledge-preview` | ready/reason、expected 四版本、expectedVersion、previewDigest、replacesTeaching、current/currentVersion、snapshot、excluded |
| POST | `/planning/knowledge-publications` | `{expected:{input,direction,style,core},expectedVersion,previewDigest,confirm:true,reason}` → StoredKnowledge |

`previewDigest` 是下一知识版本的确定性内容摘要，不能靠重试改写同一个版本。未就绪 422；过期 409。Snapshot 增加 `planning` 来源，Location 增加 `initial`。已保存快照仍通过 `GET /knowledge?version=N` 查看。

## 验证

少量关键回归覆盖：初始来源不伪造正文位置、未知时间排除、未来获知隔离、显式确认、请求去重、预览摘要/CAS、run 消费发布版本、提交保留知识引用、已有正文阻止初始化覆盖；前端覆盖预览确认和 409 后保留理由。Fake 与独立 PostgreSQL 验证，不调用付费模型。
