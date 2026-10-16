# M0.3a 核心设定候选

这一小步实现独立 Go Planner 和 CLI，尚未接人物世界页的逐条确认与持久化。沿用前面同样的 Prompt → Guard → Provider → Parse，学习重点变成“哪些字段是创作设定，哪些才可能是角色知识”。

```bash
INKLOOM_MODEL=fake go run ./cmd/inkloom -core-settings internal/demo/core_settings.json
```

Fake 是明确标记的流程样例；真实生成可使用已有 DeepSeek 配置。CLI 接收冻结的立意、方向、风格版本和本次补齐范围。版本不匹配不调用模型；文件内部一致性不等于数据库当前版本或正式确认权限。

## 三个分开的输出区

| 区域 | 内容 | 能否作为角色已知 |
| --- | --- | --- |
| characters | want/need/flaw/arcIntent/voice 等作者视角元数据 | 不能，包括该人物本人作为 POV 时 |
| worldFacts | 惯用手、已有关系、关键世界规则等候选 | 不能直接使用；未来须作者确认并过 I10 可见性过滤 |
| plans | 后续抉择、揭示、伏笔用途等未来计划 | 不能；确认过的计划仍不代表事件已经发生 |

人物硬特质通过 hardFactIds 引用事实候选，不复制元数据。ID、主体与知情引用校验；不确定的故事时间/获知时间为 null，未说明的 knownBy 为空，绝不自动推定全员知晓。

程序固定报告 `confirmation=candidate`，模型 Schema 没有 confirmed/采用字段；目前没有入库、索引或正式章节写入操作。结构校验无法证明所有自然语言都被模型正确分类，作者仍须核对未来计划是否被误写成既有事实，M0.3b 再建设逐条确认。

## 风格与事实隔离

Planner 材料只传入已选方向、创作意图和作者确认的 StyleRules；**不传参考文本、分析原文或锚文本**。这能阻断直接把范文人物/情节当作设定材料的路径；作者仍需检查确认后的规则是否含不想带入的专有内容。

输入、digest、提示词/契约版本和实际调用记录随报告保留；最多 3 次调用，含已有的有限重试/结构修复，整体超时 2 分钟。不得据候选自动更新知识库。

下一步 M0.3b：从 PG 的当前方向/风格冻结任务，在“人物世界”展示候选，允许作者编辑/删除/明确选择条目确认，保存具体版本与计划/事实区分。再往后 M0.4 才将确认产物交给正式章节输入。

学习顺序：`domain/planning/core_settings.go` → `prompts/core_planner.v1.tmpl` → `app/core_settings.go` → `cmd/inkloom/core_settings.go`。
