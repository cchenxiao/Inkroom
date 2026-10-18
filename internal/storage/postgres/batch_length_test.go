package postgres

import (
	"inkloom/internal/domain/manuscript"
	"inkloom/internal/domain/planning"
	"testing"
)

func TestBatchLengthDeductsPreservedProseWithoutEditingIt(t *testing.T) {
	text := ""
	for range 679 {
		text += "字"
	}
	kept := []manuscript.Passage{{BeatID: "kept", Segments: []manuscript.Segment{{Text: text}}}}
	targets := make([]manuscript.ContextBundle, 3)
	for i := range targets {
		targets[i].WritingTask = &manuscript.WritingTask{ChapterTargetWords: 3000, BeatTargetWords: 750}
	}
	b := manuscript.ContextBundle{}
	setBatchTargets(&b, targets, kept, planning.ChapterPlanSelection{})
	total := 679
	for _, tgt := range b.Targets {
		total += tgt.WritingTask.BeatTargetWords
		if tgt.WritingTask.PreservedWords != 679 {
			t.Fatal(tgt.WritingTask)
		}
	}
	if total != 3000 || kept[0].Segments[0].Text != text {
		t.Fatal("wrong total or edited existing prose", total)
	}
}
