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
	material, err := json.Marshal(bundle)
	if err != nil {
		return manuscript.Segment{}, model.Usage{}, err
	}
	role := "writer"
	if bundle.WritingTask != nil {
		role = "planned_writer"
	}
	draft, usage, err := parse.Generate[contracts.WriterOutput](ctx, chat, model.Input{
		Role: role, Task: `按材料写一个正文段，返回 {"text":"正文"}，不修改设定。`,
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
