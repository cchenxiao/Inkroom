package app

import (
	"context"
	"crypto/sha256"
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

type CoreSettingsReport struct {
	Status       string                       `json:"status"`
	Confirmation string                       `json:"confirmation"` // 服务端固定 candidate，模型不能赋予确认权限。
	InputDigest  string                       `json:"inputDigest"`
	Input        planning.CoreSettingsInput   `json:"input"`
	Output       *planning.CoreSettingsOutput `json:"output"`
	Calls        []model.CallRecord           `json:"calls"`
	Message      string                       `json:"message"`
}

func GenerateCoreSettings(ctx context.Context, cfg config.Config, input planning.CoreSettingsInput) (CoreSettingsReport, error) {
	return GenerateCoreSettingsWithCalls(ctx, cfg, input, nil)
}

func GenerateCoreSettingsWithCalls(ctx context.Context, cfg config.Config, input planning.CoreSettingsInput, onCall func(context.Context, model.CallRecord) error) (CoreSettingsReport, error) {
	if err := input.Validate(); err != nil {
		return CoreSettingsReport{}, err
	}
	var chat model.ChatModel
	if cfg.Model == "fake" {
		raw, _ := json.Marshal(fakeCoreSettings())
		chat = model.NewFake([]model.Step{{Role: "core_planner", Content: string(raw)}})
	} else {
		var err error
		chat, err = adapters.NewDeepSeek(cfg)
		if err != nil {
			return CoreSettingsReport{}, err
		}
	}
	return generateCoreSettings(ctx, cfg, input, chat, onCall)
}
func coreMaterial(in planning.CoreSettingsInput) json.RawMessage {
	// 故意不传 StyleSelection.AnchorText、参考文本或 StyleAnalysisOutput；仅传作者采用的规矩。
	raw, _ := json.Marshal(struct {
		Intake    planning.Intake     `json:"intake"`
		Direction planning.Direction  `json:"direction"`
		Rules     planning.StyleRules `json:"styleRules"`
		Request   string              `json:"request"`
	}{in.Source.Intake, in.Selection.Direction, in.Style.Rules, in.Request})
	return raw
}
func generateCoreSettings(ctx context.Context, cfg config.Config, input planning.CoreSettingsInput, chat model.ChatModel, onCall func(context.Context, model.CallRecord) error) (CoreSettingsReport, error) {
	if err := input.Validate(); err != nil {
		return CoreSettingsReport{}, err
	}
	raw, err := json.Marshal(input)
	if err != nil {
		return CoreSettingsReport{}, err
	}
	var frozen planning.CoreSettingsInput
	if err = json.Unmarshal(raw, &frozen); err != nil {
		return CoreSettingsReport{}, err
	}
	report := CoreSettingsReport{Status: "running", Confirmation: "candidate", Input: frozen, InputDigest: fmt.Sprintf("%x", sha256.Sum256(raw)), Calls: []model.CallRecord{}, Message: "仅为创作提案；未确认、不入正文或检索。人物创作元数据和未来计划不等于角色已知事实。"}
	if cfg.Model == "fake" {
		report.Message = "Fake 流程样例，不代表模型对本次立意的创作结果；所有内容均待作者确认。"
	}
	guard := model.NewGuard(chat, model.Limits{Calls: min(cfg.MaxCalls, 3), Tokens: cfg.MaxTokens, OutputTokens: cfg.MaxOutputTokens, ConsistencyOutputTokens: cfg.ConsistencyOutputTokens, ConsistencyTimeout: cfg.ConsistencyTimeout, Timeout: cfg.CallTimeout, ModelName: cfg.ModelName, OnCall: func(ctx context.Context, c model.CallRecord) error {
		report.Calls = append(report.Calls, c)
		if onCall != nil {
			return onCall(ctx, c)
		}
		return nil
	}})
	out, _, err := parse.Generate[planning.CoreSettingsOutput](ctx, prompts.Bind(guard), model.Input{Role: "core_planner", Task: "按作者限定范围提出主要人物、世界事实候选和未来计划，严格分区，不确认或写入事实。", Material: coreMaterial(frozen), OutputSchema: contracts.CorePlannerSchema}, planning.CoreSettingsOutput.Validate)
	if err != nil {
		report.Status = "failed"
		return report, err
	}
	report.Output = &out
	report.Status = "completed"
	return report, nil
}
func fakeCoreSettings() planning.CoreSettingsOutput {
	return planning.CoreSettingsOutput{
		Characters: []planning.CharacterDesign{{ID: "proposal-person", Name: "样例主角", Role: "本次提案的核心人物", Want: "靠自己的方法完成眼前任务", Need: "学会接受他人的帮助", Flaw: "把求助误认为示弱", ArcIntent: "逐步从独自承担走向合作", Voice: []string{"句子简短", "回避直接求助"}, HardFactIDs: []string{"proposal-hand"}}},
		WorldFacts: []planning.WorldFactProposal{{ID: "proposal-hand", Subject: "proposal-person", Text: "样例提案：主角惯用左手，尚待作者决定。", Rigidity: "hard", KnownBy: []planning.ProposedKnowledge{}}},
		Plans:      []planning.FuturePlan{{ID: "proposal-choice", Subject: "proposal-person", Intent: "样例计划：在后续关键选择中主动求助；未发生，不是角色当前知识。"}},
	}
}
