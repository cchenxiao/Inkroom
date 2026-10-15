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
	"inkloom/internal/domain/style"
)

// Critique 冷读正文，不接收 Writer 的消息历史或自我解释。
func Critique(ctx context.Context, chat model.ChatModel, segments []manuscript.Segment, version int, metrics []style.Stats) ([]review.Finding, model.Usage, error) {
	material, err := json.Marshal(struct {
		Metrics      []style.Stats        `json:"metrics"`
		DraftVersion int                  `json:"draftVersion"`
		Segments     []manuscript.Segment `json:"segments"`
	}{metrics, version, segments})
	if err != nil {
		return nil, model.Usage{}, err
	}
	result, usage, err := parse.Generate[contracts.CriticOutput](ctx, chat, model.Input{
		Role: "ai_taste", Task: `检查套话，返回 {"findings":[]}。问题必须引用原文并提供原因和修改建议。`,
		Material: material, OutputSchema: contracts.CriticSchema,
	}, func(out contracts.CriticOutput) error {
		// Schema 负责字段与枚举；领域规则负责“这句证据是否真的在本稿里”。
		_, err := review.Aggregate(out.Findings, segments, version)
		return err
	})
	if err != nil {
		return nil, usage, fmt.Errorf("critic model: %w", err)
	}
	return result.Findings, usage, nil
}
