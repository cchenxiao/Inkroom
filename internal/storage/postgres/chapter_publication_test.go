package postgres

import (
	"context"
	"crypto/rand"
	"errors"
	"reflect"
	"sync"
	"testing"

	"inkloom/internal/app"
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
	return req
}

func assertHistoricalPublication(t *testing.T, s *Store, scope string, req app.ChapterPublicationRequest) {
	t.Helper()
	ctx := context.Background()
	old, err := s.ChapterPublication(ctx, scope, req.ReviewID)
	if err != nil || old.Publication == nil || old.Current || old.Reason == "" {
		t.Fatal("old publication still current", err, old)
	}
	again, err := s.PublishChapter(ctx, scope, req)
	if err != nil || !reflect.DeepEqual(old, again) {
		t.Fatal("lost historical receipt", err)
	}
}
