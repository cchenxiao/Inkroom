# M0.2：同场景试笔与风格采用

目的：先让作者看到不同表达的实际文字，再决定风格规矩。已实现独立 Agent 核心，以及 Go/PostgreSQL 异步任务、网页对照与作者采用。

## 运行

```bash
INKLOOM_MODEL=fake go run ./cmd/inkloom -style-trial internal/demo/style_trial.json
```

Fake 只回显场景与结果，两个样本只有分段差别，不用于评价文笔。当前命令不调用 PostgreSQL、不写正式正文、Bible 或检索库。结果输出到标准输出，调用过程写到标准错误；如要保留结果，可自行重定向到文件。

使用已配置的 DeepSeek 时，把 `INKLOOM_MODEL=fake` 改为 `INKLOOM_MODEL=deepseek`。这会真实调用模型并计费；本轮验收只运行 Fake，没有额外真实模型调用。

## 数据流与职责

```text
作者提供的冻结输入文件
  → 版本与字段校验
  → 固定方向 + 同一个临时 Beat
  → 风格 A → Prompt → Guard → Provider → Parse → 试笔 A
  → 风格 B → Prompt → Guard → Provider → Parse → 试笔 B
  → 程序统计 + 来源摘要 + 调用记录（候选，不采用）
```

- `TrialInput.source` 是立意快照，`selection` 是基于该版本的方向选择。输入版本、digest 或模板快照不匹配就停止，模型不会被调用。
- `beat` 只有一份，共享场景、人物可知事实、事件结果、POV 和时态；两份 `variants` 只保存表达要求、可选范文和禁用短语。
- `anchorText` 是 few-shot 风格示例。提示词明确禁止把范文中的人物和事件带入场景。
- `trial_writer.v1` 与正式 Writer 分开。正式 Writer 目前偏悬疑、单段；试笔角色由输入决定类型，允许分段，用于比较表达。
- 两次调用按顺序执行，便于学习和追踪。共用一次运行预算，最多 4 次实际调用，含短重试和 JSON 格式修复；单次超时和总 token 上限沿用配置，CLI 总期限 2 分钟。
- 两个输出都走 Schema 和内容校验。结构损坏最多修一次；第二份失败时保留第一份和调用记录，报告 `failed` 并以非零退出码结束。
- `style.Analyze` 复用 I4 的句长、均值、方差、节奏离散度、禁用词命中统计，`calibrated=false`。此轮不计算未实现的对白比例、幽默感或审美评分，不把数值当文学门禁。

## 不应误解的边界

CLI 接收的是显式提供的输入文件。版本校验只证明这份文件内部一致，不证明它是数据库当前版本，也不是采用授权。完整输入和输入 digest 随结果返回，供下一步核对；CLI 本身不会产生“风格已采用”的状态；网页采用另走版本事务。

提示词要求两个样本保持同一事件结果，但结构校验无法证明模型完全遵守语义。作者需要对照候选，语义遗漏记录为后续评审问题，不靠关键词检测假装解决。

网页从 PostgreSQL 读取真正已选定的方向，冻结异步任务输入。当前入口是创作准备 → 风格；多作品新建向导仍为 Mock，不冒充已接入该保存链路。

## 读代码顺序

1. `internal/domain/planning/trial.go`：输入边界与版本校验。
2. `internal/app/style_trial.go`：冻结材料、共享预算、两次调用和实际统计。
3. `internal/agents/prompts/trial_writer.v1.tmpl`：表达要求与事实隔离。
4. `cmd/inkloom/style_trial.go`：命令行适配，不把模型逻辑塞进入口。

## 网页使用

1. 在 **创作准备 → 立意** 保存意图并选定方向。
2. 在 **风格** 填一个临时场景、固定事实、结果、视角和时态。两种表达要求可编辑，可选填范文与禁用表达。
3. 点击“生成两份试笔”。后台顺序执行两个 Writer，页面轮询持久化任务；离开再回来可看结果。
4. 并排阅读后选“以此为基础编辑”，改写锚文本，确认视角/时态、基调、软目标区间和 styleArc，再保存。
5. 已有满意范文可直接填入，跳过模型。已采用风格可编辑/复核；复核旧方向风格时保留原试笔来源和来源风格版本。

当前仅《浊流》main 接真实后端；原 Mock 风格折叠在独立演示区。风格参考不自动回写正文、Bible 或检索事实，正式章节消费在 M0.4 接入。

## 保存为什么在 Agent 之外

```text
浏览器提交预期 inputVersion / directionVersion + 临时场景
  → PG 锁作品头，读真实方向并冻结 StyleJob
  → HTTP 202，后台 GenerateStyleTrials，调用记录实时持久化
  → 保存原始样本（可过期，不能自动采用）
  → 作者编辑锚文本和规矩
  → PG 再锁作品头，核对 input / direction / style 三个版本
  → 原子保存锚文本版本 + StyleProfile 版本 + 原始来源
```

`requestId` 去重比较完整请求；相同 ID 不会重复调用模型，换了材料不能复用旧 ID。一个作品同时只允许一个试笔任务，失败/中断需手动重新生成。失败时保留函数已返回的完整样本；进程崩溃前未完成落库的样本文字不可恢复，调用记录仍用于审计，重启不自动重发。

`sourceStyleVersion` 表示作者显式编辑/复核既有档案；服务端核对它是当前风格版本，保留原 job/candidate/variant 引用。它允许作者在新方向下重新确认旧范文，不允许把过期模型候选偷偷补成新版本。

程序统计只描述原始样本。作者编辑后的锚文本不沿用原样本的统计；对话占比和平均句长区间都是作者目标，不自动校准或变成文学质量分数。默认区间可修改；styleArc 只描述叙事阶段，不猜测章号。

## 本次接线代码顺序

1. `internal/domain/planning/style_profile.go`：任务、样本、风格采用与来源版本。
2. `internal/storage/postgres/style_trials.go`：冻结、幂等、版本比较和原子采用。
3. `internal/server/style_trials.go`：202 后台任务与持久化调用记录。
4. `src/features/prepare/components/BackendStyleTrial.tsx`：服务端状态轮询，作者本地编辑不被查询刷新覆盖；409 保留文字、禁用旧采用。

验收使用 Fake 和独立测试数据库；没有额外调用真实模型。当前本地服务保留 DeepSeek 配置，作者在页面点击生成时才调用。
