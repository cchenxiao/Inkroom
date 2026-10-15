package agents_test

import (
	"context"
	"encoding/json"
	"inkloom/internal/agents"
	"inkloom/internal/agents/model"
	"inkloom/internal/agents/prompts"
	"inkloom/internal/demo"
	"inkloom/internal/domain/manuscript"
	"inkloom/internal/domain/memory"
	"inkloom/internal/retrieval"
	"testing"
)

func TestConsistencyToolEvidence(t *testing.T) {
	for _, tc := range []struct {
		name                 string
		kind                 memory.Kind
		otherBranch, changed bool
		ok                   bool
	}{
		{name: "new confirmed fact", kind: memory.Fact, ok: true},
		{name: "dialogue cannot become fact", kind: memory.Passage},
		{name: "other branch rejected before model sees text", kind: memory.Fact, otherBranch: true},
		{name: "frozen source may not change", kind: memory.Fact, changed: true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			b, steps, _ := demo.Load("hard-conflict")
			b.POVCharacterID = "character-shenyan"
			trait := b.Characters[0].HardTraits[len(b.Characters[0].HardTraits)-1]
			if !tc.changed {
				b.Characters[0].HardTraits = b.Characters[0].HardTraits[:len(b.Characters[0].HardTraits)-1]
			}
			before, _ := manuscript.ContentDigest(b)
			var writer struct {
				Text string `json:"text"`
			}
			_ = json.Unmarshal([]byte(steps[0].Content), &writer)
			segment := manuscript.Segment{ID: "ch7-beat-1-seg-1", ChapterID: b.ChapterID, SceneID: b.Beat.SceneID, BeatID: b.Beat.ID, Version: 1, Text: writer.Text}
			moment := memory.Moment{Chapter: 3, StoryTime: 200}
			record := memory.Record{ID: trait.ID, Text: trait.Text, Version: trait.Version, Kind: tc.kind, Status: memory.Confirmed, ProjectID: b.ProjectID, BranchID: b.BranchID, ChapterID: "ch3", SegmentID: "ch3-seg1", At: &moment, KnownBy: []memory.Knowledge{{CharacterID: b.POVCharacterID, Since: &moment}}}
			if tc.otherBranch {
				record.BranchID = "other"
			}
			if tc.changed {
				record.Version++
			}
			view := memory.View{ProjectID: b.ProjectID, BranchID: b.BranchID, POV: b.POVCharacterID, At: memory.Moment{Chapter: 7, StoryTime: 420}}
			chat := model.NewFake([]model.Step{{Role: "hard_consistency", FinishReason: model.ToolRequested, ToolCalls: []model.ToolCall{{ID: "c1", Name: "search_memory", Arguments: `{"query":"右手 伤势"}`}}}, steps[1]})
			fs, evidence, trace, _, err := agents.CheckConsistencyTools(context.Background(), prompts.Bind(chat), []manuscript.Segment{segment}, 1, b, func(context.Context, string) (retrieval.Result, error) {
				return retrieval.Result{Context: memory.RetrievalContext{View: view, Query: "右手 伤势", Mode: "keyword", Ranker: "rrf60-coverage-v1", Hits: []memory.Hit{{Record: record, Digest: memory.Digest(record), Origin: "teaching_seed", Method: "keyword", Score: 1}}}}, nil
			}, nil)
			if (err == nil) != tc.ok {
				t.Fatalf("error=%v", err)
			}
			after, _ := manuscript.ContentDigest(b)
			if before != after {
				t.Fatal("mutated Writer input")
			}
			if tc.ok && (len(fs) != 1 || evidence == nil || trace.Stop != "ready") {
				t.Fatal("lost findings/evidence")
			}
			if !tc.ok && trace.Stop == "ready" {
				t.Fatal("failed evidence treated as pass")
			}
		})
	}
}

func TestConsistencyInsufficientIsNotEmptyPass(t *testing.T) {
	b, _, _ := demo.Load("normal")
	chat := model.NewFake([]model.Step{{Role: "hard_consistency", Content: `{"decision":"insufficient"}`}})
	_, _, trace, _, err := agents.CheckConsistencyTools(context.Background(), prompts.Bind(chat), nil, 1, b, func(context.Context, string) (retrieval.Result, error) {
		t.Fatal("unexpected search")
		return retrieval.Result{}, nil
	}, nil)
	if err == nil || trace.Stop != "insufficient" {
		t.Fatalf("insufficient treated as pass: %s %v", trace.Stop, err)
	}
}
