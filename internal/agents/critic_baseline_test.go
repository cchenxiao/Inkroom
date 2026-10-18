package agents

import (
	"context"
	"encoding/json"
	"inkloom/internal/agents/model"
	"inkloom/internal/domain/manuscript"
	"inkloom/internal/domain/review"
	"testing"
)

func TestCriticRecheckReceivesPriorTasteWorklist(t *testing.T) {
	chat := &scopeRecorder{next: model.NewFake([]model.Step{{Role: "ai_taste", Content: `{"findings":[]}`}})}
	previous := []review.Finding{{ID: "taste", Critic: "ai_taste", Quote: "已改旧句", Severity: review.P2}, {ID: "hard", Critic: "hard_consistency", Quote: "事实依据", Severity: review.P1}}
	if _, _, err := CritiqueWithBaseline(context.Background(), chat, []manuscript.Segment{{ID: "s", Text: "新的正文。", Version: 2}}, 2, nil, manuscript.ContextBundle{}, previous); err != nil {
		t.Fatal(err)
	}
	var input struct {
		Previous []review.Finding     `json:"previousFindings"`
		Segments []manuscript.Segment `json:"segments"`
	}
	if err := json.Unmarshal(chat.inputs[0].Material, &input); err != nil {
		t.Fatal(err)
	}
	if len(input.Previous) != 1 || input.Previous[0].ID != "taste" || input.Segments[0].Text != "新的正文。" {
		t.Fatal(input)
	}
}
