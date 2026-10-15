package agents

import (
	"context"
	"encoding/json"
	"slices"

	"inkloom/internal/agents/contracts"
	"inkloom/internal/agents/model"
	"inkloom/internal/agents/parse"
	"inkloom/internal/domain/manuscript"
	"inkloom/internal/domain/review"
	"inkloom/internal/domain/revision"
)

func Rewrite(ctx context.Context, chat model.ChatModel, segments []manuscript.Segment, report review.Report, bundle manuscript.ContextBundle, route review.Decision) (revision.Proposal, model.Usage, error) {
	return RewriteWithInstruction(ctx, chat, segments, report, bundle, route, "")
}

func RewriteWithInstruction(ctx context.Context, chat model.ChatModel, segments []manuscript.Segment, report review.Report, bundle manuscript.ContextBundle, route review.Decision, instruction string) (revision.Proposal, model.Usage, error) {
	role := "scene_reviser"
	if route.Kind == "structural" {
		role = "structural_reviser"
	}
	findings := []review.Finding{}
	for _, f := range report.Findings {
		if slices.Contains(route.FindingIDs, f.ID) {
			findings = append(findings, f)
		}
	}
	material, err := json.Marshal(struct {
		AuthorInstruction string                   `json:"authorInstruction,omitempty"`
		Role              string                   `json:"role"`
		DraftVersion      int                      `json:"draftVersion"`
		AllowedSegmentIDs []string                 `json:"allowedSegmentIds"`
		Segments          []manuscript.Segment     `json:"segments"`
		Findings          []review.Finding         `json:"findings"`
		Context           manuscript.ContextBundle `json:"context"`
	}{instruction, role, report.DraftVersion, route.TargetIDs, segments, findings, bundle})
	if err != nil {
		return revision.Proposal{}, model.Usage{}, err
	}
	return parse.Generate[revision.Proposal](ctx, chat, model.Input{Role: role, Task: "按给定修复范围产出整段替换 patch，保留当前 Beat 的事件结果。", Material: material, OutputSchema: contracts.ReviserSchema}, nil)
}
