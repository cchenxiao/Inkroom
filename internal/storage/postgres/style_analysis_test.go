package postgres

import (
	"context"
	"crypto/rand"
	"errors"
	"inkloom/internal/agents/model"
	"inkloom/internal/app"
	"inkloom/internal/config"
	"inkloom/internal/domain/planning"
	"os"
	"strings"
	"testing"
	"time"
)

func TestStyleAnalysisLargeTextAdoptionAndRestart(t *testing.T) {
	url := os.Getenv("INKLOOM_TEST_DATABASE_URL")
	if url == "" {
		t.Skip("requires dedicated test database")
	}
	ctx := context.Background()
	s, err := Open(ctx, url)
	if err != nil {
		t.Fatal(err)
	}
	scope := "analysis-test-" + rand.Text()
	defer func() {
		for _, sql := range []string{
			"DELETE FROM planning_analysis_calls WHERE job_id IN(SELECT id FROM planning_style_analyses WHERE scope=$1)",
			"DELETE FROM planning_style_selections WHERE scope=$1", "DELETE FROM planning_style_analyses WHERE scope=$1",
			"DELETE FROM planning_selections WHERE scope=$1", "DELETE FROM planning_inputs WHERE scope=$1", "DELETE FROM planning_heads WHERE scope=$1",
		} {
			if _, e := s.pool.Exec(ctx, sql, scope); e != nil {
				t.Error(e)
			}
		}
		s.Close()
	}()
	req := planning.StyleAnalysisRequest{RequestID: rand.Text(), Title: "长参考", Text: strings.Repeat("风从门缝钻进来。他把手缩回袖口，等着她先说。", 900)}
	j, created, err := s.StartStyleAnalysis(ctx, scope, req, "scripted-fake")
	if err != nil || !created {
		t.Fatal(err)
	}
	if j.Input.TotalCharacters <= 3000 || j.Input.AnalyzedCharacters != 3000 {
		t.Fatal("long text sampling not disclosed")
	}
	if _, created, err = s.StartStyleAnalysis(ctx, scope, req, "scripted-fake"); err != nil || created {
		t.Fatal("idempotency failed", err)
	}
	cfg := config.Config{Model: "fake", ModelName: "scripted-fake", MaxCalls: 3, MaxTokens: 24000, MaxOutputTokens: 2048, CallTimeout: time.Second}
	output, err := app.AnalyzeReferenceStyle(ctx, cfg, j.Input, func(ctx context.Context, c model.CallRecord) error { return s.RecordStyleAnalysisCall(ctx, j.ID, c) })
	if err != nil {
		t.Fatal(err)
	}
	if err = s.FinishStyleAnalysis(ctx, j.ID, output, nil); err != nil {
		t.Fatal(err)
	}
	input, err := s.SavePlanningInput(ctx, scope, 0, planning.Intake{Premise: "修钟人合作"})
	if err != nil {
		t.Fatal(err)
	}
	dirs, err := app.GenerateDirections(ctx, cfg, input, nil)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = s.SelectPlanningDirection(ctx, scope, planning.SelectRequest{ExpectedInputVersion: 1, CandidateIndex: -1, Direction: dirs.Directions[0]}); err != nil {
		t.Fatal(err)
	}
	adopt := planning.StyleSelectionRequest{ExpectedInputVersion: 1, ExpectedDirectionVersion: 1, AnalysisID: j.ID, AnalysisVersion: 1, AnchorText: output.AnchorText, Rules: output.Rules}
	selected, err := s.SelectStyle(ctx, scope, adopt)
	if err != nil {
		t.Fatal(err)
	}
	if selected.AnalysisID != j.ID {
		t.Fatal("analysis provenance lost")
	}
	if _, err = s.SelectStyle(ctx, scope, adopt); !errors.Is(err, app.ErrVersionMismatch) {
		t.Fatal("stale selection overwritten", err)
	}
	adopt.ExpectedStyleVersion = 1
	adopt.SourceStyleVersion = 1
	adopt.Rules.Tone = "作者调整为更克制"
	if _, err = s.SelectStyle(ctx, scope, adopt); err != nil {
		t.Fatal("editing should preserve analysis source", err)
	}
	req.RequestID = rand.Text()
	pending, _, err := s.StartStyleAnalysis(ctx, scope, req, "scripted-fake")
	if err != nil {
		t.Fatal(err)
	}
	s.Close()
	s, err = Open(ctx, url)
	if err != nil {
		t.Fatal(err)
	}
	jobs, err := s.ListStyleAnalyses(ctx, scope)
	if err != nil {
		t.Fatal(err)
	}
	for _, job := range jobs {
		if job.ID == j.ID && (job.Status != "completed" || job.Output == nil || len(job.Calls) != 1 || job.Input.Text != req.Text) {
			t.Fatal("analysis not persisted")
		}
		if job.ID == pending.ID && job.Status != "interrupted" {
			t.Fatal("pending analysis reran")
		}
	}
}
