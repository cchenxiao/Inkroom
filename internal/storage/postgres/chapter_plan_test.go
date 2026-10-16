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
	"inkloom/internal/orchestration"
	"os"
	"strings"
	"testing"
	"time"
)

func TestChapterPlanFrozenInputAndAuthorVersion(t *testing.T) {
	url := os.Getenv("INKLOOM_TEST_DATABASE_URL")
	if url == "" {
		t.Skip("requires dedicated test database")
	}
	ctx := context.Background()
	s, err := Open(ctx, url)
	if err != nil {
		t.Fatal(err)
	}
	scope := "chapter-plan-test-" + rand.Text() + "/main"
	var plannedRun app.Run
	defer func() {
		if plannedRun.ID != "" {
			for _, table := range []string{"manuscript_commits", "planning_run_inputs", "run_artifacts", "run_actions", "run_checkpoints", "llm_calls", "reviews", "chapter_versions", "critic_lookups"} {
				if _, e := s.pool.Exec(ctx, "DELETE FROM "+table+" WHERE run_id IN (SELECT id FROM runs WHERE chapter_id=$1)", plannedRun.ChapterID); e != nil {
					t.Error(e)
				}
			}
			for _, q := range []string{"DELETE FROM segment_versions WHERE chapter_id=$1", "DELETE FROM runs WHERE chapter_id=$1", "DELETE FROM chapters WHERE id=$1"} {
				if _, e := s.pool.Exec(ctx, q, plannedRun.ChapterID); e != nil {
					t.Error(e)
				}
			}
		}

		project, _, _ := strings.Cut(scope, "/")
		for _, q := range []string{"DELETE FROM memory_heads WHERE project_id=$1", "DELETE FROM memory_records WHERE project_id=$1", "DELETE FROM knowledge_heads WHERE project_id=$1", "DELETE FROM knowledge_snapshots WHERE project_id=$1"} {
			if _, e := s.pool.Exec(ctx, q, project); e != nil {
				t.Error(e)
			}
		}
		for _, q := range []string{
			"DELETE FROM planning_chapter_plan_calls WHERE job_id IN(SELECT id FROM planning_chapter_plan_jobs WHERE scope=$1)", "DELETE FROM planning_chapter_plan_selections WHERE scope=$1", "DELETE FROM planning_chapter_plan_jobs WHERE scope=$1",
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
	zero := int64(0)
	report.Output.WorldFacts[0].StoryTime = &zero
	report.Output.WorldFacts[0].KnownBy = []planning.ProposedKnowledge{{CharacterID: report.Output.Characters[0].ID, LearnedAt: &zero}}
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

	outlineSave := planning.OutlineSaveRequest{Expected: req.Expected, JobID: job.ID, CandidateVersion: 1, Content: content}
	ol, err := s.SaveOutline(ctx, scope, outlineSave)
	if err != nil {
		t.Fatal(err)
	}
	cpReq := planning.ChapterPlanStartRequest{RequestID: rand.Text(), Expected: planning.ChapterPlanVersions{Planning: req.Expected, Outline: 1, Bindings: 1}, ChapterID: content.Chapters[0].ID, Request: "当前章分两次试探"}
	if _, _, err = s.StartChapterPlan(ctx, scope, cpReq, cfg.ModelName); !errors.Is(err, app.ErrVersionMismatch) {
		t.Fatal("unconfirmed outline started", err)
	}
	outlineSave.ExpectedOutlineVersion = ol.Version
	outlineSave.SourceOutlineVersion = ol.Version
	outlineSave.Confirmed = true
	ol, err = s.SaveOutline(ctx, scope, outlineSave)
	if err != nil {
		t.Fatal(err)
	}
	cpReq.Expected.Outline = ol.Version
	cpReq.Expected.Bindings = ol.BindingsVersion
	cp, created, err := s.StartChapterPlan(ctx, scope, cpReq, cfg.ModelName)
	if err != nil || !created {
		t.Fatal(err)
	}
	if _, created, err = s.StartChapterPlan(ctx, scope, cpReq, cfg.ModelName); err != nil || created {
		t.Fatal("duplicate job", err)
	}
	changedCP := cpReq
	changedCP.ChapterID = content.Chapters[1].ID
	if _, _, err = s.StartChapterPlan(ctx, scope, changedCP, cfg.ModelName); !errors.Is(err, app.ErrVersionMismatch) {
		t.Fatal("changed idempotent request accepted", err)
	}
	cpOut, err := app.GenerateChapterPlan(ctx, cfg, cp.Input, func(ctx context.Context, c model.CallRecord) error { return s.RecordChapterPlanCall(ctx, cp.ID, c) })
	if err != nil {
		t.Fatal(err)
	}
	if err = s.FinishChapterPlan(ctx, cp.ID, cpOut, nil); err != nil {
		t.Fatal(err)
	}
	state, err = s.GetPlanning(ctx, scope)
	if err != nil {
		t.Fatal(err)
	}
	if len(state.ChapterPlans) != 0 || len(state.ChapterPlanJobs) != 1 || len(state.ChapterPlanJobs[0].Calls) != 1 {
		t.Fatal("candidate auto adopted or missing audit")
	}
	candidate := state.ChapterPlanJobs[0].Output
	candidate.Scenes[0].StoryTime = &zero
	if candidate.Scenes[0].ID == cpOut.Scenes[0].ID || candidate.Brief.SelectedBeatID != candidate.Scenes[0].Beats[0].ID {
		t.Fatal("stable IDs not remapped")
	}
	save := planning.ChapterPlanSaveRequest{Expected: cpReq.Expected, ChapterID: cpReq.ChapterID, JobID: cp.ID, CandidateVersion: 1, Content: *candidate}
	selected, err := s.SaveChapterPlan(ctx, scope, save)
	if err != nil || selected.Confirmed || selected.Version != 1 {
		t.Fatal(err)
	}
	save.ExpectedVersion = 1
	save.SourceVersion = 1
	save.Confirmed = true
	selected, err = s.SaveChapterPlan(ctx, scope, save)
	if err != nil || !selected.Confirmed || selected.Version != 2 {
		t.Fatal(err)
	}
	if _, err = s.SaveChapterPlan(ctx, scope, save); !errors.Is(err, app.ErrVersionMismatch) {
		t.Fatal("old save overwrote author version", err)
	}
	forged := save
	forged.ExpectedVersion = 0
	forged.SourceVersion = 0
	forged.ChapterID = content.Chapters[1].ID
	if _, err = s.SaveChapterPlan(ctx, scope, forged); !errors.Is(err, app.ErrVersionMismatch) {
		t.Fatal("cross chapter candidate accepted", err)
	}

	plannedRun = exercisePlannedRun(t, s, scope, selected, cfg, &plannedRun)
	save.ExpectedVersion = 2
	save.SourceVersion = 2
	// Restart interrupts the worker, preserving the saved plan and its frozen input.
	cpReq.RequestID = rand.Text()
	pending, _, err := s.StartChapterPlan(ctx, scope, cpReq, cfg.ModelName)
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
	if len(state.ChapterPlans) != 1 || !state.ChapterPlans[0].Confirmed || state.ChapterPlans[0].Input.Outline.Version != 2 {
		t.Fatal("saved snapshot lost")
	}
	for _, j := range state.ChapterPlanJobs {
		if j.ID == pending.ID && j.Status != "interrupted" {
			t.Fatal("pending task not interrupted")
		}
	}
	outlineSave.ExpectedOutlineVersion = ol.Version
	outlineSave.SourceOutlineVersion = ol.Version
	outlineSave.Content.Chapters[0].Purpose = "作者重新调整本章目标"
	if _, err = s.SaveOutline(ctx, scope, outlineSave); err != nil {
		t.Fatal(err)
	}
	if _, err = s.SaveChapterPlan(ctx, scope, save); !errors.Is(err, app.ErrVersionMismatch) {
		t.Fatal("outdated outline accepted", err)
	}
	stale, e := s.GetRun(ctx, plannedRun.ID)
	if e != nil || stale.Status != "stale" || stale.ApprovalBlock == "" {
		t.Fatal("planning change did not invalidate approval", e, stale.Status)
	}
	if _, _, e = s.ClaimAction(ctx, plannedRun.ID, orchestration.HumanAction{ID: rand.Text(), Type: "approve", DraftVersion: plannedRun.DraftVersion}); !errors.Is(e, app.ErrVersionMismatch) {
		t.Fatal("stale approval accepted", e)
	}
	if _, e = s.Finalize(ctx, plannedRun.ID, app.FinalizeInput{ID: rand.Text(), DraftVersion: plannedRun.DraftVersion, InputDigest: plannedRun.InputDigest, FactsConfirmed: true}); !errors.Is(e, app.ErrVersionMismatch) {
		t.Fatal("stale finalization accepted", e)
	}
	frozen, e := s.FrozenContext(ctx, plannedRun.ID)
	if e != nil || frozen.Bundle.WritingTask.PlanVersion != 2 {
		t.Fatal("old frozen input was replaced", e)
	}

	// Explicit author review can reuse old content against current input; it makes a new snapshot.
	save.Expected.Outline = 3
	save.Expected.Bindings = 3
	selected, err = s.SaveChapterPlan(ctx, scope, save)
	if err != nil || selected.Input.Outline.Version != 3 {
		t.Fatal("explicit review failed", err)
	}
	if selected.Version != 3 {
		t.Fatal("review replaced old record")
	}
	// A fresh reviewed plan can be written, approved, and committed with its exact planning source.
	plannedRun = exercisePlannedRun(t, s, scope, selected, cfg, &plannedRun)
	commit, e := s.Finalize(ctx, plannedRun.ID, app.FinalizeInput{ID: rand.Text(), DraftVersion: plannedRun.DraftVersion, InputDigest: plannedRun.InputDigest, FactsConfirmed: true})
	if e != nil {
		t.Fatal("planned commit", e)
	}
	found := false
	for _, ref := range commit.Refs {
		if ref.Kind == "planning_inputs" && ref.Version == selected.Version {
			found = true
		}
	}
	if !found {
		t.Fatal("commit omitted planning provenance")
	}
	knowledgeRef := false
	for _, ref := range commit.Refs {
		if ref.Kind == "knowledge_snapshot" {
			knowledgeRef = true
		}
	}
	if !knowledgeRef {
		t.Fatal("commit omitted published knowledge")
	}
	reason, e := func() (string, error) {
		tx, e := s.pool.Begin(ctx)
		if e != nil {
			return "", e
		}
		defer tx.Rollback(ctx)
		// Simulate a legacy commit without planning association; initialization must still protect it.
		if _, e = tx.Exec(ctx, "DELETE FROM planning_run_inputs WHERE run_id=$1", plannedRun.ID); e != nil {
			return "", e
		}
		current, e := planningKnowledgeHead(ctx, tx, scope)
		if e != nil {
			return "", e
		}
		return knowledgePublishBlock(ctx, tx, scope, current)
	}()
	if e != nil || reason == "" {
		t.Fatal("committed manuscript did not block initialization replacement", e)
	}

}
