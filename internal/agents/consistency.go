package agents

import (
	"context"
	"encoding/json"
	"fmt"

	"inkloom/internal/agents/contracts"
	"inkloom/internal/agents/model"
	"inkloom/internal/agents/parse"
	"inkloom/internal/domain/manuscript"
	"inkloom/internal/domain/review"
)

// CheckConsistency 不接收大纲/风格或其他评审结果，只给本章可见的事实和正文快照。
func CheckConsistency(ctx context.Context, chat model.ChatModel, segments []manuscript.Segment, version int, bundle manuscript.ContextBundle) ([]review.Finding, model.Usage, error) {
	material, err := json.Marshal(struct {
		DraftVersion int                         `json:"draftVersion"`
		Segments     []manuscript.Segment        `json:"segments"`
		Characters   []manuscript.CharacterFacts `json:"characters"`
		Facts        []manuscript.SourceRef      `json:"facts"`
	}{version, segments, bundle.Characters, bundle.Facts})
	if err != nil {
		return nil, model.Usage{}, err
	}
	result, usage, err := parse.Generate[contracts.CriticOutput](ctx, chat, model.Input{Role: "hard_consistency", Task: "核对本轮正文与明确事实；证据不足不判硬伤；需要事实裁决或越界修改时标记交人。", Material: material, OutputSchema: contracts.ConsistencySchema}, func(out contracts.CriticOutput) error {
		_, err := review.Aggregate(out.Findings, segments, version, bundle.FactSources()...)
		return err
	})
	if err != nil {
		return nil, usage, fmt.Errorf("consistency critic: %w", err)
	}
	return result.Findings, usage, nil
}
