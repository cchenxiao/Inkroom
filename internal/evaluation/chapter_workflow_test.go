package evaluation

import (
	"context"
	"encoding/json"
	"inkloom/internal/agents/model"
	"inkloom/internal/domain/manuscript"
	"strings"
	"testing"
	"time"
)

type workflowModel struct {
	t     *testing.T
	short bool
}

func (m workflowModel) Generate(_ context.Context, in model.Input) (model.Output, model.Usage, error) {
	// Detect fixture/grader leakage and verify actual long-input contracts, not only output status.
	if strings.Contains(string(in.Material), "acceptance") || strings.Contains(string(in.Material), "WorkflowCheck") {
		m.t.Fatal("grader leaked")
	}
	if strings.Contains(string(in.Material), `"continuityPass":true`) {
		var body struct {
			Targets []string `json:"targets"`
		}
		_ = json.Unmarshal(in.Material, &body)
		raw, _ := json.Marshal(map[string]any{"checked": body.Targets, "issues": []any{}})
		return model.Output{Content: string(raw), FinishReason: model.Complete}, model.Usage{Known: true, InputTokens: 10, OutputTokens: 10}, nil
	}
	var raw any
	switch in.Role {
	case "planned_writer":
		var inBody struct {
			Targets []manuscript.ContextBundle `json:"targets"`
			Context manuscript.ContextBundle   `json:"context"`
			Rewrite *manuscript.AuthorRewrite  `json:"rewrite"`
		}
		if err := json.Unmarshal(in.Material, &inBody); err != nil {
			m.t.Fatal(err)
		}
		if inBody.Rewrite == nil {
			repeat := 80
			if m.short {
				repeat = 1
			}
			parts := []map[string]string{}
			for _, target := range inBody.Targets {
				parts = append(parts, map[string]string{"beatId": target.Beat.ID, "text": strings.Repeat("林宁核对登记，陈禾等着。", repeat)})
			}
			raw = map[string]any{"parts": parts}
		} else {
			if len(inBody.Context.Neighbors) != 2 || inBody.Context.Neighbors[0].Version != 2 || inBody.Context.Neighbors[0].State != "candidate" || !strings.Contains(inBody.Context.Neighbors[0].Segments[0].Text, "左腕") {
				m.t.Fatal("latest unadopted neighbor not delivered")
			}
			text := "左腕的袋中取出两枚，留下了一枚。" + strings.Repeat("林宁核对登记，陈禾等着。", 60)
			if inBody.Rewrite.End-inBody.Rewrite.Start == 4 {
				text = "还剩一枚"
			}
			raw = map[string]string{"text": text}
		}
	case "hard_consistency":
		var mat struct {
			Request  *manuscript.AuthorRewrite `json:"authorRequest"`
			Segments []manuscript.Segment      `json:"segments"`
		}
		if err := json.Unmarshal(in.Material, &mat); err != nil {
			m.t.Fatal(err)
		}
		out := map[string]any{"findings": []any{}}
		if strings.Contains(string(in.OutputSchema), `"continuity"`) {
			checks := []map[string]any{}
			for _, s := range mat.Segments {
				q := string([]rune(s.Text)[:min(80, len([]rune(s.Text)))])
				checks = append(checks, map[string]any{"transitions": []map[string]string{{"entity": "样例", "quote": q, "state": "离线"}}, "segmentId": s.ID, "status": "clear", "openingQuote": q, "closingQuote": q, "reason": "离线契约样例"})
			}
			out["continuity"] = checks
		}
		if mat.Request != nil {
			out["authorCheck"] = map[string]string{"status": "addressed", "reason": "离线脚本仅验证管线", "quote": mat.Segments[0].Text}
		}
		raw = out
	default:
		raw = map[string]any{"findings": []any{}}
	}
	data, err := json.Marshal(raw)
	return model.Output{Content: string(data), FinishReason: model.Complete}, model.Usage{Known: true, InputTokens: 10, OutputTokens: 10}, err
}
func TestChapterWorkflowLengthScopeAndBudget(t *testing.T) {
	b := ChapterWorkflowInput()
	if _, err := b.Freeze(); err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct {
		name  string
		short bool
		calls int
		want  int
	}{{"complete", false, 14, 3}, {"short-chapter", true, 14, 2}, {"budget-stops-dependent-stages", false, 1, 0}} {
		t.Run(tc.name, func(t *testing.T) {
			r, err := RunChapterWorkflow(context.Background(), "fake", "script", model.Limits{Calls: tc.calls, Tokens: 128000, OutputTokens: 8192, Timeout: time.Second}, workflowModel{t, tc.short})
			if r.Passed != tc.want || r.Total != 3 || (err == nil) != (tc.want == 3) {
				t.Fatalf("passed=%d total=%d error=%v stages=%+v", r.Passed, r.Total, err, r.Stages)
			}
			count := 0
			for _, s := range r.Stages {
				count += len(s.Calls)
			}
			if count > tc.calls {
				t.Fatal("budget reset between stages")
			}
		})
	}
}

type truncatedWorkflowCritic struct{ workflowModel }

func (m truncatedWorkflowCritic) Generate(ctx context.Context, in model.Input) (model.Output, model.Usage, error) {
	if in.Role == "hard_consistency" && strings.Contains(string(in.Material), `"authorRequest"`) {
		return model.Output{Content: `{"findings":`, FinishReason: model.Truncated}, model.Usage{Known: true, InputTokens: 10, OutputTokens: 10}, nil
	}
	return m.workflowModel.Generate(ctx, in)
}
func TestChapterWorkflowRetainsCandidateOnReviewTruncation(t *testing.T) {
	r, err := RunChapterWorkflow(context.Background(), "fake", "script", model.Limits{Calls: 14, Tokens: 128000, OutputTokens: 8192, Timeout: time.Second}, truncatedWorkflowCritic{workflowModel{t: t}})
	if err == nil || r.Total != 3 || r.Attempted != 2 || r.Passed != 1 {
		t.Fatalf("truncation falsely passed or changed denominator: %+v error %v", r, err)
	}
	failed := r.Stages[1]
	if len(failed.State.Segments) != 1 || failed.State.Status != "failed" || failed.Error == "" {
		t.Fatal("successful candidate lost after critic failed", failed)
	}
	found := false
	for _, r := range failed.State.CriticReviews {
		if r.Critic == "hard_consistency" && r.Status == "failed" && r.FailureCode == "model_truncated" {
			found = true
		}
	}
	if !found {
		t.Fatal("review failure not classified for the author")
	}

}

func TestExperimentalContinuityUsesExistingWorkflowAndSharedBudget(t *testing.T) {
	for _, limit := range []int{14, 1} {
		r, err := RunChapterWorkflow(context.Background(), "fake", "script", model.Limits{Calls: limit, Tokens: 128000, OutputTokens: 8192, Timeout: time.Second}, workflowModel{t: t}, true)
		count := 0
		checks := 0
		for _, stage := range r.Stages {
			for _, c := range stage.Calls {
				count++
				if c.SchemaVersion == "continuity_pairs.v2" {
					checks++
				}
			}
		}
		if count > limit {
			t.Fatal("experimental pass bypassed guard")
		}
		if limit == 14 && (err != nil || r.Passed != 3 || checks != 3 || count != 12) {
			t.Fatalf("passed=%d calls=%d checks=%d error=%v", r.Passed, count, checks, err)
		}
		if limit == 1 && (err == nil || r.Passed != 0 || checks != 0) {
			t.Fatal("budget failure allowed approval")
		}

	}
}
