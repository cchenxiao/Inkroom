# M0.4b 当前章细纲与写作简报

入口：**创作准备 → 大纲 → 当前章细纲与写作简报**。先确认全书章纲，再选一章、填写展开要求，生成候选。每次仅展开 1–4 场、最多 8 个 Beat；本阶段保存规划，不启动正文生成。

## 使用

1. 选择章纲里的章节，说明本章怎么展开，例如“两次试探推进关系，不改变事件结果”。
2. 查看并编辑候选：场景目标/阻碍/结果、在场人物、POV、可空故事时间；每个 Beat 的动作与变化。可增加、删除、排序，稳定 ID 不随排序变化。
3. 核对 Brief：必须发生、不能改变、对读者揭示/隐藏、文字与节奏要求；选定后续单段写作先用哪个 Beat。
4. 保存草稿，或勾选核对后确认规划。改变内容会撤销勾选；生成本身不采用。每章独立递增版本，候选不会覆盖已保存记录。

上游改变会使旧确认待复核。旧生成候选不能直接采用；可打开已保存细纲，重新核对并保存一个引用当前输入的新版本。409 后保留编辑并禁用旧保存，不替换作者文字。

## Agent 技术

`Story Architect → 作者确认章纲 → Showrunner → 作者确认细纲/Brief` 是产物依赖链，不是多个模型自由聊天。

- **输入冻结**：仓储锁定规划头，在同一事务读取立意、方向、风格、设定、章纲及独立章节绑定版本。浏览器只传预期版本、章节 ID、要求，不提供可信上游内容。
- **材料投影**：模型只读已确认的人物/事实/计划、StyleRules、已确认章纲、本章与要求。完整输入存档供审计；未确认项及锚文本不发送模型。
- **职责限制**：`showrunner.v1` 只产出 scenes/brief。schema 约束形状，Go 校验场景/Beat 数量、重复 ID、人物引用、POV 在场、时间、选定 Beat 和文本长度；不伪造文学质量评分。
- **有限调用**：复用 Guard、DeepSeek/Fake 适配器和结构化解析，最多 3 次实际调用、2 分钟任务期限，沿用已有 token 预算。不增加框架。重启只标记中断，不自动重发。
- **人工采用**：原始候选、作者编辑和确认各有记录。模型局部 ID 在候选落库时转换为任务命名空间 ID；保存校验来源任务、章节、所有输入版本和该章当前细纲版本。

## 角色知识与前情边界

保存时由 Go 计算每场的规划知情范围：必须是已确认事实；事实时间和该角色 learnedAt 均已知且不晚于场景 storyTime。未知时间不能推定为 0，未来计划不进入可知事实。界面使用保存时的输入快照解释结果，过期记录不补新版本号。

这只是帮助作者核对规划，**不是 I10 正式可见性查询**。新章尚未映射正式正文，规划事实也未发布为带章节/段落来源的 memory.Record；没有虚构前章定稿或挪用演示 ch7。任务材料明确 previousEnding=null，UI 标注缺口。第一章无需前章，后续章仍需真正绑定定稿来源。

M0.4c 再建设正式知识发布/映射、前章定稿衔接、assembler 依赖校验与原子冻结，然后让当前单段执行链消费选定 Beat；不能把本步“规划已确认”理解成已经可以启动新章。

## API 与存储

独立 Go 规划区；原 `docs/frontend-api.md`、MSW 409/canFinalize 逻辑不变。

- `GET /planning` 新增 `chapterPlans[]`（每章最新保存版本，保留待复核记录）、`chapterPlanJobs[]`（最近 20 次生成）。
- `POST /planning/chapter-plan-jobs`：`{requestId, expected, chapterId, request}` → 202 ChapterPlanJob。expected 为 `{planning:{input,direction,style,core}, outline, bindings}`。相同 ID 同请求返回原任务；同 ID 改请求返回 409。同作品一次只允许一个细纲生成任务。
- `POST /planning/chapter-plan-selection`：`{expected, chapterId, expectedVersion, sourceVersion, jobId, candidateVersion, content, confirmed}` → ChapterPlanSelection。新候选 sourceVersion=0；编辑已保存版本 sourceVersion=当前细纲版本。
- Selection 保存 version、versions、chapterId、来源链、完整 input、content、服务器计算的 knowledge、confirmed、createdAt。
- `content.scenes[]`：id/title/goal/conflict/outcome/povCharacterId/characterIds/storyTime/beats；Beat：id/title/action/turn。
- `content.brief`：selectedBeatId/mustHappen/cannotChange/reveal/withhold/writingGuidance。
- 迁移 014 新建 jobs、calls、selections；保存主键 `(scope,chapter_id,version)`。沿用 planning_heads 行锁保证按章版本比较和插入原子化；不改正文表、不自动发布知识。

## 阅读顺序

1. `internal/domain/planning/chapter_plan.go`：输入依赖、引用校验、规划知情投影。
2. `internal/agents/prompts/showrunner.v1.tmpl` 与对应 schema：模型职责与输出契约。
3. `internal/app/chapter_plan.go`：确认材料投影 → Guard → Provider → Parse。
4. `internal/storage/postgres/chapter_plan.go`：冻结、去重、保存、复核和来源链。
5. `BackendChapterPlan.tsx` / `ChapterPlanEditor.tsx`：远端查询与未保存编辑分离。

本轮以 Fake 验证流程和边界，不声称已验证真实模型的创作质量。自然语言中的“必须发生/不能改变”仍需作者审核，程序只校验可明确验证的结构与引用。
