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
func exercisePlannedRun(t *testing.T, s *Store, scope string, p planning.ChapterPlanSelection, cfg config.Config, started *app.Run, target ...string) app.Run {
	t.Helper()
	ctx := context.Background()
	preview, err := s.PlanningKnowledgePreview(ctx, scope)
	if err != nil {
		t.Fatal(err)
	}
	if !preview.Current {
		req := app.KnowledgePublishRequest{Expected: preview.Expected, ExpectedVersion: preview.ExpectedVersion, PreviewDigest: preview.PreviewDigest, Reason: "确认当前初始设定"}
		if _, err = s.PublishPlanningKnowledge(ctx, scope, req); !errors.Is(err, app.ErrInvalidWrite) {
			t.Fatal("published without author confirmation", err)
		}
		req.Confirm = true
		saved, e := s.PublishPlanningKnowledge(ctx, scope, req)
		if e != nil {
			t.Fatal("publish", e)
		}
		again, e := s.PublishPlanningKnowledge(ctx, scope, req)
		if e != nil || again.Digest != saved.Digest {
			t.Fatal("publication retry not idempotent", e)
		}
		req.PreviewDigest = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
		if _, e = s.PublishPlanningKnowledge(ctx, scope, req); !errors.Is(e, app.ErrVersionMismatch) {
			t.Fatal("forged preview accepted", e)
		}
	}
	ready, err := s.PlannedRunReadiness(ctx, scope, p.ChapterID, cfg, target...)
	if err != nil || !ready.Ready {
		t.Fatal("readiness", err, ready.Reason)
	}
	if len(target) > 0 {
		cfg.MaxCalls = 4
	} // Writer, two base critics, and the opted-in review
	cfg.ExperimentalContinuity = len(target) == 0 // opposite of the explicit request
	req := app.PlannedRunRequest{EnhancedContinuity: len(target) > 0, BeatID: ready.BeatID, RequestID: rand.Text(), ChapterID: p.ChapterID, Expected: p.Versions, PlanVersion: p.Version, DraftVersion: ready.DraftVersion}
	r, created, err := s.StartPlannedRun(ctx, scope, req, cfg)
	if err != nil || !created {
		t.Fatal("start", err)
	}
	*started = r
	if _, created, err = s.StartPlannedRun(ctx, scope, req, cfg); err != nil || created {
		t.Fatal("duplicate execution", err)
	}
	bad := req
	bad.EnhancedContinuity = !req.EnhancedContinuity
	if _, _, e := s.StartPlannedRun(ctx, scope, bad, cfg); !errors.Is(e, app.ErrActionMismatch) {
		t.Fatal("changed review option reused request ID", e)
	}
	bad = req
	bad.AutoRevise = true
	if _, _, err = s.StartPlannedRun(ctx, scope, bad, cfg); !errors.Is(err, app.ErrActionMismatch) {
		t.Fatal("idempotency mismatch accepted", err)
	}
	frozen, err := s.FrozenContext(ctx, r.ID)
	if err != nil || frozen.Bundle.ChapterID == "ch7" || frozen.Bundle.WritingTask == nil || frozen.Bundle.WritingTask.Knowledge == nil {
		t.Fatal("missing isolated input", err)
	}
	if frozen.Bundle.WritingTask.ExperimentalContinuity != req.EnhancedContinuity || r.Planning.EnhancedContinuity != req.EnhancedContinuity {
		t.Fatal("request option not frozen", r.Planning)
	}
	state, err := app.ExecuteChapter(ctx, cfg, "normal", orchestration.Options{FrozenInput: &frozen, BaseDraftVersion: req.DraftVersion, MaxRounds: 2})
	if err != nil {
		t.Fatal(err)
	}
	if req.EnhancedContinuity {
		found := false
		for _, c := range state.CriticReviews {
			found = found || len(c.Continuity) > 0
		}
		if !found {
			t.Fatal("enabled check not executed")
		}
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
		saved, _ := s.GetRun(ctx, req.RequestID)
		t.Fatalf("approve: %v; status=%s block=%s result=%s route=%+v", err, saved.Status, saved.ApprovalBlock, saved.Result.Status, saved.Result.Route)
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
