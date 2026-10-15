package contextlookup

import (
	"context"
	"fmt"
	"testing"

	"inkloom/internal/agents/model"
	"inkloom/internal/domain/manuscript"
	"inkloom/internal/domain/memory"
	"inkloom/internal/retrieval"
)

type script struct {
	outputs []model.Output
	inputs  []model.Input
}

func (s *script) Generate(_ context.Context, in model.Input) (model.Output, model.Usage, error) {
	s.inputs = append(s.inputs, in)
	if len(s.outputs) == 0 {
		return model.Output{}, model.Usage{}, fmt.Errorf("unexpected call")
	}
	o := s.outputs[0]
	s.outputs = s.outputs[1:]
	return o, model.Usage{Known: true}, nil
}
func call(id, q string) model.Output {
	return model.Output{FinishReason: model.ToolRequested, ToolCalls: []model.ToolCall{{ID: id, Name: "search_memory", Arguments: q}}}
}
func TestLookupBoundaries(t *testing.T) {
	cases := []struct {
		name     string
		outputs  []model.Output
		searches int
		ok       bool
	}{
		{"ready without search", []model.Output{{FinishReason: model.Complete, Content: `{"decision":"ready"}`}}, 0, true},
		{"search then ready", []model.Output{call("a", `{"query":"铜扣"}`), {FinishReason: model.Complete, Content: `{"decision":"ready"}`}}, 1, true},
		{"scope injection", []model.Output{call("a", `{"query":"铜扣","branchId":"other"}`)}, 0, false},
		{"unknown tool", []model.Output{{FinishReason: model.ToolRequested, ToolCalls: []model.ToolCall{{ID: "a", Name: "sql", Arguments: `{}`}}}}, 0, false},
		{"duplicate", []model.Output{call("a", `{"query":"铜扣"}`), call("b", `{"query":" 铜扣 "}`)}, 1, false},
		{"no gain", []model.Output{call("a", `{"query":"a"}`), call("b", `{"query":"b"}`)}, 2, false},
		{"too many", []model.Output{call("a", `{"query":"a"}`), call("b", `{"query":"b"}`), call("c", `{"query":"c"}`), call("d", `{"query":"d"}`)}, 3, false},
	}
	for _, tt := range cases {
		t.Run(tt.name, func(t *testing.T) {
			chat := &script{outputs: tt.outputs}
			calls := 0
			search := func(_ context.Context, q string) (retrieval.Result, error) {
				calls++
				hits := []memory.Hit{}
				if tt.name != "no gain" {
					hits = append(hits, memory.Hit{Record: memory.Record{ID: q, Text: "只读原文"}, Digest: q})
				}
				return retrieval.Result{Context: memory.RetrievalContext{Query: q, Hits: hits}}, nil
			}
			result, err := Run(context.Background(), chat, manuscript.ContextBundle{}, search, nil)
			if (err == nil) != tt.ok || calls != tt.searches {
				t.Fatalf("error=%v searches=%d", err, calls)
			}
			if tt.ok && tt.searches > 0 {
				if len(result.Context.Hits) != 1 || len(chat.inputs[1].Messages) != 2 || chat.inputs[1].Messages[1].ToolCallID != "a" {
					t.Fatal("tool response/history lost")
				}
			}
		})
	}
}
