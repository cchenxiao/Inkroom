package demo

import (
	"context"
	"encoding/json"
	"strings"

	"inkloom/internal/agents/model"
	"inkloom/internal/domain/manuscript"
	"inkloom/internal/domain/review"
	"inkloom/internal/domain/revision"
	"inkloom/internal/orchestration"
)

// HumanFake 仅供本地固定样例：引用仍出现则保留问题；无文学判断能力。
// 和运行脚本分开，恢复时不需要重放/消费 Writer 响应。
type HumanFake struct{ baseline orchestration.ChapterState }

func NewHumanFake(s orchestration.ChapterState) *HumanFake {
	// apply 后 Report 是新版本空壳；以最近完成的评审为基准，避免重启把问题遗忘。
	if len(s.Reviews) > 0 {
		s.Report = s.Reviews[len(s.Reviews)-1]
	}
	return &HumanFake{baseline: s}
}
func (f *HumanFake) Generate(ctx context.Context, in model.Input) (model.Output, model.Usage, error) {
	if err := ctx.Err(); err != nil {
		return model.Output{}, model.Usage{}, err
	}
	var m struct {
		DraftVersion int                  `json:"draftVersion"`
		Segments     []manuscript.Segment `json:"segments"`
		Findings     []review.Finding     `json:"findings"`
	}
	if err := json.Unmarshal(in.Material, &m); err != nil {
		return model.Output{}, model.Usage{}, err
	}
	var value any
	if in.Role == "hard_consistency" || in.Role == "ai_taste" {
		fs := []review.Finding{}
		for _, old := range f.baseline.Report.Findings {
			if old.Critic != in.Role {
				continue
			}
			for _, seg := range m.Segments {
				if old.SegmentID == seg.ID && strings.Contains(seg.Text, old.Quote) {
					old.DraftVersion = m.DraftVersion
					fs = append(fs, old)
				}
			}
		}
		value = struct {
			Findings []review.Finding `json:"findings"`
		}{fs}
	} else {
		patches := []revision.Patch{}
		for _, finding := range m.Findings {
			for _, seg := range m.Segments {
				if seg.ID != finding.SegmentID {
					continue
				}
				old, newText := seg.Text, strings.ReplaceAll(seg.Text, "右手握刀", "左手握刀")
				if in.Role == "polisher" {
					old = finding.Quote
					newText = ""
				} else if newText == old {
					newText += "他等着对方先开口。"
				}
				change := "replace"
				if newText == "" {
					change = "delete"
				}
				patches = append(patches, revision.Patch{FindingID: finding.ID, SegmentID: seg.ID, OldText: old, NewText: newText, ChangeType: change, Reason: "离线固定样例：按作者本轮授权修复引用"})
			}
		}
		value = revision.Proposal{BasedOnDraftVersion: m.DraftVersion, Patches: patches}
	}
	raw, err := json.Marshal(value)
	return model.Output{Content: string(raw), FinishReason: model.Complete}, model.Usage{Known: true}, err
}
