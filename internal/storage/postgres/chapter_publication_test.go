package postgres

import (
	"context"
	"crypto/rand"
	"errors"
	"reflect"
	"sync"
	"testing"

	"inkloom/internal/agents/model"
	"inkloom/internal/app"
	"inkloom/internal/config"
	"time"
)

// Reuse the actual planning → Beat commits → assembly → independent reviews fixture.
func exerciseChapterPublication(t *testing.T, s *Store, scope string, j app.ChapterReviewJob) app.ChapterPublicationRequest {
	t.Helper()
	ctx := context.Background()
	req := app.ChapterPublicationRequest{RequestID: rand.Text(), ReviewID: j.ID, AssemblyVersion: j.Input.DraftVersion, InputDigest: j.InputDigest, ApprovalID: j.Decision.RequestID}
	if _, err := s.PublishChapter(ctx, scope, req); !errors.Is(err, app.ErrFactsUnconfirmed) {
		t.Fatal("unconfirmed facts published", err)
	}
	req.NoPendingFacts = true
	wrong := req
	wrong.AssemblyVersion++
	if _, err := s.PublishChapter(ctx, scope, wrong); !errors.Is(err, app.ErrVersionMismatch) {
		t.Fatal("wrong assembly version published", err)
	}
	wrong = req
	wrong.ApprovalID = "another-approval"
	if _, err := s.PublishChapter(ctx, scope, wrong); !errors.Is(err, app.ErrVersionMismatch) {
		t.Fatal("wrong approval published", err)
	}
	// A started candidate review cannot be bypassed with the legacy no-pending checkbox.
	cfg := config.Config{Model: "fake", ModelName: "scripted-fake", MaxCalls: 3, MaxTokens: 120000, MaxOutputTokens: 4096, CallTimeout: time.Second}
	fr := app.ChapterFactsRequest{RequestID: rand.Text(), ReviewID: j.ID, InputDigest: j.InputDigest, Mode: "model"}
	fj, created, e := s.StartChapterFacts(ctx, scope, fr, cfg)
	if e != nil || !created {
		t.Fatal("facts start", e)
	}
	if _, fresh, e := s.StartChapterFacts(ctx, scope, fr, cfg); e != nil || fresh {
		t.Fatal("facts duplicate", e)
	}
	if _, e := s.PublishChapter(ctx, scope, req); !errors.Is(e, app.ErrFactsUnconfirmed) {
		t.Fatal("running facts bypassed", e)
	}
	output, e := app.ExtractChapterFacts(ctx, cfg, fj.Input, func(ctx context.Context, c model.CallRecord) error { return s.RecordChapterFactsCall(ctx, fj.ID, c) })
	if e != nil {
		t.Fatal(e)
	}
	// A successful provider call can still yield unusable evidence. Preserve the
	// classified failure, forbid publication, then take over without another call.
	broken := app.ChapterFactsOutput{Candidates: append([]app.ChapterFactCandidate{}, output.Candidates...)}
	broken.Candidates[0].Evidence.Quote = "不在章稿中的引文"
	if e = s.FinishChapterFacts(ctx, fj.ID, broken, nil); e != nil {
		t.Fatal(e)
	}
	failedID := fj.ID
	state, e := s.ChapterFacts(ctx, scope, j.ID)
	if e != nil || state.Job == nil || state.Job.Failure == nil || state.Job.Failure.Code != "evidence_mismatch" || state.Job.Output != nil || len(state.Job.Calls) != 1 || !state.Job.Calls[0].Success {
		t.Fatal("failed task lost diagnosis or exposed candidates", state, e)
	}
	if _, e := s.PublishChapter(ctx, scope, req); !errors.Is(e, app.ErrFactsUnconfirmed) {
		t.Fatal("failed facts bypassed", e)
	}
	manual := app.ChapterFactsRequest{RequestID: rand.Text(), ReviewID: j.ID, InputDigest: j.InputDigest, Mode: "manual"}
	fj, created, e = s.StartChapterFacts(ctx, scope, manual, cfg)
	if e != nil || !created || fj.Provider != "human" || fj.Status != "completed" || len(fj.Calls) != 0 {
		t.Fatal("manual takeover", fj, e)
	}
	if _, fresh, e := s.StartChapterFacts(ctx, scope, manual, cfg); e != nil || fresh {
		t.Fatal("manual retry", e)
	}
	if old, _, e := s.StartChapterFacts(ctx, scope, fr, cfg); e != nil || old.ID != failedID || old.Failure == nil {
		t.Fatal("lost failed history", e)
	}
	candidate := app.ChapterFactCandidate{ID: "manual-1", Kind: "event", Text: "作者确认的交接动作", Evidence: output.Candidates[0].Evidence, Reason: "作者补充"}
	selection := app.ChapterFactsSelectionRequest{RequestID: rand.Text(), JobID: fj.ID, ExpectedVersion: 0, Manual: []app.ChapterFactCandidate{candidate}, Decisions: []app.ChapterFactDecision{{CandidateID: "manual-1", Action: "confirm", Text: candidate.Text, KnownBy: []string{fj.Input.Knowledge.Characters[0]}, Reason: "已核对原文和知情人"}}}
	selected, e := s.SelectChapterFacts(ctx, scope, selection)
	if e != nil || selected.Block != "" || len(selected.Package.Facts) != 1 {
		t.Fatal("fact selection", e, selected)
	}
	if again, e := s.SelectChapterFacts(ctx, scope, selection); e != nil || !reflect.DeepEqual(again, selected) {
		t.Fatal("fact retry", e)
	}
	old := selection
	old.RequestID = rand.Text()
	if _, e := s.SelectChapterFacts(ctx, scope, old); !errors.Is(e, app.ErrVersionMismatch) {
		t.Fatal("stale fact decision", e)
	}
	if _, e := s.PublishChapter(ctx, scope, req); !errors.Is(e, app.ErrVersionMismatch) {
		t.Fatal("omitted facts version", e)
	}
	req.FactJobID = fj.ID
	req.FactVersion = selected.Version
	var wg sync.WaitGroup
	results := make([]app.ChapterPublicationState, 2)
	errs := make([]error, 2)
	for i := range results {
		wg.Add(1)
		go func(i int) { defer wg.Done(); results[i], errs[i] = s.PublishChapter(ctx, scope, req) }(i)
	}
	wg.Wait()
	for i, result := range results {
		if errs[i] != nil || result.Publication == nil || !result.Current {
			t.Fatal("publish", errs[i], result)
		}
	}
	p := results[0].Publication
	if !reflect.DeepEqual(results[0], results[1]) || p.Version != 1 || p.Review.Decision.RequestID != req.ApprovalID || !p.FactConfirmation.NoPendingFacts || len(p.Assembly.Parts) != 2 || p.Assembly.Digest != j.Input.AssemblyDigest {
		t.Fatal("incomplete immutable publication", results)
	}
	if p.Review.InputDigest != j.InputDigest || len(p.Review.Calls) != 2 || p.CreatedAt.IsZero() {
		t.Fatal("missing audit trail")
	}
	if p.FactSelection == nil || len(p.FactSelection.Package.Facts) != 1 || p.FactReview == nil || len(p.FactReview.Calls) != 0 || p.FactReview.Provider != "human" {
		t.Fatal("facts not frozen")
	}
	if k, e := s.GetKnowledge(ctx, fj.Input.Knowledge.ProjectID, fj.Input.Knowledge.BranchID, 0); e != nil || k.Digest != fj.Input.BaseKnowledge.Digest {
		t.Fatal("chapter facts replaced current input knowledge", e)
	}
	fr.RequestID = rand.Text()
	if _, _, e := s.StartChapterFacts(ctx, scope, fr, cfg); !errors.Is(e, app.ErrGateBlocked) {
		t.Fatal("published facts mutated", e)
	}
	read, err := s.ChapterPublication(ctx, scope, j.ID)
	if err != nil || !reflect.DeepEqual(read, results[0]) {
		t.Fatal("read receipt", err)
	}
	wrong = req
	wrong.RequestID = rand.Text()
	if _, err := s.PublishChapter(ctx, scope, wrong); !errors.Is(err, app.ErrActionMismatch) {
		t.Fatal("same review published twice", err)
	}
	wrong = req
	wrong.InputDigest = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
	if _, err := s.PublishChapter(ctx, scope, wrong); !errors.Is(err, app.ErrActionMismatch) {
		t.Fatal("changed retry payload accepted", err)
	}
	overview, e := s.BookOverview(ctx, scope)
	if e != nil || overview.FinalizedChapters != 1 || overview.AcceptedWords == 0 || overview.DoneBeats != 2 || overview.CurrentChapterID != j.ChapterID || overview.NextStage != "assembly" {
		t.Fatal("live overview publication", e, overview)
	}
	return req
}

func assertHistoricalPublication(t *testing.T, s *Store, scope string, req app.ChapterPublicationRequest) {
	t.Helper()
	ctx := context.Background()
	old, err := s.ChapterPublication(ctx, scope, req.ReviewID)
	if err != nil || old.Publication == nil || old.Current || old.Reason == "" {
		t.Fatal("old publication still current", err, old)
	}
	overview, e := s.BookOverview(ctx, scope)
	if e != nil || overview.FinalizedChapters != 0 {
		t.Fatal("historical publication counted as current", e, overview)
	}
	again, err := s.PublishChapter(ctx, scope, req)
	if err != nil || !reflect.DeepEqual(old, again) {
		t.Fatal("lost historical receipt", err)
	}
}
