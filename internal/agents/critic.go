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
func Critique(ctx context.Context, chat model.ChatModel, segments []manuscript.Segment, version int, metrics []style.Stats, contexts ...manuscript.ContextBundle) ([]review.Finding, model.Usage, error) {
	var context manuscript.ContextBundle
	if len(contexts) > 0 {
		context = contexts[0]
	}
	material, err := json.Marshal(struct {
		Neighbors    []manuscript.Passage `json:"neighbors,omitempty"`
		Metrics      []style.Stats        `json:"metrics"`
		DraftVersion int                  `json:"draftVersion"`
		Segments     []manuscript.Segment `json:"segments"`
	}{context.Neighbors, metrics, version, segments})
	if err != nil {
		return nil, model.Usage{}, err
	}
	result, usage, err := parse.Generate[contracts.CriticOutput](ctx, chat, model.Input{
		Role: "ai_taste", Task: `检查套话、重复描写和过度解释。逐项引用原文并给出原因和修改建议；只有未发现可支持问题时才返回空 findings。`,
		Material: material, OutputSchema: contracts.CriticSchema,
	}, func(out contracts.CriticOutput) error {
		bindReviewVersion(out.Findings, version)
		normalizeNeighborRefs(out.Findings, segments, context.Neighbors)
		// Schema 负责字段与枚举；领域规则负责“这句证据是否真的在本稿里”。
		_, err := review.Aggregate(out.Findings, segments, version, context.ReadingSources()...)
		return err
	})
	if err != nil {
		return nil, usage, fmt.Errorf("critic model: %w", err)
	}
	return result.Findings, usage, nil
}

// Only fresh model responses are stamped here, inside the version-bound request.
// Individual segment revisions can differ from the chapter draft version. The
// program owns this metadata; quote/evidence validation and persisted stale-report
// checks remain strict in review.Aggregate and the approval transaction.
func bindReviewVersion(findings []review.Finding, version int) {
	for i := range findings {
		findings[i].DraftVersion = version
	}
}
