package agents

import (
	"context"
	"encoding/json"

	"inkloom/internal/agents/contracts"
	"inkloom/internal/agents/model"
	"inkloom/internal/agents/parse"
	"inkloom/internal/domain/manuscript"
	"inkloom/internal/domain/review"
	"inkloom/internal/domain/revision"
)

func Polish(ctx context.Context, chat model.ChatModel, segments []manuscript.Segment, findings []review.Finding, version int, protected []string) (revision.Proposal, model.Usage, error) {
	return PolishWithInstruction(ctx, chat, segments, findings, version, protected, "")
}

func PolishWithInstruction(ctx context.Context, chat model.ChatModel, segments []manuscript.Segment, findings []review.Finding, version int, protected []string, instruction string) (revision.Proposal, model.Usage, error) {
	targets := make([]review.Finding, 0)
	ids := map[string]bool{}
	for _, f := range findings {
		if f.Severity == review.P2 {
			targets = append(targets, f)
			ids[f.SegmentID] = true
		}
	}
	subset := make([]manuscript.Segment, 0)
	for _, s := range segments {
		if ids[s.ID] {
			subset = append(subset, s)
		}
	}
	material, err := json.Marshal(struct {
		AuthorInstruction string               `json:"authorInstruction,omitempty"`
		DraftVersion      int                  `json:"draftVersion"`
		Segments          []manuscript.Segment `json:"segments"`
		Findings          []review.Finding     `json:"findings"`
		ProtectedTerms    []string             `json:"protectedTerms"`
	}{instruction, version, subset, targets, protected})
	if err != nil {
		return revision.Proposal{}, model.Usage{}, err
	}
	return parse.Generate[revision.Proposal](ctx, chat, model.Input{Role: "polisher", Task: "针对给定 P2 引文产出局部 patch；不要新增事实。", Material: material, OutputSchema: contracts.PolisherSchema}, nil)
}
