package postgres

import (
	"context"
	"crypto/rand"
	"errors"
	"inkloom/internal/app"
	"inkloom/internal/config"
	"inkloom/internal/domain/planning"
	"inkloom/internal/orchestration"
	"testing"
)

// Reuses the persisted planning chain from the chapter-plan integration test.
func exercisePlannedRun(t *testing.T, s *Store, scope string, p planning.ChapterPlanSelection, cfg config.Config, started *app.Run) app.Run {
	t.Helper()
	ctx := context.Background()
	ready, err := s.PlannedRunReadiness(ctx, scope, p.ChapterID, cfg)
	if err != nil || !ready.Ready {
		t.Fatal("readiness", err, ready.Reason)
	}
	req := app.PlannedRunRequest{RequestID: rand.Text(), ChapterID: p.ChapterID, Expected: p.Versions, PlanVersion: p.Version, DraftVersion: ready.DraftVersion}
	r, created, err := s.StartPlannedRun(ctx, scope, req, cfg)
	if err != nil || !created {
		t.Fatal("start", err)
	}
	*started = r
	if _, created, err = s.StartPlannedRun(ctx, scope, req, cfg); err != nil || created {
		t.Fatal("duplicate execution", err)
	}
	bad := req
	bad.AutoRevise = true
	if _, _, err = s.StartPlannedRun(ctx, scope, bad, cfg); !errors.Is(err, app.ErrActionMismatch) {
		t.Fatal("idempotency mismatch accepted", err)
	}
	frozen, err := s.FrozenContext(ctx, r.ID)
	if err != nil || frozen.Bundle.ChapterID == "ch7" || frozen.Bundle.WritingTask == nil {
		t.Fatal("missing isolated input", err)
	}
	state, err := app.ExecuteChapter(ctx, cfg, "normal", orchestration.Options{FrozenInput: &frozen, BaseDraftVersion: req.DraftVersion, MaxRounds: 2})
	if err != nil {
		t.Fatal(err)
	}
	r.Result = &state
	r.DraftVersion = state.DraftVersion
	if err = s.SaveProgress(ctx, r, req.DraftVersion); err != nil {
		t.Fatal("save", err)
	}
	if err = app.ExecuteHuman(ctx, cfg, r, s); err != nil {
		t.Fatal("human gate", err)
	}
	r, _, err = s.ClaimAction(ctx, r.ID, orchestration.HumanAction{ID: rand.Text(), Type: "approve", DraftVersion: r.DraftVersion})
	if err != nil {
		t.Fatal("approve", err)
	}
	if err = app.ExecuteHuman(ctx, cfg, r, s); err != nil {
		t.Fatal(err)
	}
	r, err = s.GetRun(ctx, r.ID)
	if err != nil || r.Status != "approved" {
		t.Fatal("not approved", err, r.Status)
	}
	bad = req
	bad.RequestID = rand.Text()
	if _, _, err = s.StartPlannedRun(ctx, scope, bad, cfg); !errors.Is(err, app.ErrVersionMismatch) {
		t.Fatal("old draft overwrote author version", err)
	}
	return r
}
