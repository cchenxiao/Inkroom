package evaluation

import (
	"context"
	"errors"
	"inkloom/internal/agents/model"
	"inkloom/internal/domain/memory"
	"inkloom/internal/domain/review"
	"testing"
)

func TestGradeRejectsEmptyPassAndUnsupportedConclusions(t *testing.T) {
	c := Case{Expect: "hard_conflict", ExpectedRule: "lock", ExpectSearch: true}
	for _, tc := range []struct {
		name   string
		result Result
		pass   bool
	}{
		{name: "skipped query empty pass", result: Result{Trace: memory.LookupTrace{Stop: "ready"}}},
		{name: "queried but wrong fact", result: Result{Trace: memory.LookupTrace{Stop: "ready", Steps: []memory.LookupStep{{Status: "completed"}}}, Findings: []review.Finding{{Severity: review.P0, RuleRef: "other"}}}},
		{name: "correct plus invented conflict", result: Result{Trace: memory.LookupTrace{Stop: "ready", Steps: []memory.LookupStep{{Status: "completed"}}}, Findings: []review.Finding{{Severity: review.P0, RuleRef: "lock", EvidenceStatus: "confirmed"}, {Severity: review.P0, RuleRef: "other", EvidenceStatus: "confirmed"}}}},
		{name: "validated intended conflict", pass: true, result: Result{Trace: memory.LookupTrace{Stop: "ready", Steps: []memory.LookupStep{{Status: "completed"}}}, Findings: []review.Finding{{Severity: review.P0, RuleRef: "lock", EvidenceStatus: "confirmed"}}}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			grade(c, &tc.result)
			if tc.result.Passed != tc.pass {
				t.Fatalf("%+v", tc.result)
			}
		})
	}
}

func TestGradeDialogueAndQueryDecision(t *testing.T) {
	c := Case{Expect: "human_lie", ExpectedRule: "hand"}
	r := Result{Trace: memory.LookupTrace{Stop: "ready"}, Findings: []review.Finding{{Severity: review.P3, RuleRef: "hand", EvidenceStatus: "confirmed", PossibleDialogueLie: true, RequiresHuman: true}}}
	grade(c, &r)
	if r.Passed {
		t.Fatal("confirmed lie interpretation passed")
	}
	r.Findings[0].EvidenceStatus = "uncertain"
	grade(c, &r)
	if !r.Passed {
		t.Fatal("uncertain human decision failed")
	}
	r.Trace.Steps = []memory.LookupStep{{Status: "failed", Query: "right hand"}}
	r.Error = "search failed"
	grade(c, &r)
	if r.QueryMatched {
		t.Fatal("failed query was counted as no query")
	}
}

func TestInterruptedEvaluationKeepsDatasetIdentity(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	calls := 0
	report, err := Run(ctx, "fake", "scripted-fake", model.Limits{}, func(c Case) (model.ChatModel, error) { calls++; return Scripted(c) }, false)
	if !errors.Is(err, context.Canceled) || report.Total != 5 || report.DatasetDigest == "" || len(report.Results) != 0 || calls != 0 {
		t.Fatalf("interrupted dataset metadata: total=%d digest=%q results=%d calls=%d err=%v", report.Total, report.DatasetDigest, len(report.Results), calls, err)
	}
}
