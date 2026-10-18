package postgres

import (
	"context"
	"crypto/rand"
	"reflect"
	"strings"
	"testing"
	"time"

	"errors"
	"inkloom/internal/agents/model"
	"inkloom/internal/app"
	"inkloom/internal/config"
	"inkloom/internal/domain/manuscript"
	"inkloom/internal/domain/memory"
	"inkloom/internal/domain/planning"
	"inkloom/internal/domain/review"
	"inkloom/internal/embedding"
	"inkloom/internal/orchestration"
	"inkloom/internal/retrieval"
)

// Runs inside the persisted planning/author/publication fixture, on its dedicated test DB.
func exerciseNextChapter(t *testing.T, s *Store, scope string, pub app.ChapterPublication) {
	t.Helper()
	ctx := context.Background()
	archive, err := s.BookArchive(ctx, scope)
	if err != nil || len(archive.Chapters) != 1 || archive.Chapters[0].PublicationID != pub.ID || len(archive.Chapters[0].Facts) != 1 {
		t.Fatal("published fact ledger lost provenance", archive, err)
	}
	if !strings.Contains(archive.ExportText(), pub.Assembly.Parts[0].Segments[0].Text) {
		t.Fatal("export dropped published text")
	}
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
	// A chapter continuation must preserve a separately adopted opening.
	var firstRun app.Run
	approvedOpening := exercisePlannedRun(t, s, scope, plan, cfg, &firstRun, plan.Content.Scenes[0].Beats[0].ID)
	openingCommit, e := s.Finalize(ctx, approvedOpening.ID, app.FinalizeInput{ID: rand.Text(), DraftVersion: approvedOpening.DraftVersion, InputDigest: approvedOpening.InputDigest, FactsConfirmed: true})
	if e != nil {
		t.Fatal(e)
	}
	ready, err = s.PlannedRunReadiness(ctx, scope, nextID, cfg, "", "chapter")
	if err != nil || len(ready.MissingBeatIDs) != 1 || len(ready.UnadoptedBeatIDs) != 1 {
		t.Fatal("wrong continuation scope", ready, err)
	}
	req := app.PlannedRunRequest{RequestID: rand.Text(), ChapterID: nextID, Expected: plan.Versions, PlanVersion: plan.Version, DraftVersion: ready.DraftVersion, Mode: "chapter", Remaining: true}
	run, fresh, err := s.StartPlannedRun(ctx, scope, req, cfg)
	if err != nil || !fresh {
		t.Fatal("next chapter start", err)
	}
	frozen, err := s.FrozenContext(ctx, run.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(frozen.Bundle.Targets) != 1 || frozen.Bundle.Targets[0].Beat.ID == plan.Content.Scenes[0].Beats[0].ID || len(frozen.Bundle.Neighbors) != 1 {
		t.Fatal("continuation rewrites protected text", frozen.Bundle.Targets)
	}
	again, created, e := s.StartPlannedRun(ctx, scope, req, cfg)
	if e != nil || created || again.ID != run.ID {
		t.Fatal("continuation retry duplicated", e)
	}
	protectedReady, e := s.PlannedRunReadiness(ctx, scope, nextID, cfg, plan.Content.Scenes[0].Beats[0].ID)
	if e != nil {
		t.Fatal(e)
	}
	for _, candidate := range protectedReady.Runs {
		if candidate.ID == run.ID {
			t.Fatal("partial batch leaked into adopted beat")
		}
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
	view, e := app.MemoryView(frozen.Bundle)
	if e != nil || !view.CatalogBound || view.At.Chapter != 2 {
		t.Fatal("real retrieval scope", e, view)
	}
	catalog, e := s.MemorySnapshot(ctx, view)
	if e != nil {
		t.Fatal(e)
	}
	foundPublication := false
	for _, record := range catalog.Records {
		if strings.HasPrefix(record.ID, "publication/"+pub.ID+"/") {
			foundPublication = true
		}
	}
	if !foundPublication {
		t.Fatal("published chapter missing from retrieval catalog")
	}
	// Hybrid search must cache projection vectors without requiring memory_heads.
	if _, e = (&retrieval.Service{Repo: s, Embedder: embedding.Fake{}}).SearchForAuthor(ctx, view, "钥匙", 3); e != nil {
		t.Fatal("published hybrid retrieval", e)
	}
	wrong := view
	wrong.ProjectID = "unrelated"
	if _, e = s.MemorySnapshot(ctx, wrong); e == nil {
		t.Fatal("cross-project pinned input accepted")
	}
	frozen, e = app.LookupContext(ctx, cfg, frozen, &retrieval.Service{Repo: s}, nil, func(trace memory.LookupTrace) error { return s.SaveLookup(ctx, run.ID, trace) })
	if e != nil {
		t.Fatal("planned lookup", e)
	}
	if e = s.SealPreparedContext(ctx, run.ID, frozen); e != nil {
		t.Fatal("seal real retrieval", e)
	}
	run, e = s.GetRun(ctx, run.ID)
	if e != nil || run.Lookup == nil || run.Lookup.Stop != "ready" || run.CurrentNode != "draft" {
		t.Fatal("lookup state", e, run)
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
	// Real DB/session/persistence path, deterministic model responses only.
	steps := []model.Step{}
	for range frozen.Bundle.Targets {
		for _, q := range []string{"钥匙"} {
			steps = append(steps, model.Step{Role: "hard_consistency", FinishReason: model.ToolRequested, ToolCalls: []model.ToolCall{{ID: q, Name: "search_memory", Arguments: `{"query":"` + q + `"}`}}})
		}
		steps = append(steps, model.Step{Role: "hard_consistency", Content: `{"findings":[]}`})
	}
	check := app.NewConsistencyCheck(&retrieval.Service{Repo: s}, s, run.ID)
	checked, _, e := check(ctx, model.NewFake(steps), result)
	if e != nil || checked.Status != "completed" || len(checked.ScopedEvidence) != len(frozen.Bundle.Targets) || len(checked.Lookup.Steps) != len(frozen.Bundle.Targets) {
		t.Fatal("multi-view consistency lookup failed", e, checked)
	}
	if _, e = checked.WithEvidence(result.Context); e != nil {
		t.Fatal("scoped evidence cannot be restored", e)
	}
	for i := range result.CriticReviews {
		if result.CriticReviews[i].Critic == "hard_consistency" {
			result.CriticReviews[i] = checked
		}
	}
	run.Result = &result
	if err = s.SaveProgress(ctx, run, run.DraftVersion); err != nil {
		t.Fatal(err)
	}
	if err = app.ExecuteHuman(ctx, cfg, run, s); err != nil {
		t.Fatal(err)
	}
	// Even an unapproved saved batch counts as existing prose for continuation.
	skipSaved := req
	skipSaved.RequestID = rand.Text()
	if _, _, e = s.StartPlannedRun(ctx, scope, skipSaved, cfg); !errors.Is(e, app.ErrPlanningNotReady) {
		t.Fatal("continuation regenerated saved candidate", e)
	}
	beforeRecheck := append([]manuscript.Segment{}, run.Result.Segments...)
	recheck, _, e := s.StartPlannedRun(ctx, scope, app.PlannedRunRequest{RequestID: rand.Text(), ChapterID: nextID, Expected: plan.Versions, PlanVersion: plan.Version, DraftVersion: run.DraftVersion, Mode: "chapter", Recheck: true, FromRunID: run.ID, SourceVersion: run.DraftVersion}, cfg)
	if e != nil {
		t.Fatal("partial chapter recheck", e)
	}
	inputRecheck, e := s.FrozenContext(ctx, recheck.ID)
	if e != nil {
		t.Fatal(e)
	}
	outputRecheck, e := app.ExecuteChapter(ctx, cfg, "normal", orchestration.Options{FrozenInput: &inputRecheck, BaseDraftVersion: recheck.DraftVersion, MaxRounds: 2})
	if e != nil || !reflect.DeepEqual(texts(beforeRecheck), texts(outputRecheck.Segments)) {
		t.Fatal("partial review expanded scope or rewrote prose", e)
	}
	baseVersion := recheck.DraftVersion
	recheck.Result, recheck.DraftVersion = &outputRecheck, outputRecheck.DraftVersion
	if e = s.SaveProgress(ctx, recheck, baseVersion); e != nil {
		t.Fatal(e)
	}
	if e = app.ExecuteHuman(ctx, cfg, recheck, s); e != nil {
		t.Fatal(e)
	}
	run = recheck
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
	if preview.Draft.Parts[0].CommitID != openingCommit.ID {
		t.Fatal("adopted opening replaced by continuation")
	}
	noMissing := req
	noMissing.RequestID = rand.Text()
	if _, _, e = s.StartPlannedRun(ctx, scope, noMissing, cfg); !errors.Is(e, app.ErrPlanningNotReady) {
		t.Fatal("empty continuation accepted", e)
	}
	quality, e := s.BookQuality(ctx, scope)
	if e != nil || len(quality.Chapters) != len(state.OutlineSelection.Content.Chapters) || quality.Chapters[1].Words == 0 || len(quality.Runs) == 0 {
		t.Fatal("real report missing saved prose", quality, e)
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
	if err != nil || working.RunID != approvedOpening.ID {
		t.Fatal("dismissed candidate remains working", err, working.RunID)
	}

}
