package postgres

import (
	"context"
	"crypto/rand"
	"encoding/json"
	"errors"
	"inkloom/internal/agents/model"
	"inkloom/internal/app"
	"inkloom/internal/config"
	"inkloom/internal/domain/planning"
	"os"
	"testing"
	"time"
)

func TestOutlineVersionsBindingsAndRestart(t *testing.T) {
	url := os.Getenv("INKLOOM_TEST_DATABASE_URL")
	if url == "" {
		t.Skip("requires dedicated test database")
	}
	ctx := context.Background()
	s, err := Open(ctx, url)
	if err != nil {
		t.Fatal(err)
	}
	scope := "outline-test-" + rand.Text()
	defer func() {
		for _, q := range []string{
			"DELETE FROM planning_outline_calls WHERE job_id IN(SELECT id FROM planning_outline_jobs WHERE scope=$1)", "DELETE FROM planning_outline_bindings WHERE scope=$1", "DELETE FROM planning_outline_selections WHERE scope=$1", "DELETE FROM planning_outline_jobs WHERE scope=$1",
			"DELETE FROM planning_core_calls WHERE job_id IN(SELECT id FROM planning_core_jobs WHERE scope=$1)", "DELETE FROM planning_core_selections WHERE scope=$1", "DELETE FROM planning_core_jobs WHERE scope=$1", "DELETE FROM planning_style_selections WHERE scope=$1", "DELETE FROM planning_selections WHERE scope=$1", "DELETE FROM planning_inputs WHERE scope=$1", "DELETE FROM planning_heads WHERE scope=$1",
		} {
			if _, err := s.pool.Exec(ctx, q, scope); err != nil {
				t.Error(err)
			}
		}
		s.Close()
	}()
	raw, err := os.ReadFile("../../demo/core_settings.json")
	if err != nil {
		t.Fatal(err)
	}
	var base planning.CoreSettingsInput
	if err = json.Unmarshal(raw, &base); err != nil {
		t.Fatal(err)
	}
	if _, err = s.SavePlanningInput(ctx, scope, 0, base.Source.Intake); err != nil {
		t.Fatal(err)
	}
	if _, err = s.SelectPlanningDirection(ctx, scope, planning.SelectRequest{ExpectedInputVersion: 1, CandidateIndex: -1, Direction: base.Selection.Direction}); err != nil {
		t.Fatal(err)
	}
	styleReq := planning.StyleSelectionRequest{ExpectedInputVersion: 1, ExpectedDirectionVersion: 1, AnchorText: base.Style.AnchorText, Rules: base.Style.Rules}
	if _, err = s.SelectStyle(ctx, scope, styleReq); err != nil {
		t.Fatal(err)
	}
	cfg := config.Config{Model: "fake", ModelName: "scripted-fake", MaxCalls: 3, MaxTokens: 24000, MaxOutputTokens: 4096, CallTimeout: time.Second}
	coreJob, _, err := s.StartCoreSettings(ctx, scope, planning.CoreStartRequest{RequestID: rand.Text(), ExpectedInputVersion: 1, ExpectedDirectionVersion: 1, ExpectedStyleVersion: 1, Request: "一位主角"}, cfg.ModelName)
	if err != nil {
		t.Fatal(err)
	}
	report, err := app.GenerateCoreSettings(ctx, cfg, coreJob.Input)
	if err != nil {
		t.Fatal(err)
	}
	if err = s.FinishCoreSettings(ctx, coreJob.ID, report, nil); err != nil {
		t.Fatal(err)
	}
	decisions := map[string]planning.CoreDecision{}
	for _, c := range report.Output.Characters {
		decisions[c.ID] = planning.CoreConfirmed
	}
	for _, f := range report.Output.WorldFacts {
		decisions[f.ID] = planning.CoreConfirmed
	}
	for _, p := range report.Output.Plans {
		decisions[p.ID] = planning.CoreConfirmed
	}
	if _, err = s.SaveCoreSettings(ctx, scope, planning.CoreSaveRequest{ExpectedInputVersion: 1, ExpectedDirectionVersion: 1, ExpectedStyleVersion: 1, JobID: coreJob.ID, CandidateVersion: 1, Content: *report.Output, Decisions: decisions}); err != nil {
		t.Fatal(err)
	}
	req := planning.OutlineStartRequest{RequestID: rand.Text(), Expected: planning.PlanningVersions{Input: 1, Direction: 1, Style: 1, Core: 1}, Request: "三章规划", ChapterCount: 3}
	job, created, err := s.StartOutline(ctx, scope, req, cfg.ModelName)
	if err != nil || !created {
		t.Fatal(err)
	}
	if _, created, err = s.StartOutline(ctx, scope, req, cfg.ModelName); err != nil || created {
		t.Fatal("duplicate invocation", err)
	}
	changed := req
	changed.ChapterCount = 4
	if _, _, err = s.StartOutline(ctx, scope, changed, cfg.ModelName); !errors.Is(err, app.ErrVersionMismatch) {
		t.Fatal("reused id accepted changed request", err)
	}
	out, err := app.GenerateOutline(ctx, cfg, job.Input, func(ctx context.Context, c model.CallRecord) error { return s.RecordOutlineCall(ctx, job.ID, c) })
	if err != nil {
		t.Fatal(err)
	}
	if err = s.FinishOutline(ctx, job.ID, out, nil); err != nil {
		t.Fatal(err)
	}
	state, err := s.GetPlanning(ctx, scope)
	if err != nil {
		t.Fatal(err)
	}
	if state.OutlineSelection != nil || len(state.OutlineJobs) != 1 || len(state.OutlineJobs[0].Calls) != 1 {
		t.Fatal("generation auto adopted")
	}
	content := *state.OutlineJobs[0].Output
	if content.Chapters[0].ID == out.Chapters[0].ID {
		t.Fatal("model local ids not namespaced")
	}
	firstID := content.Chapters[0].ID
	content.Chapters[0], content.Chapters[1] = content.Chapters[1], content.Chapters[0]
	save := planning.OutlineSaveRequest{Expected: req.Expected, JobID: job.ID, CandidateVersion: 1, Content: content, Confirmed: false}
	selection, err := s.SaveOutline(ctx, scope, save)
	if err != nil || selection.Confirmed || selection.Version != 1 {
		t.Fatal(err)
	}
	if selection.Content.Chapters[1].ID != firstID || selection.Content.Bindings.Style[0].ChapterID != firstID {
		t.Fatal("reorder broke bindings")
	}
	save.ExpectedOutlineVersion = 1
	save.SourceOutlineVersion = 1
	save.Confirmed = true
	selection, err = s.SaveOutline(ctx, scope, save)
	if err != nil || !selection.Confirmed || selection.BindingsVersion != 2 {
		t.Fatal(err)
	}
	var bindingCount int
	if err = s.pool.QueryRow(ctx, "SELECT count(*) FROM planning_outline_bindings WHERE scope=$1", scope).Scan(&bindingCount); err != nil || bindingCount != 2 {
		t.Fatal("binding snapshots not saved", err)
	}
	if _, err = s.SaveOutline(ctx, scope, save); !errors.Is(err, app.ErrVersionMismatch) {
		t.Fatal("old edit overwritten", err)
	}
	save.ExpectedOutlineVersion = 2
	save.SourceOutlineVersion = 2
	save.Content.Chapters[0].CharacterIDs = []string{"absent"}
	if _, err = s.SaveOutline(ctx, scope, save); !errors.Is(err, app.ErrInvalidWrite) {
		t.Fatal("unknown character accepted", err)
	}
	save.Content.Chapters[0].CharacterIDs = []string{report.Output.Characters[0].ID}
	save.JobID = "forged"
	if _, err = s.SaveOutline(ctx, scope, save); !errors.Is(err, app.ErrInvalidWrite) {
		t.Fatal("provenance forged", err)
	}
	save.JobID = job.ID
	// 正在生成的候选与作者版本分开，重启只中断任务，不改作者确认。
	req.RequestID = rand.Text()
	pending, _, err := s.StartOutline(ctx, scope, req, cfg.ModelName)
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
	if state.OutlineSelection.Version != 2 || !state.OutlineSelection.Confirmed {
		t.Fatal("author snapshot lost")
	}
	for _, j := range state.OutlineJobs {
		if j.ID == pending.ID && j.Status != "interrupted" {
			t.Fatal("pending job not interrupted")
		}
	}
	styleReq.ExpectedStyleVersion = 1
	styleReq.SourceStyleVersion = 1
	styleReq.Rules.Tone = "调整后的基调"
	if _, err = s.SelectStyle(ctx, scope, styleReq); err != nil {
		t.Fatal(err)
	}
	if _, err = s.SaveOutline(ctx, scope, save); !errors.Is(err, app.ErrVersionMismatch) {
		t.Fatal("old style accepted", err)
	}
	save.Expected.Style = 2
	if _, err = s.SaveOutline(ctx, scope, save); !errors.Is(err, app.ErrVersionMismatch) {
		t.Fatal("outdated core accepted", err)
	}
}
