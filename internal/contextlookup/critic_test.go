package contextlookup

import (
	"context"
	"inkloom/internal/agents/model"
	"inkloom/internal/retrieval"
	"testing"
)

func TestCriticLoopUsesNativeHistoryAndValidatesFinal(t *testing.T) {
	chat := &script{outputs: []model.Output{call("verify-1", `{"query":"旧闸"}`), {FinishReason: model.Complete, Content: `{"findings":[]}`}}}
	checked := false
	_, _, err := Execute(context.Background(), chat, model.Input{Role: "hard_consistency"}, func(context.Context, string) (retrieval.Result, error) { return retrieval.Result{}, nil }, nil, func(out model.Output, _ retrieval.Result) error {
		checked = out.Content == `{"findings":[]}`
		return nil
	})
	if err != nil || !checked || len(chat.inputs) != 2 || chat.inputs[1].Messages[1].ToolCallID != "verify-1" {
		t.Fatalf("final/history lost: %v", err)
	}
}
