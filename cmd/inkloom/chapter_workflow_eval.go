package main

import (
	"context"
	"encoding/json"
	"fmt"
	"inkloom/internal/agents/adapters"
	"inkloom/internal/agents/model"
	"inkloom/internal/config"
	"inkloom/internal/evaluation"
	"os"
	"time"
)

func chapterWorkflowEvaluation(ctx context.Context) error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}
	if cfg.Model != "deepseek" {
		return fmt.Errorf("chapter-workflow-eval requires configured real model; offline tests use go test")
	}
	chat, err := adapters.NewDeepSeek(cfg)
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(ctx, 6*time.Minute)
	defer cancel()
	limits := model.Limits{Calls: min(cfg.MaxCalls, 14), Tokens: min(cfg.MaxTokens, 128000), OutputTokens: cfg.MaxOutputTokens, ConsistencyOutputTokens: cfg.ConsistencyOutputTokens, ConsistencyTimeout: cfg.ConsistencyTimeout, Timeout: cfg.CallTimeout, ModelName: cfg.ModelName}
	report, runErr := evaluation.RunChapterWorkflow(ctx, cfg.Model, cfg.ModelName, limits, chat, cfg.ExperimentalContinuity)
	enc := json.NewEncoder(os.Stdout)
	enc.SetIndent("", "  ")
	if err = enc.Encode(report); err != nil {
		return err
	}
	fmt.Fprintf(os.Stderr, "chapter-workflow-eval: %d/%d stages; synthetic unpublished materials; inspect generated prose\n", report.Passed, report.Total)
	return runErr
}
