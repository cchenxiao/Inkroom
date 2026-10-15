package app

import (
	"context"
	"inkloom/internal/agents/adapters"
	"inkloom/internal/agents/model"
	"inkloom/internal/config"
	"inkloom/internal/contextassembly"
	"inkloom/internal/contextlookup"
	"inkloom/internal/domain/manuscript"
	"inkloom/internal/retrieval"
)

// LookupContext 用已经持久化的基础输入查询，不能重新从 demo 或最新配置装配。
func LookupContext(ctx context.Context, cfg config.Config, base manuscript.FrozenInput, s *retrieval.Service, onCall func(context.Context, model.CallRecord) error, onTrace contextlookup.Observe) (manuscript.FrozenInput, error) {
	if err := base.Validate(); err != nil {
		return manuscript.FrozenInput{}, err
	}
	view := CurrentMemoryView()
	session, err := s.Session(ctx, view)
	if err != nil {
		return manuscript.FrozenInput{}, err
	}
	// Fake 也走真实工具循环，检索本身由配置决定使用关键词/向量。
	var chat model.ChatModel = model.NewFake([]model.Step{
		{Role: "context_assembler", FinishReason: model.ToolRequested, ToolCalls: []model.ToolCall{{ID: "lookup-1", Name: "search_memory", Arguments: `{"query":"铜扣 父亲 旧外套"}`}}},
		{Role: "context_assembler", Content: `{"decision":"ready"}`},
	})
	if cfg.Model == "deepseek" {
		chat, err = adapters.NewDeepSeek(cfg)
		if err != nil {
			return manuscript.FrozenInput{}, err
		}
	}
	guard := model.NewGuard(chat, model.Limits{OnCall: onCall, Calls: cfg.MaxCalls, Tokens: cfg.MaxTokens, OutputTokens: cfg.MaxOutputTokens, Timeout: cfg.CallTimeout, ModelName: cfg.ModelName})
	result, err := contextlookup.Run(ctx, guard, base.Bundle, func(ctx context.Context, q string) (retrieval.Result, error) { return session.Search(ctx, view, q, 3) }, onTrace)
	if err != nil {
		return manuscript.FrozenInput{}, err
	}
	if result.Context.Query == "" {
		return base, nil
	} // 模型显式 ready，未调用查询工具。
	bundle := base.Bundle
	bundle.POVCharacterID = view.POV
	return contextassembly.Assemble(bundle, contextassembly.PreviousChapter{ProjectID: bundle.ProjectID, BranchID: bundle.BranchID, Confirmed: true, Source: *bundle.PreviousEnding}, contextassembly.Options{
		RunID: base.Manifest.RunID, BaseDraftVersion: base.Manifest.BaseDraftVersion, Budget: base.Manifest.Budget, ReservedOutputTokens: base.Manifest.ReservedOutputTokens, Memory: &result.Context,
		Excluded: []manuscript.ExcludedSource{{Title: "自主查询", Reason: "只搜索固定目录内当前角色可见的材料；查询记录见运行工具轨迹。空结果不是事实不存在的证明。"}},
	})
}
