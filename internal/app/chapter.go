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

func ExecuteChapter(ctx context.Context, cfg config.Config, scenario string) (orchestration.ChapterState, error) {
	if cfg.Model != "fake" && scenario != "normal" {
		return orchestration.ChapterState{}, fmt.Errorf("failure scenarios require INKLOOM_MODEL=fake")
	}
	bundle, steps, err := demo.Load(scenario)
	if err != nil {
		return orchestration.ChapterState{}, err
	}
	var chat model.ChatModel = model.NewFake(steps)
	name := "fake"
	if cfg.Model == "deepseek" {
		chat, err = adapters.NewDeepSeek(cfg)
		if err != nil {
			return orchestration.ChapterState{}, err
		}
		name = cfg.ModelName
	}
	guard := model.NewGuard(chat, model.Limits{Calls: cfg.MaxCalls, Tokens: cfg.MaxTokens, OutputTokens: cfg.MaxOutputTokens, Timeout: cfg.CallTimeout, ModelName: name})
	graph, err := orchestration.NewChapter(ctx, prompts.Bind(guard))
	if err != nil {
		return orchestration.ChapterState{}, fmt.Errorf("compile graph: %w", err)
	}
	result, err := graph.Invoke(ctx, bundle)
	result.Usage = guard.Usage()
	if err != nil {
		return result, fmt.Errorf("execute chapter: %w", err)
	}
	return result, nil
}
