package app

import (
	"context"
	"inkloom/internal/agents/adapters"
	"inkloom/internal/agents/model"
	"inkloom/internal/config"
	"inkloom/internal/contextassembly"
	"inkloom/internal/contextlookup"
	"inkloom/internal/domain/manuscript"
	"inkloom/internal/domain/memory"
	"inkloom/internal/retrieval"
)

// LookupContext 用已经持久化的基础输入查询，不能重新从 demo 或最新配置装配。
func LookupContext(ctx context.Context, cfg config.Config, base manuscript.FrozenInput, s *retrieval.Service, onCall func(context.Context, model.CallRecord) error, onTrace contextlookup.Observe) (manuscript.FrozenInput, error) {
	if err := base.Validate(); err != nil {
		return manuscript.FrozenInput{}, err
	}
	// Fake 也走真实工具循环，检索本身由配置决定使用关键词/向量。
	var err error
	steps := []model.Step{}
	for i := 0; i < max(1, len(base.Bundle.Targets)); i++ {
		steps = append(steps, model.Step{Role: "context_assembler", FinishReason: model.ToolRequested, ToolCalls: []model.ToolCall{{ID: "lookup-1", Name: "search_memory", Arguments: `{"query":"铜扣 父亲 旧外套"}`}}}, model.Step{Role: "context_assembler", Content: `{"decision":"ready"}`})
	}
	var chat model.ChatModel = model.NewFake(steps)
	if cfg.Model == "deepseek" {
		chat, err = adapters.NewDeepSeek(cfg)
		if err != nil {
			return manuscript.FrozenInput{}, err
		}
	}
	guard := model.NewGuard(chat, model.Limits{OnCall: onCall, Calls: cfg.MaxCalls, Tokens: cfg.MaxTokens, OutputTokens: cfg.MaxOutputTokens, ConsistencyOutputTokens: cfg.ConsistencyOutputTokens, ConsistencyTimeout: cfg.ConsistencyTimeout, Timeout: cfg.CallTimeout, ModelName: cfg.ModelName})
	trace := memory.LookupTrace{Steps: []memory.LookupStep{}}
	lookup := func(bundle manuscript.ContextBundle, scope string) (manuscript.ContextBundle, error) {
		view, e := MemoryView(bundle)
		if e != nil {
			return bundle, e
		}
		bundle.POVCharacterID = view.POV
		session, e := s.Session(ctx, view)
		if e != nil {
			return bundle, e
		}
		prefix := append([]memory.LookupStep{}, trace.Steps...)
		result, e := contextlookup.Run(ctx, guard, bundle, func(ctx context.Context, q string) (retrieval.Result, error) { return session.Search(ctx, view, q, 3) }, func(t memory.LookupTrace) error {
			for i := range t.Steps {
				t.Steps[i].Scope = scope
			}
			trace.Steps = append(append([]memory.LookupStep{}, prefix...), t.Steps...)
			trace.Stop = ""
			if t.Stop != "ready" {
				trace.Stop = t.Stop
			}
			if onTrace != nil {
				return onTrace(trace)
			}
			return nil
		})
		if e != nil {
			return bundle, e
		}
		if result.Context.Query == "" {
			return bundle, nil
		}
		previous := contextassembly.PreviousChapter{}
		if bundle.PreviousEnding != nil {
			previous = contextassembly.PreviousChapter{ProjectID: bundle.ProjectID, BranchID: bundle.BranchID, Confirmed: true, Source: *bundle.PreviousEnding}
		}
		prepared, e := contextassembly.Assemble(bundle, previous, contextassembly.Options{RunID: base.Manifest.RunID, BaseDraftVersion: base.Manifest.BaseDraftVersion, Budget: base.Manifest.Budget, ReservedOutputTokens: base.Manifest.ReservedOutputTokens, Memory: &result.Context, Excluded: base.Manifest.Excluded})
		return prepared.Bundle, e
	}
	bundle, err := base.Bundle.Freeze()
	if err != nil {
		return manuscript.FrozenInput{}, err
	}
	if len(bundle.Targets) > 0 {
		for i, t := range bundle.Targets {
			prepared, e := lookup(t, t.Beat.ID)
			if e != nil {
				return manuscript.FrozenInput{}, e
			}
			bundle.Targets[i] = prepared
		}
	} else {
		bundle, err = lookup(bundle, bundle.Beat.ID)
		if err != nil {
			return manuscript.FrozenInput{}, err
		}
	}
	trace.Stop = "ready"
	if onTrace != nil {
		if err = onTrace(trace); err != nil {
			return manuscript.FrozenInput{}, err
		}
	}
	base.Bundle = bundle
	return ReassemblePlanned(base)
}
