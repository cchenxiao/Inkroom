package manuscript

import (
	"fmt"
	"inkloom/internal/domain/memory"
	"reflect"
	"strings"
)

// WithReviewEvidence 返回临时评审材料，不改变 Writer 的冻结输入。
// 只允许同一可见范围的已确认 fact 成为规则；passage 仅作为查证原文。
func (b ContextBundle) WithReviewEvidence(e *memory.RetrievalContext) (ContextBundle, error) {
	out, err := b.Freeze()
	if err != nil || e == nil {
		return out, err
	}
	if err = memory.ValidateRetrieval(*e); err != nil {
		return out, err
	}
	pov := b.POVCharacterID
	if pov == "" {
		for _, c := range b.Characters {
			if c.ID == e.View.POV && strings.Contains(b.POV, c.Name) {
				pov = c.ID
			}
		}
	}
	if e.View.ProjectID != b.ProjectID || e.View.BranchID != b.BranchID || e.View.POV != pov {
		return out, fmt.Errorf("critic evidence scope mismatch")
	}
	if err := b.validateRetrievalView(e.View); err != nil {
		return out, err
	}
	refs, err := ContextRefs(b)
	if err != nil {
		return out, err
	}
	existing := map[string]SourceRef{}
	for _, s := range b.FactSources() {
		existing[s.ID] = s
	}
	for _, s := range b.Sources {
		existing[s.ID] = s
	}
	if b.PreviousEnding != nil {
		existing[b.PreviousEnding.ID] = *b.PreviousEnding
	}
	known := map[string]memory.Hit{}
	if b.Retrieval != nil {
		for _, h := range b.Retrieval.Hits {
			known[h.Record.ID] = h
			existing[h.Record.ID] = SourceRef{ID: h.Record.ID, Version: h.Record.Version, Text: h.Record.Text}
		}
	}
	for _, h := range e.Hits {
		if old, ok := existing[h.Record.ID]; ok {
			if old.Version != h.Record.Version || old.Text != h.Record.Text {
				return out, fmt.Errorf("critic source conflicts with frozen input")
			}
			if prior, ok := known[h.Record.ID]; ok && prior.Digest != h.Digest {
				return out, fmt.Errorf("critic source metadata changed")
			}
			continue
		}
		for _, ref := range refs {
			if ref.ID == h.Record.ID {
				return out, fmt.Errorf("critic source ID collision")
			}
		}
		if h.Record.Kind == memory.Fact {
			out.Facts = append(out.Facts, SourceRef{ID: h.Record.ID, Version: h.Record.Version, Text: h.Record.Text})
		}
	}
	return out, nil
}

func (b ContextBundle) validateRetrievalView(v memory.View) error {
	if t := b.WritingTask; t != nil {
		if !v.CatalogBound || v.At.Chapter != t.ChapterNumber || v.At.StoryTime != t.StoryTime || !reflect.DeepEqual(v.Knowledge, t.Knowledge) || len(v.Publications) != len(t.Publications) {
			return fmt.Errorf("retrieval time or published inputs differ from frozen task")
		}
		for i, p := range t.Publications {
			if v.Publications[i].ID != p.ID || v.Publications[i].ChapterID != p.ChapterID || v.Publications[i].Version != p.Version {
				return fmt.Errorf("retrieval publication version mismatch")
			}
		}
	}
	return nil
}
