package postgres

import (
	"context"
	"crypto/rand"
	"reflect"
	"testing"

	"inkloom/internal/app"
	"inkloom/internal/config"
	"inkloom/internal/domain/manuscript"
	"inkloom/internal/domain/planning"
	"inkloom/internal/orchestration"
)

// Runs after the existing planning/assembly/publication tests, using their isolated fixture.
func exerciseWritingScopes(t *testing.T, s *Store, scope string, p planning.ChapterPlanSelection, cfg config.Config) {
	t.Helper()
	ctx := context.Background()
	cfg.MaxCalls, cfg.MaxTokens, cfg.ContextTokens = 20, 128000, 32768
	// Exercise whole-chapter generation on a new plan, not by overwriting adopted beats.
	for i := range p.Content.Scenes[0].Beats {
		p.Content.Scenes[0].Beats[i].ID = "scope-test-" + rand.Text()
	}
	p.Content.Brief.SelectedBeatID = p.Content.Scenes[0].Beats[0].ID
	var planErr error
	p, planErr = s.SaveChapterPlan(ctx, scope, planning.ChapterPlanSaveRequest{Expected: p.Versions, ChapterID: p.ChapterID, ExpectedVersion: p.Version, SourceVersion: p.Version, JobID: p.JobID, CandidateVersion: p.CandidateVersion, Content: p.Content, Confirmed: true})
	if planErr != nil {
		t.Fatal(planErr)
	}
	first, second := p.Content.Scenes[0].Beats[0].ID, p.Content.Scenes[0].Beats[1].ID
	start := func(mode, beat string, from *app.Run, rewrite *manuscript.AuthorRewrite) app.Run {
		t.Helper()
		gate, err := s.PlannedRunReadiness(ctx, scope, p.ChapterID, cfg, beat, mode)
		if err != nil || !gate.Ready {
			t.Fatal("scope readiness", err, gate.Reason)
		}
		req := app.PlannedRunRequest{Mode: mode, BeatID: beat, RequestID: rand.Text(), ChapterID: p.ChapterID, Expected: p.Versions, PlanVersion: p.Version, DraftVersion: gate.DraftVersion}
		if from != nil {
			req.FromRunID = from.ID
			req.SourceVersion = from.DraftVersion
			req.Rewrite = rewrite
			req.Recheck = rewrite == nil
			if req.Recheck && mode == "chapter" {
				req.DraftVersion = from.DraftVersion
			}
		}
		r, created, err := s.StartPlannedRun(ctx, scope, req, cfg)
		if err != nil || !created {
			t.Fatal("scope start", err)
		}
		if _, duplicate, err := s.StartPlannedRun(ctx, scope, req, cfg); err != nil || duplicate {
			t.Fatal("duplicate scope start", err)
		}
		frozen, err := s.FrozenContext(ctx, r.ID)
		if err != nil {
			t.Fatal(err)
		}
		state, err := app.ExecuteChapter(ctx, cfg, "normal", orchestration.Options{FrozenInput: &frozen, BaseDraftVersion: req.DraftVersion, MaxRounds: 2})
		if err != nil {
			t.Fatal("scope execute", err)
		}
		r.Result = &state
		r.DraftVersion = state.DraftVersion
		if err = s.SaveProgress(ctx, r, req.DraftVersion); err != nil {
			t.Fatal(err)
		}
		if err = app.ExecuteHuman(ctx, cfg, r, s); err != nil {
			t.Fatal("scope human gate", err)
		}
		r, err = s.GetRun(ctx, r.ID)
		if err != nil || r.Status != "waiting_human" {
			t.Fatal("not at gate", err, r.Status)
		}
		return r
	}
	adopt := func(r app.Run) app.FinalCommit {
		t.Helper()
		r, _, err := s.ClaimAction(ctx, r.ID, orchestration.HumanAction{ID: rand.Text(), Type: "approve", DraftVersion: r.DraftVersion})
		if err != nil {
			t.Fatal("scope approve", err)
		}
		if err = app.ExecuteHuman(ctx, cfg, r, s); err != nil {
			t.Fatal(err)
		}
		commit, err := s.Finalize(ctx, r.ID, app.FinalizeInput{ID: rand.Text(), DraftVersion: r.DraftVersion, InputDigest: r.InputDigest, FactsConfirmed: true})
		if err != nil {
			t.Fatal("scope finalize", err)
		}
		return commit
	}
	chapter := start("chapter", "", nil, nil)
	if len(chapter.Result.Segments) != 2 || chapter.Result.Segments[0].BeatID != first || chapter.Result.Segments[1].BeatID != second {
		t.Fatal("missing chapter targets")
	}
	before := append([]manuscript.Segment{}, chapter.Result.Segments...)
	req := manuscript.AuthorRewrite{SegmentID: before[0].ID, Original: before[0].Text, Start: 0, End: 2, Instruction: "只改开头两个字"}
	action := orchestration.HumanAction{ID: rand.Text(), Type: "rewrite", DraftVersion: chapter.DraftVersion, Rewrite: &req}
	changed, _, err := s.ClaimAction(ctx, chapter.ID, action)
	if err != nil {
		t.Fatal("author rewrite without findings", err)
	}
	if err = app.ExecuteHuman(ctx, cfg, changed, s); err != nil {
		t.Fatal("resume checkpoint with rewrite", err)
	}
	chapter, err = s.GetRun(ctx, chapter.ID)
	if err != nil || chapter.DraftVersion != 2 || chapter.Status != "waiting_human" || !reflect.DeepEqual(chapter.Result.Segments[1], before[1]) {
		t.Fatal("scope escaped or recheck absent", err)
	}
	if chapter.Result.AuthorRequest == nil || *chapter.Result.AuthorRequest != req {
		t.Fatal("author request lost across checkpoint resume")
	}
	if chapter.Result.Segments[0].Text == before[0].Text {
		t.Fatal("rewrite did not apply")
	}
	if _, again, err := s.ClaimAction(ctx, chapter.ID, action); err != nil || again {
		t.Fatal("action retry not idempotent", err)
	}
	commit := adopt(chapter)
	preview, err := s.PreviewChapterAssembly(ctx, scope, app.AssemblyPreviewRequest{ChapterID: p.ChapterID})
	if err != nil || !preview.Ready || len(preview.Draft.Parts) != 2 {
		t.Fatal("chapter commit assembly", err, preview.Reason)
	}
	for i, part := range preview.Draft.Parts {
		if part.CommitID != commit.ID || len(part.Segments) != 1 || part.Segments[0].BeatID != []string{first, second}[i] {
			t.Fatal("assembly duplicated chapter", part)
		}
	}
	frozen, err := s.FrozenContext(ctx, chapter.ID)
	if err != nil {
		t.Fatal(err)
	}
	a := preview.Draft
	a.ID = rand.Text()
	a.Digest = preview.PreviewDigest
	if _, err = app.BuildChapterReviewInput(a, map[string]manuscript.FrozenInput{commit.ID: frozen}); err != nil {
		t.Fatal("chapter review mapping", err)
	}
	// Unsaved adoption is not required: latest working prose is pinned, and unchanged rechecks do not invalidate neighbors.
	left := start("beat", first, &chapter, nil)
	right := start("beat", second, &chapter, nil)
	if left.Result.RewriteRequest() == nil || left.Result.RewriteRequest().Instruction != req.Instruction {
		t.Fatal("recheck dropped author request")
	}
	if right.Result.RewriteRequest() != nil {
		t.Fatal("author request leaked into another beat")
	}
	if len(left.Planning.Neighbors) != 1 || left.Planning.Neighbors[0].RunID != chapter.ID || left.Planning.Neighbors[0].Version != chapter.DraftVersion {
		t.Fatal("missing adopted neighbor")
	}
	if left.Result.Segments[0].Text != chapter.Result.Segments[0].Text {
		t.Fatal("recheck changed prose")
	}
	if len(right.Planning.Neighbors) != 1 || right.Planning.Neighbors[0].RunID != left.ID || right.Planning.Neighbors[0].State != "candidate" {
		t.Fatal("unadopted neighbor was omitted")
	}
	unchanged, e := s.GetRun(ctx, left.ID)
	if e != nil || unchanged.Status != "waiting_human" {
		t.Fatal("unchanged recheck invalidated neighbor", e, unchanged.Status)
	}
	rhs := right.Result.Segments[0]
	rewrite := manuscript.AuthorRewrite{SegmentID: rhs.ID, Original: rhs.Text, Start: 0, End: 2, Instruction: "改变开头"}
	right, _, err = s.ClaimAction(ctx, right.ID, orchestration.HumanAction{ID: rand.Text(), Type: "rewrite", DraftVersion: right.DraftVersion, Rewrite: &rewrite})
	if err != nil {
		t.Fatal(err)
	}
	if err = app.ExecuteHuman(ctx, cfg, right, s); err != nil {
		t.Fatal(err)
	}
	right, err = s.GetRun(ctx, right.ID)
	if err != nil {
		t.Fatal(err)
	}
	// Neighboring edits are advisory; the target remains available for author approval.
	staleBeforeAdoption, e := s.GetRun(ctx, left.ID)
	if e != nil || staleBeforeAdoption.Status != "waiting_human" || !staleBeforeAdoption.NeighborsChanged {
		t.Fatal("neighbor edit blocked target approval or lost advisory", e)
	}
	adopt(right)
	obsolete, e := s.PreviewChapterAssembly(ctx, scope, app.AssemblyPreviewRequest{ChapterID: p.ChapterID, Choices: map[string]string{first: commit.ID, second: commit.ID}})
	if e != nil || obsolete.Ready {
		t.Fatal("old chapter commit bypassed new beat adoption", e)
	}
	outdated, err := s.GetRun(ctx, left.ID)
	if err != nil || outdated.Status != "waiting_human" || !outdated.NeighborsChanged {
		t.Fatal("neighbor change must remain advisory", err, outdated.Status)
	}
	// The author can adopt left immediately after adopting right: no recheck cycle.
	leftCommit := adopt(left)
	leftSaved, err := s.GetRun(ctx, left.ID)
	if err != nil || leftSaved.Status != "committed" || leftSaved.CommitID != leftCommit.ID {
		t.Fatal("adoption lost", err)
	}
	refreshed := start("beat", first, &left, nil)
	if refreshed.Result.Segments[0].Text != left.Result.Segments[0].Text {
		t.Fatal("refresh rewrote text")
	}
	if refreshed.Planning.Neighbors[0].RunID != right.ID || refreshed.Planning.Neighbors[0].State != "adopted" {
		t.Fatal("refresh did not pin latest neighbor")
	}
	adopt(refreshed)
	neighborCheck := *refreshed.Planning
	neighborCheck.Baseline = nil // The target's own adopted version is checked independently.
	current, e := neighborsCurrent(ctx, s.pool, &neighborCheck)
	if e != nil || !current {
		t.Fatal("unchanged adopted neighbor should remain current", e)
	}
	// Direct author saves without a new run also become the current neighboring working prose.
	edited, e := s.EditSegment(ctx, right.ChapterID, "main", right.Result.Segments[0].ID, right.DraftVersion, right.Result.Segments[0].Text+" 新的邻段动作。")
	if e != nil {
		t.Fatal(e)
	}
	gate, e := s.PlannedRunReadiness(ctx, scope, p.ChapterID, cfg, second)
	if e != nil || gate.Working == nil || gate.Working.Version != edited.DraftVersion || gate.Working.State != "candidate" || gate.Working.Segments[0].Text != edited.Segments[0].Text {
		t.Fatal("latest manual working draft missing", e)
	}
	ok, e := neighborsCurrent(ctx, s.pool, &neighborCheck)
	if e != nil || ok {
		t.Fatal("manual neighbor edit did not invalidate review", e)
	}
	old, err := s.GetCommit(ctx, commit.ID)
	if err != nil || !reflect.DeepEqual(old.Segments, commit.Segments) {
		t.Fatal("old adopted chapter mutated", err)
	}
	// Adoption and review-only saves are separate: a version bump without a prose
	// change still assembles; editing the second beat must not revoke the first.
	finalChapter := start("chapter", "", &chapter, nil)
	finalCommit := adopt(finalChapter)
	secondPart := finalCommit.Segments[1]
	same := start("chapter", "", &finalChapter, nil)
	samePreview, err := s.PreviewChapterAssembly(ctx, scope, app.AssemblyPreviewRequest{ChapterID: p.ChapterID})
	if err != nil || !samePreview.Ready {
		t.Fatalf("same prose needs adoption again: %v %#v", err, samePreview.Slots)
	}
	_, err = s.EditSegment(ctx, finalCommit.ChapterID, "main", secondPart.ID, same.DraftVersion, secondPart.Text+" 后段新增动作。")
	if err != nil {
		t.Fatal(err)
	}
	next, err := s.PreviewChapterAssembly(ctx, scope, app.AssemblyPreviewRequest{ChapterID: p.ChapterID})
	if err != nil || next.Ready || next.Slots[0].Part.CommitID != finalCommit.ID || next.Slots[0].Reason != "" || next.Slots[1].Reason == "" {
		t.Fatal("editing second beat revoked the unchanged first beat or accepted unreviewed edits", err, next)
	}
	retained, err := s.GetRun(ctx, finalChapter.ID)
	if err != nil || retained.Status != "committed" || retained.CommitID != finalCommit.ID {
		t.Fatal("shared-head edit revoked immutable commit", err)
	}
	firstGate, err := s.PlannedRunReadiness(ctx, scope, p.ChapterID, cfg, first)
	if err != nil || firstGate.Adopted == nil || !firstGate.Adopted.MatchesWorking || firstGate.Working.State != "adopted" {
		t.Fatal("unchanged adoption badge lost", err, firstGate.Adopted)
	}
	secondGate, err := s.PlannedRunReadiness(ctx, scope, p.ChapterID, cfg, second)
	if err != nil || secondGate.Adopted == nil || secondGate.Adopted.MatchesWorking {
		t.Fatal("new candidate confused with adopted prose", err)
	}

}
