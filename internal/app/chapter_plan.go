package app

import (
	"context"
	"encoding/json"
	"inkloom/internal/agents/adapters"
	"inkloom/internal/agents/contracts"
	"inkloom/internal/agents/model"
	"inkloom/internal/agents/parse"
	"inkloom/internal/agents/prompts"
	"inkloom/internal/config"
	"inkloom/internal/domain/planning"
)

// chapterPlanMaterial 特意投影确认子集；任务快照可以留痕全部源记录，模型不能读待确认项。
func chapterPlanMaterial(in planning.ChapterPlanInput) (json.RawMessage, error) {
	confirmed, err := in.Base.Confirmed()
	if err != nil {
		return nil, err
	}
	chapter, _ := in.Chapter()
	return json.Marshal(struct {
		Intake         planning.Intake             `json:"intake"`
		Direction      planning.Direction          `json:"direction"`
		Rules          planning.StyleRules         `json:"styleRules"`
		Core           planning.CoreSettingsOutput `json:"confirmedCore"`
		Outline        planning.OutlineContent     `json:"confirmedOutline"`
		Chapter        planning.OutlineChapter     `json:"currentChapter"`
		Request        string                      `json:"request"`
		PreviousEnding *string                     `json:"previousEnding"`
	}{in.Base.Source.Intake, in.Base.Direction.Direction, in.Base.Style.Rules, confirmed, in.Outline.Content, chapter, in.Request, nil})
}

func GenerateChapterPlan(ctx context.Context, cfg config.Config, in planning.ChapterPlanInput, onCall func(context.Context, model.CallRecord) error) (planning.ChapterPlanContent, error) {
	var empty planning.ChapterPlanContent
	if err := in.Validate(); err != nil {
		return empty, err
	}
	material, err := chapterPlanMaterial(in)
	if err != nil {
		return empty, err
	}
	var chat model.ChatModel
	if cfg.Model == "fake" {
		raw, _ := json.Marshal(fakeChapterPlan(in))
		chat = model.NewFake([]model.Step{{Role: "showrunner", Content: string(raw)}})
	} else {
		chat, err = adapters.NewDeepSeek(cfg)
		if err != nil {
			return empty, err
		}
	}
	guard := model.NewGuard(chat, model.Limits{Calls: min(cfg.MaxCalls, 3), Tokens: cfg.MaxTokens, OutputTokens: cfg.MaxOutputTokens, ConsistencyOutputTokens: cfg.ConsistencyOutputTokens, ConsistencyTimeout: cfg.ConsistencyTimeout, Timeout: cfg.CallTimeout, ModelName: cfg.ModelName, OnCall: onCall})
	out, _, err := parse.Generate[planning.ChapterPlanContent](ctx, prompts.Bind(guard), model.Input{Role: "showrunner", Task: "仅展开指定章节的场景、Beat 与作者待确认 Brief，不写正文。", Material: material, OutputSchema: contracts.ShowrunnerSchema}, func(out planning.ChapterPlanContent) error {
		return out.Validate(in)
	})
	return out, err
}
func fakeChapterPlan(in planning.ChapterPlanInput) planning.ChapterPlanContent {
	ch, _ := in.Chapter()
	return planning.ChapterPlanContent{
		Scenes: []planning.PlannedScene{{ID: "scene-1", Title: "样例：试探", Goal: ch.Purpose, Conflict: "对方拒绝直接回答", Outcome: "主角决定换一个问题", POVCharacterID: ch.CharacterIDs[0], CharacterIDs: ch.CharacterIDs, StoryTime: ch.StoryTime, Beats: []planning.PlannedBeat{
			{ID: "beat-1", Title: "提出问题", Action: ch.Event, Turn: "对方回避，引出新的阻碍"},
			{ID: "beat-2", Title: "作出选择", Action: "主角停下来，重新观察对方的反应", Turn: "决定改变接近问题的方式"},
		}}},
		Brief: planning.ChapterBrief{SelectedBeatID: "beat-1", MustHappen: ch.Event, CannotChange: "保留已确认的角色硬约束与本章结果", Reveal: ch.Reveal, Withhold: ch.Withhold, WritingGuidance: "流程样例：通过动作与停顿表现试探，不替角色解释一切"},
	}
}
