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

func authorRevisionEvaluation(ctx context.Context, selected string) error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}
	if cfg.Model != "deepseek" {
		return fmt.Errorf("author-revision-eval requires configured real model; offline coverage uses go test")
	}
	chat, err := adapters.NewDeepSeek(cfg)
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(ctx, 4*time.Minute)
	defer cancel()
	// Hard suite ceiling; honor any tighter local limit.
	limits := model.Limits{Calls: min(cfg.MaxCalls, 14), Tokens: min(cfg.MaxTokens, 128000), OutputTokens: cfg.MaxOutputTokens, ConsistencyOutputTokens: cfg.ConsistencyOutputTokens, ConsistencyTimeout: cfg.ConsistencyTimeout, Timeout: cfg.CallTimeout, ModelName: cfg.ModelName}
	var ids []string
	if selected != "" {
		ids = []string{selected}
	}
	report, runErr := evaluation.RunAuthorRevision(ctx, cfg.Model, cfg.ModelName, limits, chat, ids...)
	encoder := json.NewEncoder(os.Stdout)
	encoder.SetIndent("", "  ")
	if err := encoder.Encode(report); err != nil {
		return err
	}
	fmt.Fprintf(os.Stderr, "author-revision-eval: %d/%d probes; model=%s; generated prose still requires human inspection\n", report.Passed, report.Total, cfg.ModelName)
	return runErr
}
