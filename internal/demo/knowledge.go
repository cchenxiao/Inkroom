package demo

import (
	_ "embed"
	"encoding/json"

	"inkloom/internal/domain/knowledge"
)

//go:embed knowledge.json
var knowledgeSeed []byte

// KnowledgeSnapshot 是独立教学快照，模拟作者确认过的资料，不冒充当前数据库的正式设定。
// 每次返回独立值；不会把 fixture 的 confirmed 标志用于授权真实作品更新。
func KnowledgeSnapshot() (knowledge.Snapshot, error) {
	var s knowledge.Snapshot
	if err := json.Unmarshal(knowledgeSeed, &s); err != nil {
		return s, err
	}
	return s, s.Validate()
}
