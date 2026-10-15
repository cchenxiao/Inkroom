package postgres

import (
	"context"
	"crypto/rand"
	"errors"
	"os"
	"strings"
	"testing"
	"time"

	"inkloom/internal/app"
	"inkloom/internal/config"
	"inkloom/internal/contextassembly"
	"inkloom/internal/demo"
	"inkloom/internal/domain/knowledge"
	"inkloom/internal/domain/manuscript"
	"inkloom/internal/domain/memory"
	"inkloom/internal/orchestration"
	"inkloom/internal/retrieval"
)

func TestKnowledgePublicationAndRetrieval(t *testing.T) {
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
	project := "knowledge-test-" + rand.Text()
	defer func() {
		_, _ = s.pool.Exec(ctx, "DELETE FROM memory_heads WHERE project_id=$1", project)
		_, _ = s.pool.Exec(ctx, "DELETE FROM memory_records WHERE project_id=$1", project)
		_, _ = s.pool.Exec(ctx, "DELETE FROM knowledge_heads WHERE project_id=$1", project)
		_, _ = s.pool.Exec(ctx, "DELETE FROM knowledge_snapshots WHERE project_id=$1", project)
	}()
	snapshot, err := demo.KnowledgeSnapshot()
	if err != nil {
		t.Fatal(err)
	}
	snapshot.ProjectID = project
	in := KnowledgePublication{Snapshot: snapshot, ExpectedVersion: 0, ConfirmFacts: true, Reason: "作者核对教学来源"}
	bad := in
	bad.ConfirmFacts = false
	if _, err = s.PublishKnowledge(ctx, bad); !errors.Is(err, app.ErrInvalidWrite) {
		t.Fatalf("confirmation missing: %v", err)
	}
	first, err := s.PublishKnowledge(ctx, in)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = s.PublishKnowledge(ctx, in); err != nil {
		t.Fatal("identical retry", err)
	}
	view := app.CurrentMemoryView()
	view.ProjectID = project
	spy := &recordingEmbedder{}
	service := retrieval.Service{Repo: s, Embedder: spy}
	session, err := service.Session(ctx, view)
	if err != nil {
		t.Fatal(err)
	}
	found, err := session.Search(ctx, view, "铜扣 父亲", 3)
	if err != nil {
		t.Fatal(err)
	}
	if len(found.Context.Hits) != 1 || found.Context.Hits[0].Record.Knowledge == nil || found.Context.Hits[0].Record.Knowledge.Digest != first.Digest {
		t.Fatalf("missing snapshot provenance: %+v", found)
	}
	for _, texts := range spy.calls {
		for _, text := range texts {
			if strings.Contains(text, "座板") || strings.Contains(text, "点亮") || strings.Contains(text, "失踪前") {
				t.Fatal("secret entered embedding")
			}
		}
	}
	b, _, _ := demo.Load("normal")
	b.ProjectID = project
	b.POVCharacterID = view.POV
	prior := demo.PreviousChapter()
	prior.ProjectID = project
	frozen, err := contextassembly.Assemble(b, prior, contextassembly.Options{RunID: "knowledge-test", Budget: 16000, ReservedOutputTokens: 2048, Memory: &found.Context})
	if err != nil {
		t.Fatal(err)
	}
	refs, _ := manuscript.ContextRefs(frozen.Bundle)
	seen := false
	for _, ref := range refs {
		if strings.Contains(string(ref.Payload), first.Digest) {
			seen = true
		}
	}
	if !seen {
		t.Fatal("manifest did not freeze knowledge provenance")
	}
	state, err := app.ExecuteChapter(ctx, config.Config{Model: "fake", CallTimeout: time.Second, MaxCalls: 14, MaxTokens: 60000, MaxOutputTokens: 2048}, "normal", orchestration.Options{FrozenInput: &frozen, MaxRounds: 2, AutoRevise: true})
	if err != nil || state.Context.Retrieval.Hits[0].Record.Knowledge.Digest != first.Digest {
		t.Fatalf("writer integration: %v", err)
	}
	next, _ := demo.KnowledgeSnapshot()
	next.ProjectID = project
	next.Version = 2
	next.Facts = next.Facts[:1]
	next.Facts[0].Version = 2
	next.Facts[0].Text = "铜扣来自沈砚父亲的旧雨衣。"
	next.Information = nil
	next.Timeline = nil
	next.Foreshadows = nil
	// 同一事实改为沈砚更晚才获知；旧运行仍使用旧目录。
	next.Information = []knowledge.InfoState{{FactID: next.Facts[0].ID, SubjectID: view.POV, State: knowledge.Known, Source: knowledge.Location{ChapterID: "ch9", SegmentID: "ch9-s2", At: memory.Moment{Chapter: 9, StoryTime: 540}}}}
	second, err := s.PublishKnowledge(ctx, KnowledgePublication{Snapshot: next, ExpectedVersion: 1, ConfirmFacts: true, Reason: "修改知情时点并撤下其他事实"})
	if err != nil {
		t.Fatal(err)
	}
	if first.Digest == second.Digest {
		t.Fatal("snapshot digest unchanged")
	}
	if _, err = s.PublishKnowledge(ctx, in); !errors.Is(err, app.ErrVersionMismatch) {
		t.Fatalf("stale publish: %v", err)
	}
	old, err := session.Search(ctx, view, "铜扣", 3)
	if err != nil || len(old.Context.Hits) != 1 || old.Context.Hits[0].Record.Version != 1 {
		t.Fatal("session followed new head", err)
	}
	fresh, err := service.Search(ctx, view, "铜扣", 3)
	if err != nil || len(fresh.Context.Hits) != 0 {
		t.Fatal("new knowledge timing not enforced", err)
	}
	catalogue, err := s.MemorySnapshot(ctx, view)
	if err != nil || len(catalogue.Records) != 1 {
		t.Fatalf("removed facts remain: %d %v", len(catalogue.Records), err)
	}
	history, err := s.GetKnowledge(ctx, project, "main", 1)
	if err != nil || history.Digest != first.Digest || len(history.Snapshot.Facts) != 4 {
		t.Fatal("old snapshot lost", err)
	}
	if err = frozen.Validate(); err != nil {
		t.Fatal("old frozen input changed", err)
	}
	// 末尾更新 head 失败，快照和来源目录必须一起回滚。
	_, err = s.pool.Exec(ctx, "ALTER TABLE knowledge_heads ADD CONSTRAINT knowledge_test_reject_v3 CHECK (project_id <> '"+project+"' OR version <> 3)")
	if err != nil {
		t.Fatal(err)
	}
	defer s.pool.Exec(ctx, "ALTER TABLE knowledge_heads DROP CONSTRAINT knowledge_test_reject_v3")
	third := next
	third.Version = 3
	if _, err = s.PublishKnowledge(ctx, KnowledgePublication{Snapshot: third, ExpectedVersion: 2, ConfirmFacts: true, Reason: "回滚探针"}); err == nil {
		t.Fatal("injected failure not triggered")
	}
	current, err := s.GetKnowledge(ctx, project, "main", 0)
	if err != nil || current.Snapshot.Version != 2 {
		t.Fatal("head advanced on rollback", err)
	}
	if _, err = s.GetKnowledge(ctx, project, "main", 3); !errors.Is(err, app.ErrNotFound) {
		t.Fatalf("failed snapshot survived: %v", err)
	}
}
