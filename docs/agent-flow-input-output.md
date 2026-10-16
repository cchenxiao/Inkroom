# Agent 全流程、输入输出与作者决策

最后核对：2026-10-17。本文记录当前工作区实现（包括未提交代码），不是未来功能承诺。代码变化时按文末检查表同步更新。

本文是学习与维护入口：先看流程，再查角色字段。字段采用 JSON 名称；表中嵌套字段按层级解释。模型材料以调用点构造的 `Material` 为准，不等于数据库保存的完整任务快照。

## 1. 当前完整流程

```text
作者保存立意
  → tone_director：方向候选 → 作者编辑、选定方向
  → 风格准备（三种入口）
      trial_writer：同场景双样本
      style_analyst：参考文字分析
      作者直接提供范文与规则
    → 作者编辑并确认风格
  → core_planner：人物 / 世界事实 / 未来计划候选
    → 作者逐条确认、待确认或舍弃
      ├→ 程序预览初始知识 → 作者确认发布知识快照
      └→ story_architect：全书章纲 → 作者编辑、确认
           → 选择章节 → showrunner：Scene / Beat / Brief
           → 作者编辑、确认当前章细纲
  → 程序校验规划与知识版本，按 POV / 故事时间冻结写作材料
  → planned_writer（同一作者的不同模式）
      整章：一次返回全部 Beat 正文
      单段：只返回选中 Beat 正文
      重写：只返回指定选区的替换文字
  → hard_consistency + ai_taste 并行审查
  → 程序聚合、路由；授权范围内修订后再次审查，否则交作者
  → 作者批准 / 要求修改 / 直接编辑 → 复检 → 批准并采用、提交
  → 程序按细纲选取各 Beat 的有效提交 → 作者确认保存整章组稿
  → chapter_consistency + chapter_language 并行复审
  → 作者确认通过，或记录返工要求并返回对应 Beat 修改
  → chapter_facts 提取章末事实候选，或作者直接整理
  → 作者逐条决定、确认知情角色
  → 作者确认无遗留问题 → 程序冻结整章定稿与章末事实包
  → 下一章消费前章正文与事实包：尚未接通
```

准备阶段是独立任务与作者决定串联；正文使用 `NewChapter` Eino 图；人审使用独立 `RunHuman` 图；整章复审为并行函数调用。不是一张从立意自动跑到定稿的 Eino 图。

当前真实规划写作仍限制在首章；原 ch7 教学链路与真实规划链路分开。网页存在某个功能，不代表所有作品、分支或跨章场景均已接通。

## 2. 共用调用与版本概念

源码：[模型端口](../internal/agents/model/model.go)、[提示词渲染](../internal/agents/prompts/prompts.go)。

| 字段 | 意义 |
| --- | --- |
| `Role` | 调用角色，用于选择提示词、记录调用；不是独立模型实例的保证 |
| `Task` | 本次具体任务指令 |
| `Material` | 模型本次实际收到的业务 JSON |
| `OutputSchema` | 输出结构约束，程序仍会本地校验 |
| `Tools / Messages` | 允许的工具与工具循环消息 |
| `Purpose` | 正常生成 `generate` 或格式修复 `repair` |
| `SystemPrompt / UserPrompt` | 渲染后的系统提示词、任务与材料 |
| `PromptVersion / SchemaVersion` | 提示词、契约版本 |
| `Temperature` | 采样参数 |

模型端口返回 `Content`（正文 JSON）、`ToolCalls`（工具请求）、`FinishReason`（完成/工具/拒绝/截断），另有 `Usage`。用量、任务状态和完成时间是程序或供应商元数据，不由模型业务 JSON 自报。

典型链路：材料投影 → Prompt → Guard → Provider → JSON/Schema/业务校验 → 保存候选。引用存在只能证明出处，不证明语义判断正确。

版本必须区分：立意版本、方向版本、风格版本、设定版本、章纲/细纲版本、知识版本、Beat 稿本版本、整章组稿版本。`digest` 表示材料内容摘要，`requestId` 用于请求去重，`commitId` 指向已保存提交。上游改变后，旧结果可追溯，但不能绕过当前版本校验继续采用。

## 3. 方向规划：tone_director

源码：[GenerateDirections](../internal/app/planning.go)、[数据类型](../internal/domain/planning/planning.go)。

**输入 `InputSnapshot`**：

| 字段 | 意义 |
| --- | --- |
| `version / digest` | 创作意图版本与摘要 |
| `intake.premise` | 一句话立意 |
| `intake.genres / targetWords` | 类型、目标篇幅 |
| `intake.narrative / preferences` | 叙述偏好、希望和避免的内容 |
| `intake.references[].title / dimension` | 参考作品名、参考维度；不表示已联网阅读 |
| `intake.packs` | 创作提示模板引用 |
| `effectivePacks` | 程序展开的模板内容 |

**输出 `directions[]`**：`title` 方向名、`logline` 故事前提、`coreConflict` 核心冲突、`characterDilemma` 人物两难、`readerAppeal` 阅读吸引点、`tone` 基调、`narrative` 叙述规则、`tradeoff` 取舍。

**作者操作**：选一个并编辑采用，或直接填写已有方向。保存为 `Selection`，绑定立意版本、摘要及候选来源。修改立意会使旧候选不能直接采用，已选方向需复核。下一步是风格准备，不直接写正文。

## 4. 风格准备：trial_writer / style_analyst

### 4.1 同场景试笔 trial_writer

源码：[GenerateStyleTrials](../internal/app/style_trial.go)、[试笔结构](../internal/domain/planning/trial.go)。

输入 `inputVersion / directionVersion` 标明来源版本；`direction` 是已选方向；`beat` 和 `style` 如下：

| 字段 | 意义 |
| --- | --- |
| `beat.summary` | 临时场景概述 |
| `beat.facts / outcome` | 不可改变的事实、固定事件结果 |
| `beat.pov / tense` | 视角与时态 |
| `style.id / label` | 风格方案标识与名称 |
| `style.instructions` | 表达要求 |
| `style.anchorText` | 可选参考范文，只借表达 |
| `style.bannedPhrases` | 禁用表达 |

同一角色顺序调用两次，共享 Guard；场景不变，风格不同，B 不接收 A 的正文。每次输出 `{"text":"试笔正文"}`。程序追加统计、输入摘要、调用记录，不存在自动选优 Agent。

### 4.2 参考文字分析 style_analyst

源码：[AnalyzeReferenceStyle](../internal/app/style_analysis.go)、[分析类型](../internal/domain/planning/style_analysis.go)。

| 输入 | 意义 |
| --- | --- |
| `title` | 参考片段名 |
| `totalCharacters / analyzedCharacters` | 全文字符数、实际分析字符数 |
| `samples[].start / end / text` | 可见片段范围与原文；范围为字符下标、左闭右开 |

全文另行存档与统计，不等于全文交给模型。当前最多分析 3000 字，较长文本取首中尾片段。

| 输出 | 意义 |
| --- | --- |
| `observations[].dimension` | 句式、节奏、对白、叙述距离、意象、幽默等维度 |
| `sampleIndex / quote` | 可见片段索引与逐字依据 |
| `reason / suggestion` | 判断理由、表达建议 |
| `certainty` | `observed / tentative`，不是校准置信度 |
| `rules` | 风格规则草稿 |
| `anchorText` | 可见片段中的建议摘录 |
| `limitations` | 分析局限 |

### 4.3 作者确认后的共同产物

作者可比较试笔、导入分析结果，或直接提供范文；编辑后保存 `anchorText` 与 `StyleRules`：

| 字段 | 意义 |
| --- | --- |
| `pov / tense / tone` | 视角、时态、基调 |
| `sentenceLength.min/max` | 句长软目标 |
| `dialogueRatio.min/max` | 对话比例软目标，0–1 |
| `bannedPhrases` | 禁用表达 |
| `styleArc` | 随叙事阶段变化的风格要求 |

分析可独立进行，采用需有效方向。保存候选不等于确认；试笔/范文中的事件不会自动成为作品事实。下一步 Planner 读取确认规则，不读取参考原文或锚文本。

## 5. 核心设定：core_planner

源码：[GenerateCoreSettings](../internal/app/core_settings.go)、[核心设定类型](../internal/domain/planning/core_settings.go)；操作见[人物世界](core-settings.md)。

输入：`intake` 创作意图、`direction` 已选方向、`styleRules` 确认风格、`request` 本次规划范围。

| 输出区域 | 字段与意义 |
| --- | --- |
| `characters[]` | `id/name` 标识/姓名；`role` 故事作用；`want` 表面追求；`need` 内在需要；`flaw` 弱点；`arcIntent` 成长方向；`voice` 声音特点；`hardFactIds` 硬事实引用 |
| `worldFacts[]` | `id` 标识；`subject` 人物或 world；`text` 内容；`rigidity` hard/soft；`storyTime` 故事时点；`knownBy[].characterId/learnedAt` 知情人物/获知时点 |
| `plans[]` | `id` 标识；`subject` 主体；`intent` 未来安排 |

作者逐条编辑，选择确认、待确认、舍弃，保存版本。只有确认子集给下游；候选之间的关联也要有效。未知时间为 null，未知知情范围为空，不推定所有人知道。

人物成长设计不是人物自知；确认未来计划不代表事件已发生。确认集合可用于章纲；成为角色事实还需初始知识发布。

## 6. 初始知识发布：确定性程序

见[初始知识发布](planning-knowledge.md)、[实现](../internal/app/planning_knowledge.go)。不调用 Agent。

输入为已确认规划及版本。程序生成发布预览、排除原因。作者填理由并确认后发布知识快照；只有合规事实与知情声明进入知识来源，不发布 want/need/flaw 或未来计划为世界事实。未知事实时间排除事实，未知获知时间排除相应知情声明。

确认设定 ≠ 发布知识。开工前需有效的已发布知识；正文按 POV 与故事时间再次过滤。已有正式正文后的设定替换受限制，不应绕过变更流程。

## 7. 全书章纲：story_architect

源码：[GenerateOutline](../internal/app/outline.go)、[章纲类型](../internal/domain/planning/outline.go)。

输入：`intake / direction / styleRules`；`confirmedCore` 仅确认设定；`request` 章纲要求；`chapterCount` 章节数。

| 输出 | 字段与意义 |
| --- | --- |
| `acts[]` | `id/title/purpose`：幕的标识、名称、作用 |
| `chapters[]` | `id/actId/title`：章节身份；`purpose` 作用；`event` 主事件；`arc` 变化；`reveal/withhold` 揭示/保留；`characterIds` 人物；`targetWords` 篇幅；`storyTime` 时点 |
| `bindings.style[]` | `chapterId/guidance`：章节风格要求 |
| `bindings.plans[]` | `planId/chapterIds/purpose`：计划安排在哪些章节及目的 |

作者编辑、重排、调整绑定；保存草稿只是保存，显式确认后才能进入当前章细纲。章纲不是已发生事实。

## 8. 当前章细纲：showrunner

源码：[GenerateChapterPlan](../internal/app/chapter_plan.go)、[细纲类型](../internal/domain/planning/chapter_plan.go)。

输入：`intake / direction / styleRules / confirmedCore / confirmedOutline`、`currentChapter` 当前章、`request` 展开要求、`previousEnding` 前章接口（当前实现传 nil）。

| 输出 | 字段与意义 |
| --- | --- |
| `scenes[]` | `id/title` 标识；`goal/conflict/outcome` 目标/冲突/结果；`povCharacterId` 视角；`characterIds` 人物；`storyTime` 时点；`beats` 节拍 |
| `scenes[].beats[]` | `id/title` 标识；`action` 行动；`turn` 带来的局势或认知变化 |
| `brief` | `selectedBeatId` 默认目标；`mustHappen` 必须发生；`cannotChange` 不可改变；`reveal/withhold` 揭示/隐藏；`writingGuidance` 写作要求 |

作者编辑场景、Beat、Brief 后保存草稿或确认。确认后可选择整章生成，或选一个 Beat 写作。切换写作目标不等于修改细纲。

## 9. 冻结写作材料：程序与教学装配 Agent 的区别

真实规划入口：[PreparePlannedContext](../internal/app/planned_run.go)、[PrepareChapterWriting](../internal/app/chapter_writing.go)。程序读取可信仓储，校验版本，投影当前 POV/时间事实，生成 `FrozenInput + ContextManifest`。

| `ContextBundle` 字段 | 意义 |
| --- | --- |
| `projectId/branchId/chapterId` | 作品、分支、稿本定位 |
| `beat` | `id/sceneId/title/description/version/locked`：本次节拍与约束 |
| `pov/povCharacterId` | 视角说明与人物 ID |
| `characters` | `id/name/version/hardTraits/knows`：人物及来源化事实；未列出不等于不知道 |
| `facts/sources/previousEnding` | 明确事实、参考来源、前章结尾；SourceRef 为 id/version/text |
| `bannedPhrases/protectedTerms` | 禁用表达、修订保护词 |
| `writingTask` | 从完整规划裁剪出的写作任务 |
| `targets` | 整章每个 Beat 的独立 ContextBundle，按细纲排序 |
| `neighbors` | 紧邻前后 Beat 的已采用正文及来源 |
| `original/rewrite` | 原稿和作者重写请求 |
| `retrieval` | 已检索材料及可见范围、来源信息 |

`writingTask`：`brief` 写作简报；`style` 风格；`sceneGoal/sceneConflict/sceneOutcome` 场景约束；`voices` 说话特点；`storyTime/opening/genre` 时点/开篇/类型；`chapterTargetWords/beatTargetWords` 篇幅软目标；`versions/planVersion/sourceDigest/knowledge` 规划与知识来源；`scope/chapterId` 逻辑作品章节定位。

旧教学入口另有 `context_assembler`（[代码](../internal/contextlookup/lookup.go)）：输入基础 ContextBundle，模型可请求 `search_memory({query})`，最终输出 `decision=ready/insufficient`。工具最多 3 次、模型决策最多 4 次；程序执行搜索和装配，模型不自由编造完整材料。真实规划路径当前没有接旧 ch7 检索目录，不能将教学查证能力描述为全书写作已接通。

## 10. 正文作者：planned_writer 的三种模式

源码：[WriteScope / RewriteAuthor](../internal/agents/writing_scope.go)、[Write](../internal/agents/writer.go)、[当前提示词](../internal/agents/prompts/planned_writer.v3.tmpl)。

三种模式共用 `planned_writer.v3`，但 Task、Material、Schema 不同；模板注入不同 Schema 后，最终提示词也不完全相同。

| 操作 | 模型输入 | 模型输出 | 程序后处理 |
| --- | --- | --- | --- |
| 整章生成 | 含全部 `targets` 的 Bundle；每项独立 POV/时间/事实/场景/Brief/风格 | `parts:[{beatId,text}]` | 校验数量、顺序、Beat ID；转换成多个 Segment |
| 单 Beat 生成 | 当前 Bundle 与 `neighbors` | `{text}` | 补 Segment ID、Scene/Beat 归属、顺序与版本 |
| 作者选区重写 | `{context,segments,rewrite}` | `{text}`，仅选区替换内容 | 保留范围外原文，拼接新文本并增加版本 |

`rewrite`：`segmentId` 目标；`original` 完整原文；`start/end` Unicode 码点范围（左闭右开）；`instruction` 作者要求。范围限制由程序拼接落实，不只靠提示词。正文可以包含多个自然段；一个 Beat 当前保存为一个 Segment，text 内以换行分段。

**当前上下文边界**：

- 整章最多 8 个 Beat，按全部 targets 一次生成；不是生成长文后猜测拆分。顶层当前复用第一项材料，再附 targets，存在第一项信息重复。
- 单段只读取细纲紧邻前后各一段的最新已采用正文；未采用邻段可能只有标题/位置而没有正文。不是完整已写前文，也未传完整后续 action/turn 规划。
- 整章准备路径当前未加载 neighbors；重写邻段同样只读，后文不能变成人物提前已知。
- 当前只支持首章，前章衔接字段不代表实际跨章来源已接通。
- `Original` 有值但没有 Rewrite 时可原样转交审查，不调用作者重写。

更详细设计见[写作范围](chapter-writing-scope.md)。历史教学 `writer` 与规划 `planned_writer` 是不同提示词入口，不混用其篇幅约束。

## 11. 候选双评审：hard_consistency / ai_taste

源码：[并行与汇总](../internal/orchestration/critics.go)、[一致性](../internal/agents/consistency.go)、[语言](../internal/agents/critic.go)。

| 角色 | 实际材料 | 职责 |
| --- | --- | --- |
| `hard_consistency` | draftVersion、segments、characters、facts、neighbors、targets | 当前正文与事实、认知边界、相邻文本是否一致；整章按目标 Beat 使用对应事实 |
| `ai_taste` | draftVersion、segments、metrics、neighbors | 套话、重复解释、对白同质、邻段重复和语气变化 |

二者独立并行，等待完成后聚合；失败不能当空清单通过。教学工具版一致性可查询并返回 insufficient，真实规划入口不使用旧教学目录。

输出均为 `findings[]`：

| 字段 | 意义 |
| --- | --- |
| `id/critic` | 问题标识、评审类别 |
| `severity` | 严重程度 |
| `segmentId/quote` | 目标段落、逐字引用 |
| `evidenceRefs` | 来源引用 |
| `reason/suggestion` | 问题理由、修复建议 |
| `repairScope` | 修改范围 |
| `draftVersion` | 本次稿本版本 |
| `ruleRef/ruleQuote` | 一致性判断的依据及原文 |
| `evidenceStatus` | 确定或不确定 |
| `possibleDialogueLie/requiresHuman` | 可能谎言、需要人工判断 |

`metrics` 是程序统计：segmentId、sentenceLengths、mean、variance、burstiness、calibrated、hits（phrase/count）。未校准指标不是质量门禁。报告校验只能证明引用、版本与规则组合有效，不能证明语义结论正确。

## 12. 自动修订与作者主动重写不能混淆

源码：[polisher](../internal/agents/polisher.go)、[reviser](../internal/agents/reviser.go)。Route、Apply、ApplyScoped 都是程序，不是 Agent。

| 角色 | 输入 | 范围 |
| --- | --- | --- |
| `polisher` | 当前版本、P2 问题、涉及段落、protectedTerms、可选 authorInstruction | 局部润色 |
| `scene_reviser` | role、draftVersion、allowedSegmentIds、segments、选中 findings、context、可选 authorInstruction | 授权场景修订 |
| `structural_reviser` | 同上 | 当前 Beat 的结构修订，不等于全书改纲 |

输出：`basedOnDraftVersion` 与 `patches[]`。每条 patch 为 `findingId` 对应问题、`segmentId` 目标、`changeType` 修改类型、`oldText/newText` 旧/新文、`reason` 理由。Polisher 支持局部替换/删除；Reviser 为授权整段替换。

程序按严重度、范围、授权和轮次选择本轮一个角色，校验后应用，版本递增，再双评审。当前规划入口自动策略比底层图更保守：有限句级自动修订，结构问题交人。不能仅因为图里存在节点就宣称该入口自动开放所有角色。

作者主动选区重写由 `planned_writer` 的修订模式完成，不要求先存在 Critic Finding，也不等于 Polisher Patch。

## 13. 人审、采用与提交

源码：[RunHuman](../internal/orchestration/human.go)；操作细节见[写作范围](chapter-writing-scope.md)。

| 人的选择 | 后续 |
| --- | --- |
| 批准 approve | 校验版本和门禁，记录批准；不等于整章定稿 |
| 指令修改 instruct | 通过既有问题修订角色处理，应用后复检 |
| 选区重写 rewrite | 调用 planned_writer 修订模式，只替换授权选区，随后复检 |
| 直接编辑 inline_edit | 保存作者修改，更新版本并复检 |
| 旧稿/已采用稿重写 | 新冻结上下文、新候选运行，保留历史 |
| 上下文过期后复检 | 原文不变，使用新材料重新审查 |
| 再生成 | 新候选，不能覆盖已采用历史 |
| 采用、提交已批准候选 | 冻结正文提交与来源，可供组稿选择 |

候选生成 ≠ 批准 ≠ 采用提交 ≠ 整章定稿。版本失效后需重新核对，不能把旧批准套到新材料。

## 14. 整章组稿：程序

见[组稿](chapter-assembly.md)、[实现](../internal/app/chapter_assembly.go)。

输入：确认细纲顺序、各 Beat 有效提交、作者选择的 `beatId → commitId`。整章生成的提交也按 BeatID 提取，不能整章重复填进每一项。

作者预览并选择版本，确认后保存不可变 `ChapterAssembly`：连续正文、各部分来源、组稿版本和摘要。程序排序与组装，不调用 LLM。此时是待审章稿，不是最终定稿。

## 15. 整章复审：chapter_consistency / chapter_language

源码：[ReviewChapter](../internal/app/chapter_review.go)、[类型](../internal/app/chapter_review_types.go)。

输入 `assemblyId/draftVersion/assemblyDigest/parts`：此处 draftVersion 是整章组稿版本。每个 part 含 beatId、sceneId、title、commitId、pov、storyTime、segments、facts；来源含 id、kind、text、sourceId、sourceVersion。

- `chapter_consistency`：完整有序正文与各 Beat 冻结事实，检查跨段动作、物件、时空、认知衔接。
- `chapter_language`：程序移除 facts 与 POV 字段，检查整章语言重复和一致性。

两路并行，不读对方结论；输出 Findings，另有 `evidence:[{ref,quote}]` 逐字证据。结果分类仍是 hard_consistency / ai_taste，不能因此认为和局部审查是同一次调用。

作者确认复审通过后进入定稿准备；记录返工要求只保存决定，不自动重写。返工需回目标 Beat 修改、提交，再组稿、复审。两路失败、阻断项或版本过期时不能批准。复审通过还不是最终定稿。

## 16. 章末事实：chapter_facts

源码：[ExtractChapterFacts](../internal/app/chapter_facts_agent.go)、[类型与决定](../internal/app/chapter_facts.go)。

| 输入 | 意义 |
| --- | --- |
| `chapterId` | 当前章 |
| `review` | 已批准复审对应的完整冻结章稿 |
| `baseKnowledge` | 基础知识版本引用 |
| `knowledge` | 完整基础知识快照；这是作者整理视角，不直接给 Writer |

输出 `candidates[]`：`id` 标识、`text` 候选陈述、`kind` event/statement/uncertain、`relatedFactId` 关联旧事实、`evidence.ref/quote` 正文证据、`reason` 理由。

作者也可直接建立人工批次，不调用模型。每条决定：

| action | 结果 |
| --- | --- |
| `confirm` | 确认新增事件事实，可编辑 text、选择 knownBy |
| `exclude` | 排除，不纳入事实包 |
| `keep_existing` | 保留关联旧事实，填写理由，不覆盖旧说法 |
| `revise_manuscript` | 要求改稿，阻断定稿，返工后重新整理 |

`candidateId` 对应条目；`text` 为作者确认陈述；`knownBy` 为作者明确选择的知情人物；`reason` 留下决定依据。知情时间来自证据段，不由模型推定。台词和不确定候选不能直接升级为世界事实；可另行人工补充有证据的事件。

存在候选批次时必须完整处理；空候选不证明没有新增事实。

## 17. 整章定稿：程序

见[定稿](chapter-publication.md)、[章末事实](chapter-facts.md)。作者确认无遗留问题后，程序再次核对章稿、复审、规划、知识与事实决定版本，冻结正文、来源提交、复审、作者决定及章末事实包。

事实包记录基础知识引用和新增事实；当前不直接更新本章的 knowledge head 或检索目录，避免改掉本章自己的输入版本。下一章消费“基础知识 + 前章定稿事实包”的交接尚未接通，不宣称 Writer 已自动使用这些新增事实。

## 18. 后续维护规则

功能修改时同步检查本文，不只更新流程图：

1. 新增/删除角色：更新整体流程、角色章节和代码入口。
2. 改提示词：核对实际 Render 选择的版本；旧模板文件存在不表示仍启用。
3. 改 Material：区分仓储完整快照与真正发给模型的字段，更新字段意义及信息边界。
4. 改 Schema：更新模型输出、程序补充字段、校验与失败行为。
5. 改人审动作：写明选择后是仅保存、确认、发布、调用模型、复检还是定稿。
6. 改范围：核对整章/Beat/选区，POV、时间与邻文是否变化；不能只改提示词描述。
7. 改接入：明确网页/CLI、真实/Mock、首章/跨章、候选/正式知识的状态。
8. 更新核对日期和下表；历史变化放表里，正文保持当前状态。

### 变更记录

| 日期 | 变化 |
| --- | --- |
| 2026-10-17 | 建立全流程基线，覆盖创作准备、整章/单段/选区作者模式、双层评审、人审、组稿、章末事实与定稿；记录逐段上下文和跨章交接的当前限制。 |
