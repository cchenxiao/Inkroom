package server

import (
	"inkloom/internal/app"
	"inkloom/internal/config"
	"testing"
)

func TestExecutionUsesPersistedBudget(t *testing.T) {
	s := service{cfg: config.Config{MaxCalls: 10, MaxTokens: 128000, MaxOutputTokens: 8192}}
	cfg := s.runConfig(app.Run{MaxCalls: 48, MaxTokens: 512000})
	if cfg.MaxCalls != 48 || cfg.MaxTokens != 512000 || cfg.MaxOutputTokens != 8192 {
		t.Fatal("frozen budget not used")
	}
}
