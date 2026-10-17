package postgres

import (
	"context"
	"crypto/rand"
	"errors"
	"os"
	"sync"
	"testing"
	"time"

	"inkloom/internal/agents/model"
	"inkloom/internal/app"
)

// 一组覆盖事务回滚、并行序号、outbox 重投和保留边界，不调用真实模型。
func TestEventTransactionsAndReplay(t *testing.T) {
	url := os.Getenv("INKLOOM_TEST_DATABASE_URL")
	if url == "" {
		t.Skip("set INKLOOM_TEST_DATABASE_URL")
	}
	ctx := context.Background()
	s, err := Open(ctx, url)
	if err != nil {
		t.Fatal(err)
	}
	id := rand.Text()
	chapter := "event-test-" + id
	defer func() {
		s.pool.Exec(ctx, "DELETE FROM llm_calls WHERE run_id=$1", id)
		s.pool.Exec(ctx, "DELETE FROM runs WHERE id=$1", id)
		s.pool.Exec(ctx, "DELETE FROM chapters WHERE id=$1", chapter)
		s.Close()
	}()
	r := app.Run{ID: id, ChapterID: chapter, BranchID: "main", Status: "running"}
	if err = s.CreateRun(ctx, r); err != nil {
		t.Fatal(err)
	}
	// 已写入业务和事件，但事务未提交：外部看不到，回滚后二者均不留痕。
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	r.CurrentNode = "rollback-only"
	if err = saveRun(ctx, tx, r); err != nil {
		t.Fatal(err)
	}
	p, err := s.Events(ctx, id, 0)
	if err != nil || p.Head != 1 || len(p.Events) != 1 {
		t.Fatalf("uncommitted event visible: %+v %v", p, err)
	}
	if err = tx.Rollback(ctx); err != nil {
		t.Fatal(err)
	}
	actual, err := s.GetRun(ctx, id)
	if err != nil || actual.CurrentNode != "" || actual.EventSequence != 1 {
		t.Fatalf("rollback failed: %+v %v", actual, err)
	}
	// 并行 Critic 记账：序号连续且每个事件包含同版快照。
	var wg sync.WaitGroup
	errs := make(chan error, 12)
	for i := 1; i <= 12; i++ {
		wg.Add(1)
		go func(n int) {
			defer wg.Done()
			errs <- s.RecordCall(ctx, id, model.CallRecord{Number: n, Phase: "finished", Usage: model.Usage{Known: true, InputTokens: 1}})
		}(i)
	}
	wg.Wait()
	close(errs)
	for err := range errs {
		if err != nil {
			t.Fatal(err)
		}
	}
	p, err = s.Events(ctx, id, 0)
	if err != nil || p.Head != 13 || len(p.Events) != 13 {
		t.Fatalf("bad history %d %d %v", p.Head, len(p.Events), err)
	}
	for i, e := range p.Events {
		if e.Sequence != int64(i+1) || e.Run.EventSequence != e.Sequence {
			t.Fatal("noncontiguous events")
		}
	}
	tail, err := s.Events(ctx, id, 7)
	if err != nil || len(tail.Events) != 6 || tail.Events[0].Sequence != 8 {
		t.Fatal("replay lost tail", err)
	}
	if err = s.PruneEvents(ctx, id, 7); !errors.Is(err, app.ErrRunBusy) {
		t.Fatal("pruned undelivered events", err)
	}
	first, err := s.PendingEvents(ctx)
	if err != nil {
		t.Fatal(err)
	}
	again, err := s.PendingEvents(ctx)
	if err != nil || len(first) != len(again) {
		t.Fatal("reading outbox consumed events")
	}
	for _, e := range first {
		if e.RunID == id {
			if err = s.DeliverEvent(ctx, e.ID); err != nil {
				t.Fatal(err)
			}
		}
	}
	if err = s.PruneEvents(ctx, id, 7); err != nil {
		t.Fatal(err)
	}
	if _, err = s.Events(ctx, id, 6); !errors.Is(err, app.ErrCursorExpired) {
		t.Fatal("expired cursor not rejected", err)
	}
	if _, err = s.Events(ctx, id, 14); !errors.Is(err, app.ErrInvalidCursor) {
		t.Fatal("future cursor accepted", err)
	}
	tail, err = s.Events(ctx, id, 7)
	if err != nil || len(tail.Events) != 6 {
		t.Fatal("retention boundary failed", err)
	}
	latest, err := s.GetRun(ctx, id)
	if err != nil || latest.EventSequence != 13 || latest.Tokens != 12 {
		t.Fatal("snapshot/cursor mismatch", err)
	}
}

func TestActiveCheckProgressSurvivesSnapshotAndReplay(t *testing.T) {
	url := os.Getenv("INKLOOM_TEST_DATABASE_URL")
	if url == "" {
		t.Skip("set INKLOOM_TEST_DATABASE_URL")
	}
	ctx := context.Background()
	s, err := Open(ctx, url)
	if err != nil {
		t.Fatal(err)
	}
	id := rand.Text()
	chapter := "progress-test-" + id
	defer func() {
		s.pool.Exec(ctx, "DELETE FROM llm_calls WHERE run_id=$1", id)
		s.pool.Exec(ctx, "DELETE FROM runs WHERE id=$1", id)
		s.pool.Exec(ctx, "DELETE FROM chapters WHERE id=$1", chapter)
		s.Close()
	}()
	if err = s.CreateRun(ctx, app.Run{ID: id, ChapterID: chapter, BranchID: "main", Status: "running"}); err != nil {
		t.Fatal(err)
	}
	start := time.Now().UTC().Truncate(time.Millisecond).Add(-80 * time.Second)
	call := model.CallRecord{Number: 1, Role: "hard_consistency", Phase: "started", StartedAt: start, TimeoutMs: 90000, Activity: "continuity_objects"}
	if err = s.RecordCall(ctx, id, call); err != nil {
		t.Fatal(err)
	}
	second := call
	second.Number = 2
	second.Activity = "continuity_characters"
	if err = s.RecordCall(ctx, id, second); err != nil {
		t.Fatal(err)
	}
	snapshot, err := s.GetRun(ctx, id)
	if err != nil || len(snapshot.ActiveCalls) != 2 || !snapshot.ActiveCalls[0].StartedAt.Equal(start) {
		t.Fatal(snapshot.ActiveCalls, err)
	}
	call.Phase = "finished"
	if err = s.RecordCall(ctx, id, call); err != nil {
		t.Fatal(err)
	}
	snapshot, err = s.GetRun(ctx, id)
	if err != nil || len(snapshot.ActiveCalls) != 1 || snapshot.ActiveCalls[0].Number != 2 {
		t.Fatal(snapshot.ActiveCalls, err)
	}
	page, err := s.Events(ctx, id, 0)
	if err != nil {
		t.Fatal(err)
	}
	last := page.Events[len(page.Events)-1].Run
	if len(last.ActiveCalls) != 1 || !last.ActiveCalls[0].StartedAt.Equal(start) || last.ActiveCalls[0].Activity != "continuity_characters" {
		t.Fatal(last.ActiveCalls)
	}
}
