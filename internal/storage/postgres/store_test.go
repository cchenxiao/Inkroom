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
	"inkloom/internal/domain/manuscript"
	"inkloom/internal/domain/review"
	"inkloom/internal/orchestration"
)

// 单组真实数据库集成：版本竞争、原子回滚、晚到 Agent、历史和重启保留。
// 显式提供专用测试数据库；不清空数据库，只清理本测试创建的章/运行。
func TestVersionTransactionsAndRestart(t *testing.T) {
	url := os.Getenv("INKLOOM_TEST_DATABASE_URL")
	if url == "" {
		t.Skip("set INKLOOM_TEST_DATABASE_URL to run PostgreSQL integration")
	}
	ctx := context.Background()
	store, err := Open(ctx, url)
	if err != nil {
		t.Fatal(err)
	}
	chapter := "test-" + rand.Text()
	defer func() {
		for _, q := range []string{
			"DELETE FROM llm_calls WHERE run_id IN(SELECT id FROM runs WHERE chapter_id=$1)",
			"DELETE FROM reviews WHERE run_id IN(SELECT id FROM runs WHERE chapter_id=$1)",
			"DELETE FROM chapter_versions WHERE chapter_id=$1",
			"DELETE FROM segment_versions WHERE chapter_id=$1",
			"DELETE FROM runs WHERE chapter_id=$1",
			"DELETE FROM chapters WHERE id=$1",
		} {
			if _, e := store.pool.Exec(ctx, q, chapter); e != nil {
				t.Error(e)
			}
		}
		store.Close()
	}()
	r := app.Run{ID: rand.Text(), ChapterID: chapter, BranchID: "main", Status: "running", CreatedAt: time.Now()}
	if err = store.CreateRun(ctx, r); err != nil {
		t.Fatal(err)
	}
	seg := manuscript.Segment{ID: "seg-1", ChapterID: chapter, SceneID: "scene-1", BeatID: "beat-1", Version: 1, Text: "雨还在下。"}
	r.DraftVersion = 1
	r.Result = &orchestration.ChapterState{DraftVersion: 1, Segments: []manuscript.Segment{seg}, Reviews: []review.Report{{DraftVersion: 1, Findings: []review.Finding{}}}}
	if err = store.SaveProgress(ctx, r, 0); err != nil {
		t.Fatal(err)
	}
	// 同一个 expectedVersion 两次并发提交，恰好一胜一负。
	errs := make([]error, 2)
	var wg sync.WaitGroup
	for i := range errs {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			_, errs[i] = store.EditSegment(ctx, chapter, "main", "seg-1", 1, []string{"作者甲：雨停了。", "作者乙：雨更大了。"}[i])
		}(i)
	}
	wg.Wait()
	successes, conflicts := 0, 0
	for _, err := range errs {
		if err == nil {
			successes++
		} else if errors.Is(err, app.ErrVersionMismatch) {
			conflicts++
		} else {
			t.Fatal(err)
		}
	}
	if successes != 1 || conflicts != 1 {
		t.Fatalf("wins=%d conflicts=%d", successes, conflicts)
	}
	d, err := store.Draft(ctx, chapter, "main", 0)
	if err != nil {
		t.Fatal(err)
	}
	if d.DraftVersion != 2 || d.Reviewed || len(d.Findings) > 0 {
		t.Fatal("human edit did not invalidate old review")
	}
	authorText := d.Segments[0].Text
	// 迟到的 Agent 也以 v1 为基准生成了 v2，但不得覆盖作者的 v2。
	r.Result.DraftVersion = 2
	r.DraftVersion = 2
	r.Result.Segments[0].Version = 2
	r.Result.Segments[0].Text = "迟到的 AI。"
	if err = store.SaveProgress(ctx, r, 1); !errors.Is(err, app.ErrVersionMismatch) {
		t.Fatalf("late agent accepted: %v", err)
	}
	old, err := store.Draft(ctx, chapter, "main", 1)
	if err != nil || old.Segments[0].Text != "雨还在下。" {
		t.Fatal("old manuscript overwritten")
	}
	// 新 run 用 v2 启动；坏段版本不能提前占用 v3（事务整体回滚）。
	next := app.Run{ID: rand.Text(), ChapterID: chapter, BranchID: "main", Status: "running", BaseDraftVersion: 2, DraftVersion: 2}
	if err = store.CreateRun(ctx, next); err != nil {
		t.Fatal(err)
	}
	bad := d.Segments[0]
	bad.Text = "给旧段版本贴新内容" // version 仍为 2
	next.Result = &orchestration.ChapterState{DraftVersion: 3, Segments: []manuscript.Segment{bad}}
	if err = store.SaveProgress(ctx, next, 2); !errors.Is(err, app.ErrInvalidWrite) {
		t.Fatalf("version reuse accepted: %v", err)
	}
	versions, err := store.Versions(ctx, chapter, "main")
	if err != nil || len(versions) != 2 {
		t.Fatal("invalid transaction left partial history")
	}
	if err = store.RecordCall(ctx, next.ID, model.CallRecord{Number: 1, Role: "writer", Phase: "started"}); err != nil {
		t.Fatal(err)
	}
	store.Close()
	store, err = Open(ctx, url)
	if err != nil {
		t.Fatal(err)
	}
	d, err = store.Draft(ctx, chapter, "main", 0)
	if err != nil || d.DraftVersion != 2 || d.Segments[0].Text != authorText {
		t.Fatal("restart lost author draft")
	}
	recovered, err := store.GetRun(ctx, next.ID)
	if err != nil || recovered.Status != "interrupted" || recovered.Usage.Known {
		t.Fatal("orphan run not marked interrupted")
	}
	calls, err := store.Calls(ctx, next.ID)
	if err != nil || len(calls) != 1 || calls[0].Phase != "unknown" {
		t.Fatal("interrupted model call was reported as complete")
	}
}
