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

type alwaysClearContinuity struct{ t *testing.T }

func (m alwaysClearContinuity) Generate(_ context.Context, in model.Input) (model.Output, model.Usage, error) {
	if strings.Contains(string(in.Material), "expectedSegment") || strings.Contains(string(in.Material), "requiredEvidence") {
		m.t.Fatal("grader label leaked")
	}
	var body struct {
		Pass    bool     `json:"continuityPass"`
		Targets []string `json:"targets"`
	}
	// Targets in the ordinary fact pass are objects; only decode the dedicated pass.
	var mode struct {
		Pass bool `json:"continuityPass"`
	}
	_ = json.Unmarshal(in.Material, &mode)
	var raw []byte
	if mode.Pass {
		if err := json.Unmarshal(in.Material, &body); err != nil {
			m.t.Fatal(err)
		}
		raw, _ = json.Marshal(map[string]any{"checked": body.Targets, "issues": []any{}})
	} else {
		raw = []byte(`{"findings":[]}`)
	}
	return model.Output{Content: string(raw), FinishReason: model.Complete}, model.Usage{Known: true, InputTokens: 10, OutputTokens: 10}, nil
}
func TestContinuityGraderRejectsFalseClearWithoutLeakingAnswers(t *testing.T) {
	r, err := RunContinuity(context.Background(), "fake", model.Limits{Calls: 14, Tokens: 128000, OutputTokens: 8192, Timeout: time.Second}, alwaysClearContinuity{t})
	if err == nil || r.Total != 9 || r.Passed != 4 {
		t.Fatalf("false clear passed: %+v %v", r, err)
	}
}

func TestContinuitySelectionIsExplicitAndUnknownCasesMakeNoCalls(t *testing.T) {
	limits := model.Limits{Calls: 14, Tokens: 128000, OutputTokens: 8192, Timeout: time.Second}
	r, err := RunContinuity(context.Background(), "fake", limits, alwaysClearContinuity{t}, "long-bag-returned")
	if err != nil || r.DatasetTotal != 9 || r.Total != 1 || r.Passed != 1 || len(r.SelectedCases) != 1 || len(r.Results[0].Calls) != 2 {
		t.Fatal(r.Total, r.Passed, err)
	}
	_, err = RunContinuity(context.Background(), "fake", limits, model.NewFake(nil), "unknown")
	if err == nil {
		t.Fatal("unknown case accepted")
	}
}

func TestCompactContinuityPairKeepsLengthAndSingleCausalDifference(t *testing.T) {
	var cs []ContinuityCase
	if err := json.Unmarshal(continuityCompactCasesJSON, &cs); err != nil {
		t.Fatal(err)
	}
	if len(cs) != 2 {
		t.Fatal("expected a normal/error pair")
	}
	bridge := "她掀开小铁柜的搭扣，取出蓝布袋放回值班桌，再把信封放在旁边。"
	for _, c := range cs {
		n := 0
		for _, s := range c.Texts {
			n += manuscript.TextLength(s)
		}
		if n < 2000 || n > 3000 || len(c.Texts) != 3 {
			t.Fatal(c.ID, n)
		}
	}
	if cs[0].ExpectedSegment != -1 || cs[1].ExpectedSegment != 2 || !strings.Contains(cs[0].Texts[2], bridge) {
		t.Fatal("invalid control")
	}
	for i, s := range cs[0].Texts {
		if strings.Replace(s, bridge, "她把信封放在蓝布袋旁边。", 1) != cs[1].Texts[i] {
			t.Fatal("uncontrolled pair difference", i)
		}
	}
	r, err := RunCompactContinuity(context.Background(), "fake", model.Limits{Calls: 4, Tokens: 128000, OutputTokens: 8192, Timeout: time.Second}, alwaysClearContinuity{t})
	if err == nil || r.Total != 2 || r.Passed != 1 {
		t.Fatal("false clear must fail erroneous compact sample", r.Total, r.Passed, err)
	}
}

func TestQuantityPairHasOnlyOneChangedCountAndRejectsFalseClear(t *testing.T) {
	var cs []ContinuityCase
	if err := json.Unmarshal(continuityQuantityCasesJSON, &cs); err != nil {
		t.Fatal(err)
	}
	if len(cs) != 2 || cs[0].ExpectedSegment != -1 || cs[1].ExpectedSegment != 2 {
		t.Fatal("invalid quantity pair")
	}
	for i, s := range cs[0].Texts {
		expected := s
		if i == 2 {
			expected = strings.Replace(s, "里面还剩一枚铜签", "里面还剩两枚铜签", 1)
		}
		if expected != cs[1].Texts[i] {
			t.Fatal("uncontrolled quantity difference")
		}
	}
	r, err := RunQuantityContinuity(context.Background(), "fake", model.Limits{Calls: 4, Tokens: 128000, OutputTokens: 8192, Timeout: time.Second}, alwaysClearContinuity{t})
	if err == nil || r.Passed != 1 || r.Total != 2 {
		t.Fatal(r.Total, r.Passed, err)
	}
}
