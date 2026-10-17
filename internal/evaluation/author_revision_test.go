package evaluation

import (
	"context"
	"encoding/json"
	"inkloom/internal/agents/model"
	"strings"
	"testing"
	"time"
)

func revisionScript(t *testing.T, falsePass bool) model.ChatModel {
	t.Helper()
	cases, err := AuthorRevisionCases()
	if err != nil {
		t.Fatal(err)
	}
	steps := []model.Step{}
	for _, c := range cases {
		candidate := c.Candidate
		if c.Mode == "rewrite" {
			text := "十六页之后直接到了十九页，十七和十八两页一起不见了。沈砚记下页码，等陆青进门。"
			if c.ExpectedReplacement != "" {
				text = c.ExpectedReplacement
			}
			raw, _ := json.Marshal(map[string]string{"text": text})
			steps = append(steps, model.Step{Role: "planned_writer", Content: string(raw)}, model.Step{Role: "ai_taste", Content: `{"findings":[]}`})
			_, req, err := revisionInput(c)
			if err != nil {
				t.Fatal(err)
			}
			candidate = string([]rune(c.Original)[:req.Start]) + text + string([]rune(c.Original)[req.End:])
		}
		status := c.ExpectedStatuses[0]
		if falsePass && c.ID == "page-rephrased" {
			status = "addressed"
		}
		raw, _ := json.Marshal(map[string]any{"findings": []any{}, "authorCheck": map[string]string{"status": status, "reason": "脚本验证评分与门禁，不代表语义质量。", "quote": candidate}})
		steps = append(steps, model.Step{Role: "hard_consistency", Content: string(raw)})
	}
	return model.NewFake(steps)
}

type blindRevisionModel struct {
	next model.ChatModel
	t    *testing.T
}

func (c blindRevisionModel) Generate(ctx context.Context, in model.Input) (model.Output, model.Usage, error) {
	for _, forbidden := range []string{"expectedStatuses", "expectedReplacement", "requiredPatterns", "forbiddenPatterns", "page-rephrased", "author-revision-v2"} {
		if strings.Contains(string(in.Material), forbidden) {
			c.t.Errorf("grader leaked into model: %s", forbidden)
		}
	}
	return c.next.Generate(ctx, in)
}
func TestAuthorRevisionEvaluationGradesFalsePassAndPreservesScope(t *testing.T) {
	for _, falsePass := range []bool{false, true} {
		limits := model.Limits{Calls: 14, Tokens: 128000, OutputTokens: 1024, Timeout: time.Second}
		result, err := RunAuthorRevision(context.Background(), "fake", "script", limits, blindRevisionModel{revisionScript(t, falsePass), t})
		if result.Total != 8 || result.Attempted != 8 || (err != nil) != falsePass {
			t.Fatalf("unexpected evaluation: %#v error=%v", result, err)
		}
		want := 8
		if falsePass {
			want = 7
		}
		if result.Passed != want {
			t.Fatalf("want %d passed, got %d: %#v", want, result.Passed, result.Results)
		}
		calls := 0
		for _, r := range result.Results {
			calls += len(r.Calls)
			for _, c := range r.Calls {
				if c.InputDigest == "" || c.PromptVersion == "" || c.PromptDigest == "" {
					t.Fatal("missing replay provenance")
				}
			}
		}
		if calls != 12 {
			t.Fatalf("unexpected calls %d", calls)
		}
	}
}
func TestAuthorRevisionEvaluationSharesOneBudget(t *testing.T) {
	result, err := RunAuthorRevision(context.Background(), "fake", "script", model.Limits{Calls: 1, Tokens: 128000, OutputTokens: 1024, Timeout: time.Second}, revisionScript(t, false))
	if err == nil || result.Passed == result.Total {
		t.Fatal("exhausted budget falsely passed suite")
	}
	calls := 0
	for _, r := range result.Results {
		calls += len(r.Calls)
	}
	if calls != 1 || result.Total != 8 {
		t.Fatalf("budget reset or denominator shrank: calls=%d total=%d", calls, result.Total)
	}
}

func TestAuthorRevisionUnknownCaseMakesNoCall(t *testing.T) {
	result, err := RunAuthorRevision(context.Background(), "fake", "script", model.Limits{Calls: 14, Tokens: 128000, OutputTokens: 1024, Timeout: time.Second}, model.NewFake(nil), "not-a-case")
	if err == nil || result.Attempted != 0 {
		t.Fatal("unknown filter must fail before any model call")
	}
}
