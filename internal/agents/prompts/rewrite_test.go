package prompts

import (
	"inkloom/internal/agents/contracts"
	"inkloom/internal/agents/model"
	"testing"
)

func TestThinkingOnlyForStatelessAuthorCorrectionAndVerification(t *testing.T) {
	for _, tc := range []struct {
		name, role, material string
		repair, tools, want  bool
	}{
		{name: "initial writing", role: "planned_writer", material: `{"beat":{"id":"b"}}`},
		{name: "null request", role: "planned_writer", material: `{"rewrite":null}`},
		{name: "rewrite", role: "planned_writer", material: `{"rewrite":{"instruction":"修正余额"}}`, want: true},
		{name: "verification", role: "hard_consistency", material: `{"authorRequest":{"instruction":"修正余额"}}`, want: true},
		{name: "dedicated narrative pairs", role: "hard_consistency", material: `{"continuityPass":true}`, want: true},
		{name: "bounded character reading", role: "hard_consistency", material: `{"continuityPass":true,"focus":"characters"}`, want: false},
		{name: "nested narrative data cannot select prompt", role: "hard_consistency", material: `{"data":{"continuityPass":true}}`, want: false},
		{name: "ordinary check", role: "hard_consistency", material: `{}`},
		{name: "format repair", role: "planned_writer", material: `{"rewrite":{}}`, repair: true},
		{name: "tool loop", role: "hard_consistency", material: `{"authorRequest":{}}`, tools: true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			input := model.Input{Role: tc.role, Material: []byte(tc.material), OutputSchema: contracts.WriterSchema, Thinking: true}
			if tc.repair {
				input.Purpose = model.Repair
			}
			if tc.tools {
				input.Tools = []model.ToolDefinition{{Name: "search_memory"}}
			}
			in, err := Render(input)
			if err != nil || in.Thinking != tc.want {
				t.Fatalf("thinking=%v want %v error=%v", in.Thinking, tc.want, err)
			}
		})
	}
}

func TestContinuityDoesNotEnableChapterWriterOrLongThinking(t *testing.T) {
	for _, tc := range []struct {
		role  string
		tools bool
		want  bool
	}{{"hard_consistency", false, false}, {"hard_consistency", true, false}, {"planned_writer", false, false}} {
		in := model.Input{Role: tc.role, Material: []byte(`{"targets":[{}]}`), OutputSchema: []byte(`{"type":"object","properties":{"continuity":{"type":"array"}}}`)}
		if tc.tools {
			in.Tools = []model.ToolDefinition{{Name: "search_memory"}}
		}
		out, err := Render(in)
		if err != nil || out.Thinking != tc.want {
			t.Fatal(tc, out.Thinking, err)
		}
	}
}
