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

func continuityEvaluation(ctx context.Context, selectedCase, suite string) error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}
	if cfg.Model != "deepseek" {
		return fmt.Errorf("continuity-eval requires configured real model")
	}
	chat, err := adapters.NewDeepSeek(cfg)
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(ctx, 4*time.Minute)
	defer cancel()
	var selected []string
	if selectedCase != "" {
		selected = []string{selectedCase}
	}
	evaluate := evaluation.RunContinuity
	if suite == "compact" {
		evaluate = evaluation.RunCompactContinuity
	}
	if suite == "quantity" {
		evaluate = evaluation.RunQuantityContinuity
	}
	report, runErr := evaluate(ctx, cfg.ModelName, model.Limits{Calls: min(cfg.MaxCalls, 14), Tokens: min(cfg.MaxTokens, 128000), OutputTokens: cfg.MaxOutputTokens, ConsistencyOutputTokens: cfg.ConsistencyOutputTokens, ConsistencyTimeout: cfg.ConsistencyTimeout, Timeout: cfg.CallTimeout, ModelName: cfg.ModelName}, chat, selected...)
	enc := json.NewEncoder(os.Stdout)
	enc.SetIndent("", "  ")
	if err = enc.Encode(report); err != nil {
		return err
	}
	fmt.Fprintf(os.Stderr, "continuity-eval: %d/%d cases\n", report.Passed, report.Total)
	return runErr
}
