package manuscript

import (
	"encoding/json"
	"fmt"
	"inkloom/internal/domain/memory"
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

func (b ContextBundle) baseFactSources() []SourceRef {
	out := append([]SourceRef{}, b.Facts...)
	for _, c := range b.Characters {
		out = append(out, c.HardTraits...)
		out = append(out, c.Knows...)
	}
	return out
}

// ExplicitFacts 只把检索中的已确认 fact 加入事实输入；台词/原文保留为 passage。
func (b ContextBundle) ExplicitFacts() []SourceRef {
	out := append([]SourceRef{}, b.Facts...)
	if b.Retrieval != nil {
		for _, h := range b.Retrieval.Hits {
			if h.Record.Kind == memory.Fact {
				out = append(out, SourceRef{ID: h.Record.ID, Version: h.Record.Version, Text: h.Record.Text})
			}
		}
	}
	return out
}
func (b ContextBundle) FactSources() []SourceRef {
	out := b.baseFactSources()
	if b.Retrieval != nil {
		for _, h := range b.Retrieval.Hits {
			if h.Record.Kind == memory.Fact {
				out = append(out, SourceRef{ID: h.Record.ID, Version: h.Record.Version, Text: h.Record.Text})
			}
		}
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
	if b.Retrieval != nil {
		v := b.Retrieval.View
		if err := memory.ValidateRetrieval(*b.Retrieval); err != nil {
			return frozen, err
		}
		if v.ProjectID != b.ProjectID || v.BranchID != b.BranchID || v.POV != b.POVCharacterID {
			return frozen, fmt.Errorf("retrieval scope does not match manuscript")
		}
		found := false
		for _, c := range b.Characters {
			if c.ID == v.POV && strings.Contains(b.POV, c.Name) {
				found = true
			}
		}
		if !found {
			return frozen, fmt.Errorf("retrieval POV is not the writing POV")
		}
	}
	if t := b.WritingTask; t != nil {
		if k := t.Knowledge; k != nil && (k.Version < 1 || len(k.Digest) != 64) {
			return frozen, fmt.Errorf("invalid published knowledge reference")
		}
		v := t.Versions
		if (!t.Opening && (t.ChapterNumber < 2 || len(t.Publications) != t.ChapterNumber-1 || b.PreviousEnding == nil)) || t.Scope == "" || t.ChapterID == "" || t.PlanVersion < 1 || len(t.SourceDigest) != 64 || t.StoryTime < 0 || v["input"] < 1 || v["direction"] < 1 || v["style"] < 1 || v["core"] < 1 || v["outline"] < 1 || v["bindings"] < 1 || t.Brief.SelectedBeatID != b.Beat.ID || t.Style.POV == "" {
			return frozen, fmt.Errorf("invalid planned writing task")
		}
	}
	for _, target := range b.Targets {
		if len(target.Targets) > 0 || target.ProjectID != b.ProjectID || target.BranchID != b.BranchID {
			return frozen, fmt.Errorf("invalid chapter target")
		}
		if _, err := target.Freeze(); err != nil {
			return frozen, err
		}
	}
	targetIDs := map[string]bool{}
	for _, target := range b.Targets {
		if targetIDs[target.Beat.ID] {
			return frozen, fmt.Errorf("duplicate chapter target")
		}
		targetIDs[target.Beat.ID] = true
	}
	for _, p := range b.Neighbors {
		if p.BeatID == "" || (p.Position != "before" && p.Position != "after") {
			return frozen, fmt.Errorf("invalid neighboring passage identity")
		}
		if p.Version == 0 && p.RunID == "" && len(p.Segments) == 0 {
			continue
		}
		digest, err := ContentDigest(p.Segments)
		if err != nil || p.BeatID == "" || p.RunID == "" || p.DraftID == "" || p.Version < 1 || p.Digest != digest || (p.Position != "before" && p.Position != "after") {
			return frozen, fmt.Errorf("invalid neighboring passage")
		}
	}
	if b.Rewrite != nil {
		if err := b.Rewrite.Validate(b.Original); err != nil {
			return frozen, err
		}
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
	if b.Retrieval != nil {
		for _, h := range b.Retrieval.Hits {
			if h.Record.Kind != memory.Fact {
				sources = append(sources, SourceRef{ID: h.Record.ID, Version: h.Record.Version, Text: h.Record.Text})
			}
		}
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
