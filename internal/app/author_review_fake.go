package app

import (
	"bytes"
	"context"
	"encoding/json"
	"inkloom/internal/agents/model"
	"inkloom/internal/domain/manuscript"
	"inkloom/internal/domain/review"
)

// Only installed for the Fake provider. This is a pipeline sample, not semantic validation.
type authorReviewFake struct{ next model.ChatModel }

func (f authorReviewFake) Generate(ctx context.Context, in model.Input) (out model.Output, usage model.Usage, err error) {
	if bytes.Contains(in.Material, []byte(`"continuityPass":true`)) {
		var m struct {
			Targets []string `json:"targets"`
		}
		if err = json.Unmarshal(in.Material, &m); err != nil {
			return
		}
		raw, _ := json.Marshal(map[string]any{"checked": m.Targets, "issues": []any{}})
		return model.Output{Content: string(raw), FinishReason: model.Complete}, model.Usage{Known: true}, nil
	}
	var material struct {
		Request  *manuscript.AuthorRewrite `json:"authorRequest"`
		Segments []manuscript.Segment      `json:"segments"`
	}
	if in.Role == "hard_consistency" && json.Unmarshal(in.Material, &material) == nil && material.Request != nil {
		for _, s := range material.Segments {
			if s.ID == material.Request.SegmentID {
				status := "addressed"
				if s.Text == material.Request.Original {
					status = "unresolved"
				}
				raw, _ := json.Marshal(map[string]any{"findings": []review.Finding{}, "authorCheck": review.AuthorCheck{Status: status, Reason: "演示验收：仅验证请求、正文与审核链路，不代表真实模型的语义判断。", Quote: s.Text}})
				return model.Output{Content: string(raw), FinishReason: model.Complete}, model.Usage{Known: true}, nil
			}
		}
	}
	return f.next.Generate(ctx, in)
}
