package postgres

import (
	"context"
	"crypto/rand"
	"os"
	"strings"
	"testing"
	"time"

	"inkloom/internal/app"
	"inkloom/internal/config"
	"inkloom/internal/contextassembly"
	"inkloom/internal/demo"
	"inkloom/internal/domain/memory"
	"inkloom/internal/embedding"
	"inkloom/internal/orchestration"
	"inkloom/internal/retrieval"
)

type recordingEmbedder struct{ calls [][]string }

func (e *recordingEmbedder) ID() string { return embedding.Fake{}.ID() }
func (e *recordingEmbedder) Embed(ctx context.Context, texts []string) ([][]float32, error) {
	e.calls = append(e.calls, append([]string{}, texts...))
	return embedding.Fake{}.Embed(ctx, texts)
}

// 一组真实 PG/pgvector 检查：版本目录→过滤→向量缓存→排序→冻结→Writer。
func TestMemoryRetrieval(t *testing.T) {
	url := os.Getenv("INKLOOM_TEST_DATABASE_URL")
	if url == "" {
		t.Skip("set INKLOOM_TEST_DATABASE_URL")
	}
	ctx := context.Background()
	s, err := Open(ctx, url)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	project := "memory-test-" + rand.Text()
	defer func() {
		_, _ = s.pool.Exec(ctx, "DELETE FROM memory_heads WHERE project_id=$1", project)
		_, _ = s.pool.Exec(ctx, "DELETE FROM memory_records WHERE project_id=$1", project)
	}()
	records, err := demo.MemorySeed()
	if err != nil {
		t.Fatal(err)
	}
	for i := range records {
		records[i].ProjectID = project
	}
	if err = s.SeedMemory(ctx, records); err != nil {
		t.Fatal(err)
	}
	if err = s.SeedMemory(ctx, records); err != nil {
		t.Fatal("seed retry", err)
	}
	view := app.CurrentMemoryView()
	view.ProjectID = project
	spy := &recordingEmbedder{}
	search := retrieval.Service{Repo: s, Embedder: spy}
	result, err := search.Search(ctx, view, "铜扣 旧外套", 3)
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Context.Hits) != 3 || result.Context.Hits[0].Record.ID != "seed-copper" || result.Context.Mode != "hybrid_fake" {
		t.Fatalf("ranking: %+v", result)
	}
	for _, call := range spy.calls {
		for _, text := range call {
			if strings.Contains(text, "座板") || strings.Contains(text, "第十章") || strings.Contains(text, "试写分支") {
				t.Fatal("invisible material reached embedder")
			}
		}
	}
	before := len(spy.calls)
	if _, err = search.Search(ctx, view, "铜扣 旧外套", 3); err != nil {
		t.Fatal(err)
	}
	if len(spy.calls) != before+1 || len(spy.calls[len(spy.calls)-1]) != 1 {
		t.Fatal("source vectors not cached")
	}
	b, _, err := demo.Load("normal")
	if err != nil {
		t.Fatal(err)
	}
	b.ProjectID = project
	b.POVCharacterID = view.POV
	prior := demo.PreviousChapter()
	prior.ProjectID = project
	opts := contextassembly.Options{RunID: "test", Budget: 8000, ReservedOutputTokens: 2048, Memory: &result.Context}
	frozen, err := contextassembly.Assemble(b, prior, opts)
	if err != nil {
		t.Fatal(err)
	}
	if err = frozen.Validate(); err != nil {
		t.Fatal(err)
	}
	cfg := config.Config{Model: "fake", CallTimeout: time.Second, MaxCalls: 14, MaxTokens: 40000, MaxOutputTokens: 2048}
	state, err := app.ExecuteChapter(ctx, cfg, "normal", orchestration.Options{FrozenInput: &frozen, MaxRounds: 2, AutoRevise: true})
	if err != nil {
		t.Fatal(err)
	}
	if state.Context.Retrieval == nil || state.Context.Retrieval.Hits[0].Record.ID != "seed-copper" {
		t.Fatal("retrieval did not reach Writer pipeline")
	}
	opts.Budget = frozen.Manifest.TokenEstimate - 1
	trimmed, err := contextassembly.Assemble(b, prior, opts)
	if err != nil {
		t.Fatal(err)
	}
	if len(trimmed.Bundle.Retrieval.Hits) >= len(result.Context.Hits) || len(trimmed.Manifest.Excluded) == 0 {
		t.Fatal("optional memory was not trimmed")
	}
	for _, r := range records {
		if r.ID == "seed-copper" {
			r.Version = 2
			r.Text = "铜扣被作者修订为来自父亲的雨衣。"
			if err = s.putMemory(ctx, r, "teaching_seed", "", 1); err != nil {
				t.Fatal(err)
			}
			r.Version = 3
			if err = s.putMemory(ctx, r, "teaching_seed", "", 1); err != app.ErrVersionMismatch {
				t.Fatal("old publication overwrote head", err)
			}
		}
	}
	updated, err := search.Search(ctx, view, "铜扣", 3)
	if err != nil {
		t.Fatal(err)
	}
	found := false
	for _, h := range updated.Context.Hits {
		if h.Record.ID == "seed-copper" {
			found = h.Record.Version == 2
		}
	}
	if !found || frozen.Bundle.Retrieval.Hits[0].Record.Version != 1 {
		t.Fatal("versions mixed or frozen run mutated")
	}
	// 当前新索引可以继续更新；已冻结输入不随 head 改变。
	if err = frozen.Validate(); err != nil {
		t.Fatal(err)
	}
}

// 复用 I9 已完成真实审批的提交，验证正文出处不能靠客户端伪造。
func verifyCommitPublication(t *testing.T, s *Store, c app.FinalCommit) {
	t.Helper()
	ctx := context.Background()
	seg := c.Segments[0]
	r := memory.Record{ProjectID: c.ProjectID, BranchID: c.BranchID, Version: 1, Kind: memory.Passage, Status: memory.Confirmed, ChapterID: c.ChapterID, SegmentID: seg.ID, At: &memory.Moment{Chapter: 2, StoryTime: 120}, KnownBy: []memory.Knowledge{{CharacterID: "character-shenyan", Since: &memory.Moment{Chapter: 2, StoryTime: 120}}}}
	in := MemoryPublication{CommitID: c.ID, Record: r}
	in.Record.Text = "不是原来的定稿正文"
	if err := s.PublishMemory(ctx, in); err != app.ErrInvalidWrite {
		t.Fatal("forged source accepted", err)
	}
	in.Record.Text = ""
	in.Record.Kind = memory.Fact
	if err := s.PublishMemory(ctx, in); err != app.ErrInvalidWrite {
		t.Fatal("passage promoted to world fact", err)
	}
	in.Record.Kind = memory.Passage
	if err := s.PublishMemory(ctx, in); err != nil {
		t.Fatal(err)
	}
	if err := s.PublishMemory(ctx, in); err != nil {
		t.Fatal("publication retry", err)
	}
	id := c.ID + "/" + seg.ID
	defer func() {
		_, _ = s.pool.Exec(ctx, "DELETE FROM memory_heads WHERE id=$1", id)
		_, _ = s.pool.Exec(ctx, "DELETE FROM memory_records WHERE id=$1", id)
	}()
	snapshot, err := s.MemorySnapshot(ctx, app.CurrentMemoryView())
	if err != nil {
		t.Fatal(err)
	}
	found := false
	for _, record := range snapshot.Records {
		if record.ID == id {
			found = record.Text == seg.Text && snapshot.Origins[id].CommitID == c.ID && record.Kind == memory.Passage
		}
	}
	if !found {
		t.Fatal("commit-backed passage missing")
	}
}
