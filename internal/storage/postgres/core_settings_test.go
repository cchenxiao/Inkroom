package postgres

import (
	"context"
	"crypto/rand"
	"encoding/json"
	"errors"
	"os"
	"testing"
	"time"

	"inkloom/internal/agents/model"
	"inkloom/internal/app"
	"inkloom/internal/config"
	"inkloom/internal/domain/planning"
)

func TestCoreSettingsAuthorReviewAndVersionIsolation(t *testing.T) {
	url := os.Getenv("INKLOOM_TEST_DATABASE_URL")
	if url == "" {
		t.Skip("requires dedicated test database")
	}
	ctx := context.Background()
	s, err := Open(ctx, url)
	if err != nil {
		t.Fatal(err)
	}
	scope := "core-test-" + rand.Text()
	defer func() {
		for _, sql := range []string{
			"DELETE FROM planning_core_calls WHERE job_id IN(SELECT id FROM planning_core_jobs WHERE scope=$1)",
			"DELETE FROM planning_core_selections WHERE scope=$1", "DELETE FROM planning_core_jobs WHERE scope=$1",
			"DELETE FROM planning_style_selections WHERE scope=$1", "DELETE FROM planning_selections WHERE scope=$1", "DELETE FROM planning_inputs WHERE scope=$1", "DELETE FROM planning_heads WHERE scope=$1",
		} {
			if _, err := s.pool.Exec(ctx, sql, scope); err != nil {
				t.Error(err)
			}
		}
		s.Close()
	}()
	raw, err := os.ReadFile("../../demo/core_settings.json")
	if err != nil {
		t.Fatal(err)
	}
	var fixture planning.CoreSettingsInput
	if err = json.Unmarshal(raw, &fixture); err != nil {
		t.Fatal(err)
	}
	if _, err = s.SavePlanningInput(ctx, scope, 0, fixture.Source.Intake); err != nil {
		t.Fatal(err)
	}
	if _, err = s.SelectPlanningDirection(ctx, scope, planning.SelectRequest{ExpectedInputVersion: 1, CandidateIndex: -1, Direction: fixture.Selection.Direction}); err != nil {
		t.Fatal(err)
	}
	req := planning.CoreStartRequest{RequestID: rand.Text(), ExpectedInputVersion: 1, ExpectedDirectionVersion: 1, ExpectedStyleVersion: 1, Request: "只设计一个主角及必要事实"}
	if _, _, err = s.StartCoreSettings(ctx, scope, req, "fake"); !errors.Is(err, app.ErrVersionMismatch) {
		t.Fatal("missing style should block", err)
	}
	style := planning.StyleSelectionRequest{ExpectedInputVersion: 1, ExpectedDirectionVersion: 1, AnchorText: fixture.Style.AnchorText, Rules: fixture.Style.Rules}
	if _, err = s.SelectStyle(ctx, scope, style); err != nil {
		t.Fatal(err)
	}
	job, created, err := s.StartCoreSettings(ctx, scope, req, "fake")
	if err != nil || !created {
		t.Fatal(err)
	}
	if _, created, err = s.StartCoreSettings(ctx, scope, req, "fake"); err != nil || created {
		t.Fatal("duplicate call", err)
	}
	changed := req
	changed.Request = "different"
	if _, _, err = s.StartCoreSettings(ctx, scope, changed, "fake"); !errors.Is(err, app.ErrVersionMismatch) {
		t.Fatal("id reused with other input", err)
	}
	changed = req
	changed.RequestID = rand.Text()
	if _, _, err = s.StartCoreSettings(ctx, scope, changed, "fake"); !errors.Is(err, app.ErrRunBusy) {
		t.Fatal("concurrent generation", err)
	}
	cfg := config.Config{Model: "fake", ModelName: "scripted-fake", MaxCalls: 3, MaxTokens: 24000, MaxOutputTokens: 2048, CallTimeout: time.Second}
	report, err := app.GenerateCoreSettingsWithCalls(ctx, cfg, job.Input, func(ctx context.Context, c model.CallRecord) error { return s.RecordCoreCall(ctx, job.ID, c) })
	if err != nil {
		t.Fatal(err)
	}
	if err = s.FinishCoreSettings(ctx, job.ID, report, nil); err != nil {
		t.Fatal(err)
	}
	state, err := s.GetPlanning(ctx, scope)
	if err != nil {
		t.Fatal(err)
	}
	if state.CoreSelection != nil || len(state.CoreJobs) != 1 || len(state.CoreJobs[0].Calls) != 1 {
		t.Fatal("generation auto adopted or call missing")
	}
	content := *report.Output
	decisions := map[string]planning.CoreDecision{}
	for _, c := range content.Characters {
		decisions[c.ID] = planning.CorePending
	}
	for _, f := range content.WorldFacts {
		decisions[f.ID] = planning.CorePending
	}
	for _, p := range content.Plans {
		decisions[p.ID] = planning.CorePending
	}
	save := planning.CoreSaveRequest{ExpectedInputVersion: 1, ExpectedDirectionVersion: 1, ExpectedStyleVersion: 1, JobID: job.ID, CandidateVersion: 1, Content: content, Decisions: decisions}
	pending, err := s.SaveCoreSettings(ctx, scope, save)
	if err != nil || pending.Version != 1 {
		t.Fatal(err)
	}
	save.ExpectedCoreVersion = 1
	save.SourceCoreVersion = 1
	save.Decisions[content.Characters[0].ID] = planning.CoreConfirmed
	if _, err = s.SaveCoreSettings(ctx, scope, save); !errors.Is(err, app.ErrInvalidWrite) {
		t.Fatal("unconfirmed hard fact accepted", err)
	}
	for id := range save.Decisions {
		save.Decisions[id] = planning.CoreConfirmed
	}
	save.Content.Characters[0].Name = "作者修改的姓名"
	selected, err := s.SaveCoreSettings(ctx, scope, save)
	if err != nil || selected.Version != 2 {
		t.Fatal(err)
	}
	if _, err = s.SaveCoreSettings(ctx, scope, save); !errors.Is(err, app.ErrVersionMismatch) {
		t.Fatal("stale author edit overwrote", err)
	}
	state, err = s.GetPlanning(ctx, scope)
	if err != nil {
		t.Fatal(err)
	}
	if state.CoreJobs[0].Output.Characters[0].Name == selected.Content.Characters[0].Name {
		t.Fatal("original output mutated")
	}
	style.ExpectedStyleVersion = 1
	style.SourceStyleVersion = 1
	style.Rules.Tone = "新的克制基调"
	if _, err = s.SelectStyle(ctx, scope, style); err != nil {
		t.Fatal(err)
	}
	save.ExpectedCoreVersion = 2
	save.SourceCoreVersion = 2
	if _, err = s.SaveCoreSettings(ctx, scope, save); !errors.Is(err, app.ErrVersionMismatch) {
		t.Fatal("old upstream accepted", err)
	}
	save.ExpectedStyleVersion = 2
	save.SourceCoreVersion = 0
	if _, err = s.SaveCoreSettings(ctx, scope, save); !errors.Is(err, app.ErrVersionMismatch) {
		t.Fatal("old job newly adopted", err)
	}
	save.SourceCoreVersion = 2
	save.JobID = "forged"
	if _, err = s.SaveCoreSettings(ctx, scope, save); !errors.Is(err, app.ErrInvalidWrite) {
		t.Fatal("provenance forged", err)
	}
	save.JobID = job.ID
	if _, err = s.SaveCoreSettings(ctx, scope, save); err != nil {
		t.Fatal("explicit rereview failed", err)
	}
	changed.ExpectedStyleVersion = 2
	pendingJob, _, err := s.StartCoreSettings(ctx, scope, changed, "fake")
	if err != nil {
		t.Fatal(err)
	}
	s.Close()
	s, err = Open(ctx, url)
	if err != nil {
		t.Fatal(err)
	}
	state, err = s.GetPlanning(ctx, scope)
	if err != nil {
		t.Fatal(err)
	}
	if state.CoreSelection.Version != 3 {
		t.Fatal("selection lost after restart")
	}
	for _, j := range state.CoreJobs {
		if j.ID == pendingJob.ID && j.Status != "interrupted" {
			t.Fatal("pending job not interrupted")
		}
	}
}
