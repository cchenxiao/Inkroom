package postgres

import (
	"context"
	"crypto/rand"
	"errors"
	"inkloom/internal/agents/model"
	"inkloom/internal/app"
	"inkloom/internal/config"
	"testing"
)

func exerciseChapterReview(t *testing.T, s *Store, scope string, a app.ChapterAssembly, cfg config.Config) (app.ChapterReviewJob, app.ChapterReviewOutput) {
	t.Helper()
	ctx := context.Background()
	cfg.MaxTokens = 120000
	req := app.ChapterReviewRequest{EnhancedContinuity: true, RequestID: rand.Text(), AssemblyID: a.ID, AssemblyVersion: a.Version, AssemblyDigest: a.Digest}
	job, created, err := s.StartChapterReview(ctx, scope, req, cfg)
	if err != nil || !created {
		t.Fatal("start chapter review", err)
	}
	if again, fresh, e := s.StartChapterReview(ctx, scope, req, cfg); e != nil || fresh || again.ID != job.ID {
		t.Fatal("review retry started twice", e)
	}
	if !job.Input.EnhancedContinuity {
		t.Fatal("chapter option was not frozen")
	}
	changed := req
	changed.EnhancedContinuity = false
	if _, _, e := s.StartChapterReview(ctx, scope, changed, cfg); !errors.Is(e, app.ErrActionMismatch) {
		t.Fatal("chapter option mismatch accepted", e)
	}
	changed = req
	changed.AssemblyVersion++
	if _, _, e := s.StartChapterReview(ctx, scope, changed, cfg); !errors.Is(e, app.ErrActionMismatch) {
		t.Fatal("changed idempotent request accepted", e)
	}
	decision := app.ChapterReviewDecision{RequestID: rand.Text(), AssemblyVersion: a.Version, InputDigest: job.InputDigest, Action: "approve", Reason: "核对了整章动作与衔接"}
	if _, e := s.DecideChapterReview(ctx, scope, job.ID, decision); !errors.Is(e, app.ErrGateBlocked) {
		t.Fatal("running review approved", e)
	}
	out, err := app.ReviewChapter(ctx, cfg, job.Input, func(ctx context.Context, c model.CallRecord) error { return s.RecordChapterReviewCall(ctx, job.ID, c) })
	if err != nil {
		t.Fatal("fake review", err)
	}
	if err = s.FinishChapterReview(ctx, job.ID, out, nil); err != nil {
		t.Fatal(err)
	}
	if _, e := s.PublishChapter(ctx, scope, app.ChapterPublicationRequest{RequestID: rand.Text(), ReviewID: job.ID, AssemblyVersion: a.Version, InputDigest: job.InputDigest, ApprovalID: decision.RequestID, NoPendingFacts: true}); !errors.Is(e, app.ErrGateBlocked) {
		t.Fatal("review published without author approval", e)
	}
	approved, err := s.DecideChapterReview(ctx, scope, job.ID, decision)
	if err != nil || approved.Decision == nil || approved.Decision.Action != "approve" {
		t.Fatal("author review", err)
	}
	if _, e := s.DecideChapterReview(ctx, scope, job.ID, decision); e != nil {
		t.Fatal("decision retry", e)
	}
	listing, err := s.ChapterReviews(ctx, scope, a.ID)
	if err != nil || len(listing.Jobs) != 1 || len(listing.Jobs[0].Calls) != 3 || !listing.Current {
		t.Fatal("trace listing", err, listing)
	}
	publication := exerciseChapterPublication(t, s, scope, approved)
	req.RequestID = rand.Text()
	newJob, _, err := s.StartChapterReview(ctx, scope, req, cfg)
	if err != nil {
		t.Fatal(err)
	}
	listing, err = s.ChapterReviews(ctx, scope, a.ID)
	if err != nil || listing.Jobs[1].Current || listing.Jobs[1].ApprovalBlock == "" {
		t.Fatal("new review did not supersede old approval", err)
	}
	assertHistoricalPublication(t, s, scope, publication)
	failed := app.ChapterReviewOutput{Critics: []app.ChapterCriticResult{{Critic: "hard_consistency", Status: "completed", Findings: []app.ChapterFinding{}}, {Critic: "ai_taste", Status: "failed", Findings: []app.ChapterFinding{}, Error: "provider timeout"}}}
	if err = s.FinishChapterReview(ctx, newJob.ID, failed, errors.New("provider timeout")); err != nil {
		t.Fatal(err)
	}
	decision.RequestID = rand.Text()
	decision.InputDigest = newJob.InputDigest
	if _, e := s.DecideChapterReview(ctx, scope, newJob.ID, decision); !errors.Is(e, app.ErrGateBlocked) {
		t.Fatal("failed critic approved", e)
	}
	decision.Action = "request_changes"
	decision.Reason = "需要补足两段之间的动作过渡"
	if _, e := s.DecideChapterReview(ctx, scope, newJob.ID, decision); e != nil {
		t.Fatal("request changes", e)
	}
	req.RequestID = rand.Text()
	interrupted, _, err := s.StartChapterReview(ctx, scope, req, cfg)
	if err != nil {
		t.Fatal(err)
	}
	if err = s.recoverInterrupted(ctx); err != nil {
		t.Fatal(err)
	}
	listing, err = s.ChapterReviews(ctx, scope, a.ID)
	if err != nil || listing.Jobs[0].ID != interrupted.ID || listing.Jobs[0].Status != "interrupted" {
		t.Fatal("recovery", err)
	}
	req.RequestID = rand.Text()
	late, _, err := s.StartChapterReview(ctx, scope, req, cfg)
	if err != nil {
		t.Fatal(err)
	}
	return late, out
}
