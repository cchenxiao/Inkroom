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

func TestSelectedRewriteFromAdoptedSourceProducesPreviewWithoutCritics(t *testing.T) {
	req := &manuscript.AuthorRewrite{Preview: true, SegmentID: "s", Original: "他开门。旁人等着。", Start: 1, End: 3, Instruction: "把开门改为敲门"}
	chat := model.NewFake([]model.Step{{Role: "planned_writer", Content: `{"text":"敲门"}`}})
	g, err := NewChapter(context.Background(), chat, Options{})
	if err != nil {
		t.Fatal(err)
	}
	out, err := g.Invoke(context.Background(), manuscript.ContextBundle{ChapterID: "chapter", BranchID: "main", Facts: []manuscript.SourceRef{{ID: "f", Version: 1, Text: "门关着。"}}, Beat: manuscript.Beat{ID: "beat", SceneID: "scene", Version: 1}, Rewrite: req, Original: []manuscript.Segment{{ID: "s", Text: req.Original}, {ID: "other", Text: "另一段不变。"}}})
	if err != nil {
		t.Fatal(err)
	}
	if out.Segments[0].Text != req.Original || out.Segments[1].Text != "另一段不变。" || out.FindingProposal == nil || out.FindingProposal.Replacement != "敲门" || len(out.CriticReviews) != 0 {
		t.Fatal("preview rewrote prose or ran critics", out)
	}
	if ApprovalReason(out) == "" {
		t.Fatal("unconfirmed preview approved")
	}
	next, err := applyFindingAction(context.Background(), out, HumanAction{ID: "apply", Type: "apply_finding", DraftVersion: out.DraftVersion, ProposalID: out.FindingProposal.ID}, model.NewFake(nil))
	if err != nil {
		t.Fatal(err)
	}
	if next.Segments[0].Text != "他敲门。旁人等着。" || next.Segments[1].Text != "另一段不变。" || !next.ReviewPending || next.AuthorRequest == nil {
		t.Fatal("selection application changed outside selection")
	}
}

func TestManualCandidateSavesAllTargetsWithoutModelOrReview(t *testing.T) {
	source := []manuscript.Segment{{ID: "a", Text: "第一处。"}, {ID: "b", Text: "第二处。"}, {ID: "c", Text: "保留。"}}
	b := manuscript.ContextBundle{ChapterID: "chapter", BranchID: "main", Facts: []manuscript.SourceRef{{ID: "f", Version: 1, Text: "固定事实。"}}, Beat: manuscript.Beat{ID: "beat", SceneID: "scene", Version: 1}, Original: source, ManualEdits: map[string]string{"a": "新的一处。", "b": "新的一处😀。"}}
	graph, err := NewChapter(context.Background(), model.NewFake(nil), Options{BaseDraftVersion: 4})
	if err != nil {
		t.Fatal(err)
	}
	out, err := graph.Invoke(context.Background(), b)
	if err != nil {
		t.Fatal(err)
	}
	if source[0].Text != "第一处。" || out.Segments[0].Text != b.ManualEdits["a"] || out.Segments[1].Text != b.ManualEdits["b"] || out.Segments[2].Text != source[2].Text || !out.ReviewPending || len(out.CriticReviews) != 0 || len(out.Revisions[0].Patches) != 2 || ApprovalReason(out) == "" {
		t.Fatal("save changed source, reviewed or omitted a target", out)
	}
	b.ManualEdits["foreign"] = "不存在。"
	if _, err = graph.Invoke(context.Background(), b); err == nil {
		t.Fatal("accepted partial save with invalid target")
	}
}
