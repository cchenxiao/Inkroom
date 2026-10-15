# 前端与 Mock API 契约

统一前缀 /api。GET 按查询参数传 branchId；写请求由 shared/api/hooks 默认补齐当前 chapterId、branchId，显式传参优先。正文、审批、patch 应用必须带 draftVersion，冲突返回 409 version_mismatch。branchId 默认 main，章节 GET、正文写入、run、版本操作须带当前 branchId。

| 资源                                                         | 请求与返回                                                                                         |
| ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------- |
| GET /projects/:id；PATCH 同路径                              | Project；修改创作准备与锁定                                                                        |
| POST /projects/:id/suggestions                               | {kind:project/characters/rules/style,chapterId,branchId,draftVersion} → 未应用的 ChangeSet         |
| GET /projects/:id/tree                                       | Chapter[]（嵌套 Scene/Beat）                                                                       |
| GET /chapters/:id?branchId=&version=                         | ChapterDocument（正文、finding、scores、run、patches、conflicts）                                  |
| PATCH /segments/:id                                          | {text,draftVersion,branchId,isDialogueLie?} → {draftVersion,changeset}；保存候选，不自动改世界事实 |
| GET /bible/all 或 /bible/:kind                               | Bible 或对应资源；POST/PATCH /bible/:kind/:id? 保存仅返回 ChangeSet 预览                           |
| GET /changesets；POST /changesets/preview                    | ChangeSet[]；PreviewChangeInput → ChangeSet                                                        |
| POST /changesets/:id/apply                                   | {strategy,draftVersion,branchId} → ChangeSet                                                       |
| GET /conflicts；POST /conflicts/:id/resolve                  | Conflict[]；{choice,isDialogueLie,reason,draftVersion,branchId} → Conflict                         |
| POST /comments                                               | {segmentId,quote,text,draftVersion,branchId} → {comment,patch}                                     |
| POST /findings/:id/suggest；POST /findings/:id/ignore        | {draftVersion,branchId,reason?} → RevisionPatch / Finding                                          |
| POST /patches/:id/apply；POST /patches/:id/discard           | ApplyPatchInput → ChapterDocument / RevisionPatch                                                  |
| GET /runs/:id                                                | RunState；编排事件增量更新该独立缓存                                                               |
| POST /runs                                                   | {chapterId,branchId,maxRounds?} → RunState                                                         |
| POST /runs/:id/actions                                       | RunActionInput → RunState；暂停、恢复、快进为补充动作                                              |
| GET /runs/:id/context-manifest                               | ContextManifest                                                                                    |
| GET /runs/:id/events                                         | SSE，事件为 RunEvent；Last-Event-ID 去重恢复                                                       |
| GET /commits?branchId=&chapterId=；POST /commits/:id/restore | Commit[]；{draftVersion,branchId} → Commit                                                         |
| GET/POST /branches；DELETE /branches/:id                     | Branch[]；{name,fromBranchId} → Branch；删除表示放弃                                               |
| GET/POST /branches/:id/merge                                 | MergePreview；{draftVersion,resolutions,targetVersions,sourceVersions} → Commit，未裁决返回冲突    |
| GET /reports/overview /experiments /regression               | ReportOverview / Experiment[] / RegressionCase[]                                                   |
| POST /reports/polish；GET /exports?branchId=                 | {chapterIds,preserveRhythm:true} → RunState；{text,filename}                                       |
| POST /imports                                                | {kind,text,draftVersion} → {imported,message}                                                      |
| POST /demo/reset；POST /demo/stale                           | 重置演示；模拟另一窗口保存供并发验收                                                               |

所有字段的具体结构以 src/types/domain/index.ts 为准。非 GET 具有副作用；SSE 推送候选与进度，不直接覆盖用户正文。Mock 初始数据固定为《浊流》第七章 v3，便于回归测试。

## 事件与并发

标准 SSE 帧含 `id`、`event` 和 JSON `data`，data 对应 `RunEvent`；模拟器额外返回 `data.run` 快照。四个 Critic 独立启动，再汇总结果；P2 修改后只复检风格和一致性。maxRounds 接受 2 或 3。

变更应用生成独立传播 run：`index.updating` 的 phase 为 `checking`、`indexing`、`summarizing`、`ready`，最后发送 `run.finished`。传播仅刷新影响范围，不使旧审稿结果自动有效；作者需复检新版本。

服务端校验补丁自己的 draftVersion、变更预览自己的 draftVersion、审批所依赖的 run.draftVersion，不能通过提交最新版本号绕过旧候选保护。角色对白谎言与世界事实分开保存；忽略 P0 不会解除定稿门禁。

分支合并的 GET 预览包含目标与来源各章节版本映射 `targetVersions` / `sourceVersions`；POST 必须回传捕获的映射。预览之后任一相关版本变化都要求重新预览、重新裁决。合并时每个实际修改的目标章节分别递增版本并作废旧审稿；新增、删除与重排分段按整章结构冲突处理。

## Go 候选接口（I8 已实现）

准备页 `trialApi` 使用独立 `backendApi`；浏览器 `/go-api` 代理至 Go `/api`，不走 MSW。下面是已落地的学习切片，不能将上文完整 Mock 契约视为已全部接入后端。

| 接口 | 契约 |
| --- | --- |
| GET /health | provider、model、scenarios、storage=postgres |
| POST /runs | chapterId、branchId、**draftVersion 必填**（无稿为 0）、autoRevise、allowLocalRewrite、maxRounds、scenario；返回 202 + Run |
| GET /runs；GET /runs/:id | 最近 50 条运行快照；单条含 result/usage，id 可为 latest |
| GET /runs/:id/calls | CallRecord[]：角色、prompt/schema 版本、attempt、耗时、usage、started/finished/unknown，不包含密钥或原始请求 |
| GET /chapters/:id?branchId=&version= | Draft：chapterId、branchId、draftVersion、segments、findings、reviewed、origin、createdAt；version 省略/0 取当前版 |
| GET /chapters/:id/versions?branchId= | 最近 100 个正文版本（版本号、来源、时间） |
| PATCH /segments/:id | chapterId、branchId、draftVersion、text → 新 Draft；整次事务保存候选并作废旧 run |

当前仅 `ch7/main` 可启动。修改候选不修改 MSW 正式稿或 Bible。版本不匹配返回 `409 {code:"version_mismatch",message}`；已有执行返回 `409 run_busy`。人工修改后新版本的 `reviewed=false`，旧报告仅供历史查看；`stale` 不能当成本稿评审。初稿阶段中断仅保留已落库结果；已进入 I7 人审检查点的运行支持显式恢复。

接口类型见 `src/features/prepare/types/backend.ts` 与 `internal/app/repository.go`。可靠事件见下节；仍与 MSW 的完整产品事件分开。

### 人工操作与恢复

`POST /runs/:id/actions` 请求：`{id,type,draftVersion,instruction?,segmentId?,text?}`。`type` 为 `approve | instruct | inline_edit`；`id` 是客户端生成的一次决定的稳定 ID，重试不可换 ID 或内容。首次受理 202；相同已完成操作返回 200，只返回结果不重做。相同 ID 不同内容返回 409 `action_mismatch`；旧版本 409 `version_mismatch`；门禁不满足 409 `gate_blocked`。

Run 新增 `canResume`、`approvalBlock`、`instructionBlock`、`pendingAction`、原运行 `maxCalls/maxTokens`，新增终态 `approved`。`waiting_human` + `canResume` 表示 checkpoint 已真正保存。`approved` 仅为候选批准，不是正式章节定稿。`pendingAction` 表示已受理但未完成的操作，failed/interrupted 时用原内容和 ID 明确继续；不自动重发。

人审写操作再查章/分支最新版本，并和 run 中的版本比较；已完成操作的重取不产生新审批。指令修订保留原轮数上限与运行调用/token 预算；跨章、事实裁决不在该入口自动执行。未经当前版本两个必要 Critic 复检，或仍有阻断 Finding/事实待裁决时不能批准；未校准文本统计仍只提示。

### 真实 SSE 进度（I8）

`GET /runs/:id/events` 返回 `text/event-stream`。可选请求头 `Last-Event-ID: <run_id>:<sequence>`；不带从 0 重放。事件帧含 `id`、`event`、JSON `data`，对应 `BackendRunEvent {runId,sequence,type,createdAt,run}`。`run` 为该事务的完整快照，含 `eventSequence`、`activeRoles`、`result.nodePhase`。单条 GET 返回相同快照契约；列表只提供历史摘要。

已实现类型：`run.started`、`run.updated`、`node.started`、`node.finished`、`model.started/finished/unknown`、`draft.saved`、`findings.ready`、`revise.round`、`gate.waiting`、`run.finished`、`run.failed`、`version.stale`。修订事件的轮数和范围取 `run.reviseRound/maxRounds/result.revisions`；问题只使用与稿本版本匹配的报告。正文是完整 JSON 校验后的候选版本，此阶段没有逐 token `draft.delta`。

- 每 run 序号从 1 连续递增；允许重复传输，消费成功再推进游标；发现缺口重新读取快照。
- 游标过期返回 `410 cursor_expired`，跨 run / 超出最新序号返回 `400 invalid_cursor`，运行不存在返回 404。重新 GET 快照后以 `eventSequence` 续接。
- 连接建立先订阅再回放，按持久化历史顺序排空；内存通知仅唤醒读取。慢连接缓冲溢出/写入超时会断开，客户端重连补齐。
- 客户端重连退避 0.5–8 秒；切换运行/收起面板取消订阅。禁止重试 POST 代替 SSE 重连。旧查询快照按事件序号拦截，依赖资源查询先取消再刷新。
- 默认保留全部事件；显式维护裁剪后才产生过期游标。I8 之前的运行序号为 0，不补造历史，但后续人工操作仍会产生新事件。
