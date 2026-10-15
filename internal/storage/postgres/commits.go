package postgres

import (
	"context"
	"encoding/json"
	"errors"
	"reflect"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"inkloom/internal/app"
	"inkloom/internal/domain/manuscript"
	"inkloom/internal/domain/review"
	"inkloom/internal/orchestration"
)

var _ app.FinalRepository = (*Store)(nil)

// Finalize 固定章→run 锁顺序，与直改/审批共用边界。正文、设定引用、run、事件一起提交。
func (s *Store) Finalize(ctx context.Context, id string, in app.FinalizeInput) (app.FinalCommit, error) {
	if in.ID == "" || len(in.ID) > 100 || in.DraftVersion < 1 || len(in.InputDigest) != 64 {
		return app.FinalCommit{}, app.ErrInvalidWrite
	}
	if !in.FactsConfirmed {
		return app.FinalCommit{}, app.ErrFactsUnconfirmed
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return app.FinalCommit{}, err
	}
	defer tx.Rollback(context.Background())
	// 重试原请求只读历史回执，即使之后又改稿，也不会重新批准/提交旧版本。
	if c, ok, e := existingCommit(ctx, tx, id, in); ok || e != nil {
		return c, e
	}
	r, err := lockHuman(ctx, tx, id)
	if err != nil {
		return app.FinalCommit{}, err
	}
	// 并发相同请求可能刚等完行锁；再查一次幂等键。
	if c, ok, e := existingCommit(ctx, tx, id, in); ok || e != nil {
		return c, e
	}
	if r.DraftVersion != in.DraftVersion {
		return app.FinalCommit{}, app.ErrVersionMismatch
	}
	if r.Status != "approved" || r.PendingAction != nil || r.Result == nil || orchestration.ApprovalReason(*r.Result) != "" {
		return app.FinalCommit{}, app.ErrGateBlocked
	}
	frozen, err := frozenContext(ctx, tx, id)
	if err != nil {
		return app.FinalCommit{}, err
	}
	digest, err := manuscript.ContentDigest(r.Result.Context)
	if err != nil {
		return app.FinalCommit{}, err
	}
	if digest != in.InputDigest || r.InputDigest != in.InputDigest || frozen.Manifest.Digest != in.InputDigest || frozen.Manifest.RunID != id || frozen.Manifest.BaseDraftVersion != r.BaseDraftVersion {
		return app.FinalCommit{}, app.ErrContextMismatch
	}
	var approval string
	err = tx.QueryRow(ctx, `SELECT action_id FROM run_actions WHERE run_id=$1 AND status='completed' AND request->>'type'='approve' AND (request->>'draftVersion')::int=$2 ORDER BY created_at DESC LIMIT 1`, id, in.DraftVersion).Scan(&approval)
	if errors.Is(err, pgx.ErrNoRows) {
		return app.FinalCommit{}, app.ErrGateBlocked
	}
	if err != nil {
		return app.FinalCommit{}, err
	}
	// 用落库正文和评审重新核对，不能只相信浏览器或旧 run 的“已通过”标签。
	var body, reportRaw []byte
	err = tx.QueryRow(ctx, "SELECT segments FROM chapter_versions WHERE chapter_id=$1 AND branch_id=$2 AND draft_version=$3", r.ChapterID, r.BranchID, in.DraftVersion).Scan(&body)
	if err != nil {
		return app.FinalCommit{}, err
	}
	var segments []manuscript.Segment
	if err = json.Unmarshal(body, &segments); err != nil {
		return app.FinalCommit{}, err
	}
	if !reflect.DeepEqual(segments, r.Result.Segments) {
		return app.FinalCommit{}, app.ErrVersionMismatch
	}
	err = tx.QueryRow(ctx, "SELECT report FROM reviews WHERE run_id=$1 AND draft_version=$2", id, in.DraftVersion).Scan(&reportRaw)
	if errors.Is(err, pgx.ErrNoRows) {
		return app.FinalCommit{}, app.ErrGateBlocked
	}
	if err != nil {
		return app.FinalCommit{}, err
	}
	var report review.Report
	if err = json.Unmarshal(reportRaw, &report); err != nil {
		return app.FinalCommit{}, err
	}
	if !reflect.DeepEqual(report, r.Result.Report) {
		return app.FinalCommit{}, app.ErrGateBlocked
	}
	for _, f := range report.Findings {
		if f.RequiresHuman || f.PossibleDialogueLie {
			return app.FinalCommit{}, app.ErrFactsUnconfirmed
		}
	}
	refs, err := manuscript.ContextRefs(frozen.Bundle)
	if err != nil {
		return app.FinalCommit{}, err
	}
	c := app.FinalCommit{ID: in.ID, RunID: id, ProjectID: frozen.Bundle.ProjectID, ChapterID: r.ChapterID, BranchID: r.BranchID, DraftVersion: in.DraftVersion, ApprovalActionID: approval, InputDigest: in.InputDigest, CreatedAt: time.Now().UTC(), FactConfirmation: app.FactConfirmation{DraftVersion: in.DraftVersion, Method: "author_no_pending_facts", NoPendingFacts: true}, Manifest: frozen.Manifest, Segments: segments, Report: report, Refs: refs}
	err = tx.QueryRow(ctx, "SELECT id FROM manuscript_commits WHERE chapter_id=$1 AND branch_id=$2 ORDER BY created_at DESC,id DESC LIMIT 1", r.ChapterID, r.BranchID).Scan(&c.ParentCommit)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return c, err
	}
	for _, object := range []struct {
		kind, id string
		value    any
	}{{"manuscript", r.ChapterID, segments}, {"review", id, report}} {
		raw, e := json.Marshal(object.value)
		if e != nil {
			return c, e
		}
		hash, e := manuscript.ContentDigest(object.value)
		if e != nil {
			return c, e
		}
		c.Refs = append(c.Refs, manuscript.VersionRef{Kind: object.kind, ID: object.id, Version: in.DraftVersion, Digest: hash, Payload: raw})
	}
	raw, err := json.Marshal(c)
	if err != nil {
		return c, err
	}
	var parent any
	if c.ParentCommit != "" {
		parent = c.ParentCommit
	}
	_, err = tx.Exec(ctx, "INSERT INTO manuscript_commits(id,run_id,chapter_id,branch_id,draft_version,parent_commit,payload,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)", c.ID, id, r.ChapterID, r.BranchID, c.DraftVersion, parent, raw, c.CreatedAt)
	var pgerr *pgconn.PgError
	if errors.As(err, &pgerr) && pgerr.Code == "23505" {
		return c, app.ErrActionMismatch
	}
	if err != nil {
		return c, err
	}
	for _, ref := range c.Refs {
		if _, err = tx.Exec(ctx, "INSERT INTO commit_refs VALUES($1,$2,$3,$4,$5,$6)", c.ID, ref.Kind, ref.ID, ref.Version, ref.Digest, ref.Payload); err != nil {
			return c, err
		}
	}
	r.Status = "committed"
	r.CommitID = c.ID
	r.CurrentNode = "commit"
	r.Result.Status = "committed"
	r.Result.CurrentNode = "commit"
	r.Result.NodePhase = "finished"
	r.Result.StopReason = "作者确认后已冻结本版正文与匹配设定，后续修改生成新候选，不改写此次定稿"
	if err = saveRun(ctx, tx, r); err != nil {
		return c, err
	}
	if err = appendEvent(ctx, tx, id, "commit.created"); err != nil {
		return c, err
	}
	if err = tx.Commit(ctx); err != nil {
		return c, err
	}
	return c, nil
}
func existingCommit(ctx context.Context, tx pgx.Tx, runID string, in app.FinalizeInput) (app.FinalCommit, bool, error) {
	var c app.FinalCommit
	var raw []byte
	err := tx.QueryRow(ctx, "SELECT payload FROM manuscript_commits WHERE id=$1 OR run_id=$2 ORDER BY (id=$1) DESC LIMIT 1", in.ID, runID).Scan(&raw)
	if errors.Is(err, pgx.ErrNoRows) {
		return c, false, nil
	}
	if err != nil {
		return c, false, err
	}
	if err = json.Unmarshal(raw, &c); err != nil {
		return c, false, err
	}
	if c.ID != in.ID || c.RunID != runID || c.DraftVersion != in.DraftVersion || c.InputDigest != in.InputDigest {
		return c, false, app.ErrActionMismatch
	}
	return c, true, nil
}
func (s *Store) GetCommit(ctx context.Context, id string) (app.FinalCommit, error) {
	var c app.FinalCommit
	var raw []byte
	err := s.pool.QueryRow(ctx, "SELECT payload FROM manuscript_commits WHERE id=$1", id).Scan(&raw)
	if errors.Is(err, pgx.ErrNoRows) {
		return c, app.ErrNotFound
	}
	if err != nil {
		return c, err
	}
	err = json.Unmarshal(raw, &c)
	return c, err
}
func (s *Store) Commits(ctx context.Context, chapter, branch string) ([]app.FinalCommit, error) {
	rows, err := s.pool.Query(ctx, "SELECT payload FROM manuscript_commits WHERE chapter_id=$1 AND branch_id=$2 ORDER BY created_at DESC,id DESC LIMIT 50", chapter, branch)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []app.FinalCommit{}
	for rows.Next() {
		var c app.FinalCommit
		var raw []byte
		if err = rows.Scan(&raw); err != nil {
			return nil, err
		}
		if err = json.Unmarshal(raw, &c); err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, rows.Err()
}
