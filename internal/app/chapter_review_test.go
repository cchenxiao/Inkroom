package app

import (
	"context"
	"inkloom/internal/agents/model"
	"inkloom/internal/config"
	"inkloom/internal/domain/review"
	"strings"
	"testing"
	"time"
)

func reviewInputFixture() ChapterReviewInput {
	return ChapterReviewInput{AssemblyID: "assembly", DraftVersion: 2, AssemblyDigest: strings.Repeat("a", 64), Parts: []ChapterReviewPart{
		{BeatID: "b1", CommitID: "c1", Segments: []ChapterReviewSource{{ID: "s-1", Kind: "passage", Text: "她把铁锁剪断，扔进河里。", SourceID: "seg", SourceVersion: 1}}, Facts: []ChapterReviewSource{{ID: "f-1", Kind: "fact", Text: "渡口只有一把铁锁。", SourceID: "lock", SourceVersion: 1}}},
		{BeatID: "b2", CommitID: "c2", Segments: []ChapterReviewSource{{ID: "s-2", Kind: "passage", Text: "她拿起刚才那把完好的铁锁。", SourceID: "seg", SourceVersion: 4}}, Facts: []ChapterReviewSource{}},
	}}
}
func TestChapterReviewEvidenceAndGate(t *testing.T) {
	in := reviewInputFixture()
	f := ChapterFinding{Finding: review.Finding{ID: "f1", Critic: "hard_consistency", Severity: review.P1, SegmentID: "s-2", Quote: "完好的铁锁", EvidenceRefs: []string{"s-2", "s-1"}, Reason: "同一把锁前段已被剪断丢弃，后段却完好出现，没有交代恢复。", Suggestion: "补充新的锁的来源或保持已剪断状态。", RepairScope: "segment", DraftVersion: 2, EvidenceStatus: "confirmed"}, Evidence: []ChapterEvidence{{Ref: "s-2", Quote: "完好的铁锁"}, {Ref: "s-1", Quote: "把铁锁剪断"}}}
	if err := ValidateChapterFindings(in, "hard_consistency", []ChapterFinding{f}); err != nil {
		t.Fatal(err)
	}
	bad := f
	bad.Evidence = []ChapterEvidence{{Ref: "s-2", Quote: "完好的铁锁"}, {Ref: "s-1", Quote: "人物知道第三章的内容"}}
	if ValidateChapterFindings(in, "hard_consistency", []ChapterFinding{bad}) == nil {
		t.Fatal("fabricated quote accepted")
	}
	bad = f
	bad.EvidenceRefs = []string{"s-2", "f-1"}
	bad.Evidence = []ChapterEvidence{{Ref: "s-2", Quote: "完好的铁锁"}, {Ref: "f-1", Quote: "只有一把铁锁"}}
	if ValidateChapterFindings(in, "hard_consistency", []ChapterFinding{bad}) == nil {
		t.Fatal("another Beat's frozen facts applied")
	}
	j := ChapterReviewJob{Current: true, Status: "completed", Output: &ChapterReviewOutput{Critics: []ChapterCriticResult{{Critic: "hard_consistency", Status: "completed", Findings: []ChapterFinding{f}}, {Critic: "ai_taste", Status: "completed", Findings: []ChapterFinding{}}}}}
	if ChapterReviewBlock(j) == "" {
		t.Fatal("unresolved contradiction passed")
	}
	j.Output.Critics[0].Findings = []ChapterFinding{}
	if ChapterReviewBlock(j) != "" {
		t.Fatal("completed clean review blocked")
	}
	j.Current = false
	if ChapterReviewBlock(j) == "" {
		t.Fatal("old review approved")
	}
}
func TestChapterReviewParallelFailureAndBudget(t *testing.T) {
	in := reviewInputFixture()
	chat := model.NewFake([]model.Step{{Role: "chapter_consistency", Content: `{"findings":[]}`}, {Role: "chapter_language", Content: `{"findings":[]}`, FinishReason: model.Truncated}})
	out, err := reviewChapterWith(context.Background(), chat, in)
	if err == nil || len(out.Critics) != 2 || out.Critics[0].Status != "completed" || out.Critics[1].Status != "failed" {
		t.Fatal("partial failure became clean review", out, err)
	}
	calls := 0
	_, err = ReviewChapter(context.Background(), config.Config{Model: "fake", MaxCalls: 4, MaxTokens: 1, MaxOutputTokens: 2048, CallTimeout: time.Second}, in, func(context.Context, model.CallRecord) error { calls++; return nil })
	if err == nil || calls != 0 {
		t.Fatal("insufficient whole-review budget started paid calls", err, calls)
	}
}
