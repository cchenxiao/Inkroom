package agents

import (
	"context"
	"encoding/json"
	"fmt"
	"inkloom/internal/agents/contracts"
	"inkloom/internal/agents/model"
	"inkloom/internal/agents/parse"
	"inkloom/internal/domain/manuscript"
	"strings"
)

// WriteScope keeps one author role; the contract declares beat or full chapter scope.
func WriteScope(ctx context.Context, chat model.ChatModel, b manuscript.ContextBundle) ([]manuscript.Segment, model.Usage, error) {
	if b.Rewrite != nil {
		updated, usage, err := RewriteAuthor(ctx, chat, b.Original, b, *b.Rewrite)
		return updated, usage, err
	}
	if len(b.Original) > 0 {
		return append([]manuscript.Segment{}, b.Original...), model.Usage{Known: true}, nil
	}
	if len(b.Targets) == 0 {
		s, u, e := Write(ctx, chat, b)
		return []manuscript.Segment{s}, u, e
	}
	type part struct {
		BeatID string `json:"beatId"`
		Text   string `json:"text"`
	}
	type result struct {
		Parts []part `json:"parts"`
	}
	material, err := json.Marshal(b)
	if err != nil {
		return nil, model.Usage{}, err
	}
	output, usage, err := parse.Generate[result](ctx, chat, model.Input{Role: "planned_writer", Task: "一次写完整章。严格按 targets 的顺序为每个情节段返回一个 parts 条目，保持相邻段连续；每段只使用该 target 的视角与可知事实。", Material: material, OutputSchema: contracts.ChapterWriterSchema}, func(out result) error {
		if len(out.Parts) != len(b.Targets) {
			return fmt.Errorf("chapter must contain every target exactly once")
		}
		for i, p := range out.Parts {
			if p.BeatID != b.Targets[i].Beat.ID || strings.TrimSpace(p.Text) == "" {
				return fmt.Errorf("chapter target order or text invalid")
			}
		}
		return nil
	})
	if err != nil {
		return nil, usage, err
	}
	segments := make([]manuscript.Segment, 0, len(output.Parts))
	for i, p := range output.Parts {
		t := b.Targets[i]
		segments = append(segments, manuscript.Segment{ID: p.BeatID + "-seg-1", ChapterID: b.ChapterID, SceneID: t.Beat.SceneID, BeatID: p.BeatID, Order: i + 1, Text: p.Text, POV: t.POV, Version: 1})
	}
	return segments, usage, nil
}
func RewriteAuthor(ctx context.Context, chat model.ChatModel, segments []manuscript.Segment, b manuscript.ContextBundle, req manuscript.AuthorRewrite) ([]manuscript.Segment, model.Usage, error) {
	if err := req.Validate(segments); err != nil {
		return nil, model.Usage{}, err
	}
	if len(b.Targets) > 0 {
		for _, segment := range segments {
			if segment.ID == req.SegmentID {
				target, ok := b.ForBeat(segment.BeatID)
				if !ok {
					return nil, model.Usage{}, fmt.Errorf("unknown rewrite target")
				}
				b = target
				break
			}
		}
	}
	// Prior author requests remain in the frozen audit record, but are not instructions for this rewrite.
	b.Rewrite, b.RevisionRequest, b.Original = nil, nil, nil
	material, err := json.Marshal(struct {
		Context  manuscript.ContextBundle `json:"context"`
		Segments []manuscript.Segment     `json:"segments"`
		Request  manuscript.AuthorRewrite `json:"rewrite"`
	}{b, segments, req})
	if err != nil {
		return nil, model.Usage{}, err
	}
	out, u, err := parse.Generate[contracts.WriterOutput](ctx, chat, model.Input{Role: "planned_writer", Task: "按 rewrite.instruction 重写指定范围。start/end 是原文 Unicode 码点偏移，end 不包含。只返回这个范围的替换正文 text，不包含前后缀。其他正文与 neighbors 只读；后文不是角色已知事实。", Material: material, OutputSchema: contracts.WriterSchema}, func(out contracts.WriterOutput) error {
		if strings.TrimSpace(out.Text) == "" || out.Text == string([]rune(req.Original)[req.Start:req.End]) {
			return fmt.Errorf("模型没有修改选中的正文，本次结果未保存，请补充要求后重试")
		}
		return nil
	})
	if err != nil {
		return nil, u, err
	}
	updated := append([]manuscript.Segment{}, segments...)
	for i, s := range updated {
		if s.ID == req.SegmentID {
			original := []rune(req.Original)
			updated[i].Text = string(original[:req.Start]) + out.Text + string(original[req.End:])
			if len([]rune(updated[i].Text)) > 20000 {
				return nil, u, fmt.Errorf("rewritten segment exceeds limit")
			}
			updated[i].Version++
		}
	}
	return updated, u, nil
}
