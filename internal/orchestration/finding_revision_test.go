package orchestration

import (
	"context"
	"github.com/cloudwego/eino/compose"
	"inkloom/internal/agents/model"
	"inkloom/internal/domain/manuscript"
	"inkloom/internal/domain/review"
	"reflect"
	"strings"
	"testing"
)

func localFindingState() ChapterState {
	s := decisionState()
	s.Context = manuscript.ContextBundle{ChapterID: "chapter", BranchID: "main", Beat: manuscript.Beat{ID: "beat", SceneID: "scene", Version: 1}, Facts: []manuscript.SourceRef{{ID: "fact", Version: 1, Text: "固定事实"}}}
	s.Segments[0].Text = "甲说完，又补了半句，乙。另一个问题。第三处。"
	s.Report.Findings = []review.Finding{}
	for i, q := range []string{"甲说完，又补了半句", "另一个问题", "第三处"} {
		s.Report.Findings = append(s.Report.Findings, review.Finding{ID: []string{"f1", "f2", "f3"}[i], SegmentID: "segment", Quote: q, Severity: review.P3, Critic: "ai_taste", EvidenceRefs: []string{"segment"}, RepairScope: "phrase", DraftVersion: 1})
	}
	return s
}
func localRequest(s ChapterState, id string) *manuscript.AuthorRewrite {
	for _, f := range s.Report.Findings {
		if f.ID == id {
			text := s.Segments[0].Text
			offset := strings.Index(text, f.Quote)
			start := len([]rune(text[:offset]))
			return &manuscript.AuthorRewrite{SegmentID: "segment", Original: text, Start: start, End: start + len([]rune(f.Quote)), Instruction: "只修改这条问题"}
		}
	}
	panic("missing finding")
}
func TestLocalFindingPreviewBatchPreservesWorklistAndOnlyReviewsOnRequest(t *testing.T) {
	ctx := context.Background()
	initial := localFindingState()
	current := initial
	cp := decisionCheckpoints{}
	artifacts := map[string]ChapterState{}
	opts := HumanOptions{RunID: "batch", Checkpoints: cp, Usage: func() model.Usage { return model.Usage{Known: true} }, Pause: func(s ChapterState, _ string) { current = s }, Load: func(_ context.Context, key string) (ChapterState, bool, error) {
		s, ok := artifacts[key]
		return s, ok, nil
	}, Save: func(_ context.Context, key string, _ int, s ChapterState, _ string) error {
		artifacts[key] = s
		return nil
	}}
	run := func(a *HumanAction, chat model.ChatModel) {
		t.Helper()
		opts.Action = a
		_, err := RunHuman(ctx, current, chat, opts)
		if _, ok := compose.ExtractInterruptInfo(err); !ok {
			t.Fatalf("gate not restored: %v", err)
		}
	}
	empty := model.NewFake(nil)
	run(nil, empty)
	proposal := &HumanAction{ID: "preview", Type: "propose_finding", FindingID: "f1", DraftVersion: 1, Rewrite: localRequest(current, "f1")}
	run(proposal, model.NewFake([]model.Step{{Role: "planned_writer", Content: `{"text":"甲又说了半句，"}`}}))
	if current.DraftVersion != 1 || !reflect.DeepEqual(current.Segments, initial.Segments) || current.FindingProposal == nil || current.FindingProposal.Replacement != "甲又说了半句" {
		t.Fatal("preview mutated manuscript or kept duplicate punctuation")
	}
	if ApprovalReason(current) == "" {
		t.Fatal("pending preview allowed approval")
	}
	if ValidateHumanAction(current, HumanAction{ID: "wrong", Type: "apply_finding", DraftVersion: 1, ProposalID: "other"}) == nil {
		t.Fatal("unrelated proposal accepted")
	}
	run(&HumanAction{ID: "discard", Type: "discard_finding", DraftVersion: 1, ProposalID: "preview"}, empty)
	if current.FindingProposal != nil || current.DraftVersion != 1 {
		t.Fatal("discard altered manuscript")
	}
	proposal.ID = "preview2"
	run(proposal, model.NewFake([]model.Step{{Role: "planned_writer", Content: `{"text":"甲又说了半句，"}`}}))
	run(&HumanAction{ID: "apply", Type: "apply_finding", DraftVersion: 1, ProposalID: "preview2"}, empty)
	if current.DraftVersion != 2 || !current.ReviewPending || !reflect.DeepEqual(initial.Report, current.Report) || strings.Contains(current.Segments[0].Text, "，，") {
		t.Fatal("apply lost report, rewrote boundaries or falsely passed")
	}
	if ApprovalReason(current) == "" {
		t.Fatal("unreviewed local edit allowed approval")
	}
	run(&HumanAction{ID: "second", Type: "edit_finding", FindingID: "f2", DraftVersion: 2, Rewrite: localRequest(current, "f2"), Text: "第二处已改"}, empty)
	if len(current.FindingChanges) != 2 || current.Report.DraftVersion != 1 || current.DraftVersion != 3 {
		t.Fatal("cannot batch edits against retained report")
	}
	run(&HumanAction{ID: "keep", Type: "finding_decision", FindingID: "f3", DraftVersion: 3, Decision: "keep", Instruction: "作者确认保留"}, empty)
	if ApprovalReason(current) == "" {
		t.Fatal("keep bypassed batch review")
	}
	run(&HumanAction{ID: "review", Type: "review_batch", DraftVersion: 3}, model.NewFake([]model.Step{{Role: "hard_consistency", Content: `{"findings":[]}`}, {Role: "ai_taste", Content: `{"findings":[]}`}}))
	if current.ReviewPending || current.FindingChanges != nil || FindingKept(current, "f3") || current.Report.DraftVersion != 3 || ApprovalReason(current) != "" {
		t.Fatalf("full review did not clear gate: %s", ApprovalReason(current))
	}
}
func TestLocalFindingRejectsWideningAndOldQuote(t *testing.T) {
	s := localFindingState()
	a := HumanAction{ID: "x", Type: "propose_finding", FindingID: "f1", DraftVersion: 1, Rewrite: localRequest(s, "f1")}
	a.Rewrite.End = len([]rune(a.Rewrite.Original))
	if ValidateHumanAction(s, a) == nil {
		t.Fatal("whole beat accepted as local finding")
	}
	a.Rewrite = localRequest(s, "f1")
	s.Segments[0].Text += "改变"
	if ValidateHumanAction(s, a) == nil {
		t.Fatal("stale original accepted")
	}
}
