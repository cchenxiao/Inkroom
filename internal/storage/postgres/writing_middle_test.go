package postgres

import (
	"context"
	"crypto/rand"
	"inkloom/internal/app"
	"inkloom/internal/config"
	"inkloom/internal/domain/manuscript"
	"inkloom/internal/domain/planning"
	"inkloom/internal/orchestration"
	"reflect"
	"testing"
)

// Extends the isolated plan fixture to three beats. No synthetic decision touches author data.
func exerciseMiddleWorkingDraft(t *testing.T, s *Store, scope string, p planning.ChapterPlanSelection, cfg config.Config) {
	t.Helper()
	ctx := context.Background()
	cfg.MaxCalls, cfg.MaxTokens, cfg.ContextTokens = 20, 128000, 32768
	state, readErr := s.GetPlanning(ctx, scope)
	if readErr != nil {
		t.Fatal(readErr)
	}
	for _, current := range state.ChapterPlans {
		if current.ChapterID == p.ChapterID {
			p = current
		}
	}
	// Freeze a new author-confirmed test plan with a real middle beat.
	p.Content.Scenes[0].Beats = append(append([]planning.PlannedBeat{}, p.Content.Scenes[0].Beats...), planning.PlannedBeat{ID: "third-" + rand.Text(), Title: "收尾", Action: "收起记录，完成本次交接。", Turn: "为下一次核对留下记录。"})
	// New scene plan has new beat identities; previous adopted passages stay intact.
	for i := range p.Content.Scenes[0].Beats {
		p.Content.Scenes[0].Beats[i].ID = "middle-test-" + rand.Text()
	}
	p.Content.Brief.SelectedBeatID = p.Content.Scenes[0].Beats[0].ID
	var err error
	p, err = s.SaveChapterPlan(ctx, scope, planning.ChapterPlanSaveRequest{Expected: p.Versions, ChapterID: p.ChapterID, ExpectedVersion: p.Version, SourceVersion: p.Version, JobID: p.JobID, CandidateVersion: p.CandidateVersion, Content: p.Content, Confirmed: true})
	if err != nil {
		t.Fatal("three-beat plan", err)
	}
	beats := p.Content.Scenes[0].Beats
	start := func(mode, beat string, from *app.Run, recheck bool) app.Run {
		t.Helper()
		gate, err := s.PlannedRunReadiness(ctx, scope, p.ChapterID, cfg, beat, mode)
		if err != nil || !gate.Ready {
			t.Fatal("readiness", err, gate.Reason)
		}
		req := app.PlannedRunRequest{EnhancedContinuity: recheck, Mode: mode, BeatID: beat, ChapterID: p.ChapterID, RequestID: rand.Text(), Expected: p.Versions, PlanVersion: p.Version, DraftVersion: gate.DraftVersion}
		if from != nil {
			req.FromRunID = from.ID
			req.SourceVersion = from.DraftVersion
			req.Recheck = recheck
			if recheck && mode == "chapter" {
				req.DraftVersion = from.DraftVersion
			}
		}
		r, created, err := s.StartPlannedRun(ctx, scope, req, cfg)
		if err != nil || !created {
			t.Fatal("start", err)
		}
		frozen, err := s.FrozenContext(ctx, r.ID)
		if err != nil {
			t.Fatal(err)
		}
		if frozen.Bundle.WritingTask.ExperimentalContinuity != recheck {
			t.Fatal("recheck option not applied")
		}
		for _, target := range frozen.Bundle.Targets {
			if target.WritingTask.ExperimentalContinuity != recheck {
				t.Fatal("chapter target option differs")
			}
		}
		state, err := app.ExecuteChapter(ctx, cfg, "normal", orchestration.Options{FrozenInput: &frozen, BaseDraftVersion: req.DraftVersion, MaxRounds: 2})
		if err != nil {
			t.Fatal("execute", err)
		}
		r.Result = &state
		r.DraftVersion = state.DraftVersion
		if err = s.SaveProgress(ctx, r, req.DraftVersion); err != nil {
			t.Fatal(err)
		}
		if err = app.ExecuteHuman(ctx, cfg, r, s); err != nil {
			t.Fatal(err)
		}
		r, err = s.GetRun(ctx, r.ID)
		if err != nil || r.Status != "waiting_human" {
			t.Fatal("gate", err, r.Status)
		}
		return r
	}
	chapter := start("chapter", "", nil, false)
	if len(chapter.Result.Segments) != 3 {
		t.Fatal("not three beats")
	}
	// A whole-chapter recheck copies every segment and never calls the writer.
	rechecked := start("chapter", "", &chapter, true)
	if rechecked.Planning.Mode != "chapter" || !reflect.DeepEqual(texts(rechecked.Result.Segments), texts(chapter.Result.Segments)) {
		t.Fatal("chapter recheck changed scope or prose")
	}
	chapter = rechecked
	// Save a newer unapproved left neighbor in its own draft before opening the middle.
	left := start("beat", beats[0].ID, &chapter, true)
	leftText := left.Result.Segments[0].Text + " 林宁把布袋系在左腕。"
	saved, err := s.EditSegment(ctx, left.ChapterID, "main", left.Result.Segments[0].ID, left.DraftVersion, leftText)
	if err != nil {
		t.Fatal(err)
	}
	middle := start("beat", beats[1].ID, &chapter, true)
	frozen, err := s.FrozenContext(ctx, middle.ID)
	if err != nil {
		t.Fatal(err)
	}
	n := frozen.Bundle.Neighbors
	if len(n) != 2 || n[0].Position != "before" || n[1].Position != "after" || n[0].BeatID != beats[0].ID || n[1].BeatID != beats[2].ID || n[0].Version != saved.DraftVersion || n[0].State != "candidate" || n[1].State != "candidate" || n[0].Segments[0].Text != leftText || n[1].Segments[0].Text != chapter.Result.Segments[2].Text {
		t.Fatalf("wrong current middle neighbors: %#v", n)
	}
	// Change only the right neighbor in the shared chapter head after freezing the middle.
	right := chapter.Result.Segments[2]
	_, err = s.EditSegment(ctx, chapter.ChapterID, "main", right.ID, chapter.DraftVersion, right.Text+" 新的右侧衔接动作。")
	if err != nil {
		t.Fatal(err)
	}
	old, err := s.FrozenContext(ctx, middle.ID)
	if err != nil || !reflect.DeepEqual(old.Bundle.Neighbors, n) {
		t.Fatal("frozen evidence mutated", err)
	}
	stale, err := s.GetRun(ctx, middle.ID)
	if err != nil || stale.Status != "waiting_human" || !stale.NeighborsChanged {
		t.Fatal("neighbor change should be advisory", err, stale.Status)
	}
	if ok, err := planningRunCurrent(ctx, s.pool, middle.Planning); err != nil || !ok {
		t.Fatal("neighbor edits must not block this target", err)
	}
	refreshed := start("beat", beats[1].ID, &middle, true)
	if !reflect.DeepEqual(texts(refreshed.Result.Segments), texts(middle.Result.Segments)) {
		t.Fatal("recheck changed middle prose")
	}
	if refreshed.Planning.Neighbors[1].Segments[0].Text != right.Text+" 新的右侧衔接动作。" {
		t.Fatal("recheck used old right neighbor")
	}
	// The newer shared chapter save has an unchanged left part. It must not hide a
	// separately edited left draft: author-edited left prose remains the latest for that beat.
	if refreshed.Planning.Neighbors[0].Segments[0].Text != leftText {
		t.Fatal("saving right neighbor resurrected older left prose from chapter head")
	}
}
func texts(ss []manuscript.Segment) []string {
	out := []string{}
	for _, s := range ss {
		out = append(out, s.Text)
	}
	return out
}
