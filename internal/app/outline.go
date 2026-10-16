package app

import (
	"context"
	"encoding/json"
	"fmt"
	"inkloom/internal/agents/adapters"
	"inkloom/internal/agents/contracts"
	"inkloom/internal/agents/model"
	"inkloom/internal/agents/parse"
	"inkloom/internal/agents/prompts"
	"inkloom/internal/config"
	"inkloom/internal/domain/planning"
)

// outlineMaterial 特意投影确认子集；任务快照可以留痕全部源记录，模型不能读待确认项。
func outlineMaterial(in planning.OutlineInput) (json.RawMessage, error) {
	confirmed, err := in.Confirmed()
	if err != nil {
		return nil, err
	}
	return json.Marshal(struct {
		Intake       planning.Intake             `json:"intake"`
		Direction    planning.Direction          `json:"direction"`
		Rules        planning.StyleRules         `json:"styleRules"`
		Core         planning.CoreSettingsOutput `json:"confirmedCore"`
		Request      string                      `json:"request"`
		ChapterCount int                         `json:"chapterCount"`
	}{in.Source.Intake, in.Direction.Direction, in.Style.Rules, confirmed, in.Request, in.ChapterCount})
}
func GenerateOutline(ctx context.Context, cfg config.Config, in planning.OutlineInput, onCall func(context.Context, model.CallRecord) error) (planning.OutlineContent, error) {
	var empty planning.OutlineContent
	if err := in.Validate(); err != nil {
		return empty, err
	}
	material, err := outlineMaterial(in)
	if err != nil {
		return empty, err
	}
	var chat model.ChatModel
	if cfg.Model == "fake" {
		raw, _ := json.Marshal(fakeOutline(in))
		chat = model.NewFake([]model.Step{{Role: "story_architect", Content: string(raw)}})
	} else {
		chat, err = adapters.NewDeepSeek(cfg)
		if err != nil {
			return empty, err
		}
	}
	guard := model.NewGuard(chat, model.Limits{Calls: min(cfg.MaxCalls, 3), Tokens: cfg.MaxTokens, OutputTokens: cfg.MaxOutputTokens, Timeout: cfg.CallTimeout, ModelName: cfg.ModelName, OnCall: onCall})
	out, _, err := parse.Generate[planning.OutlineContent](ctx, prompts.Bind(guard), model.Input{Role: "story_architect", Task: "提出全书简要章纲与配套章节安排，不写正文或细纲。", Material: material, OutputSchema: contracts.StoryArchitectSchema}, func(out planning.OutlineContent) error {
		if len(out.Chapters) != in.ChapterCount {
			return fmt.Errorf("章节数须等于本次请求")
		}
		return out.Validate(in)
	})
	return out, err
}
func fakeOutline(in planning.OutlineInput) planning.OutlineContent {
	core, _ := in.Confirmed()
	out := planning.OutlineContent{Acts: []planning.OutlineAct{{ID: "act-opening", Title: "样例：困境与选择", Purpose: "验证作者编辑与章纲确认流程"}}, Chapters: []planning.OutlineChapter{}, Bindings: planning.OutlineBindings{Style: []planning.OutlineStyleBinding{}, Plans: []planning.OutlinePlanBinding{}}}
	for i := 0; i < in.ChapterCount; i++ {
		out.Chapters = append(out.Chapters, planning.OutlineChapter{ID: fmt.Sprintf("chapter-%d", i+1), ActID: "act-opening", Title: fmt.Sprintf("样例章节 %d", i+1), Purpose: "面对一个新阻碍", Event: "主角尝试解决问题，发现独自行动的局限", Arc: "从固执走向重新评估", Reveal: "展示选择的代价", Withhold: "后续选择的结果", CharacterIDs: []string{core.Characters[0].ID}, TargetWords: 3000})
	}
	out.Bindings.Style = append(out.Bindings.Style, planning.OutlineStyleBinding{ChapterID: out.Chapters[0].ID, Guidance: "样例：以动作和停顿承载情绪"})
	if len(core.Plans) > 0 {
		out.Bindings.Plans = append(out.Bindings.Plans, planning.OutlinePlanBinding{PlanID: core.Plans[0].ID, ChapterIDs: []string{out.Chapters[len(out.Chapters)-1].ID}, Purpose: "样例：安排后续抉择，尚未发生"})
	}
	return out
}
