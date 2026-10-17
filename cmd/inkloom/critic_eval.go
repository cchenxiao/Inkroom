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

func criticEvaluation(ctx context.Context, candidate bool) error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}
	factory := evaluation.Factory(evaluation.Scripted)
	if cfg.Model == "deepseek" {
		factory = func(evaluation.Case) (model.ChatModel, error) { return adapters.NewDeepSeek(cfg) }
	}
	ctx, stop := context.WithTimeout(ctx, 3*time.Minute)
	defer stop()
	limits := model.Limits{Calls: 4, Tokens: cfg.MaxTokens, OutputTokens: cfg.MaxOutputTokens, ConsistencyOutputTokens: cfg.ConsistencyOutputTokens, ConsistencyTimeout: cfg.ConsistencyTimeout, Timeout: cfg.CallTimeout, ModelName: cfg.ModelName}
	report, runErr := evaluation.Run(ctx, cfg.Model, cfg.ModelName, limits, factory, candidate)
	encoder := json.NewEncoder(os.Stdout)
	encoder.SetIndent("", "  ")
	if err = encoder.Encode(report); err != nil {
		return err
	}
	fmt.Fprintf(os.Stderr, "critic-eval: %d/%d; provider=%s; teaching samples, not calibrated accuracy\n", report.Passed, report.Total, cfg.Model)
	return runErr
}
