package postgres

import (
	"context"
	"crypto/rand"
	"errors"
	"os"
	"testing"
	"time"

	"inkloom/internal/agents/model"
	"inkloom/internal/app"
	"inkloom/internal/config"
	"inkloom/internal/orchestration"
)

// 故障窗口：正文/复检产物已提交，但新 checkpoint 还没保存。
type failCheckpoint struct{ app.HumanRepository }

func (f failCheckpoint) SaveCheckpoint(context.Context, string, []byte, orchestration.ChapterState, string) error {
	return errors.New("injected checkpoint failure")
}

func TestHumanCheckpointRecovery(t *testing.T) {
	url := os.Getenv("INKLOOM_TEST_DATABASE_URL")
	if url == "" {
		t.Skip("set INKLOOM_TEST_DATABASE_URL")
	}
	ctx := context.Background()
	store, err := Open(ctx, url)
	if err != nil {
		t.Fatal(err)
	}
	chapter := "human-test-" + rand.Text()
	id := rand.Text()
	defer func() {
		for _, table := range []string{"run_artifacts", "run_actions", "run_checkpoints", "llm_calls", "reviews", "chapter_versions"} {
			if _, e := store.pool.Exec(ctx, "DELETE FROM "+table+" WHERE run_id=$1", id); e != nil {
				t.Error(e)
			}
		}
		for _, q := range []string{"DELETE FROM chapter_versions WHERE chapter_id=$1", "DELETE FROM segment_versions WHERE chapter_id=$1", "DELETE FROM runs WHERE chapter_id=$1", "DELETE FROM chapters WHERE id=$1"} {
			if _, e := store.pool.Exec(ctx, q, chapter); e != nil {
				t.Error(e)
			}
		}
		store.Close()
	}()
	cfg := config.Config{Model: "fake", MaxCalls: 14, MaxTokens: 24000, MaxOutputTokens: 2048, CallTimeout: time.Second}
	r := app.Run{ID: id, ChapterID: chapter, BranchID: "main", Status: "running", Provider: "fake", Model: "scripted-fake", MaxCalls: 14, MaxTokens: 24000, MaxRounds: 2}
	if err = store.CreateRun(ctx, r); err != nil {
		t.Fatal(err)
	}
	state, err := app.ExecuteChapter(ctx, cfg, "normal", orchestration.Options{MaxRounds: 2, OnModelCall: func(ctx context.Context, c model.CallRecord) error { return store.RecordCall(ctx, id, c) }})
	if err != nil {
		t.Fatal(err)
	}
	state.Context.ChapterID = chapter
	for i := range state.Segments {
		state.Segments[i].ChapterID = chapter
	}
	r.Result = &state
	r.DraftVersion = 1
	if err = store.SaveProgress(ctx, r, 0); err != nil {
		t.Fatal(err)
	}
	if err = app.ExecuteHuman(ctx, cfg, r, store); err != nil {
		t.Fatal(err)
	}
	store.Close()
	store, err = Open(ctx, url)
	if err != nil {
		t.Fatal(err)
	}
	r, err = store.GetRun(ctx, id)
	if err != nil || r.Status != "waiting_human" || !r.CanResume {
		t.Fatalf("waiting checkpoint lost: %v", err)
	}
	if _, _, err = store.ClaimAction(ctx, id, orchestration.HumanAction{ID: rand.Text(), Type: "approve", DraftVersion: 1}); !errors.Is(err, app.ErrGateBlocked) {
		t.Fatalf("blocked approval accepted: %v", err)
	}
	a := orchestration.HumanAction{ID: rand.Text(), Type: "instruct", DraftVersion: 1, Instruction: "删掉套话，保留事件结果"}
	r, execute, err := store.ClaimAction(ctx, id, a)
	if err != nil || !execute {
		t.Fatal(err)
	}
	if err = app.ExecuteHuman(ctx, cfg, r, failCheckpoint{store}); err == nil {
		t.Fatal("fault did not trigger")
	}
	d, err := store.Draft(ctx, chapter, "main", 0)
	if err != nil || d.DraftVersion != 2 || !d.Reviewed {
		t.Fatalf("artifacts were not saved before fault: v%d %v", d.DraftVersion, err)
	}
	callsBefore, err := store.Calls(ctx, id)
	if err != nil {
		t.Fatal(err)
	}
	store.Close()
	store, err = Open(ctx, url)
	if err != nil {
		t.Fatal(err)
	}
	r, err = store.GetRun(ctx, id)
	if err != nil || r.Status != "interrupted" || r.PendingAction == nil {
		t.Fatal("pending action not recoverable")
	}
	r, execute, err = store.ClaimAction(ctx, id, a)
	if err != nil || !execute {
		t.Fatal(err)
	}
	if err = app.ExecuteHuman(ctx, cfg, r, store); err != nil {
		t.Fatal(err)
	}
	callsAfter, err := store.Calls(ctx, id)
	if err != nil || len(callsAfter) != len(callsBefore) {
		t.Fatal("resume repeated model calls")
	}
	r, err = store.GetRun(ctx, id)
	if err != nil || r.Status != "waiting_human" || r.DraftVersion != 2 || r.ApprovalBlock != "" {
		t.Fatalf("recovery failed: status=%s v%d %v", r.Status, r.DraftVersion, err)
	}
	if _, execute, err = store.ClaimAction(ctx, id, a); err != nil || execute {
		t.Fatal("duplicate action executed again")
	}
	bad := a
	bad.Instruction = "different"
	if _, _, err = store.ClaimAction(ctx, id, bad); !errors.Is(err, app.ErrActionMismatch) {
		t.Fatal("same key accepted different content")
	}
	inline := orchestration.HumanAction{ID: rand.Text(), Type: "inline_edit", DraftVersion: 2, SegmentID: r.Result.Segments[0].ID, Text: r.Result.Segments[0].Text + "雨停了。"}
	r, _, err = store.ClaimAction(ctx, id, inline)
	if err != nil {
		t.Fatal(err)
	}
	if err = app.ExecuteHuman(ctx, cfg, r, store); err != nil {
		t.Fatal(err)
	}
	r, err = store.GetRun(ctx, id)
	if err != nil || r.DraftVersion != 3 || r.ApprovalBlock != "" {
		t.Fatal("inline edit was not rechecked")
	}
	// 恢复预算来自所有历史调用，而不是每次 resume 重新发一份额度。
	history, e := store.Calls(ctx, id)
	if e != nil {
		t.Fatal(e)
	}
	guard := model.NewGuard(nil, model.Limits{History: history, Calls: len(history), Tokens: 24000})
	input := model.Input{SystemPrompt: "system", UserPrompt: "user", PromptVersion: "test.v1"}
	if _, _, e = guard.Generate(ctx, input); !errors.Is(e, model.ErrBudgetExhausted) {
		t.Fatal("resume reset call budget")
	}
	unknown := model.NewGuard(nil, model.Limits{Calls: 20, Tokens: 100, History: []model.CallRecord{{Number: 1, Phase: "unknown", ReservedTokens: 100}}})
	if _, _, e = unknown.Generate(ctx, input); !errors.Is(e, model.ErrBudgetExhausted) {
		t.Fatal("unknown usage lost budget reservation")
	}
	approval := orchestration.HumanAction{ID: rand.Text(), Type: "approve", DraftVersion: 3}
	r, _, err = store.ClaimAction(ctx, id, approval)
	if err != nil {
		t.Fatal(err)
	}
	if err = app.ExecuteHuman(ctx, cfg, r, store); err != nil {
		t.Fatal(err)
	}
	r, err = store.GetRun(ctx, id)
	if err != nil || r.Status != "approved" || r.CurrentNode != "human_gate" {
		t.Fatal("approval did not complete")
	}
	if _, err = store.EditSegment(ctx, chapter, "main", state.Segments[0].ID, 3, d.Segments[0].Text+"风也停了。"); err != nil {
		t.Fatal(err)
	}
	if _, _, err = store.ClaimAction(ctx, id, orchestration.HumanAction{ID: rand.Text(), Type: "approve", DraftVersion: 3}); !errors.Is(err, app.ErrVersionMismatch) {
		t.Fatal("stale approval accepted")
	}
}
