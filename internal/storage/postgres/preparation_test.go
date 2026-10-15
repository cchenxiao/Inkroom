package postgres

import (
	"context"
	"crypto/rand"
	"errors"
	"inkloom/internal/agents/model"
	"inkloom/internal/app"
	"inkloom/internal/config"
	"inkloom/internal/contextassembly"
	"inkloom/internal/demo"
	"inkloom/internal/domain/memory"
	"inkloom/internal/orchestration"
	"os"
	"testing"
	"time"
)

// 一组事务检查：准备可追踪、封存不可覆盖、稿本竞争拒绝、调用预算跨阶段连续、重启不重复准备。
func TestPreparationLifecycle(t *testing.T) {
	url := os.Getenv("INKLOOM_TEST_DATABASE_URL")
	if url == "" {
		t.Skip("set INKLOOM_TEST_DATABASE_URL")
	}
	ctx := context.Background()
	s, err := Open(ctx, url)
	if err != nil {
		t.Fatal(err)
	}
	chapter := "lookup-" + rand.Text()
	id := rand.Text()
	defer func() {
		for _, q := range []string{"DELETE FROM llm_calls WHERE run_id IN(SELECT id FROM runs WHERE chapter_id=$1)", "DELETE FROM reviews WHERE run_id IN(SELECT id FROM runs WHERE chapter_id=$1)", "DELETE FROM chapter_versions WHERE chapter_id=$1", "DELETE FROM segment_versions WHERE chapter_id=$1", "DELETE FROM runs WHERE chapter_id=$1", "DELETE FROM chapters WHERE id=$1"} {
			if _, e := s.pool.Exec(ctx, q, chapter); e != nil {
				t.Error(e)
			}
		}
		s.Close()
	}()
	b, _, _ := demo.Load("no-findings")
	b.ChapterID = chapter
	in, err := contextassembly.Assemble(b, demo.PreviousChapter(), contextassembly.Options{RunID: id, Budget: 8000, ReservedOutputTokens: 2048})
	if err != nil {
		t.Fatal(err)
	}
	r := app.Run{ID: id, ChapterID: chapter, BranchID: "main", Status: "running", CurrentNode: "context_assemble", MaxCalls: 14, MaxTokens: 24000}
	if err = s.CreatePreparingRun(ctx, r, in); err != nil {
		t.Fatal(err)
	}
	if _, err = s.FrozenContext(ctx, id); !errors.Is(err, app.ErrContextMismatch) {
		t.Fatal("final input exists before ready", err)
	}
	base, err := s.PreparationInput(ctx, id)
	if err != nil || base.Manifest.Digest != in.Manifest.Digest {
		t.Fatal("base snapshot missing", err)
	}
	if err = s.SealPreparedContext(ctx, id, in); !errors.Is(err, app.ErrGateBlocked) {
		t.Fatal("sealed before ready", err)
	}
	if err = s.SaveLookup(ctx, id, memory.LookupTrace{Steps: []memory.LookupStep{}, Stop: "ready"}); err != nil {
		t.Fatal(err)
	}
	if err = s.SealPreparedContext(ctx, id, in); err != nil {
		t.Fatal(err)
	}
	if err = s.SealPreparedContext(ctx, id, in); !errors.Is(err, app.ErrGateBlocked) {
		t.Fatal("sealed twice", err)
	}
	r, err = s.GetRun(ctx, id)
	if err != nil || r.InputDigest == "" || r.Lookup.Stop != "ready" {
		t.Fatal("sealed run missing metadata", err)
	}
	history := []model.CallRecord{{Number: 1, Phase: "finished", Role: "context_assembler", Usage: model.Usage{Known: true, InputTokens: 100, OutputTokens: 10}}}
	if err = s.RecordCall(ctx, id, history[0]); err != nil {
		t.Fatal(err)
	}
	cfg := config.Config{Model: "fake", MaxCalls: 14, MaxTokens: 24000, MaxOutputTokens: 2048, CallTimeout: time.Second}
	calls := []int{}
	state, err := app.ExecuteChapter(ctx, cfg, "no-findings", orchestration.Options{FrozenInput: &in, CallHistory: history, OnModelCall: func(ctx context.Context, c model.CallRecord) error {
		calls = append(calls, c.Number)
		return s.RecordCall(ctx, id, c)
	}})
	if err != nil || len(calls) == 0 || calls[0] != 2 || state.Usage.InputTokens != 100 {
		t.Fatal("budget/history restarted", calls, state.Usage, err)
	}
	r.Result = &state
	r.DraftVersion = state.DraftVersion
	if err = s.SaveProgress(ctx, r, 0); err != nil {
		t.Fatal(err)
	}
	if err = s.StopRun(ctx, id, "completed", ""); err != nil {
		t.Fatal(err)
	}
	// 新准备期间作者改稿，旧基础不能被封存成可执行输入。
	id2 := rand.Text()
	in.Manifest.RunID = id2
	in.Manifest.BaseDraftVersion = 1
	r2 := app.Run{ID: id2, ChapterID: chapter, BranchID: "main", Status: "running", CurrentNode: "context_assemble", BaseDraftVersion: 1, DraftVersion: 1}
	if err = s.CreatePreparingRun(ctx, r2, in); err != nil {
		t.Fatal(err)
	}
	if err = s.SaveLookup(ctx, id2, memory.LookupTrace{Stop: "ready"}); err != nil {
		t.Fatal(err)
	}
	if _, err = s.EditSegment(ctx, chapter, "main", state.Segments[0].ID, 1, "作者的新正文。"); err != nil {
		t.Fatal(err)
	}
	if err = s.SealPreparedContext(ctx, id2, in); !errors.Is(err, app.ErrVersionMismatch) {
		t.Fatal("stale preparation accepted", err)
	}
	// 存在未完成模型调用的准备，重启后必须 interrupted/unknown。
	id3 := rand.Text()
	in.Manifest.RunID = id3
	in.Manifest.BaseDraftVersion = 2
	r2.ID = id3
	r2.BaseDraftVersion = 2
	r2.DraftVersion = 2
	if err = s.CreatePreparingRun(ctx, r2, in); err != nil {
		t.Fatal(err)
	}
	if err = s.RecordCall(ctx, id3, model.CallRecord{Number: 1, Phase: "started", ReservedTokens: 4000}); err != nil {
		t.Fatal(err)
	}
	s.Close()
	s, err = Open(ctx, url)
	if err != nil {
		t.Fatal(err)
	}
	saved, err := s.GetRun(ctx, id3)
	if err != nil || saved.Status != "interrupted" || saved.Usage.Known {
		t.Fatal("preparation replayed or unknown call lost", saved, err)
	}
	if _, err = s.PreparationInput(ctx, id3); err != nil {
		t.Fatal(err)
	}
}
