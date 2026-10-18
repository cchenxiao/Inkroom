package postgres

import (
	"context"
	"crypto/rand"
	"errors"
	"os"
	"reflect"
	"strings"
	"testing"
	"time"

	"inkloom/internal/app"
	"inkloom/internal/config"
	"inkloom/internal/domain/manuscript"
	"inkloom/internal/domain/review"
	"inkloom/internal/orchestration"
)

func TestFindingPreviewRecoveryAndBatchReview(t *testing.T) {
	for _, kind := range []string{"propose_finding", "propose_selection"} {
		t.Run(kind, func(t *testing.T) { exercisePreviewRecovery(t, kind) })
	}
}
func exercisePreviewRecovery(t *testing.T, kind string) {
	url := os.Getenv("INKLOOM_TEST_DATABASE_URL")
	if url == "" {
		t.Skip("set INKLOOM_TEST_DATABASE_URL")
	}
	ctx := context.Background()
	store, err := Open(ctx, url)
	if err != nil {
		t.Fatal(err)
	}
	id := rand.Text()
	chapter := "local-finding-" + id
	defer func() {
		for _, table := range []string{"run_artifacts", "run_actions", "run_checkpoints", "llm_calls", "reviews", "chapter_versions"} {
			if _, e := store.pool.Exec(ctx, "DELETE FROM "+table+" WHERE run_id=$1", id); e != nil {
				t.Error(e)
			}
		}
		for _, table := range []string{"chapter_versions", "segment_versions", "runs"} {
			if _, e := store.pool.Exec(ctx, "DELETE FROM "+table+" WHERE chapter_id=$1", chapter); e != nil {
				t.Error(e)
			}
		}
		if _, e := store.pool.Exec(ctx, "DELETE FROM chapters WHERE id=$1", chapter); e != nil {
			t.Error(e)
		}
		store.Close()
	}()
	cfg := config.Config{Model: "fake", MaxCalls: 14, MaxTokens: 24000, MaxOutputTokens: 2048, CallTimeout: time.Second}
	r := app.Run{ID: id, ChapterID: chapter, BranchID: "main", Status: "running", Provider: "fake", Model: "scripted-fake", MaxCalls: 14, MaxTokens: 24000, MaxRounds: 2}
	if err = store.CreateRun(ctx, r); err != nil {
		t.Fatal(err)
	}
	state, err := app.ExecuteChapter(ctx, cfg, "no-findings", orchestration.Options{})
	if err != nil {
		t.Fatal(err)
	}
	state.Context.ChapterID = chapter
	for i := range state.Segments {
		state.Segments[i].ChapterID = chapter
	}
	state.Segments[0].Text += "待修改甲。待修改乙。"
	for i, q := range []string{"待修改甲", "待修改乙"} {
		state.Report.Findings = append(state.Report.Findings, review.Finding{ID: []string{"f1", "f2"}[i], SegmentID: state.Segments[0].ID, Quote: q, Severity: review.P2, Critic: "ai_taste", EvidenceRefs: []string{state.Segments[0].ID}, Reason: "措辞需调整", Suggestion: "换个表达", RepairScope: "phrase", DraftVersion: 1})
	}
	state.Reviews[len(state.Reviews)-1] = state.Report
	r.Result = &state
	r.DraftVersion = 1
	if err = store.SaveProgress(ctx, r, 0); err != nil {
		t.Fatal(err)
	}
	if err = app.ExecuteHuman(ctx, cfg, r, store); err != nil {
		t.Fatal(err)
	}
	original := state.Segments[0].Text
	request := func(text, quote string) *manuscript.AuthorRewrite {
		index := strings.Index(text, quote)
		start := len([]rune(text[:index]))
		return &manuscript.AuthorRewrite{SegmentID: state.Segments[0].ID, Original: text, Start: start, End: start + len([]rune(quote)), Instruction: "仅改选中问题"}
	}
	perform := func(a orchestration.HumanAction, fail bool) {
		t.Helper()
		claimed, execute, e := store.ClaimAction(ctx, id, a)
		if e != nil || !execute {
			t.Fatalf("claim: %v", e)
		}
		if fail {
			if e = app.ExecuteHuman(ctx, cfg, claimed, failCheckpoint{store}); e == nil {
				t.Fatal("expected checkpoint failure")
			}
			if e = store.StopRun(ctx, id, "interrupted", "test recovery"); e != nil {
				t.Fatal(e)
			}
			store.Close()
			store, err = Open(ctx, url)
			if err != nil {
				t.Fatal(err)
			}
			claimed, execute, e = store.ClaimAction(ctx, id, a)
			if e != nil || !execute {
				t.Fatalf("resume: %v", e)
			}
		}
		if e = app.ExecuteHuman(ctx, cfg, claimed, store); e != nil {
			t.Fatal(e)
		}
		r, e = store.GetRun(ctx, id)
		if e != nil {
			t.Fatal(e)
		}
		if _, execute, e = store.ClaimAction(ctx, id, a); e != nil || execute {
			t.Fatalf("idempotent retry: %v", e)
		}
	}
	preview := orchestration.HumanAction{ID: rand.Text(), Type: kind, DraftVersion: 1, FindingID: "f1", Rewrite: request(original, "待修改甲")}
	if kind == "propose_selection" {
		preview.FindingID = ""
		preview.Rewrite.Preview = true
	}
	perform(preview, true)
	calls, err := store.Calls(ctx, id)
	if err != nil || len(calls) != 1 {
		t.Fatalf("preview repeated writer: %d %v", len(calls), err)
	}
	if r.DraftVersion != 1 || r.Result.Segments[0].Text != original || r.Result.FindingProposal == nil {
		t.Fatal("preview changed prose")
	}
	perform(orchestration.HumanAction{ID: rand.Text(), Type: "apply_finding", DraftVersion: 1, ProposalID: preview.ID}, true)
	if r.DraftVersion != 2 || !r.Result.ReviewPending || !reflect.DeepEqual(r.Result.Report, state.Report) {
		t.Fatal("apply lost worklist or version")
	}
	perform(orchestration.HumanAction{ID: rand.Text(), Type: "edit_finding", DraftVersion: 2, FindingID: "f2", Rewrite: request(r.Result.Segments[0].Text, "待修改乙"), Text: "手动改乙"}, false)
	calls, err = store.Calls(ctx, id)
	if err != nil || len(calls) != 1 {
		t.Fatal("applying preview or manual edit invoked model")
	}
	if _, _, e := store.ClaimAction(ctx, id, orchestration.HumanAction{ID: rand.Text(), Type: "approve", DraftVersion: 3}); !errors.Is(e, app.ErrGateBlocked) {
		t.Fatalf("approved without batch review: %v", e)
	}
	perform(orchestration.HumanAction{ID: rand.Text(), Type: "review_batch", DraftVersion: 3}, false)
	calls, err = store.Calls(ctx, id)
	if err != nil || len(calls) != 3 {
		t.Fatalf("batch did not run exactly two critics: %d %v", len(calls), err)
	}
	if len(r.Result.Revisions) != 2 || r.Result.Revisions[0].FromVersion != 1 || r.Result.Revisions[0].ToVersion != 2 || r.Result.Revisions[0].Patches[0].OldText != "待修改甲" || r.Result.Revisions[1].Patches[0].NewText != "手动改乙" {
		t.Fatal("persisted diff missing or duplicated after resume and review", r.Result.Revisions)
	}
	if r.Result.ReviewPending || r.Result.Report.DraftVersion != 3 || len(r.Result.FindingChanges) != 0 {
		t.Fatal("batch gate not released")
	}
}
