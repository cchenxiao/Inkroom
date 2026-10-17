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
