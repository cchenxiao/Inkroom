package agents

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"inkloom/internal/agents/contracts"
	"inkloom/internal/agents/model"
	"inkloom/internal/agents/parse"
	"inkloom/internal/domain/manuscript"
)

// Write 此时只写一个 Beat 的一个候选段；ID 和版本由程序分配，不交给模型猜。
func Write(ctx context.Context, chat model.ChatModel, bundle manuscript.ContextBundle) (manuscript.Segment, model.Usage, error) {
	if bundle.ChapterID == "" || bundle.BranchID == "" || bundle.Beat.ID == "" || bundle.Beat.SceneID == "" || strings.TrimSpace(bundle.Beat.Description) == "" {
		return manuscript.Segment{}, model.Usage{}, fmt.Errorf("chapter, branch and beat context are required")
	}
	writerContext, err := singleBeatWritingContext(bundle)
	if err != nil {
		return manuscript.Segment{}, model.Usage{}, err
	}
	material, err := json.Marshal(writerContext)
	if err != nil {
		return manuscript.Segment{}, model.Usage{}, err
	}
	role := "writer"
	if bundle.WritingTask != nil {
		role = "planned_writer"
	}
	draft, usage, err := parse.Generate[contracts.WriterOutput](ctx, chat, model.Input{
		Role: role, Task: `按材料完成本次 Beat 的正文片段，可按叙事需要自然分段，返回 {"text":"正文"}，不修改设定。`,
		Material: material, OutputSchema: contracts.WriterSchema,
	}, nil)
	if err != nil {
		return manuscript.Segment{}, usage, fmt.Errorf("writer model: %w", err)
	}
	return manuscript.Segment{
		ID: bundle.Beat.ID + "-seg-1", ChapterID: bundle.ChapterID,
		SceneID: bundle.Beat.SceneID, BeatID: bundle.Beat.ID,
		Order: 1, Text: draft.Text, POV: bundle.POV, Version: 1,
	}, usage, nil
}

// A single beat must not receive the scene/chapter outcome as its own required
// action. Keep fixed constraints and the next beat boundary, but project the
// author-confirmed action/turn into the executable brief. The frozen input is
// unchanged and retains the full chapter plan for audit and chapter review.
func singleBeatWritingContext(bundle manuscript.ContextBundle) (manuscript.ContextBundle, error) {
	b, err := bundle.Freeze()
	if err != nil {
		return b, err
	}
	if t := b.WritingTask; t != nil && t.BeatAction != "" && t.BeatOutcome != "" {
		t.Brief.MustHappen = t.BeatAction + "；本段到这里结束：" + t.BeatOutcome
		t.Brief.Reveal = t.BeatOutcome
		t.SceneGoal, t.SceneOutcome = t.BeatAction, t.BeatOutcome
		if t.NextBeat != "" {
			t.SceneConflict = ""
		}
	}
	return b, nil
}
