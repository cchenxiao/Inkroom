package demo_test

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"inkloom/internal/agents/model"
	"inkloom/internal/app"
	"inkloom/internal/config"
	"inkloom/internal/demo"
	"inkloom/internal/domain/manuscript"
	"inkloom/internal/domain/review"
	"inkloom/internal/orchestration"
)

// apply 保存后清空当前报告，但保留问题引文。模拟恢复收到的 pending 状态。
func TestFakeKeepsFindingsAcrossPendingReview(t *testing.T) {
	ctx := context.Background()
	original, err := app.ExecuteChapter(ctx, config.Config{Model: "fake", MaxCalls: 14, MaxTokens: 24000, MaxOutputTokens: 2048, CallTimeout: time.Second}, "hard-conflict", orchestration.Options{})
	if err != nil {
		t.Fatal(err)
	}
	pending := original
	pending.DraftVersion++
	pending.Report = review.Report{DraftVersion: pending.DraftVersion, Findings: []review.Finding{}}
	raw, _ := json.Marshal(struct {
		DraftVersion int                  `json:"draftVersion"`
		Segments     []manuscript.Segment `json:"segments"`
	}{pending.DraftVersion, pending.Segments})
	out, _, err := demo.NewHumanFake(pending).Generate(ctx, model.Input{Role: "hard_consistency", Material: raw})
	if err != nil {
		t.Fatal(err)
	}
	var got struct {
		Findings []review.Finding `json:"findings"`
	}
	if err = json.Unmarshal([]byte(out.Content), &got); err != nil {
		t.Fatal(err)
	}
	if len(got.Findings) != len(original.Report.Findings) || len(got.Findings) == 0 {
		t.Fatalf("resume lost blocking findings: got %d want %d", len(got.Findings), len(original.Report.Findings))
	}
}
