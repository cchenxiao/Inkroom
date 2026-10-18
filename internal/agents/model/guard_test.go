package model

import (
	"context"
	"testing"
	"time"
)

func TestTruncatedCallIsRecordedAsUnsuccessfulWithoutAutomaticRetry(t *testing.T) {
	records := []CallRecord{}
	g := NewGuard(NewFake([]Step{{Role: "hard_consistency", Content: `{}`, FinishReason: Truncated}}), Limits{Calls: 3, Tokens: 10000, OutputTokens: 100, Timeout: time.Second, OnCall: func(_ context.Context, c CallRecord) error { records = append(records, c); return nil }})
	out, _, err := g.Generate(context.Background(), Input{Purpose: Generate, Role: "hard_consistency", SystemPrompt: "check", UserPrompt: "text", PromptVersion: "test.v1"})
	if err != nil || out.FinishReason != Truncated || len(records) != 2 || records[1].Phase != "finished" || records[1].Success || records[1].Attempt != 1 {
		t.Fatal(out, err, records)
	}
}

type policyProbe struct {
	inputs    []Input
	deadlines []time.Duration
}

func (p *policyProbe) Generate(ctx context.Context, in Input) (Output, Usage, error) {
	p.inputs = append(p.inputs, in)
	d, _ := ctx.Deadline()
	p.deadlines = append(p.deadlines, time.Until(d))
	return Output{FinishReason: Complete}, Usage{Known: true}, nil
}
func TestConsistencyBudgetMatchesProviderAndAudit(t *testing.T) {
	p := &policyProbe{}
	records := []CallRecord{}
	g := NewGuard(p, Limits{Calls: 5, Tokens: 128000, OutputTokens: 8192, Timeout: time.Minute, ConsistencyOutputTokens: 30000, ConsistencyTimeout: 90 * time.Second, OnCall: func(_ context.Context, c CallRecord) error { records = append(records, c); return nil }})
	for _, role := range []string{"writer", "hard_consistency", "chapter_consistency", "ai_taste"} {
		_, _, err := g.Generate(context.Background(), Input{Role: role, SystemPrompt: "check", UserPrompt: "text", PromptVersion: "test"})
		if err != nil {
			t.Fatal(err)
		}
	}
	for i, in := range p.inputs {
		want, timeout := 8192, time.Minute
		if i == 1 || i == 2 {
			want, timeout = 30000, 90*time.Second
		}
		c := records[2*i]
		if in.OutputTokens != want || in.CallTimeout != timeout || c.OutputLimit != want || c.TimeoutMs != timeout.Milliseconds() || c.StartedAt.IsZero() || c.ReservedTokens < want || p.deadlines[i] > timeout || p.deadlines[i] < timeout-time.Second {
			t.Fatal(in, c, p.deadlines[i])
		}
		if records[2*i+1].StartedAt != c.StartedAt {
			t.Fatal("start time changed on completion")
		}
	}
	// A larger role allowance cannot bypass the overall run budget.
	p = &policyProbe{}
	g = NewGuard(p, Limits{Calls: 1, Tokens: 10000, OutputTokens: 8192, Timeout: time.Second, ConsistencyOutputTokens: 30000})
	_, _, err := g.Generate(context.Background(), Input{Role: "hard_consistency", SystemPrompt: "check", UserPrompt: "text", PromptVersion: "test"})
	if err != ErrBudgetExhausted || len(p.inputs) != 0 {
		t.Fatal("unreserved provider call", err)
	}
}

func TestAuthorOperationBudgetKeepsHistoryAndBoundsResume(t *testing.T) {
	now := time.Now().UTC()
	history := []CallRecord{{Number: 14, StartedAt: now.Add(-time.Minute), Phase: "finished", Usage: Usage{Known: true, InputTokens: 128000}}}
	records := []CallRecord{}
	limits := Limits{History: history, BudgetSince: now, Calls: 1, Tokens: 1000, OutputTokens: 100, Timeout: time.Second, OnCall: func(_ context.Context, c CallRecord) error { records = append(records, c); return nil }}
	g := NewGuard(&policyProbe{}, limits)
	input := Input{Role: "ai_taste", SystemPrompt: "check", UserPrompt: "text", PromptVersion: "test"}
	if _, _, err := g.Generate(context.Background(), input); err != nil {
		t.Fatal(err)
	}
	if records[1].Number != 15 || g.Usage().InputTokens != 128000 {
		t.Fatal(records, g.Usage())
	}
	limits.History = append(history, records[1])
	resumed := NewGuard(&policyProbe{}, limits)
	if _, _, err := resumed.Generate(context.Background(), input); err != ErrBudgetExhausted {
		t.Fatal("resume reset budget", err)
	}
}
