package app

import (
	"context"
	"encoding/json"
	"errors"
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
		body, _ := json.Marshal(ChapterFactsOutput{Candidates: []ChapterFactCandidate{{SuggestedKnowers: []SuggestedKnower{}, ID: "f1", Kind: "uncertain", Text: "请作者核对这段发生的事实", Evidence: ChapterEvidence{Ref: p.ID, Quote: p.Text}, Reason: "Fake 仅演示候选与人工处理，不评价事实准确性"}}})
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
	input := model.Input{Role: "chapter_facts", Task: "提取本章值得跨章保留的事实候选，引用原文并识别与现有事实的关系。每条必须返回 suggestedKnowers：用逐字原文为明确亲历或听见事件的人物提出知情建议，无依据填空数组。建议由作者确认，不自行批准或更新知识。", Material: raw, OutputSchema: contracts.ChapterFactsSchema}
	var candidate ChapterFactsOutput
	validate := func(out ChapterFactsOutput) error {
		candidate = out
		return ValidateChapterFactCandidates(in, out)
	}
	result, _, err := parse.Generate[ChapterFactsOutput](ctx, prompts.Bind(guard), input, validate)
	var invalid *chapterFactError
	if errors.As(err, &invalid) && invalid.Failure.Code == "unknown_fact_reference" {
		// One bounded reference correction. Keep every claim; the model may only
		// correct the relation to the supplied knowledge catalogue, never drop a
		// rejected fact to manufacture a successful extraction.
		input.Material, _ = json.Marshal(struct {
			Input      ChapterFactsInput  `json:"input"`
			Candidates ChapterFactsOutput `json:"previous"`
			Problem    string             `json:"problem"`
		}{in, candidate, invalid.Failure.Message})
		input.Task = "校对上一份候选的 relatedFactId：只能引用 input.knowledge.facts 中的完整 ID；如果是独立新事件或没有相同断言的既有事实，填空串。保持候选数量、顺序、ID、text、kind、evidence、suggestedKnowers 不变，不得删除候选或新造事实。输出完整候选。"
		original := candidate
		result, _, err = parse.Generate[ChapterFactsOutput](ctx, prompts.Bind(guard), input, func(out ChapterFactsOutput) error {
			if len(out.Candidates) != len(original.Candidates) {
				return factError("validation", "candidate_changed", "关联校对改变了候选数量，请重新提取。", ErrInvalidWrite)
			}
			for i, c := range out.Candidates {
				a, b := c, original.Candidates[i]
				a.RelatedFactID, b.RelatedFactID = "", ""
				a.Reason, b.Reason = "", ""
				ar, _ := json.Marshal(a)
				br, _ := json.Marshal(b)
				if string(ar) != string(br) {
					return factError("validation", "candidate_changed", "关联校对改动了事实或证据，请重新提取。", ErrInvalidWrite)
				}
			}
			return ValidateChapterFactCandidates(in, out)
		})
	}
	return result, err
}
