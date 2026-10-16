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

func AnalyzeReferenceStyle(ctx context.Context, cfg config.Config, input planning.StyleAnalysisInput, onCall func(context.Context, model.CallRecord) error) (planning.StyleAnalysisOutput, error) {
	// 不信任调用者提供的取样与统计，每次根据原文重新确定可见边界。
	frozen, err := planning.NewStyleAnalysisInput(input.Title, input.Text)
	if err != nil {
		return planning.StyleAnalysisOutput{}, err
	}
	var chat model.ChatModel
	if cfg.Model == "fake" {
		excerpt := []rune(frozen.Samples[0].Text)
		excerpt = excerpt[:min(len(excerpt), 100)]
		out := planning.StyleAnalysisOutput{Observations: []planning.StyleObservation{{Dimension: "sentence", SampleIndex: 0, Quote: string(excerpt[:min(30, len(excerpt))]), Reason: "Fake 管线样例，未做语义判断。", Suggestion: "请作者根据这段原文确认想保留的句式。", Certainty: "tentative"}}, Rules: planning.StyleRules{POV: "待作者确认", Tense: "待作者确认", Tone: "Fake 示例：请作者补充表达要求", BannedPhrases: []string{}, SentenceLength: planning.NumberRange{Min: 8, Max: 35}, DialogueRatio: planning.NumberRange{Min: 0, Max: 1}}, AnchorText: string(excerpt), Limitations: "Fake 只验证引用、候选与保存链路；不代表真实风格分析。"}
		raw, _ := json.Marshal(out)
		chat = model.NewFake([]model.Step{{Role: "style_analyst", Content: string(raw)}})
	} else {
		chat, err = adapters.NewDeepSeek(cfg)
		if err != nil {
			return planning.StyleAnalysisOutput{}, err
		}
	}
	guard := model.NewGuard(chat, model.Limits{OnCall: onCall, Calls: min(cfg.MaxCalls, 3), Tokens: cfg.MaxTokens, OutputTokens: cfg.MaxOutputTokens, Timeout: cfg.CallTimeout, ModelName: cfg.ModelName})
	// 全文明确从 prompt 中剔除；样本之外的人物、事件不会进入模型材料。
	material, _ := json.Marshal(struct {
		Title    string                  `json:"title"`
		Total    int                     `json:"totalCharacters"`
		Analyzed int                     `json:"analyzedCharacters"`
		Samples  []planning.StyleExcerpt `json:"samples"`
	}{frozen.Title, frozen.TotalCharacters, frozen.AnalyzedCharacters, frozen.Samples})
	out, _, err := parse.Generate[planning.StyleAnalysisOutput](ctx, prompts.Bind(guard), model.Input{Role: "style_analyst", Task: "分析参考片段的表达方式，给出有原文依据、待作者确认的风格规矩；不提取故事事实。", Material: material, OutputSchema: contracts.StyleAnalystSchema}, func(out planning.StyleAnalysisOutput) error { return out.Validate(frozen) })
	return out, err
}
