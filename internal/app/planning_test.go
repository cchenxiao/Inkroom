package app

import (
	"context"
	"inkloom/internal/config"
	"inkloom/internal/domain/planning"
	"strings"
	"testing"
	"time"
)

func TestFakePlanningAcceptsLongValidPremise(t *testing.T) {
	input := planning.Snapshot(1, planning.Intake{Premise: strings.Repeat("字", 1800)})
	_, err := GenerateDirections(context.Background(), config.Config{Model: "fake", ModelName: "scripted-fake", MaxCalls: 3, MaxTokens: 24000, MaxOutputTokens: 2048, CallTimeout: time.Second}, input, nil)
	if err != nil {
		t.Fatal(err)
	}
}
