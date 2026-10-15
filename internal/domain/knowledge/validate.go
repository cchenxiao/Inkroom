package knowledge

import (
	"fmt"
	"slices"
	"strings"
)

func validLocation(l Location) bool {
	return strings.TrimSpace(l.ChapterID) != "" && strings.TrimSpace(l.SegmentID) != "" && l.At.Chapter > 0 && l.At.StoryTime >= 0
}

// Validate 检查显式声明之间是否自洽；不宣称能证明自然语言事实为真。
func (s Snapshot) Validate() error {
	if strings.TrimSpace(s.ProjectID) == "" || strings.TrimSpace(s.BranchID) == "" || s.Version < 1 || !s.Confirmed {
		return fmt.Errorf("knowledge requires confirmed project/branch/version")
	}
	chars := map[string]bool{}
	for _, id := range s.Characters {
		if strings.TrimSpace(id) == "" || id == "reader" || chars[id] {
			return fmt.Errorf("invalid or duplicate character %q", id)
		}
		chars[id] = true
	}
	if len(chars) == 0 {
		return fmt.Errorf("knowledge requires characters")
	}
	facts := map[string]Fact{}
	for _, f := range s.Facts {
		if _, ok := facts[f.ID]; ok || strings.TrimSpace(f.ID) == "" || strings.TrimSpace(f.Text) == "" || f.Version < 1 || !validLocation(f.Source) {
			return fmt.Errorf("invalid or duplicate fact %q", f.ID)
		}
		facts[f.ID] = f
	}
	subjects := map[string]map[string]bool{}
	for _, i := range s.Information {
		f, ok := facts[i.FactID]
		if !ok || (!chars[i.SubjectID] && i.SubjectID != "reader") || !validLocation(i.Source) {
			return fmt.Errorf("invalid information link %q/%q", i.FactID, i.SubjectID)
		}
		if subjects[i.FactID] == nil {
			subjects[i.FactID] = map[string]bool{}
		}
		if subjects[i.FactID][i.SubjectID] {
			return fmt.Errorf("duplicate information state %q/%q", i.FactID, i.SubjectID)
		}
		subjects[i.FactID][i.SubjectID] = true
		switch i.State {
		case Known:
			if i.Belief != "" || i.Source.At.StoryTime < f.Source.At.StoryTime {
				return fmt.Errorf("known fact %q has belief text or predates event", i.FactID)
			}
		case Belief:
			if strings.TrimSpace(i.Belief) == "" {
				return fmt.Errorf("belief %q requires its own text", i.FactID)
			}
		default:
			return fmt.Errorf("unknown knowledge state %q", i.State)
		}
	}
	events := map[string]TimelineEvent{}
	for _, e := range s.Timeline {
		if _, ok := events[e.ID]; ok || strings.TrimSpace(e.ID) == "" || strings.TrimSpace(e.Summary) == "" || !validLocation(e.Source) {
			return fmt.Errorf("invalid or duplicate event %q", e.ID)
		}
		seen := map[string]bool{}
		for _, id := range e.FactIDs {
			if _, ok := facts[id]; !ok || seen[id] {
				return fmt.Errorf("event %q has missing/duplicate fact %q", e.ID, id)
			}
			seen[id] = true
		}
		events[e.ID] = e
	}
	for _, e := range s.Timeline {
		seen := map[string]bool{}
		for _, id := range e.CausalBefore {
			next, ok := events[id]
			if !ok || seen[id] {
				return fmt.Errorf("event %q has missing/duplicate causal link %q", e.ID, id)
			}
			seen[id] = true
			if e.Source.At.StoryTime > next.Source.At.StoryTime {
				return fmt.Errorf("causal link %q -> %q reverses story time", e.ID, id)
			}
		}
	}
	// DFS 三色标记，按 ID 连边；章节倒叙不等于因果倒置。
	colors := map[string]int{}
	var visit func(string) error
	visit = func(id string) error {
		if colors[id] == 1 {
			return fmt.Errorf("timeline causal cycle at %q", id)
		}
		if colors[id] == 2 {
			return nil
		}
		colors[id] = 1
		for _, next := range events[id].CausalBefore {
			if err := visit(next); err != nil {
				return err
			}
		}
		colors[id] = 2
		return nil
	}
	for _, e := range s.Timeline {
		if err := visit(e.ID); err != nil {
			return err
		}
	}
	clues := map[string]bool{}
	for _, f := range s.Foreshadows {
		if strings.TrimSpace(f.ID) == "" || clues[f.ID] || strings.TrimSpace(f.Title) == "" || strings.TrimSpace(f.Payload) == "" || !validLocation(f.Planted) || f.PlanResolveChapter < f.Planted.At.Chapter || !slices.Contains([]string{"P0", "P1", "P2"}, f.Importance) {
			return fmt.Errorf("invalid or duplicate foreshadow %q", f.ID)
		}
		clues[f.ID] = true
		switch f.Status {
		case Open:
			if f.Resolved != nil || f.AbandonReason != "" {
				return fmt.Errorf("open foreshadow %q has closing metadata", f.ID)
			}
		case Closed:
			if f.Resolved == nil || !validLocation(*f.Resolved) || f.Resolved.At.Chapter < f.Planted.At.Chapter || f.AbandonReason != "" {
				return fmt.Errorf("closed foreshadow %q needs later narrative evidence", f.ID)
			}
		case Abandoned:
			if strings.TrimSpace(f.AbandonReason) == "" || f.Resolved != nil {
				return fmt.Errorf("abandoned foreshadow %q needs reason, not resolution", f.ID)
			}
		default:
			return fmt.Errorf("unknown foreshadow status %q", f.Status)
		}
	}
	return nil
}
