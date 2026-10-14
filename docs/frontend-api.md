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
