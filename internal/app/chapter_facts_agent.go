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
)

// ExtractChapterFacts proposes claims. It cannot approve them or mutate story knowledge.
func ExtractChapterFacts(ctx context.Context, cfg config.Config, in ChapterFactsInput, onCall func(context.Context, model.CallRecord) error) (ChapterFactsOutput, error) {
	if err := in.Review.Validate(); err != nil {
		return ChapterFactsOutput{}, factError("input", "invalid_review", "整章复审材料无效，请重新核对章稿来源。", err)
	}
	if err := in.Knowledge.Validate(); err != nil {
		return ChapterFactsOutput{}, factError("input", "invalid_knowledge", "冻结的知识材料无效，请重新核对知识来源。", err)
	}
	var chat model.ChatModel
	var err error
	if cfg.Model == "fake" {
		p := in.Review.Parts[0].Segments[0]
		body, _ := json.Marshal(ChapterFactsOutput{Candidates: []ChapterFactCandidate{{ID: "f1", Kind: "uncertain", Text: "请作者核对这段发生的事实", Evidence: ChapterEvidence{Ref: p.ID, Quote: p.Text}, Reason: "Fake 仅演示候选与人工处理，不评价事实准确性"}}})
		chat = model.NewFake([]model.Step{{Role: "chapter_facts", Content: string(body)}})
	} else {
		chat, err = adapters.NewDeepSeek(cfg)
		if err != nil {
			return ChapterFactsOutput{}, factError("configuration", "model_configuration", "模型配置不可用，请检查模型服务配置。", err)
		}
	}
	return extractChapterFactsWithModel(ctx, cfg, in, chat, onCall)
}

func extractChapterFactsWithModel(ctx context.Context, cfg config.Config, in ChapterFactsInput, chat model.ChatModel, onCall func(context.Context, model.CallRecord) error) (ChapterFactsOutput, error) {
	record := func(ctx context.Context, call model.CallRecord) error {
		if onCall == nil {
			return nil
		}
		if err := onCall(ctx, call); err != nil {
			return factError("persistence", "call_record_failed", "模型调用记录未能保存，请检查存储状态后再处理。", err)
		}
		return nil
	}
	guard := model.NewGuard(chat, model.Limits{Calls: cfg.MaxCalls, Tokens: cfg.MaxTokens, OutputTokens: cfg.MaxOutputTokens, ConsistencyOutputTokens: cfg.ConsistencyOutputTokens, ConsistencyTimeout: cfg.ConsistencyTimeout, Timeout: cfg.CallTimeout, ModelName: cfg.ModelName, OnCall: record})
	raw, err := json.Marshal(in)
	if err != nil {
		return ChapterFactsOutput{}, err
	}
	result, _, err := parse.Generate[ChapterFactsOutput](ctx, prompts.Bind(guard), model.Input{Role: "chapter_facts", Task: "提取本章值得跨章保留的事实候选，引用原文并识别与现有事实的关系。不要批准或扩大角色知情范围。", Material: raw, OutputSchema: contracts.ChapterFactsSchema}, func(out ChapterFactsOutput) error { return ValidateChapterFactCandidates(in, out) })
	return result, err
}
