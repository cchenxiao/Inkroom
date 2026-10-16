# M0.4a 全书简要章纲

入口：**创作准备 → 大纲**。先确认当前方向、风格和至少一位人物，填写本次章纲要求及建议章数（2–12 章），生成章纲候选。默认 6 章只是初始建议，不限制作品最终长度。

本步完成全书章纲，尚未展开 Scene/Beat 或生成 Chapter Brief；“确认章纲”不等于批准正式章节开工。原演示章纲折叠并明确标记 Mock，与真实规划分开。

## 作者操作

- 点“编辑这份章纲”，左侧选章、右侧编辑目的、事件、弧光、读者披露/保留、参与人物、目标字数和可选故事时点。
- 可以重排、增删章节；在幕结构中修改幕标题/作用、增加幕，把章节移到其他幕后再删除空幕。默认三幕可调整为 1–5 幕。
- 章节 ID 不随章号改变。删除章节需确认，同时移除该章风格安排与未来计划引用；目前只修改本份规划草稿，不宣称完成已写正文的影响分析。
- 风格安排只说明如何在本章运用已确认的风格；未来计划可以绑定一个或多个章节，并填写用途。计划仍未发生，不自动升级为事实，也不是正式伏笔埋设/回收记录。
- “保存草稿”保留未确认版本；“确认章纲”需要明确勾选核对。任何内容改动都会清除当前勾选，避免误用之前的确认。
- 切换候选不会覆盖已打开编辑。请求发生 409 时保留输入、禁用旧保存；关闭后从最新档案重新编辑。上游变化后，旧档案显示待复核，仍可显式编辑并重新确认。

## Agent 技术

```text
PG 当前立意/方向/风格/核心设定（同一事务冻结）
 → 只投影已确认的核心设定
 → story_architect.v1 → Guard → Provider → Schema + 引用校验
 → 原始候选（任务命名空间内的章节 ID）
 → 作者编辑 / 草稿 / 显式确认
 → 章纲快照 + 章节绑定快照（同一事务保存）
```

**模型看到什么**：创作意图、已选方向、已采用 StyleRules、已确认人物/事实/计划的分类材料、本次要求与章数。完整源快照供审计，但其中 pending/rejected 内容不进模型材料；参考原文/锚文本也不传给它。人物动机仍为作者视角，未来计划仍单列，不假装角色已经知道。

**模型产出什么**：acts、chapters、bindings。章纲每章含目的、事件、弧光、揭示/保留、人物引用、目标字数及 nullable storyTime。数组表示阅读顺序，故事时间以分钟表示且未知留空；不以章序判断倒叙错误。模型不得输出确认状态、正文、Scene/Beat 或评分门禁。

**程序校验什么**：幕/章节 ID 唯一且引用存在；每幕有章；人物和计划必须来自已确认集合；禁止悬空、重复绑定和 null 数组；章节数、长度、字数与时间有界。程序不能证明自然语言内容一定符合作者意图，仍由作者审阅。

采用同一模型 Guard：2 分钟总期限，最多 3 次调用（含有限重试/结构修复），token/输出预算沿用配置，不因章节多自动扩大花费。输出不足会失败并保留调用记录，可减少章数后重试。Fake 只验证流程，不代表真实创作质量。

## 版本与存储

新增迁移 013：outline jobs/calls/selections/bindings 以及 planning_heads.outline_version。保留原始任务，作者修改写新快照。

- 生成由服务端读取真实上游，浏览器只传四个预期版本和要求；重复 requestId + 相同内容返回原任务，不再调用模型。
- 上游版本过期不生成、不采用。运行中的任务仍保留原输入；完成只写候选，不覆盖作者档案。
- 保存比较 `input/direction/style/core` 与 `expectedOutlineVersion`。新候选必须来自同 scope 的已完成、版本匹配任务；编辑/复核已存档案必须保留来源链。
- 模型局部 ID 发布时加任务命名空间，避免另一轮生成的同名 chapter-1 混为一章；之后重排只改顺序。作者新建章节使用独立 UUID。
- `OutlineSelection` 与绑定快照原子发布。绑定有独立 version 与 outline/style/core 来源版本，本步随章纲一起递增；不反写基础风格或人物设定。读取时在同一 repeatable-read 事务内读取绑定快照。
- 重启将 running 任务记为 interrupted，started 调用记为 unknown；不自动重发付费请求。

## API

独立 Go 规划接口，前端通过统一 client 的 `/go-api` 代理访问，原 `frontend-api.md` Mock/正文契约不变。

- `GET /planning`：新增 outlineVersion、outlineSelection、outlineJobs（最近 20 次）。
- `POST /planning/outline-jobs`：`{requestId, expected:{input,direction,style,core}, request, chapterCount}` → 202 OutlineJob。
- `POST /planning/outline-selection`：`{expected, expectedOutlineVersion, sourceOutlineVersion, jobId, candidateVersion, content, confirmed}` → OutlineSelection。新候选 sourceOutlineVersion=0，编辑当前档案则取当前版本。
- OutlineSelection：version、bindingsVersion、versions、sourceOutlineVersion、jobId、candidateVersion、content、confirmed、createdAt。
- content：acts[]、chapters[]、bindings `{style:[{chapterId,guidance}], plans:[{planId,chapterIds,purpose}]}`。

只有有效版本的 confirmed 章纲才可成为后续细纲输入。已有正文、正式伏笔承诺及跨章传播仍未接入；本步不提供“按新章纲改写旧稿”的操作。

## 学习顺序

1. `internal/domain/planning/outline.go`：确认子集投影、版本依赖、引用与边界校验。
2. `internal/agents/prompts/story_architect.v1.tmpl` 和对应 schema：把自然语言任务拆成可验证结构。
3. `internal/app/outline.go`：真正给模型的材料与 Guard 调用。
4. `internal/storage/postgres/outline.go`：冻结输入、任务去重、稳定 ID、采用事务与配套绑定。
5. `BackendOutline.tsx` / `OutlineEditor.tsx`：远端状态与本地编辑分离，保存前版本检查。

下一步 M0.4b：选择有效章纲中的一章，展开 Scene/Beat 与 Brief，明确角色可知范围并让作者确认开工材料。
