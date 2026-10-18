package manuscript

import (
	"fmt"
	"strings"
)

// Passage is narrative evidence, never a character's confirmed knowledge.
type Passage struct {
	State    string    `json:"state,omitempty"` // candidate | adopted; absent on legacy snapshots
	BeatID   string    `json:"beatId"`
	Title    string    `json:"title"`
	DraftID  string    `json:"draftId"`
	RunID    string    `json:"runId"`
	Version  int       `json:"version"`
	Digest   string    `json:"digest"`
	Position string    `json:"position"`
	Segments []Segment `json:"segments"`
}

// AuthorRewrite uses rune offsets into a pinned segment. Only this range is writable.
type AuthorRewrite struct {
	Preview     bool   `json:"preview,omitempty"` // Author selection: preview before changing prose.
	SegmentID   string `json:"segmentId"`
	Original    string `json:"original"`
	Start       int    `json:"start"`
	End         int    `json:"end"`
	Instruction string `json:"instruction"`
}

func (r AuthorRewrite) Validate(segments []Segment) error {
	if strings.TrimSpace(r.Instruction) == "" || len([]rune(r.Instruction)) > 1000 {
		return fmt.Errorf("请填写 1–1000 字修改要求")
	}
	for _, s := range segments {
		if s.ID != r.SegmentID {
			continue
		}
		if s.Text != r.Original || r.Start < 0 || r.End <= r.Start || r.End > len([]rune(s.Text)) {
			return fmt.Errorf("选区原文或版本已变化，请重新选择")
		}
		return nil
	}
	return fmt.Errorf("目标正文不属于本次稿件")
}
func (b ContextBundle) ForBeat(id string) (ContextBundle, bool) {
	if b.Beat.ID == id && len(b.Targets) == 0 {
		return b, true
	}
	for _, target := range b.Targets {
		if target.Beat.ID == id {
			return target, true
		}
	}
	return ContextBundle{}, false
}
func (b ContextBundle) ReadingSources() []SourceRef {
	out := b.FactSources()
	seen := map[string]bool{}
	for _, ref := range out {
		seen[ref.ID] = true
	}
	for _, target := range b.Targets {
		for _, ref := range target.ReadingSources() {
			if !seen[ref.ID] {
				out = append(out, ref)
				seen[ref.ID] = true
			}
		}
	}
	for _, p := range b.Neighbors {
		for _, s := range p.Segments {
			id := "passage/" + p.BeatID + "/" + s.ID
			if !seen[id] {
				out = append(out, SourceRef{ID: id, Version: p.Version, Text: s.Text})
				seen[id] = true
			}
		}
	}
	return out
}
