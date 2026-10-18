// Package app 装配一次用例；CLI 和 HTTP 复用同一条执行路径。
package app

import (
	"context"
	"fmt"

	"inkloom/internal/agents/adapters"
	"inkloom/internal/agents/model"
	"inkloom/internal/agents/prompts"
	"inkloom/internal/config"
	"inkloom/internal/demo"
	"inkloom/internal/orchestration"
)

func ExecuteChapter(ctx context.Context, cfg config.Config, scenario string, opts orchestration.Options) (orchestration.ChapterState, error) {
	if cfg.Model != "fake" && scenario != "normal" {
		return orchestration.ChapterState{}, fmt.Errorf("failure scenarios require INKLOOM_MODEL=fake")
	}
	_, steps, err := demo.Load(scenario)
	if err != nil {
		return orchestration.ChapterState{}, err
	}
	input := opts.FrozenInput
	if input == nil {
		prepared, e := PrepareContext(cfg, scenario, "cli", opts.BaseDraftVersion)
		if e != nil {
			return orchestration.ChapterState{}, e
		}
		input = &prepared
	}
	if err = input.Validate(); err != nil || input.Manifest.BaseDraftVersion != opts.BaseDraftVersion {
		return orchestration.ChapterState{}, ErrContextMismatch
	}
	bundle := input.Bundle
	if bundle.WritingTask != nil {
		steps = plannedFakeSteps(bundle)
	}
	steps, err = demo.WithBaseVersion(steps, opts.BaseDraftVersion)
	if err != nil {
		return orchestration.ChapterState{}, err
	}
	var chat model.ChatModel = lookupFake{next: authorReviewFake{next: model.NewFake(steps)}}
	name := "fake"
	if cfg.Model == "deepseek" && len(bundle.ManualEdits) == 0 {
		chat, err = adapters.NewDeepSeek(cfg)
		if err != nil {
			return orchestration.ChapterState{}, err
		}
		name = cfg.ModelName
	}
	guard := model.NewGuard(chat, model.Limits{History: opts.CallHistory, OnCall: opts.OnModelCall, Calls: cfg.MaxCalls, Tokens: cfg.MaxTokens, OutputTokens: cfg.MaxOutputTokens, ConsistencyOutputTokens: cfg.ConsistencyOutputTokens, ConsistencyTimeout: cfg.ConsistencyTimeout, Timeout: cfg.CallTimeout, ModelName: name})
	var latest orchestration.ChapterState
	observer := opts.OnProgress
	opts.OnProgress = func(state orchestration.ChapterState) {
		state.Usage = guard.Usage()
		latest = state
		if observer != nil {
			observer(state)
		}
	}
	graph, err := orchestration.NewChapter(ctx, prompts.Bind(guard), opts)
	if err != nil {
		return orchestration.ChapterState{}, fmt.Errorf("compile graph: %w", err)
	}
	result, err := graph.Invoke(ctx, bundle)
	if err != nil {
		result = orchestration.TerminalError(latest, err)
	}
	result.Usage = guard.Usage()
	if err != nil && result.Status != "escalated" {
		return result, fmt.Errorf("execute chapter: %w", err)
	}
	return result, nil
}
