package postgres

import (
	"inkloom/internal/domain/manuscript"
	"testing"
)

func TestNarrativeFreshnessIgnoresVersionOnlyChanges(t *testing.T) {
	a := manuscript.Passage{State: "candidate", RunID: "first", Version: 1, Segments: []manuscript.Segment{{ID: "s", BeatID: "b", SceneID: "scene", POV: "甲", Text: "他开门。", ChapterID: "beat-draft", Version: 1}}}
	b := a
	b.State = "adopted"
	b.RunID = "recheck"
	b.Version = 7
	b.Segments = append([]manuscript.Segment{}, a.Segments...)
	b.Segments[0].Version = 7
	b.Segments[0].ChapterID = "chapter-draft"
	if !sameNarrative(a, b) {
		t.Fatal("metadata-only changes invalidate neighboring review")
	}
	b.Segments[0].Text = "他关门。"
	if sameNarrative(a, b) {
		t.Fatal("changed prose accepted")
	}
	if sameNarrative(manuscript.Passage{}, b) {
		t.Fatal("newly saved prose did not invalidate missing neighbor")
	}
	b.Segments[0] = a.Segments[0]
	b.Segments[0].POV = "乙"
	if sameNarrative(a, b) {
		t.Fatal("changed viewpoint accepted")
	}
}
