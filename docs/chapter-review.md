# M0.4c4 整章复审与作者决定

入口：章节写作 → 组稿与复审 → 整章组稿 → 保存章稿后出现“整章复审”。不会跳到 Mock 人工审核页。

## 操作

1. 保存完整章稿，点击“开始整章复审”。必须仍是最新章稿，且逐段正文、细纲和知识来源仍有效。
2. 两路 Critic 独立读取完整正文：一致性检查跨段动作、物件、时空和认知衔接；语言检查重复解释、套话和对白同质。
3. 展开意见查看证据，点击“定位章稿原文”阅读上下文。也可看调用记录、各段事实快照和旧批次。
4. 通读后填写理由并确认。两路完整完成且没有阻断项时可“确认复审通过”；有问题时“记录返工要求”，再到对应 Beat 修改、复检提交、重新组稿。此按钮记录要求，不自动调用 Writer。

**复审通过仍不是最终定稿。** 本阶段未同步全章新增事实，也没有提供下一章前情来源。组稿快照保持不可变，作者决定单独留档。

## Agent 技术

`chapter_review.go` 负责确定性的编排：冻结输入 → 两个 goroutine 各自审稿 → WaitGroup 等齐 → 校验输出 → 持久化结果 → 作者决定。没有 Writer 参与；Critic 看不到对方意见，不投票。

- `BuildChapterReviewInput` 从章稿选用的 commit 和它的 FrozenContext 构建输入，不能由浏览器提交一段“可信正文”。段号按章稿顺序命名 `s-1-1`，保留原 segment ID、稿本版本与 commit，避免各 Beat 都叫同一个 segment ID。
- 每个 Beat 的事实来自当时的 POV/故事时间投影。事实与原文分别标为 `fact`、`passage`，不得把台词、误解或前后段叙述自动提升为世界事实。语言 Critic 的输入不包含事实。
- `chapter_consistency.v1` / `chapter_language.v1` 是专用整章提示词，使用同一个 `chapter_review.v1` JSON Schema；输出继续包含标准 Finding 字段，新增逐字证据 `evidence:[{ref,quote}]`。
- 验证分层：完成状态 → JSON → Schema → 引用和版本校验。确认的跨段矛盾至少引用目标段和另一段原文/本 Beat 事实；证据不足或可能谎言为 P3 并要求人工判断。引用存在只能证明出处真实，不能证明语义结论一定正确。
- Guard 复用全任务调用次数、token 和超时上限。调用前先估算两路完整材料预算，预算不足不调用模型、不截断正文；提示调整 `INKLOOM_MAX_TOKENS`。格式修复仍只针对无效 JSON，不用重试把文学判断改到通过。
- 空意见只表示本次未报告问题，不能证明模型检查完备。既有“模型可能漏审”问题仍然保留，不以强行造问题规避。

## 状态与一致性

任务状态为 `running → completed / failed`；进程重启把未完成任务标为 `interrupted`，未落定的调用标为 `unknown`，不自动重新收费。

- 每个任务冻结章稿 ID/版本/摘要、完整审读输入和输入摘要；每个调用保存 role、prompt/schema 版本、耗时、用量。
- 两路任一失败，整体失败，不能把空 Findings 展示为通过。
- 单个 scope 只允许一个整章复审任务运行。重试相同 requestId 和内容返回原任务；相同 ID 不同内容拒绝。
- 查询和人工决定都重新检查当前章稿、每段稿本、知识/规划版本及最新复审批次。旧报告可查看，旧作者决定仍留档，但不再具备当前批准资格。
- 批准时在规划→知识→稿本锁范围内再次核对。P0–P2 或需要人工判断的 P3 暂不允许通过，沿用现有保守审核规则；本阶段没有“直接忽略模型意见”功能。
- 一次复审只能记录一个作者决定，稳定操作 ID 支持未知结果重试；已成功的旧请求仍可取回原回执，回执同时给出当前是否失效。

## Go API

实际前缀 `/api`，前端 `/go-api` 代理；Mock 的 `docs/frontend-api.md` 不变。

| 方法 | 路径 | 内容 |
| --- | --- | --- |
| POST | `/planning/chapter-reviews` | `{requestId,assemblyId,assemblyVersion,assemblyDigest}` → 202 job |
| GET | `/planning/chapter-reviews?assemblyId=…` | `{current,reason,jobs}`，最近 10 次任务，含输入/结果/调用/作者决定及动态 approvalBlock |
| POST | `/planning/chapter-reviews/:id/decisions` | `{requestId,assemblyVersion,inputDigest,action:approve或request_changes,reason}` → job，时间由服务端生成 |

迁移 017 增加 `chapter_review_jobs`、`chapter_review_calls`、`chapter_review_decisions`。没有改写章稿/单段 commit，也没有伪造整章 run_id。

## 验证与后续

少量关键回归覆盖真实引文、跨 POV 事实误用、失败不能批准、预算不足零调用、任务/作者决定去重、服务中断、迟到结果遇到作者改稿失效，前端覆盖失败门禁与 409 取消确认。以 Fake 和专用测试库验证，不额外调用付费模型。

后续：全章最终定稿和事实同步边界，再将定稿正文/摘要作为下一章的明确来源。真实工作台已接入现有流程，跨段自动修订与完整正文编辑器接线继续分步实现。
