package postgres

import (
	"context"
	"crypto/rand"
	"errors"
	"inkloom/internal/app"
	"inkloom/internal/config"
	"inkloom/internal/domain/planning"
	"inkloom/internal/orchestration"
	"reflect"
	"testing"
)

// Runs against the persisted planning/adoption fixture, using the production
// copy-on-edit, checkpoint, version-lock and dismissal paths.
func exerciseManualCandidate(t *testing.T, s *Store, scope string, p planning.ChapterPlanSelection, cfg config.Config, sourceID string) {
	t.Helper()
	ctx := context.Background()
	source, err := s.GetRun(ctx, sourceID)
	if err != nil || source.CommitID == "" {
		t.Fatal("missing adoption", err)
	}
	gate, err := s.PlannedRunReadiness(ctx, scope, p.ChapterID, cfg, source.Planning.BeatID)
	if err != nil {
		t.Fatal(err)
	}
	seg := source.Result.Segments[0]
	req := app.PlannedRunRequest{RequestID: rand.Text(), ChapterID: p.ChapterID, BeatID: source.Planning.BeatID, Mode: "beat", FromRunID: source.ID, SourceVersion: source.DraftVersion, DraftVersion: gate.DraftVersion, Expected: p.Versions, PlanVersion: p.Version, Edits: map[string]string{seg.ID: seg.Text + "作者补充。"}}
	bad := req
	bad.RequestID = rand.Text()
	bad.Edits = map[string]string{"foreign": "不能跨段覆盖"}
	if _, _, e := s.StartPlannedRun(ctx, scope, bad, cfg); !errors.Is(e, app.ErrGateBlocked) {
		t.Fatal("foreign target accepted", e)
	}
	run, created, err := s.StartPlannedRun(ctx, scope, req, cfg)
	if err != nil || !created {
		t.Fatal("manual fork", err)
	}
	frozen, err := s.FrozenContext(ctx, run.ID)
	if err != nil {
		t.Fatal(err)
	}
	// Save must work even when the previous model configuration is unavailable.
	offline := cfg
	offline.Model = "deepseek"
	offline.ModelName = "offline"
	offline.APIKey = ""
	if _, err := app.LookupContext(ctx, offline, frozen, nil, nil, nil); err != nil {
		t.Fatal("manual save prepared with a model", err)
	}
	if err := s.SealPreparedContext(ctx, run.ID, frozen); err != nil {
		t.Fatal("manual context seal required a model lookup", err)
	}
	state, err := app.ExecuteChapter(ctx, offline, "normal", orchestration.Options{FrozenInput: &frozen, BaseDraftVersion: req.DraftVersion, MaxRounds: 2})
	if err != nil {
		t.Fatal("manual save used model", err)
	}
	if !state.ReviewPending || len(state.CriticReviews) != 0 || state.Segments[0].Text != req.Edits[seg.ID] || len(state.Revisions) != 1 {
		t.Fatal("manual fork lost review/diff", state)
	}
	if state.Revisions[0].FromVersion != req.SourceVersion {
		t.Fatal("manual diff must identify the adopted source version")
	}
	run.Result = &state
	run.DraftVersion = state.DraftVersion
	if err = s.SaveProgress(ctx, run, req.DraftVersion); err != nil {
		t.Fatal(err)
	}
	if err = app.ExecuteHuman(ctx, offline, run, s); err != nil {
		t.Fatal(err)
	}
	run, err = s.GetRun(ctx, run.ID)
	if err != nil {
		t.Fatal(err)
	}
	if run.ActionBlocks["save_edits"] != "" || run.ActionBlocks["review_batch"] != "" || run.ActionBlocks["approve"] == "" {
		t.Fatal("capability disagrees with saved draft", run.ActionBlocks)
	}
	if _, e, err := s.StartPlannedRun(ctx, scope, req, cfg); err != nil || e {
		t.Fatal("retry duplicated fork", err)
	}
	bad = req
	bad.RequestID = rand.Text()
	if _, _, e := s.StartPlannedRun(ctx, scope, bad, cfg); !errors.Is(e, app.ErrVersionMismatch) {
		t.Fatal("old version accepted", e)
	}
	action := orchestration.HumanAction{ID: rand.Text(), Type: "save_edits", DraftVersion: run.DraftVersion, Edits: map[string]string{seg.ID: req.Edits[seg.ID] + "继续修改。"}}
	claimed, execute, err := s.ClaimAction(ctx, run.ID, action)
	if err != nil || !execute {
		t.Fatal(err)
	}
	if err = app.ExecuteHuman(ctx, offline, claimed, failCheckpoint{s}); err == nil {
		t.Fatal("expected checkpoint interruption")
	}
	if err = s.StopRun(ctx, run.ID, "interrupted", "test interruption"); err != nil {
		t.Fatal(err)
	}
	claimed, execute, err = s.ClaimAction(ctx, run.ID, action)
	if err != nil || !execute {
		t.Fatal("resume save", err)
	}
	if err = app.ExecuteHuman(ctx, offline, claimed, s); err != nil {
		t.Fatal("resume", err)
	}
	saved, err := s.GetRun(ctx, run.ID)
	if err != nil {
		t.Fatal(err)
	}
	if saved.DraftVersion != action.DraftVersion+1 || saved.Result.Segments[0].Text != action.Edits[seg.ID] {
		t.Fatal("save replayed or lost text")
	}
	if _, execute, err = s.ClaimAction(ctx, run.ID, action); err != nil || execute {
		t.Fatal("save retry duplicated", err)
	}
	_, _, err = s.ClaimAction(ctx, run.ID, orchestration.HumanAction{ID: rand.Text(), Type: "approve", DraftVersion: saved.DraftVersion})
	var reason app.ActionValidationError
	if !errors.As(err, &reason) || reason.Reason != saved.ActionBlocks["approve"] {
		t.Fatal("approval reason lost", err)
	}
	_, err = s.Finalize(ctx, saved.ID, app.FinalizeInput{ID: rand.Text(), DraftVersion: saved.DraftVersion, InputDigest: saved.InputDigest, FactsConfirmed: true})
	if !errors.As(err, &reason) || reason.Reason != saved.ActionBlocks["commit"] {
		t.Fatal("adoption gate differs from read-side capability", err)
	}
	calls, err := s.Calls(ctx, run.ID)
	if err != nil || len(calls) != 0 {
		t.Fatal("manual save called model", err)
	}
	adopted, err := s.GetRun(ctx, source.ID)
	if err != nil || adopted.CommitID != source.CommitID || !reflect.DeepEqual(texts(adopted.Result.Segments), texts(source.Result.Segments)) {
		t.Fatal("adopted prose changed", err)
	}
	if _, err = s.DismissPlannedCandidate(ctx, scope, run.ID, saved.DraftVersion); err != nil {
		t.Fatal("dismiss", err)
	}
	gate, err = s.PlannedRunReadiness(ctx, scope, p.ChapterID, cfg, source.Planning.BeatID)
	if err != nil || gate.Working == nil || gate.Working.RunID != source.ID {
		t.Fatal("adoption not restored", err)
	}
}
