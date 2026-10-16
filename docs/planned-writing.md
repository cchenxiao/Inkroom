# M0.4c1 已确认规划接入单段写作

入口：**创作准备 → 大纲 → 当前章细纲 → 用这份规划写一段**。仅《浊流》main 接真实 Go 后端；其他作品及正文工作台仍是 Mock。

## 这一段能做什么

确认有效的立意、方向、风格、核心设定、章纲、当前章细纲与 Brief 后，选择第一章的一个 Beat，生成约 150–350 字候选。候选自动经过一致性与 AI 味检查；作者可授权最多两轮句级修订，结构问题交人工。可查看来源、修改、审核和提交该段。提交单段不等于整章定稿。

开工前须在“知识快照”发布当前已确认设定，并填写选定场景的故事时间，并在人物世界中确认当前 POV 可知的事实及获知时间。时间未知、尚未确认或未来才获知的事实不进入 Writer。缺少可用事实时显示阻断原因。第一章确实没有前章；后续章因未接前章定稿来源而禁用。

再次生成同一 Beat 会增加候选版本，页面先提示确认，旧版本保留。改动上游规划后，旧输入仍可回看，但不能再批准或提交旧运行；复核规划后需重新生成。

## Agent 技术：输入装配与执行分开

```text
确认的规划（完整存档）
    ↓ 事务校验版本 + 当前 POV/时间投影
FrozenInput + ContextManifest
    ↓
planned_writer → 一致性 / AI 味并行 → 分级 → 有限修订 → 人审 → 单段提交
```

1. `internal/storage/postgres/planned_runs.go` 在同一事务中锁规划头，读取六个上游版本、细纲版本与稿本版本。客户端只传预期版本，不提供可信设定。`requestId` 相同且内容相同返回原运行，内容不同拒绝；HTTP 忙碌时可能先返回 `run_busy`，查记录或重试原 ID 即可，不能另起 ID 盲目重试。
2. `internal/app/planned_run.go` 将确认材料投影成正文侧 `WritingTask`：Brief、当前场景、风格规矩、在场人物声音、当前 POV 已知事实。完整参考原文、未来章纲和未确认设定不转发。完整来源另存 `planning_run_inputs`，保留内容摘要。
3. `planned_writer.v1.tmpl` 复用既有 Writer JSON 契约，按真实类型和风格写，不默认悬疑。作者计划与角色已知事实明确分离。提示词限定职责，程序负责版本、字段、引用与权限校验；模型仍可能漏审，不能把空 Findings 当作查证完备证明。
4. 复用现有 Eino 编排、模型预算、SSE、checkpoint、人审恢复。初始设定按确认版本引用，不虚构“来源正文段落”；本切片不开放旧 ch7 检索目录，也没有跨章工具查询。
5. 每个 `scope + chapterId + beatId` 映射独立物理稿本。规划头→稿本→run 的固定锁序负责审批并发；稿本 CAS 防迟到结果覆盖作者新稿。每次批准和提交都会再次核对规划版本。`WritingStyle` 用具体字段，保证 JSONB 往返后摘要稳定。

## Go API

前端走 `/go-api` 代理，实际路径统一以 `/api` 开头。原 `docs/frontend-api.md` Mock 契约不变。

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| GET | `/planning/chapter-runs?chapterId=...&beatId=...` | 返回 ready/reason、draftId/draftVersion、planVersion、expected、最近 10 次 runs |
| POST | `/planning/chapter-runs` | `{requestId,chapterId,beatId?,expected,planVersion,draftVersion,autoRevise}` → 202 Run |

`expected={planning:{input,direction,style,core},outline,bindings}`。版本不匹配 409；材料未就绪 422。Run 增加 `planning={scope,chapterId,beatId,expected,planVersion}`，正文版本仍用物理稿本 ID。查询稿本、运行事件、人工操作、上下文清单与定稿复用已有 API；提交引用增加 `planning_inputs` 和 `writing_task`。迁移 015 自动创建运行与规划绑定表。

## 验证与下一步

Fake + 独立测试库验证输入隔离、POV 时间投影、JSONB 摘要、请求去重、版本覆盖保护、审核及规划失效；前端验证携带版本、失败重试沿用 ID、旧规划按钮禁用。未额外调用付费模型验证文学质量。

M0.4c2 已接 [正式初始知识发布](planning-knowledge.md)。M0.4c3 已接 [整章组稿](chapter-assembly.md)，可不改细纲版本独立选择 Beat。M0.4c4 已接 [整章复审与作者决定](chapter-review.md)；之后接全章最终定稿、前章来源与正文工作台。不能把单段 commit 或待审章稿当作上一章定稿，M0 尚未全部结束。
