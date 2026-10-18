package config

import (
	"testing"
	"time"
)

func TestExperimentalContinuityRequiresExplicitOptIn(t *testing.T) {
	t.Setenv("INKLOOM_MODEL", "fake")
	t.Setenv("INKLOOM_EMBEDDER", "none")
	for _, tc := range []struct {
		raw           string
		want, invalid bool
	}{{"", false, false}, {"false", false, false}, {"true", true, false}, {"maybe", false, true}} {
		t.Run(tc.raw, func(t *testing.T) {
			t.Setenv("INKLOOM_EXPERIMENTAL_CONTINUITY", tc.raw)
			cfg, err := Load()
			if (err != nil) != tc.invalid || (!tc.invalid && cfg.ExperimentalContinuity != tc.want) {
				t.Fatalf("unexpected opt-in: enabled=%v error=%v", cfg.ExperimentalContinuity, err)
			}
		})
	}
}

func TestConsistencyPolicyIsSeparateAndValidated(t *testing.T) {
	t.Setenv("INKLOOM_MODEL", "fake")
	t.Setenv("INKLOOM_EMBEDDER", "none")
	t.Setenv("INKLOOM_MAX_OUTPUT_TOKENS", "8192")
	t.Setenv("INKLOOM_CALL_TIMEOUT", "60s")
	t.Setenv("INKLOOM_CONSISTENCY_OUTPUT_TOKENS", "")
	t.Setenv("INKLOOM_CONSISTENCY_TIMEOUT", "")
	c, err := Load()
	if err != nil || c.ConsistencyOutputTokens != 30000 || c.ConsistencyTimeout != 90*time.Second || c.MaxOutputTokens != 8192 || c.CallTimeout != time.Minute {
		t.Fatal("default policy", err)
	}
	t.Setenv("INKLOOM_CONSISTENCY_OUTPUT_TOKENS", "20000")
	t.Setenv("INKLOOM_CONSISTENCY_TIMEOUT", "45s")
	c, err = Load()
	if err != nil || c.ConsistencyOutputTokens != 20000 || c.ConsistencyTimeout != 45*time.Second || c.MaxOutputTokens != 8192 {
		t.Fatal("custom policy", err)
	}
	for _, name := range []string{"INKLOOM_CONSISTENCY_OUTPUT_TOKENS", "INKLOOM_CONSISTENCY_TIMEOUT"} {
		t.Run(name, func(t *testing.T) {
			t.Setenv(name, "0")
			if _, err := Load(); err == nil {
				t.Fatal("invalid policy accepted")
			}
		})
	}
}

func TestChapterBudgetDoesNotReuseSingleBeatCap(t *testing.T) {
	t.Setenv("INKLOOM_MODEL", "fake")
	t.Setenv("INKLOOM_EMBEDDER", "none")
	t.Setenv("INKLOOM_MAX_CALLS", "10")
	t.Setenv("INKLOOM_MAX_TOKENS", "128000")
	t.Setenv("INKLOOM_CHAPTER_MAX_CALLS", "")
	t.Setenv("INKLOOM_CHAPTER_MAX_TOKENS", "")
	cfg, err := Load()
	if err != nil {
		t.Fatal(err)
	}
	chapter := cfg.ChapterLimits()
	if cfg.MaxCalls != 10 || chapter.MaxCalls != 48 || chapter.MaxTokens != 512000 {
		t.Fatal("scope budgets not separated")
	}
	t.Setenv("INKLOOM_CHAPTER_MAX_CALLS", "20")
	cfg, err = Load()
	if err != nil || cfg.ChapterLimits().MaxCalls != 20 {
		t.Fatal("explicit chapter cap ignored")
	}
	t.Setenv("INKLOOM_CHAPTER_MAX_TOKENS", "0")
	if _, err := Load(); err == nil {
		t.Fatal("invalid chapter cap accepted")
	}
}
