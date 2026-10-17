package postgres

import (
	"context"
	"crypto/rand"
	"encoding/json"
	"errors"
	"os"
	"reflect"
	"testing"
	"time"

	"inkloom/internal/app"
	"inkloom/internal/config"
	"inkloom/internal/contextassembly"
	"inkloom/internal/demo"
	"inkloom/internal/domain/review"
	"inkloom/internal/orchestration"
)

// 一组真实事务验证：冻结输入 → 自动评审 → 人审 → 定稿，及关键拒绝/回滚窗口。
func TestFinalCommitFreezesMatchingVersions(t *testing.T) {
	t.Run("clear", func(t *testing.T) { testFinalCommitFreezesMatchingVersions(t, false) })
	t.Run("author_decision", func(t *testing.T) { testFinalCommitFreezesMatchingVersions(t, true) })
}
func testFinalCommitFreezesMatchingVersions(t *testing.T, withDecision bool) {
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
	chapter := "commit-test-" + id
	defer func() {
		for _, q := range []string{
			"DELETE FROM manuscript_commits WHERE run_id=$1", "DELETE FROM run_artifacts WHERE run_id=$1", "DELETE FROM run_actions WHERE run_id=$1", "DELETE FROM run_checkpoints WHERE run_id=$1", "DELETE FROM llm_calls WHERE run_id=$1", "DELETE FROM reviews WHERE run_id=$1", "DELETE FROM chapter_versions WHERE run_id=$1",
		} {
			if _, e := s.pool.Exec(ctx, q, id); e != nil {
				t.Error(e)
			}
		}
		for _, q := range []string{"DELETE FROM chapter_versions WHERE chapter_id=$1", "DELETE FROM segment_versions WHERE chapter_id=$1", "DELETE FROM runs WHERE chapter_id=$1", "DELETE FROM chapters WHERE id=$1"} {
			if _, e := s.pool.Exec(ctx, q, chapter); e != nil {
				t.Error(e)
			}
		}
		s.Close()
	}()
	b, _, err := demo.Load("no-findings")
	if err != nil {
		t.Fatal(err)
	}
	b.ChapterID = chapter
	frozen, err := contextassembly.Assemble(b, demo.PreviousChapter(), contextassembly.Options{RunID: id, Budget: 8000, ReservedOutputTokens: 2048})
	if err != nil {
		t.Fatal(err)
	}
	cfg := config.Config{Model: "fake", MaxCalls: 14, MaxTokens: 24000, MaxOutputTokens: 2048, CallTimeout: time.Second}
	r := app.Run{ID: id, ChapterID: chapter, BranchID: "main", Status: "running", Provider: "fake", Model: "scripted-fake", MaxCalls: 14, MaxTokens: 24000, MaxRounds: 2}
	if err = s.CreatePreparedRun(ctx, r, frozen); err != nil {
		t.Fatal(err)
	}
	r, err = s.GetRun(ctx, id)
	if err != nil {
		t.Fatal(err)
	}
	pinned, err := s.FrozenContext(ctx, id)
	if err != nil || pinned.Manifest.Digest != r.InputDigest {
		t.Fatal("input not persisted before execution", err)
	}
	state, err := app.ExecuteChapter(ctx, cfg, "no-findings", orchestration.Options{FrozenInput: &pinned, MaxRounds: 2})
	if err != nil {
		t.Fatal(err)
	}
	if withDecision {
		state.Report.Findings = append(state.Report.Findings, review.Finding{ID: "author-dialogue", SegmentID: state.Segments[0].ID, Quote: state.Segments[0].Text, Severity: review.P3, RequiresHuman: true, PossibleDialogueLie: true, Critic: "hard_consistency", Reason: "台词是否故意隐瞒", Suggestion: "请作者判断", RepairScope: "segment", EvidenceStatus: "uncertain", EvidenceRefs: []string{}})
		state.Reviews[len(state.Reviews)-1] = state.Report
	}
	r.Result = &state
	r.DraftVersion = state.DraftVersion
	before, _ := s.GetRun(ctx, id)
	savedPOV := state.Context.POV
	state.Context.POV = "changed"
	if err = s.SaveProgress(ctx, r, 0); !errors.Is(err, app.ErrContextMismatch) {
		t.Fatal("mixed context accepted", err)
	}
	after, _ := s.GetRun(ctx, id)
	if after.EventSequence != before.EventSequence {
		t.Fatal("rejected context emitted event")
	}
	state.Context.POV = savedPOV
	if err = s.SaveProgress(ctx, r, 0); err != nil {
		t.Fatal(err)
	}
	if err = app.ExecuteHuman(ctx, cfg, r, s); err != nil {
		t.Fatal(err)
	}
	input := app.FinalizeInput{ID: rand.Text(), DraftVersion: 1, InputDigest: pinned.Manifest.Digest, FactsConfirmed: true}
	if _, err = s.Finalize(ctx, id, input); !errors.Is(err, app.ErrGateBlocked) {
		t.Fatal("unapproved commit accepted", err)
	}
	if withDecision {
		action := orchestration.HumanAction{ID: rand.Text(), Type: "finding_decision", DraftVersion: 1, FindingID: "author-dialogue", Decision: "keep", Instruction: "此处是人物故意隐瞒，并非既定事实"}
		claimed, execute, e := s.ClaimAction(ctx, id, action)
		if e != nil || !execute {
			t.Fatalf("claim author decision: %v", e)
		}
		if e = app.ExecuteHuman(ctx, cfg, claimed, s); e != nil {
			t.Fatal(e)
		}
	}
	a := orchestration.HumanAction{ID: rand.Text(), Type: "approve", DraftVersion: 1}
	r, execute, err := s.ClaimAction(ctx, id, a)
	if err != nil || !execute {
		t.Fatal(err)
	}
	if err = app.ExecuteHuman(ctx, cfg, r, s); err != nil {
		t.Fatal(err)
	}
	input.FactsConfirmed = false
	if _, err = s.Finalize(ctx, id, input); !errors.Is(err, app.ErrFactsUnconfirmed) {
		t.Fatal("missing author fact check accepted", err)
	}
	input.FactsConfirmed = true
	wrong := input
	wrong.InputDigest = "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff"
	if _, err = s.Finalize(ctx, id, wrong); !errors.Is(err, app.ErrContextMismatch) {
		t.Fatal("wrong basis accepted", err)
	}
	// 在 commit 主记录插入后、refs 写入时制造失败，验证整次提交与事件都回滚。
	constraint := "i9_injected_failure"
	if _, err = s.pool.Exec(ctx, "ALTER TABLE commit_refs ADD CONSTRAINT "+constraint+" CHECK (commit_id <> '"+input.ID+"')"); err != nil {
		t.Fatal(err)
	}
	before, _ = s.GetRun(ctx, id)
	_, injected := s.Finalize(ctx, id, input)
	if _, err = s.pool.Exec(ctx, "ALTER TABLE commit_refs DROP CONSTRAINT "+constraint); err != nil {
		t.Fatal(err)
	}
	if injected == nil {
		t.Fatal("expected injected ref failure")
	}
	after, _ = s.GetRun(ctx, id)
	if after.Status != "approved" || after.EventSequence != before.EventSequence {
		t.Fatal("partial finalization survived rollback")
	}
	if _, err = s.GetCommit(ctx, input.ID); !errors.Is(err, app.ErrNotFound) {
		t.Fatal("partial commit survived rollback", err)
	}
	commit, err := s.Finalize(ctx, id, input)
	if err != nil {
		t.Fatal(err)
	}
	verifyCommitPublication(t, s, commit)
	if commit.ApprovalActionID != a.ID || commit.InputDigest != pinned.Manifest.Digest || commit.DraftVersion != 1 || !commit.FactConfirmation.NoPendingFacts {
		t.Fatal("commit does not match approval/context")
	}
	var refs int
	if err = s.pool.QueryRow(ctx, "SELECT count(*) FROM commit_refs WHERE commit_id=$1", commit.ID).Scan(&refs); err != nil || refs != len(commit.Refs) {
		t.Fatal("missing frozen refs", err)
	}
	for _, kind := range []string{"outline", "character", "bible_fact", "previous_ending", "style_policy", "manuscript", "review"} {
		found := false
		for _, ref := range commit.Refs {
			if ref.Kind == kind {
				found = true
			}
		}
		if !found {
			t.Fatal("missing", kind)
		}
	}
	r, err = s.GetRun(ctx, id)
	if err != nil || r.Status != "committed" || r.CommitID != commit.ID {
		t.Fatal("run not finalized", err)
	}
	events, err := s.Events(ctx, id, before.EventSequence)
	if err != nil || len(events.Events) != 2 || events.Events[1].Type != "commit.created" {
		t.Fatal("commit and events not atomic", err)
	}
	original, _ := json.Marshal(commit)
	if _, err = s.EditSegment(ctx, chapter, "main", state.Segments[0].ID, 1, "作者继续写了一个新版本。"); err != nil {
		t.Fatal(err)
	}
	s.Close()
	s, err = Open(ctx, url)
	if err != nil {
		t.Fatal(err)
	}
	historical, err := s.GetCommit(ctx, input.ID)
	if err != nil {
		t.Fatal(err)
	}
	got, _ := json.Marshal(historical)
	// JSONB 对 RawMessage 内字段顺序会规范化，所以比较语义而不是字节排列。
	var aJSON, bJSON any
	_ = json.Unmarshal(original, &aJSON)
	_ = json.Unmarshal(got, &bJSON)
	if !reflect.DeepEqual(aJSON, bJSON) {
		t.Fatal("final snapshot changed after edit/restart")
	}
	again, err := s.Finalize(ctx, id, input)
	if err != nil || again.ID != commit.ID {
		t.Fatal("retry did not reuse immutable commit", err)
	}
	different := input
	different.DraftVersion = 2
	if _, err = s.Finalize(ctx, id, different); !errors.Is(err, app.ErrActionMismatch) {
		t.Fatal("idempotency key reused for new version", err)
	}
	list, err := s.Commits(ctx, chapter, "main")
	if err != nil || len(list) != 1 {
		t.Fatal("duplicate final commit", err)
	}
}
