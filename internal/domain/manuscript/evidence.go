package manuscript

import (
	"fmt"
	"inkloom/internal/domain/memory"
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
