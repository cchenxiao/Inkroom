package postgres

import (
	"context"
	"crypto/rand"
	"encoding/json"
	"errors"
	"inkloom/internal/app"
	"inkloom/internal/config"
	"inkloom/internal/domain/planning"
	"os"
	"testing"
	"time"
)

// 独立测试 scope：真实事务覆盖幂等、陈旧采用与重启，避免堆叠 Mock 测试。
func TestStyleTrialPersistenceAndVersionGuards(t *testing.T) {
	url := os.Getenv("INKLOOM_TEST_DATABASE_URL")
	if url == "" {
		t.Skip("requires dedicated test database")
	}
	ctx := context.Background()
	s, err := Open(ctx, url)
	if err != nil {
		t.Fatal(err)
	}
	scope := "style-test-" + rand.Text()
	defer func() {
		for _, sql := range []string{
			"DELETE FROM planning_style_calls WHERE job_id IN(SELECT id FROM planning_style_jobs WHERE scope=$1)",
			"DELETE FROM planning_style_selections WHERE scope=$1", "DELETE FROM planning_style_jobs WHERE scope=$1",
			"DELETE FROM planning_selections WHERE scope=$1", "DELETE FROM planning_inputs WHERE scope=$1", "DELETE FROM planning_heads WHERE scope=$1",
		} {
			if _, e := s.pool.Exec(ctx, sql, scope); e != nil {
				t.Error(e)
			}
		}
		s.Close()
	}()
	raw, err := os.ReadFile("../../demo/style_trial.json")
	if err != nil {
		t.Fatal(err)
	}
	var fixture planning.TrialInput
	if err = json.Unmarshal(raw, &fixture); err != nil {
		t.Fatal(err)
	}
	if _, err = s.SavePlanningInput(ctx, scope, 0, fixture.Source.Intake); err != nil {
		t.Fatal(err)
	}
	dir := planning.SelectRequest{ExpectedInputVersion: 1, CandidateIndex: -1, Direction: fixture.Selection.Direction}
	if _, err = s.SelectPlanningDirection(ctx, scope, dir); err != nil {
		t.Fatal(err)
	}
	req := planning.StartTrialRequest{RequestID: rand.Text(), ExpectedInputVersion: 1, ExpectedDirectionVersion: 1, Beat: fixture.Beat, Variants: fixture.Variants}
	job, created, err := s.StartStyleTrial(ctx, scope, req, "scripted-fake")
	if err != nil || !created {
		t.Fatal(err)
	}
	if _, created, err = s.StartStyleTrial(ctx, scope, req, "scripted-fake"); err != nil || created {
		t.Fatal("duplicate paid request", err)
	}
	changed := req
	changed.Beat.Outcome = "另一种结局"
	if _, _, err = s.StartStyleTrial(ctx, scope, changed, "scripted-fake"); !errors.Is(err, app.ErrVersionMismatch) {
		t.Fatal("request ID reused with different material", err)
	}
	report, err := app.GenerateStyleTrials(ctx, config.Config{Model: "fake", ModelName: "scripted-fake", MaxCalls: 4, MaxTokens: 40000, MaxOutputTokens: 2048, CallTimeout: time.Second}, job.Report.Input)
	if err != nil {
		t.Fatal(err)
	}
	if err = s.FinishStyleTrial(ctx, job.ID, report, nil); err != nil {
		t.Fatal(err)
	}
	selection := planning.StyleSelectionRequest{ExpectedInputVersion: 1, ExpectedDirectionVersion: 1, JobID: job.ID, CandidateVersion: 1, VariantID: report.Samples[0].Variant.ID, AnchorText: "作者改写后的参考文字。", Rules: planning.StyleRules{POV: "第三人称限知", Tense: "过去时", Tone: "克制", SentenceLength: planning.NumberRange{Min: 8, Max: 30}, DialogueRatio: planning.NumberRange{Min: 0.1, Max: 0.5}}}
	chosen, err := s.SelectStyle(ctx, scope, selection)
	if err != nil {
		t.Fatal(err)
	}
	if chosen.AnchorVersion != 1 || chosen.Version != 1 {
		t.Fatal("anchor and profile must version together")
	}
	if _, err = s.SelectStyle(ctx, scope, selection); !errors.Is(err, app.ErrVersionMismatch) {
		t.Fatal("stale profile overwrite", err)
	}
	dir.ExpectedDirectionVersion = 1
	dir.Direction.Tone = "换一个新基调"
	if _, err = s.SelectPlanningDirection(ctx, scope, dir); err != nil {
		t.Fatal(err)
	}
	selection.ExpectedDirectionVersion = 2
	selection.ExpectedStyleVersion = 1
	if _, err = s.SelectStyle(ctx, scope, selection); !errors.Is(err, app.ErrVersionMismatch) {
		t.Fatal("old sample adopted under new direction", err)
	}
	req.RequestID = rand.Text()
	req.ExpectedDirectionVersion = 2
	pending, _, err := s.StartStyleTrial(ctx, scope, req, "scripted-fake")
	if err != nil {
		t.Fatal(err)
	}
	s.Close()
	s, err = Open(ctx, url)
	if err != nil {
		t.Fatal(err)
	}
	state, err := s.GetPlanning(ctx, scope)
	if err != nil {
		t.Fatal(err)
	}
	if state.StyleSelection == nil || state.StyleSelection.AnchorText != selection.AnchorText || state.StyleSelection.DirectionVersion == state.DirectionVersion {
		t.Fatal("adoption lost or dependency silently changed")
	}
	for _, j := range state.StyleJobs {
		if j.ID == pending.ID && j.Report.Status != "interrupted" {
			t.Fatal("restart must not rerun model")
		}
	}
	review := selection
	review.SourceStyleVersion = 1
	review.AnchorText = "复核旧方向下的锚文本。"
	reviewed, err := s.SelectStyle(ctx, scope, review)
	if err != nil || reviewed.JobID != job.ID || reviewed.SourceStyleVersion != 1 || reviewed.DirectionVersion != 2 {
		t.Fatal("review must retain original sample provenance", err)
	}
	manual := selection
	manual.ExpectedStyleVersion = 2
	manual.JobID = ""
	manual.CandidateVersion = 0
	manual.VariantID = ""
	manual.AnchorText = "已有范文经过作者复核。"
	adopted, err := s.SelectStyle(ctx, scope, manual)
	if err != nil || adopted.DirectionVersion != 2 || adopted.AnchorVersion != 3 {
		t.Fatal("manual anchor path must adopt against current direction", err)
	}
	if _, err = s.SavePlanningInput(ctx, scope, 1, planning.Intake{Premise: "新立意"}); err != nil {
		t.Fatal(err)
	}
	manual.ExpectedInputVersion = 2
	manual.ExpectedStyleVersion = 3
	if _, err = s.SelectStyle(ctx, scope, manual); !errors.Is(err, app.ErrVersionMismatch) {
		t.Fatal("manual path accepted direction from old intake", err)
	}

}
