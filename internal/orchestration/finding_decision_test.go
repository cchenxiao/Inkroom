package orchestration

import (
	"context"
	"reflect"
	"strings"
	"testing"

	"github.com/cloudwego/eino/compose"
	"inkloom/internal/agents/model"
	"inkloom/internal/domain/manuscript"
	"inkloom/internal/domain/review"
)

type decisionCheckpoints map[string][]byte

func (c decisionCheckpoints) Get(_ context.Context, id string) ([]byte, bool, error) {
	b, ok := c[id]
	return b, ok, nil
}
func (c decisionCheckpoints) Set(_ context.Context, id string, b []byte) error { c[id] = b; return nil }

func decisionState() ChapterState {
	return ChapterState{DraftVersion: 1, Segments: []manuscript.Segment{{ID: "segment", Text: "他保留了原来的说法。", Version: 1}},
		Report:        review.Report{DraftVersion: 1, Findings: []review.Finding{{ID: "finding", Severity: review.P3, RequiresHuman: true}}},
		CriticReviews: []CriticReview{{Critic: "hard_consistency", Status: "completed", DraftVersion: 1}, {Critic: "ai_taste", Status: "completed", DraftVersion: 1}}}
}
func TestFindingDecisionCheckpointWithoutModelOrManuscriptChange(t *testing.T) {
	ctx := context.Background()
	initial := decisionState()
	artifacts := map[string]ChapterState{}
	var paused ChapterState
	opts := HumanOptions{RunID: "test", Checkpoints: decisionCheckpoints{},
		Pause: func(s ChapterState, _ string) { paused = s },
		Load: func(_ context.Context, key string) (ChapterState, bool, error) {
			s, ok := artifacts[key]
			return s, ok, nil
		},
		Save: func(_ context.Context, key string, expected int, s ChapterState, origin string) error {
			if expected != 1 || s.DraftVersion != 1 || origin != "human_decision" || !reflect.DeepEqual(s.Segments, initial.Segments) {
				t.Fatal("decision changed manuscript")
			}
			artifacts[key] = s
			return nil
		},
	}
	// An empty fake fails if any model call is attempted.
	chat := model.NewFake(nil)
	_, err := RunHuman(ctx, initial, chat, opts)
	if _, ok := compose.ExtractInterruptInfo(err); !ok {
		t.Fatalf("initial pause: %v", err)
	}
	opts.Action = &HumanAction{ID: "keep", Type: "finding_decision", DraftVersion: 1, FindingID: "finding", Decision: "keep"}
	_, err = RunHuman(ctx, paused, chat, opts)
	if _, ok := compose.ExtractInterruptInfo(err); !ok {
		t.Fatalf("decision did not return to gate: %v", err)
	}
	if !FindingKept(paused, "finding") || ApprovalReason(paused) != "" || len(paused.FindingDecisions) != 1 || paused.FindingDecisions[0].Reason != "" {
		t.Fatalf("decision missing: %+v", paused.FindingDecisions)
	}
	opts.Action = &HumanAction{ID: "reopen", Type: "finding_decision", DraftVersion: 1, FindingID: "finding", Decision: "reopen"}
	_, err = RunHuman(ctx, paused, chat, opts)
	if _, ok := compose.ExtractInterruptInfo(err); !ok {
		t.Fatalf("reopen: %v", err)
	}
	if FindingKept(paused, "finding") || ApprovalReason(paused) == "" || len(paused.FindingDecisions) != 2 {
		t.Fatal("reopen lost history or gate")
	}
}
func TestFindingDecisionVersionAndApprovalGuards(t *testing.T) {
	s := decisionState()
	a := HumanAction{ID: "decision", Type: "finding_decision", DraftVersion: 1, FindingID: "finding", Decision: "keep", Instruction: "作者判断"}
	for _, mutate := range []func(*HumanAction){func(a *HumanAction) { a.DraftVersion = 2 }, func(a *HumanAction) { a.FindingID = "missing" }, func(a *HumanAction) { a.Instruction = strings.Repeat("字", 1001) }, func(a *HumanAction) { a.Decision = "approve" }} {
		invalid := a
		mutate(&invalid)
		if ValidateHumanAction(s, invalid) == nil {
			t.Fatalf("accepted invalid action: %+v", invalid)
		}
	}
	s.FindingDecisions = []FindingDecision{{FindingID: "finding", DraftVersion: 1, Decision: "keep", Reason: "作者判断"}}
	for _, severity := range []review.Severity{review.P0, review.P1, review.P2} {
		s.Report.Findings[0].Severity = severity
		if ApprovalReason(s) == "" {
			t.Fatal("decision bypassed hard finding")
		}
	}
	s.DraftVersion = 2
	if FindingKept(s, "finding") {
		t.Fatal("decision leaked into new version")
	}
}

func TestAuthorMayKeepStyleP2ButNotHardOrUnreviewedContent(t *testing.T) {
	s := decisionState()
	s.Report.Findings[0].Severity = review.P2
	s.Report.Findings[0].Critic = "ai_taste"
	s.Report.Findings[0].RequiresHuman = false
	s.FindingDecisions = []FindingDecision{{FindingID: "finding", DraftVersion: 1, Decision: "keep"}}
	if ApprovalReason(s) != "" {
		t.Fatal(ApprovalReason(s))
	}
	for _, critic := range []string{"hard_consistency", ""} {
		s.Report.Findings[0].Critic = critic
		if ApprovalReason(s) == "" {
			t.Fatal("hard/unknown P2 bypassed")
		}
	}
	s.Report.Findings[0].Critic = "ai_taste"
	s.ReviewPending = true
	if ApprovalReason(s) == "" {
		t.Fatal("unreviewed changes bypassed")
	}
}
