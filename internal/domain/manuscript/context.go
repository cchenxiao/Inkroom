package manuscript

import (
	"encoding/json"
	"fmt"
	"strings"
)

// CharacterFacts 是当前章节可见的最小人物事实；knows 缺一条不代表角色不知道。
// 每条硬特质/知识都有独立来源 ID 和版本，便于 Critic 引用和程序核对。
type CharacterFacts struct {
	ID         string      `json:"id"`
	Name       string      `json:"name"`
	Version    int         `json:"version"`
	HardTraits []SourceRef `json:"hardTraits"`
	Knows      []SourceRef `json:"knows"`
}

func (b ContextBundle) FactSources() []SourceRef {
	out := append([]SourceRef{}, b.Facts...)
	for _, c := range b.Characters {
		out = append(out, c.HardTraits...)
		out = append(out, c.Knows...)
	}
	return out
}

// Freeze 在进入图时复制全部嵌套切片；整个 run 使用这份基础输入版本。
// 此处只负责快照复制和来源校验；存储事务负责版本并发控制。
func (b ContextBundle) Freeze() (ContextBundle, error) {
	raw, err := json.Marshal(b)
	if err != nil {
		return ContextBundle{}, err
	}
	var frozen ContextBundle
	if err := json.Unmarshal(raw, &frozen); err != nil {
		return frozen, err
	}
	if b.ChapterID == "" || b.BranchID == "" || b.Beat.ID == "" || b.Beat.SceneID == "" || b.Beat.Version < 1 {
		return frozen, fmt.Errorf("context requires chapter/branch/beat and a pinned beat version")
	}
	seen := map[string]bool{b.Beat.ID: true}
	for _, c := range b.Characters {
		if c.ID == "" || c.Name == "" || c.Version < 1 || seen[c.ID] {
			return frozen, fmt.Errorf("invalid character snapshot")
		}
		seen[c.ID] = true
	}
	sources := append(append([]SourceRef{}, b.Sources...), b.FactSources()...)
	if b.PreviousEnding != nil {
		sources = append(sources, *b.PreviousEnding)
	}
	for _, s := range sources {
		if s.ID == "" || s.Version < 1 || strings.TrimSpace(s.Text) == "" || seen[s.ID] {
			return frozen, fmt.Errorf("invalid or duplicate source %q", s.ID)
		}
		seen[s.ID] = true
	}
	if len(b.FactSources()) == 0 {
		return frozen, fmt.Errorf("consistency review requires pinned facts")
	}
	return frozen, nil
}
