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
	type targetFacts struct {
		BeatID     string                      `json:"beatId"`
		POV        string                      `json:"pov"`
		Characters []manuscript.CharacterFacts `json:"characters"`
		Facts      []manuscript.SourceRef      `json:"facts"`
	}
	targets := []targetFacts{}
	for _, target := range bundle.Targets {
		targets = append(targets, targetFacts{target.Beat.ID, target.POV, target.Characters, target.ExplicitFacts()})
	}
	material, err := json.Marshal(struct {
		DraftVersion int                         `json:"draftVersion"`
		Segments     []manuscript.Segment        `json:"segments"`
		Characters   []manuscript.CharacterFacts `json:"characters"`
		Facts        []manuscript.SourceRef      `json:"facts"`
		Neighbors    []manuscript.Passage        `json:"neighbors,omitempty"`
		Targets      []targetFacts               `json:"targets,omitempty"`
	}{version, segments, bundle.Characters, bundle.ExplicitFacts(), bundle.Neighbors, targets})
	if err != nil {
		return nil, model.Usage{}, err
	}
	result, usage, err := parse.Generate[contracts.CriticOutput](ctx, chat, model.Input{Role: "hard_consistency", Task: "核对本轮正文与明确事实；证据不足不判硬伤；需要事实裁决或越界修改时标记交人。", Material: material, OutputSchema: contracts.ConsistencySchema}, func(out contracts.CriticOutput) error {
		for _, f := range out.Findings {
			for _, segment := range segments {
				if segment.ID == f.SegmentID && len(bundle.Targets) > 0 {
					target, ok := bundle.ForBeat(segment.BeatID)
					if !ok {
						return fmt.Errorf("unknown target")
					}
					if _, err := review.Aggregate([]review.Finding{f}, segments, version, target.ReadingSources()...); err != nil {
						return err
					}
				}
			}
		}
		_, err := review.Aggregate(out.Findings, segments, version, bundle.ReadingSources()...)
		return err
	})
	if err != nil {
		return nil, usage, fmt.Errorf("consistency critic: %w", err)
	}
	return result.Findings, usage, nil
}
