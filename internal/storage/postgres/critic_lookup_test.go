package postgres

import (
	"context"
	"crypto/rand"
	"errors"
	"inkloom/internal/app"
	"inkloom/internal/config"
	"inkloom/internal/contextassembly"
	"inkloom/internal/demo"
	"inkloom/internal/domain/manuscript"
	"inkloom/internal/domain/memory"
	"inkloom/internal/orchestration"
	"os"
	"testing"
	"time"
)

func TestCriticEvidenceVersionAndEvents(t *testing.T) {
	url := os.Getenv("INKLOOM_TEST_DATABASE_URL")
	if url == "" {
		t.Skip("requires PostgreSQL")
	}
	ctx := context.Background()
	s, err := Open(ctx, url)
	if err != nil {
		t.Fatal(err)
	}
	chapter := "critic-" + rand.Text()
	id := rand.Text()
	defer func() {
		for _, q := range []string{"DELETE FROM reviews WHERE run_id IN(SELECT id FROM runs WHERE chapter_id=$1)", "DELETE FROM chapter_versions WHERE chapter_id=$1", "DELETE FROM segment_versions WHERE chapter_id=$1", "DELETE FROM runs WHERE chapter_id=$1", "DELETE FROM chapters WHERE id=$1"} {
			if _, e := s.pool.Exec(ctx, q, chapter); e != nil {
				t.Error(e)
			}
		}
		s.Close()
	}()
	b, _, _ := demo.Load("no-findings")
	b.ChapterID = chapter
	input, err := contextassembly.Assemble(b, demo.PreviousChapter(), contextassembly.Options{RunID: id, Budget: 8000, ReservedOutputTokens: 2048})
	if err != nil {
		t.Fatal(err)
	}
	r := app.Run{ID: id, ChapterID: chapter, BranchID: "main", Status: "running"}
	if err = s.CreatePreparedRun(ctx, r, input); err != nil {
		t.Fatal(err)
	}
	cfg := config.Config{Model: "fake", MaxCalls: 14, MaxTokens: 24000, MaxOutputTokens: 2048, CallTimeout: time.Second}
	state, err := app.ExecuteChapter(ctx, cfg, "no-findings", orchestration.Options{FrozenInput: &input})
	if err != nil {
		t.Fatal(err)
	}
	r.Result = &state
	r.DraftVersion = 1
	if err = s.SaveProgress(ctx, r, 0); err != nil {
		t.Fatal(err)
	}
	hard := state.CriticReviews[0]
	hard.Lookup = &memory.LookupTrace{Steps: []memory.LookupStep{}, Stop: "ready"}
	digest, _ := manuscript.ContentDigest(struct {
		Context  manuscript.ContextBundle
		Segments []manuscript.Segment
	}{state.Context, state.Segments})
	check := app.CriticLookup{DraftVersion: 1, InputDigest: digest, Review: hard}
	if err = s.SaveCriticLookup(ctx, id, check); err != nil {
		t.Fatal(err)
	}
	if err = s.SaveCriticLookup(ctx, id, check); !errors.Is(err, app.ErrGateBlocked) {
		t.Fatal("completed evidence overwritten", err)
	}
	// A late aggregate snapshot must not erase the independently stored lookup.
	if err = s.SaveProgress(ctx, r, 1); err != nil {
		t.Fatal(err)
	}
	got, err := s.GetRun(ctx, id)
	if err != nil || len(got.CriticLookups) != 1 {
		t.Fatal("lost trace", err)
	}
	events, err := s.Events(ctx, id, 0)
	if err != nil {
		t.Fatal(err)
	}
	found := false
	for _, e := range events.Events {
		if e.Type == "critic.lookup" {
			found = true
		}
	}
	if !found {
		t.Fatal("trace missing from transactional events")
	}
	s.Close()
	s, err = Open(ctx, url)
	if err != nil {
		t.Fatal(err)
	}
	got, err = s.GetRun(ctx, id)
	if err != nil || len(got.CriticLookups) != 1 || got.CriticLookups[0].Review.Lookup.Stop != "ready" {
		t.Fatal("trace lost after restart", err)
	}
	if _, err = s.EditSegment(ctx, chapter, "main", state.Segments[0].ID, 1, "作者修改了正文。"); err != nil {
		t.Fatal(err)
	}
	if err = s.SaveCriticLookup(ctx, id, check); !errors.Is(err, app.ErrVersionMismatch) {
		t.Fatal("late evidence accepted", err)
	}
}
