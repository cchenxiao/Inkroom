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

// GenerateDirections 只有一个职责明确的 Agent，不为一次生成额外搭建多 Agent 图。
// Prompt → Guard → Provider；输出再经 JSON Schema 和业务校验。
func GenerateDirections(ctx context.Context, cfg config.Config, input planning.InputSnapshot, onCall func(context.Context, model.CallRecord) error) (planning.Output, error) {
	if err := input.Intake.Validate(); err != nil {
		return planning.Output{}, err
	}
	var chat model.ChatModel
	if cfg.Model == "fake" {
		raw, _ := json.Marshal(fakeDirections(input.Intake))
		chat = model.NewFake([]model.Step{{Role: "tone_director", Content: string(raw)}})
	} else {
		var err error
		chat, err = adapters.NewDeepSeek(cfg)
		if err != nil {
			return planning.Output{}, err
		}
	}
	guard := model.NewGuard(chat, model.Limits{OnCall: onCall, Calls: min(cfg.MaxCalls, 3), Tokens: cfg.MaxTokens, OutputTokens: cfg.MaxOutputTokens, ConsistencyOutputTokens: cfg.ConsistencyOutputTokens, ConsistencyTimeout: cfg.ConsistencyTimeout, Timeout: cfg.CallTimeout, ModelName: cfg.ModelName})
	raw, err := json.Marshal(input)
	if err != nil {
		return planning.Output{}, err
	}
	out, _, err := parse.Generate[planning.Output](ctx, prompts.Bind(guard), model.Input{Role: "tone_director", Task: "依据冻结的创作意图生成差异明确的方向；所有建议待作者选择，不直接成为正式设定。", Material: raw, OutputSchema: contracts.ToneDirectionSchema}, planning.Output.Validate)
	return out, err
}

// Fake 只验证业务链路，始终标明样例，不冒充模型对任意立意的创作结果。
func fakeDirections(i planning.Intake) planning.Output {
	premise := []rune(i.Premise)
	if len(premise) > 120 {
		i.Premise = string(premise[:120]) + "…"
	}
	return planning.Output{Directions: []planning.Direction{
		{Title: "样例 A · 选择的代价", Logline: i.Premise + "（Fake 流程样例：从主角的一次主动选择展开。）", CoreConflict: "主角想保住自己的生活，却必须为一个承诺承担代价。", CharacterDilemma: "守约会失去眼前利益，退让会伤害信任自己的人。", ReaderAppeal: "读者跟随选择逐步看见代价，并期待主角承担后果。", Tone: "贴近人物，感官克制；对白留有余地，关键选择处放慢。", Narrative: "第三人称限知，过去时；待作者确认。", Tradeoff: "人物关系更集中，外部事件规模较小。"},
		{Title: "样例 B · 共同难题", Logline: i.Premise + "（Fake 流程样例：让立场相反的两人被迫合作。）", CoreConflict: "两人需要共同完成一件事，却对成功的含义有相反理解。", CharacterDilemma: "坚持自己的方法可能拖累对方，合作又意味着暴露弱点。", ReaderAppeal: "立场碰撞和关系变化制造推进，反差可容纳适量幽默。", Tone: "对话推进，动作明确；紧张与短暂松弛交替。", Narrative: "单一视角，避免随意跳入对方内心；待作者确认。", Tradeoff: "需精心区分两个人的声音，不能依赖误会拖延情节。"},
	}}
}
