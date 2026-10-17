package agents

import (
	"context"
	"encoding/json"
	"inkloom/internal/agents/model"
	"inkloom/internal/domain/manuscript"
	"strings"
	"testing"
)

func TestContinuityPairsRestoreEvidenceAndRejectInvalidReferences(t *testing.T) {
	ss := []manuscript.Segment{{ID: "current", Text: "她把袋子放在桌上。"}}
	b := manuscript.ContextBundle{Neighbors: []manuscript.Passage{{BeatID: "before", Version: 2, Position: "before", Segments: []manuscript.Segment{{ID: "previous", Text: "她把袋子锁入柜中。"}}}, {BeatID: "after", Version: 1, Position: "after", Segments: []manuscript.Segment{{ID: "next", Text: "她开柜取袋。"}}}}}
	base := continuityPairs{Checked: []string{"current"}, Issues: []continuityIssue{{Earlier: "p1", Later: "p2", Reason: "位置不衔接", Suggestion: "补上取出", NeedsAuthor: true}}}
	for _, tc := range []struct {
		name   string
		change func(*continuityPairs)
		valid  bool
	}{
		{"valid", func(*continuityPairs) {}, true},
		{"missing coverage", func(r *continuityPairs) { r.Checked = nil }, false},
		{"unknown evidence", func(r *continuityPairs) { r.Issues[0].Earlier = "invented" }, false},
		{"reverse order", func(r *continuityPairs) { r.Issues[0].Earlier = "p3" }, false},
		{"unrelated target", func(r *continuityPairs) { r.Issues[0].Later = "p3" }, false},
		{"duplicate issue", func(r *continuityPairs) { r.Issues = append(r.Issues, r.Issues[0]) }, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			r := base
			r.Issues = append([]continuityIssue{}, base.Issues...)
			tc.change(&r)
			raw, _ := json.Marshal(r)
			out, _, err := checkContinuityPairs(context.Background(), model.NewFake([]model.Step{{Role: "hard_consistency", Content: string(raw)}}), ss, 3, b)
			if (err == nil) != tc.valid {
				t.Fatal(out, err)
			}
			if tc.valid && (out.Findings[0].Quote != ss[0].Text || out.Findings[0].RuleRef != "passage/before/previous" || out.Findings[0].RuleQuote != b.Neighbors[0].Segments[0].Text || !out.Findings[0].RequiresHuman) {
				t.Fatal(out)
			}
		})
	}
}
func TestContinuityKeepsFactCheckAndFailsClosedOnSecondPass(t *testing.T) {
	b := manuscript.ContextBundle{WritingTask: &manuscript.WritingTask{ExperimentalContinuity: true}}
	recorder := &scopeRecorder{next: model.NewFake([]model.Step{{Role: "hard_consistency", Content: `{"findings":[]}`}, {Role: "hard_consistency", Content: `{"checked":[],"issues":[]}`}})}
	out, _, err := AssessConsistency(context.Background(), recorder, []manuscript.Segment{{ID: "a", Text: "她在场。"}}, 1, b, nil)
	if err == nil || len(recorder.inputs) != 2 || len(out.Continuity) != 0 {
		t.Fatal(out, err)
	}
	if strings.Contains(string(recorder.inputs[0].Material), "continuityPass") || !strings.Contains(string(recorder.inputs[1].Material), "continuityPass") {
		t.Fatal("passes conflated")
	}
}
func TestContinuityIsDisabledForOrdinaryWriting(t *testing.T) {
	b := manuscript.ContextBundle{WritingTask: &manuscript.WritingTask{}, Targets: []manuscript.ContextBundle{{Beat: manuscript.Beat{ID: "a"}}, {Beat: manuscript.Beat{ID: "b"}}}}
	recorder := &scopeRecorder{next: model.NewFake([]model.Step{{Role: "hard_consistency", Content: `{"findings":[]}`}})}
	out, _, err := AssessConsistency(context.Background(), recorder, []manuscript.Segment{{ID: "a", BeatID: "a", Text: "甲在场。"}, {ID: "b", BeatID: "b", Text: "乙在场。"}}, 1, b, nil)
	if err != nil || len(recorder.inputs) != 1 || len(out.Continuity) != 0 {
		t.Fatal(out, err)
	}
	if strings.Contains(string(recorder.inputs[0].OutputSchema), `"continuity"`) {
		t.Fatal("experimental schema enabled by default")
	}
}
