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
	return CritiqueWithBaseline(ctx, chat, segments, version, metrics, context, nil)
}

// Rechecks use the prior worklist as context; new issues still require evidence.
func CritiqueWithBaseline(ctx context.Context, chat model.ChatModel, segments []manuscript.Segment, version int, metrics []style.Stats, context manuscript.ContextBundle, previous []review.Finding) ([]review.Finding, model.Usage, error) {
	prior := []review.Finding{}
	for _, f := range previous {
		if f.Critic == "ai_taste" {
			prior = append(prior, f)
		}
	}
	material, err := json.Marshal(struct {
		Previous     []review.Finding     `json:"previousFindings,omitempty"`
		Neighbors    []manuscript.Passage `json:"neighbors,omitempty"`
		Metrics      []style.Stats        `json:"metrics"`
		DraftVersion int                  `json:"draftVersion"`
		Segments     []manuscript.Segment `json:"segments"`
	}{prior, context.Neighbors, metrics, version, segments})
	if err != nil {
		return nil, model.Usage{}, err
	}
	result, usage, err := parse.Generate[contracts.CriticOutput](ctx, chat, model.Input{
		Role: "ai_taste", Task: `检查套话、重复描写和过度解释。逐项引用原文并给出原因和修改建议；只有未发现可支持问题时才返回空 findings。若提供 previousFindings，优先逐条核对这些问题在当前正文中是否仍存在，已解决的不要再报；不要每轮更换审美标准或为凑数量扩大问题清单。同一问题不要拆成多条，建议性偏好归为 P3，P2 需要具体可定位的重复、冗余或表达缺陷；新发现也必须有当前原文证据。quote 必须逐字复制当前 segments 原文，包括换行、空行和标点，不得改写成摘要或沿用已经改变的旧引文。`,
		Material: material, OutputSchema: contracts.CriticSchema,
	}, func(out contracts.CriticOutput) error {
		bindReviewVersion(out.Findings, version)
		restoreQuoteWhitespace(out.Findings, segments)
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
