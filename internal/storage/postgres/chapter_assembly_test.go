package postgres

import (
	"context"
	"crypto/rand"
	"errors"
	"inkloom/internal/app"
	"inkloom/internal/config"
	"inkloom/internal/domain/planning"
	"testing"
)

// Reuses the real persisted planning chain and Fake Writer/critic/author approval path.
func exerciseChapterAssembly(t *testing.T, s *Store, scope string, p planning.ChapterPlanSelection, cfg config.Config, first app.FinalCommit) {
	t.Helper()
	ctx := context.Background()
	input := app.AssemblyPreviewRequest{ChapterID: p.ChapterID}
	preview, err := s.PreviewChapterAssembly(ctx, scope, input)
	if err != nil || preview.Ready || len(preview.Slots) != 2 || len(preview.Draft.Parts) != 1 {
		t.Fatal("missing Beat must block assembly", err, preview)
	}
	var second app.Run
	beat := p.Content.Scenes[0].Beats[1].ID
	second = exercisePlannedRun(t, s, scope, p, cfg, &second, beat)
	if second.ChapterID == first.ChapterID || second.Planning.PlanVersion != p.Version || second.Planning.BeatID != beat {
		t.Fatal("target selection changed plan or reused another draft")
	}
	frozen, err := s.FrozenContext(ctx, second.ID)
	if err != nil || frozen.Bundle.WritingTask.Brief.SelectedBeatID != beat {
		t.Fatal("wrong target in frozen input", err)
	}
	commit, err := s.Finalize(ctx, second.ID, app.FinalizeInput{ID: rand.Text(), DraftVersion: second.DraftVersion, InputDigest: second.InputDigest, FactsConfirmed: true})
	if err != nil {
		t.Fatal(err)
	}
	preview, err = s.PreviewChapterAssembly(ctx, scope, input)
	if err != nil || !preview.Ready || len(preview.Draft.Parts) != 2 || preview.Draft.Parts[0].CommitID != first.ID || preview.Draft.Parts[1].CommitID != commit.ID {
		t.Fatal("assembly ordering", err, preview)
	}
	wrong := input
	wrong.Choices = map[string]string{beat: first.ID}
	if bad, e := s.PreviewChapterAssembly(ctx, scope, wrong); e != nil || bad.Ready {
		t.Fatal("cross Beat commit selected", e)
	}
	choices := map[string]string{}
	for _, part := range preview.Draft.Parts {
		choices[part.BeatID] = part.CommitID
	}
	req := app.AssemblySaveRequest{RequestID: rand.Text(), ChapterID: p.ChapterID, Choices: choices, PreviewDigest: preview.PreviewDigest, ExpectedVersion: 0}
	if _, e := s.SaveChapterAssembly(ctx, scope, req); !errors.Is(e, app.ErrInvalidWrite) {
		t.Fatal("saved without confirmation", e)
	}
	req.Confirm = true
	saved, err := s.SaveChapterAssembly(ctx, scope, req)
	if err != nil || saved.Version != 1 || saved.Status != "awaiting_chapter_review" {
		t.Fatal("save", err, saved)
	}
	if again, e := s.SaveChapterAssembly(ctx, scope, req); e != nil || again.ID != saved.ID {
		t.Fatal("retry", e)
	}
	changed := req
	changed.PreviewDigest = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
	if _, e := s.SaveChapterAssembly(ctx, scope, changed); !errors.Is(e, app.ErrActionMismatch) {
		t.Fatal("request id reused with changed payload", e)
	}
	changed = req
	changed.RequestID = rand.Text()
	if _, e := s.SaveChapterAssembly(ctx, scope, changed); !errors.Is(e, app.ErrVersionMismatch) {
		t.Fatal("concurrent old preview saved", e)
	}
	preview, err = s.PreviewChapterAssembly(ctx, scope, input)
	if err != nil || len(preview.History) != 1 {
		t.Fatal(err)
	}
	lateReview, reviewOutput := exerciseChapterReview(t, s, scope, saved, cfg)
	stale := req
	stale.RequestID = rand.Text()
	stale.ExpectedVersion = 1
	stale.PreviewDigest = preview.PreviewDigest
	// A newer current draft invalidates a previously valid assembly preview, even though its commits remain immutable.
	segment := commit.Segments[0]
	if _, e := s.EditSegment(ctx, commit.ChapterID, "main", segment.ID, commit.DraftVersion, segment.Text+" 作者改了一句。"); e != nil {
		t.Fatal(e)
	}
	if _, e := s.SaveChapterAssembly(ctx, scope, stale); !errors.Is(e, app.ErrVersionMismatch) {
		t.Fatal("stale draft was assembled", e)
	}
	after, e := s.PreviewChapterAssembly(ctx, scope, input)
	if e != nil || after.Ready || len(after.History) != 1 || after.History[0].Digest != saved.Digest {
		t.Fatal("history changed or stale draft allowed", e)
	}
	if _, e = s.SaveChapterAssembly(ctx, scope, req); e != nil {
		t.Fatal("lost receipt after draft changed", e)
	}
	if err = s.FinishChapterReview(ctx, lateReview.ID, reviewOutput, nil); err != nil {
		t.Fatal(err)
	}
	reviews, e := s.ChapterReviews(ctx, scope, saved.ID)
	if e != nil || reviews.Current || reviews.Jobs[0].Current {
		t.Fatal("late review accepted as current", e)
	}
	if _, e = s.DecideChapterReview(ctx, scope, lateReview.ID, app.ChapterReviewDecision{RequestID: rand.Text(), AssemblyVersion: saved.Version, InputDigest: lateReview.InputDigest, Action: "approve", Reason: "旧稿已看过"}); !errors.Is(e, app.ErrVersionMismatch) {
		t.Fatal("late review approved changed draft", e)
	}

}
