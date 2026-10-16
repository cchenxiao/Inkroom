# M0.1a 作品方向规划接口

本阶段实现“一句立意 → 候选 → 作者编辑选定 → 持久化”。浏览器入口为 **创作准备 → 立意**。沿用现有 Go 服务配置，`fake` 验证流程，`deepseek` 使用本地配置的模型。与原有 Mock 设定分开；当前只支持 `zhuoliu/main`，未接试写分支，选定方向不会自动写入章节或知识库。

## 请求与版本

Go 前缀 `/api`；Vite 前端通过 `/go-api` 代理。所有写操作要求 JSON，限制本地页面来源，不接收未知字段。

| 方法与路径 | 请求 | 响应 |
| --- | --- | --- |
| GET /planning | 无 | 当前 input、directionVersion、selection、最近 20 次 jobs、可选 packs |
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

下一步 M0.2：同一临时场景生成两个试笔样本，作者选锚文本，形成独立版本的 StyleProfile；不会提前开始全书正文生成。
