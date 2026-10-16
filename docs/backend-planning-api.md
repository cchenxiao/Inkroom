# 作品规划接口（M0.1a / M0.2b）

本阶段实现“一句立意 → 候选 → 作者编辑选定 → 持久化”。浏览器入口为 **创作准备 → 立意**。沿用现有 Go 服务配置，`fake` 验证流程，`deepseek` 使用本地配置的模型。与原有 Mock 设定分开；当前只支持 `zhuoliu/main`，未接试写分支，选定方向不会自动写入章节或知识库。

## 请求与版本

Go 前缀 `/api`；Vite 前端通过 `/go-api` 代理。所有写操作要求 JSON，限制本地页面来源，不接收未知字段。

| 方法与路径 | 请求 | 响应 |
| --- | --- | --- |
| GET /planning | 无 | 当前 input、directionVersion、selection、最近 20 次 jobs、可选 packs，以及 styleVersion、styleSelection、最近 20 次 styleJobs |
| PATCH /planning/intake | `{expectedVersion, intake}`，首次版本 0 | 新 InputSnapshot，版本 +1 |
| POST /planning/jobs | `{requestId, expectedInputVersion}` | 202 Job；相同 ID/版本重试返回原任务，不重复执行 |
| POST /planning/selection | `{expectedInputVersion, expectedDirectionVersion, jobId, candidateVersion, candidateIndex, direction}` | 作者选定的新 DirectionSelection |

`intake`：premise 必填；genres、targetWords、narrative、preferences 可空；references 为 `{title,dimension}[]`，最多 5 部，暂不联网；packs 为 `{id,version,overrides?}[]`。模板版本、原始覆盖项、基础 guidance 和整体 digest 一起冻结。只提供创作提示，没有新增硬门禁。

`direction`：title、logline、coreConflict、characterDilemma、readerAppeal、tone、narrative、tradeoff。字段含义见前端表单；作者可编辑所有内容。人工直接提供方向时 `jobId=""`、`candidateVersion=0`、`candidateIndex=-1`；同样必须基于已保存立意。

模型候选批次 `Job.version=1`，内容不变；状态与内容版本分开。生成任务保存完整输入版本与 digest、模型名、PromptVersion、SchemaVersion、调用次数/耗时/实际或未知 token。采用保存原候选引用和作者编辑后的完整方向；模型原文不被修改。

## 并发与故障

- 输入版本、作者方向版本各自递增，与章节 `draftVersion` 无关。
- 生成期间可改立意。迟到候选仍保存，但采用事务核对它的原输入版本，过期返回 `409 version_mismatch`。
- 采用事务锁定作品头，同时核对预期输入版本和方向版本；两窗口修改不会静默互相覆盖。
- 修改立意不删除旧选择；前端显示“需要复核”。作者显式编辑/复核后才能形成基于新立意的新选择。
- 每作品最多一个生成任务。`requestId` 负责生成重试去重；失败/中断任务只有作者另发新 ID 才会重跑。模型预算最多 3 次实际调用（包含允许的短重试与一次 JSON 格式修复），整体期限 2 分钟。
- 服务重启将未完成任务标 interrupted、未完成调用标 unknown，不自动再花费。任务完成写盘失败只记日志，重启时按中断处理。
- 当前页面展示最近 20 批生成历史；输入/采用全历史存库，历史版本浏览 API 留待后续。旧候选不能因页面打开新版本而被“补号”。

## 学习时按这个顺序看

1. `internal/domain/planning/planning.go`：作者意图、模型提案、作者决定是三种产物，先定义边界再写提示词。
2. `internal/agents/prompts/tone_director.v1.tmpl` 与 `contracts/tone_director.v1.json`：提示词约束创作职责，Schema 约束机器可处理的结构；不能靠 Schema 证明文学质量。
3. `internal/app/planning.go`：一个 Agent 已足够，复用 Prompt → Guard → Provider → Parse。下一阶段才让 Writer 读取已选方向试笔。
4. `internal/server/planning.go`：202 + 后台任务 + 页面轮询，HTTP 请求不等待几十秒的模型生成；断开页面不会直接取消任务。
5. `internal/storage/postgres/planning.go`：行锁与版本比较保证“读到的版本”和“提交时的版本”一致；模型不决定谁有权覆盖作者选择。

M0.3 已接入核心人物/世界设定候选与作者确认，详见下方 M0.3b。

## M0.2b 试笔与风格

| 方法与路径 | 请求 | 响应 |
| --- | --- | --- |
| POST /planning/style-trials | `{requestId, expectedInputVersion, expectedDirectionVersion, beat, variants}` | 202 StyleJob，相同 ID 和请求返回原任务 |
| POST /planning/style-selection | `{expectedInputVersion, expectedDirectionVersion, expectedStyleVersion, sourceStyleVersion?, jobId, candidateVersion, variantId, anchorText, rules}` | 新 StyleSelection，锚文本与风格版本同时 +1 |

- `beat`：summary / facts[] / outcome / pov / tense。`variants` 恰好两项，含 id / label / instructions / anchorText / bannedPhrases[]。正式立意和方向不接受浏览器传入，仓储读取后冻结。
- `StyleJob`：id / version=1 / request / report / promptVersion / schemaVersion / createdAt。report 保留 input、inputDigest、status、model、samples、calls、usage、message。GET /planning 同快照读取版本和当前采用，分别返回最近 20 次方向/试笔任务。
- `rules`：pov、tense 为硬叙述约束；tone、sentenceLength `{min,max}`（字/句）、dialogueRatio `{min,max}`（0–1）、bannedPhrases[]、styleArc。数字为作者软目标，不是校准结果。
- 从试笔采用需任务 completed、样本存在且 input/direction/candidate 版本匹配。直接提供范文使用 jobId=""、candidateVersion=0、variantId=""；仍检查当前方向是否基于当前立意。
- 编辑/复核已保存风格使用 sourceStyleVersion=当前风格版本，jobId/candidateVersion/variantId 必须与原档案完全一致。新档案保留来源链，允许作者显式将旧方向的范文复核到新方向；原模型样本不变。
- StyleSelection 保存 version、anchorVersion、inputVersion、directionVersion、sourceStyleVersion、jobId、candidateVersion、variantId、anchorText、rules、createdAt。过期写入返回 409；前端保留作者文字，要求重新核对。
- 启动去重比较全部临时材料；单作品最多一个试笔任务，最多 4 次模型调用，整体 2 分钟。中断不自动重跑。调用记录按实际 call number 持久化。

原 `docs/frontend-api.md` Mock/章节契约不变；上述接口属于独立 Go 规划区。


## 参考文本风格分析

新增 `GET/POST /planning/style-analyses`，与书名参考线索独立。POST `{requestId,title,text}` 创建只读分析任务，支持 80–30,000 字；长文明确取样首/中/尾共 3,000 字，全文做程序统计。采用接口新增 `analysisId/analysisVersion`，不得与试笔 job 来源混用；既有风格编辑继续保留来源。详见 [文本风格分析接口与边界](reference-style-analysis.md)。


## M0.3b 人物与世界

`GET /planning` 增加 coreVersion、coreSelection、coreJobs。新增 `POST /planning/core-jobs` 冻结当前上游生成候选，`POST /planning/core-selection` 保存作者逐条决策；两条接口的完整字段、关联约束与版本语义见 [核心设定说明](core-settings.md)。模型只生成提案，确认状态由作者请求与服务端事务控制，不发布到正式知识。迁移 012 自动执行。


## M0.4a 全书章纲

`GET /planning` 增加 outlineVersion/outlineSelection/outlineJobs。新增 `POST /planning/outline-jobs` 与 `POST /planning/outline-selection`，分别生成与保存章纲；绑定单独版本化并与章纲原子保存。四个上游版本和章纲版本均校验，未确认设定不进入模型材料。完整字段与边界见 [全书章纲](outline.md)。迁移 013 自动执行。


## M0.4b 当前章细纲与 Brief

`GET /planning` 增加 chapterPlans/chapterPlanJobs。新增 `POST /planning/chapter-plan-jobs` 与 `POST /planning/chapter-plan-selection`，冻结有效已确认章纲，生成单章场景/Beat/Brief 候选，按稳定章节 ID 递增作者版本。迁移 014 自动执行；候选与确认均不发布正文或正式知识。完整字段和边界见 [细纲说明](chapter-plan.md)。

## M0.4c1 规划接单段写作

新增 `GET/POST /planning/chapter-runs`，按确认规划启动第一章选定 Beat，冻结输入、隔离稿本并在批准/提交时复核上游版本。迁移 015 保存完整规划来源；已有事件、人审与提交 API 复用。字段及边界见 [规划写作说明](planned-writing.md)。

## M0.4c2 初始知识发布

新增 `GET /planning/knowledge-preview` 和 `POST /planning/knowledge-publications`；作者确认后的初始事实及获知声明发布到已有知识快照与检索目录。新规划 run 绑定当前知识版本，原 Mock 契约不变。完整字段与保护范围见 [初始知识发布](planning-knowledge.md)。
