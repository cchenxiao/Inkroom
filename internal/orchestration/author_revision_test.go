package orchestration

import (
	"context"
	"inkloom/internal/agents/model"
	"inkloom/internal/domain/manuscript"
	"inkloom/internal/domain/review"
	"testing"
)

func TestRewriteFlowRequiresExplicitAssessment(t *testing.T) {
	request := &manuscript.AuthorRewrite{SegmentID: "s", Original: "他开门。", Start: 1, End: 3, Instruction: "改成敲门"}
	for _, status := range []string{"addressed", "unresolved", "needs_clarification"} {
		t.Run(status, func(t *testing.T) {
			chat := model.NewFake([]model.Step{
				{Role: "planned_writer", Content: `{"text":"敲门"}`},
				{Role: "ai_taste", Content: `{"findings":[]}`},
				{Role: "hard_consistency", Content: `{"findings":[],"authorCheck":{"status":"` + status + `","reason":"针对作者要求检查动作与后文衔接。","quote":"敲门"}}`},
			})
			graph, err := NewChapter(context.Background(), chat, Options{})
			if err != nil {
				t.Fatal(err)
			}
			out, err := graph.Invoke(context.Background(), manuscript.ContextBundle{ChapterID: "chapter", BranchID: "main", Facts: []manuscript.SourceRef{{ID: "f", Version: 1, Text: "门关着。"}}, Beat: manuscript.Beat{ID: "beat", SceneID: "scene", Version: 1}, Rewrite: request, Original: []manuscript.Segment{{ID: "s", Text: request.Original}}})
			if err != nil {
				t.Fatal(err)
			}
			if out.AuthorRequest == nil || out.AuthorRequest.Instruction != request.Instruction {
				t.Fatal("request not persisted")
			}
			if (ApprovalReason(out) == "") != (status == "addressed") {
				t.Fatal("incorrect approval gate", ApprovalReason(out))
			}
		})
	}
}
func TestApprovalRejectsLegacyAndStaleAuthorChecks(t *testing.T) {
	s := ChapterState{DraftVersion: 2, Context: manuscript.ContextBundle{Rewrite: &manuscript.AuthorRewrite{Instruction: "作者要求"}}, Report: review.Report{DraftVersion: 2}, CriticReviews: []CriticReview{{Critic: "hard_consistency", Status: "completed", DraftVersion: 2}, {Critic: "ai_taste", Status: "completed", DraftVersion: 2}}}
	if ApprovalReason(s) == "" {
		t.Fatal("legacy empty findings passed author request")
	}
	s.CriticReviews[0].AuthorCheck = &review.AuthorCheck{Status: "addressed"}
	s.CriticReviews[0].DraftVersion = 1
	if ApprovalReason(s) == "" {
		t.Fatal("stale assessment passed")
	}
}
