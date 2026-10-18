package postgres

import (
	"context"
	"crypto/rand"
	"reflect"
	"strings"
	"testing"
	"time"

	"errors"
	"inkloom/internal/app"
	"inkloom/internal/config"
	"inkloom/internal/domain/planning"
	"inkloom/internal/domain/review"
	"inkloom/internal/orchestration"
)

// Runs inside the persisted planning/author/publication fixture, on its dedicated test DB.
func exerciseNextChapter(t *testing.T, s *Store, scope string, pub app.ChapterPublication) {
	t.Helper()
	ctx := context.Background()
	state, err := s.GetPlanning(ctx, scope)
	if err != nil {
		t.Fatal(err)
	}
	first := state.ChapterPlans[0]
	nextID := state.OutlineSelection.Content.Chapters[1].ID
	cfg := config.Config{Model: "fake", ModelName: "scripted-fake", MaxCalls: 6, MaxTokens: 120000, MaxOutputTokens: 4096, CallTimeout: time.Second}
	job, _, err := s.StartChapterPlan(ctx, scope, planning.ChapterPlanStartRequest{RequestID: rand.Text(), Expected: first.Versions, ChapterID: nextID, Request: "承接前章定稿"}, cfg.ModelName)
	if err != nil {
		t.Fatal(err)
	}
	if job.Input.PreviousChapter == nil || job.Input.PreviousChapter.PublicationID != pub.ID || len(job.Input.PreviousChapter.Facts) != 1 {
		t.Fatal("planner lost finalized chapter", job.Input.PreviousChapter)
	}
	content, err := app.GenerateChapterPlan(ctx, cfg, job.Input, nil)
	if err != nil {
		t.Fatal(err)
	}
	zero := int64(0)
	content.Scenes[0].StoryTime = &zero
	if err = s.FinishChapterPlan(ctx, job.ID, content, nil); err != nil {
		t.Fatal(err)
	}
	state, err = s.GetPlanning(ctx, scope)
	if err != nil {
		t.Fatal(err)
	}
	for _, j := range state.ChapterPlanJobs {
		if j.ID == job.ID {
			content = *j.Output
		}
	}
	plan, err := s.SaveChapterPlan(ctx, scope, planning.ChapterPlanSaveRequest{Expected: first.Versions, ChapterID: nextID, JobID: job.ID, CandidateVersion: 1, Content: content, Confirmed: true})
	if err != nil {
		t.Fatal(err)
	}
	ready, err := s.PlannedRunReadiness(ctx, scope, nextID, cfg, "", "chapter")
	if err != nil || !ready.Ready {
		t.Fatal("next chapter readiness", err, ready.Reason)
	}
	req := app.PlannedRunRequest{RequestID: rand.Text(), ChapterID: nextID, Expected: plan.Versions, PlanVersion: plan.Version, DraftVersion: ready.DraftVersion, Mode: "chapter"}
	run, fresh, err := s.StartPlannedRun(ctx, scope, req, cfg)
	if err != nil || !fresh {
		t.Fatal("next chapter start", err)
	}
	frozen, err := s.FrozenContext(ctx, run.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(run.Planning.Publications) != 1 || run.Planning.Publications[0].ID != pub.ID || frozen.Bundle.PreviousEnding == nil || frozen.Bundle.WritingTask.ChapterNumber != 2 {
		t.Fatal("writer lost publication provenance")
	}
	carried := false
	for _, f := range frozen.Bundle.Facts {
		carried = carried || strings.HasPrefix(f.ID, "publication/"+pub.ID+"/fact/")
	}
	if !carried {
		t.Fatal("confirmed prior facts lost")
	}
	result, err := app.ExecuteChapter(ctx, cfg, "normal", orchestration.Options{FrozenInput: &frozen, BaseDraftVersion: req.DraftVersion, MaxRounds: 2})
	if err != nil {
		t.Fatal(err)
	}
	run.Result = &result
	run.DraftVersion = result.DraftVersion
	if err = s.SaveProgress(ctx, run, req.DraftVersion); err != nil {
		t.Fatal(err)
	}
	if err = app.ExecuteHuman(ctx, cfg, run, s); err != nil {
		t.Fatal(err)
	}
	run, _, err = s.ClaimAction(ctx, run.ID, orchestration.HumanAction{ID: rand.Text(), Type: "approve", DraftVersion: run.DraftVersion})
	if err != nil {
		t.Fatal(err)
	}
	if err = app.ExecuteHuman(ctx, cfg, run, s); err != nil {
		t.Fatal(err)
	}
	run, err = s.GetRun(ctx, run.ID)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = s.Finalize(ctx, run.ID, app.FinalizeInput{ID: rand.Text(), DraftVersion: run.DraftVersion, InputDigest: run.InputDigest, FactsConfirmed: true}); err != nil {
		t.Fatal("adopt next chapter", err)
	}
	preview, err := s.PreviewChapterAssembly(ctx, scope, app.AssemblyPreviewRequest{ChapterID: nextID})
	if err != nil || !preview.Ready || len(preview.Draft.Parts) != 2 {
		t.Fatal("next chapter cannot assemble", err, preview.Reason)
	}
	choices := map[string]string{}
	for _, part := range preview.Draft.Parts {
		choices[part.BeatID] = part.CommitID
	}
	assembly, err := s.SaveChapterAssembly(ctx, scope, app.AssemblySaveRequest{RequestID: rand.Text(), ChapterID: nextID, Choices: choices, ExpectedVersion: preview.ExpectedVersion, PreviewDigest: preview.PreviewDigest, Confirm: true})
	if err != nil {
		t.Fatal(err)
	}
	reviewJob, fresh, err := s.StartChapterReview(ctx, scope, app.ChapterReviewRequest{RequestID: rand.Text(), AssemblyID: assembly.ID, AssemblyVersion: assembly.Version, AssemblyDigest: assembly.Digest}, cfg)
	if err != nil || !fresh || len(reviewJob.Input.Parts) != 2 {
		t.Fatal("whole-chapter adoption cannot enter review", err)
	}
	for i, part := range reviewJob.Input.Parts {
		if len(part.Segments) != len(assembly.Parts[i].Segments) || part.CommitID != assembly.Parts[i].CommitID {
			t.Fatal("wrong beat provenance", part)
		}
	}
	out, err := app.ReviewChapter(ctx, cfg, reviewJob.Input, nil)
	if err != nil {
		t.Fatal(err)
	}
	source := reviewJob.Input.Parts[0].Segments[0]
	out.Critics[1].Findings = []app.ChapterFinding{{Finding: review.Finding{ID: "style-judgement", Critic: "ai_taste", Severity: review.P3, RequiresHuman: true, SegmentID: source.ID, Quote: source.Text, Reason: "记录动作可由作者决定保留", Suggestion: "核对叙述节奏", RepairScope: "phrase", DraftVersion: assembly.Version, EvidenceStatus: "uncertain", EvidenceRefs: []string{source.ID}}, Evidence: []app.ChapterEvidence{{Ref: source.ID, Quote: source.Text}}}}
	if err = s.FinishChapterReview(ctx, reviewJob.ID, out, nil); err != nil {
		t.Fatal(err)
	}
	decision := app.ChapterReviewDecision{RequestID: rand.Text(), AssemblyVersion: assembly.Version, InputDigest: reviewJob.InputDigest, Action: "approve", Reason: "核对并保留记录动作"}
	if _, err = s.DecideChapterReview(ctx, scope, reviewJob.ID, decision); !errors.Is(err, app.ErrGateBlocked) {
		t.Fatal("unjudged P3 passed", err)
	}
	decision.KeptFindings = []string{"ai_taste/style-judgement"}
	approved, err := s.DecideChapterReview(ctx, scope, reviewJob.ID, decision)
	if err != nil || approved.ApprovalBlock != "" {
		t.Fatal("explicit judgement blocked", err, approved.ApprovalBlock)
	}
	listing, err := s.ChapterReviews(ctx, scope, assembly.ID)
	if err != nil || listing.Jobs[0].ApprovalBlock != "" || len(listing.Jobs[0].Decision.KeptFindings) != 1 {
		t.Fatal("judgement lost after reload", err)
	}
	// A rejected newer candidate must not force the author to redo an approved
	// assembly. It remains auditable, but is removed from working prose.
	beat := assembly.Parts[0].BeatID
	beatReady, err := s.PlannedRunReadiness(ctx, scope, nextID, cfg, beat)
	if err != nil {
		t.Fatal(err)
	}
	candidate, _, err := s.StartPlannedRun(ctx, scope, app.PlannedRunRequest{RequestID: rand.Text(), ChapterID: nextID, Expected: plan.Versions, PlanVersion: plan.Version, DraftVersion: beatReady.DraftVersion, BeatID: beat}, cfg)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = s.DismissPlannedCandidate(ctx, scope, candidate.ID, candidate.DraftVersion); !errors.Is(err, app.ErrGateBlocked) {
		t.Fatal("running candidate dismissed", err)
	}
	input, err := s.FrozenContext(ctx, candidate.ID)
	if err != nil {
		t.Fatal(err)
	}
	output, err := app.ExecuteChapter(ctx, cfg, "normal", orchestration.Options{FrozenInput: &input, BaseDraftVersion: candidate.DraftVersion, MaxRounds: 2})
	if err != nil {
		t.Fatal(err)
	}
	output.Segments[0].Text += "这是作者决定放弃的新候选。"
	candidate.Result, candidate.DraftVersion = &output, output.DraftVersion
	candidate.Status = "waiting_human"
	if err = s.SaveProgress(ctx, candidate, beatReady.DraftVersion); err != nil {
		t.Fatal(err)
	}
	before, err := s.PreviewChapterAssembly(ctx, scope, app.AssemblyPreviewRequest{ChapterID: nextID})
	if err != nil || before.Ready {
		t.Fatal("new candidate was ignored before author choice", err)
	}
	if _, err = s.DismissPlannedCandidate(ctx, scope, candidate.ID, candidate.DraftVersion+1); !errors.Is(err, app.ErrVersionMismatch) {
		t.Fatal("wrong version dismissed", err)
	}
	dismissed, err := s.DismissPlannedCandidate(ctx, scope, candidate.ID, candidate.DraftVersion)
	if err != nil || !dismissed.Dismissed || dismissed.CanResume || dismissed.CanDismiss {
		t.Fatal("dismiss candidate", err, dismissed.Status)
	}
	if _, err = s.DismissPlannedCandidate(ctx, scope, candidate.ID, candidate.DraftVersion); err != nil {
		t.Fatal("dismiss retry", err)
	}
	if _, err = s.DismissPlannedCandidate(ctx, scope, run.ID, run.DraftVersion); !errors.Is(err, app.ErrGateBlocked) {
		t.Fatal("adopted run dismissed", err)
	}
	after, err := s.PreviewChapterAssembly(ctx, scope, app.AssemblyPreviewRequest{ChapterID: nextID})
	if err != nil || !after.Ready || !reflect.DeepEqual(after.Draft.Parts, preview.Draft.Parts) {
		t.Fatal("adopted source not restored", err, after.Reason)
	}
	listing, err = s.ChapterReviews(ctx, scope, assembly.ID)
	if err != nil || !listing.Jobs[0].Current || listing.Jobs[0].ApprovalBlock != "" || listing.Jobs[0].Decision == nil {
		t.Fatal("original review not restored", err)
	}
	working, err := workingPassage(ctx, s.pool, scope, nextID, beat)
	if err != nil || working.RunID != run.ID {
		t.Fatal("dismissed candidate remains working", err, working.RunID)
	}

}
