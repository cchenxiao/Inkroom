package manuscript

import "unicode"

// LengthSummary is deterministic guidance, never a fact or an automatic rewrite/approval gate.
type LengthSummary struct {
	Scope  string `json:"scope"`
	Actual int    `json:"actual"`
	Target int    `json:"target"`
	Lower  int    `json:"lower"`
	Upper  int    `json:"upper"`
	Status string `json:"status"`
}

func TextLength(text string) int {
	n := 0
	for _, r := range text {
		if !unicode.IsSpace(r) {
			n++
		}
	}
	return n
}
func MeasureLength(segments []Segment, b ContextBundle) *LengthSummary {
	if b.WritingTask == nil || len(segments) == 0 {
		return nil
	}
	scope, target := "beat", b.WritingTask.BeatTargetWords
	if len(b.Targets) > 0 {
		scope, target = "chapter", 0
		for _, part := range b.Targets {
			if part.WritingTask != nil {
				target += part.WritingTask.BeatTargetWords
			}
		}
		if target == 0 {
			target = b.WritingTask.ChapterTargetWords
		}
	}
	if target <= 0 {
		return nil
	}
	out := &LengthSummary{Scope: scope, Target: target, Lower: (target*3 + 3) / 4, Upper: target * 4 / 3, Status: "within"}
	if scope == "chapter" && b.WritingTask.ChapterTargetWords <= 3000 && b.WritingTask.ChapterTargetWords > b.WritingTask.PreservedWords {
		out.Upper = min(out.Upper, 3000-b.WritingTask.PreservedWords)
	}
	for _, s := range segments {
		out.Actual += TextLength(s.Text)
	}
	if out.Actual < out.Lower {
		out.Status = "short"
	} else if out.Actual > out.Upper {
		out.Status = "long"
	}
	return out
}
