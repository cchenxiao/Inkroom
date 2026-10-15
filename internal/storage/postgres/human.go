package postgres

import (
	"context"
	"encoding/json"
	"errors"
	"reflect"

	"github.com/jackc/pgx/v5"
	"inkloom/internal/app"
	"inkloom/internal/orchestration"
)

var _ app.HumanRepository = (*Store)(nil)

func (s *Store) Checkpoint(ctx context.Context, id string) ([]byte, bool, error) {
	var raw []byte
	var version string
	err := s.pool.QueryRow(ctx, "SELECT payload,workflow_version FROM run_checkpoints WHERE run_id=$1", id).Scan(&raw, &version)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, false, nil
	}
	if err != nil {
		return nil, false, err
	}
	if version != orchestration.HumanWorkflowVersion {
		return nil, false, app.ErrGateBlocked
	}
	return raw, true, nil
}

// lockHuman 固定章→run 顺序，和普通正文写入一致，防死锁及跨窗口覆盖。
func lockHuman(ctx context.Context, tx pgx.Tx, id string) (app.Run, error) {
	var chapter, branch string
	if err := tx.QueryRow(ctx, "SELECT chapter_id,branch_id FROM runs WHERE id=$1", id).Scan(&chapter, &branch); err != nil {
		return app.Run{}, err
	}
	var head int
	if err := tx.QueryRow(ctx, "SELECT draft_version FROM chapters WHERE id=$1 AND branch_id=$2 FOR UPDATE", chapter, branch).Scan(&head); err != nil {
		return app.Run{}, err
	}
	var raw []byte
	if err := tx.QueryRow(ctx, "SELECT payload FROM runs WHERE id=$1 FOR UPDATE", id).Scan(&raw); err != nil {
		return app.Run{}, err
	}
	r, err := decodeRun(raw)
	if err != nil {
		return r, err
	}
	if r.DraftVersion != head || r.Status == "stale" {
		return r, app.ErrVersionMismatch
	}
	return r, nil
}
func saveRun(ctx context.Context, tx pgx.Tx, r app.Run) error {
	raw, err := json.Marshal(r)
	if err != nil {
		return err
	}
	_, err = tx.Exec(ctx, "UPDATE runs SET status=$2,payload=$3,updated_at=now() WHERE id=$1", r.ID, r.Status, raw)
	return err
}
func (s *Store) SaveCheckpoint(ctx context.Context, id string, raw []byte, state orchestration.ChapterState, actionID string) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(context.Background())
	r, err := lockHuman(ctx, tx, id)
	if err != nil {
		return err
	}
	if r.Status != "running" || state.DraftVersion != r.DraftVersion {
		return app.ErrVersionMismatch
	}
	if _, err = tx.Exec(ctx, `INSERT INTO run_checkpoints VALUES($1,$2,$3,now()) ON CONFLICT(run_id) DO UPDATE SET payload=EXCLUDED.payload,workflow_version=EXCLUDED.workflow_version,updated_at=now()`, id, orchestration.HumanWorkflowVersion, raw); err != nil {
		return err
	}
	r.Status = "waiting_human"
	r.CurrentNode = "human_gate"
	r.Result = &state
	r.Error = ""
	r.PendingAction = nil
	if err = saveRun(ctx, tx, r); err != nil {
		return err
	}
	if actionID != "" {
		if _, err = tx.Exec(ctx, "UPDATE run_actions SET status='completed' WHERE run_id=$1 AND action_id=$2", id, actionID); err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}
func (s *Store) ClaimAction(ctx context.Context, id string, a orchestration.HumanAction) (app.Run, bool, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return app.Run{}, false, err
	}
	defer tx.Rollback(context.Background())
	// 完成的同一操作可以重取结果，即使之后作者又改了稿，也不会再次执行旧审批。
	var previous []byte
	var status string
	err = tx.QueryRow(ctx, "SELECT request,status FROM run_actions WHERE run_id=$1 AND action_id=$2", id, a.ID).Scan(&previous, &status)
	exists := err == nil
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return app.Run{}, false, err
	}
	if exists {
		var old orchestration.HumanAction
		if err = json.Unmarshal(previous, &old); err != nil {
			return app.Run{}, false, err
		}
		if !reflect.DeepEqual(old, a) {
			return app.Run{}, false, app.ErrActionMismatch
		}
		if status == "completed" {
			r, e := s.GetRun(ctx, id)
			return r, false, e
		}
	}
	r, err := lockHuman(ctx, tx, id)
	if err != nil {
		return r, false, err
	}
	var checkpoint bool
	if err = tx.QueryRow(ctx, "SELECT EXISTS(SELECT 1 FROM run_checkpoints WHERE run_id=$1 AND workflow_version=$2)", id, orchestration.HumanWorkflowVersion).Scan(&checkpoint); err != nil {
		return r, false, err
	}
	if !checkpoint || r.Result == nil {
		return r, false, app.ErrGateBlocked
	}
	if exists {
		if r.Status != "interrupted" && r.Status != "failed" {
			return r, false, app.ErrRunBusy
		}
	} else {
		if r.Status != "waiting_human" {
			return r, false, app.ErrRunBusy
		}
		if a.DraftVersion != r.DraftVersion {
			return r, false, app.ErrVersionMismatch
		}
		if err = orchestration.ValidateHumanAction(*r.Result, a); err != nil {
			return r, false, app.ErrGateBlocked
		}
		raw, _ := json.Marshal(a)
		if _, err = tx.Exec(ctx, "INSERT INTO run_actions(run_id,action_id,request,status) VALUES($1,$2,$3,'pending')", id, a.ID, raw); err != nil {
			return r, false, err
		}
	}
	r.Status = "running"
	r.Error = ""
	r.PendingAction = &a
	if err = saveRun(ctx, tx, r); err != nil {
		return r, false, err
	}
	if err = tx.Commit(ctx); err != nil {
		return r, false, err
	}
	return r, true, nil
}
func (s *Store) LoadArtifact(ctx context.Context, id, key string) (orchestration.ChapterState, bool, error) {
	var state orchestration.ChapterState
	var raw []byte
	err := s.pool.QueryRow(ctx, "SELECT state FROM run_artifacts WHERE run_id=$1 AND operation_key=$2", id, key).Scan(&raw)
	if errors.Is(err, pgx.ErrNoRows) {
		return state, false, nil
	}
	if err != nil {
		return state, false, err
	}
	err = json.Unmarshal(raw, &state)
	return state, true, err
}
func (s *Store) CommitArtifact(ctx context.Context, id, actionID, key string, expected int, state orchestration.ChapterState, origin string) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(context.Background())
	r, err := lockHuman(ctx, tx, id)
	if err != nil {
		return err
	}
	if r.Status != "running" || r.DraftVersion != expected {
		return app.ErrVersionMismatch
	}
	var pending string
	if err = tx.QueryRow(ctx, "SELECT status FROM run_actions WHERE run_id=$1 AND action_id=$2", id, actionID).Scan(&pending); err != nil {
		return err
	}
	if pending != "pending" {
		return app.ErrGateBlocked
	}
	// 同一产物只能写一次；冲突时整个事务回滚，调用方恢复后 Load 取已提交结果。
	raw, err := json.Marshal(state)
	if err != nil {
		return err
	}
	if _, err = tx.Exec(ctx, "INSERT INTO run_artifacts VALUES($1,$2,$3)", id, key, raw); err != nil {
		return err
	}
	if state.DraftVersion == expected+1 {
		if err = writeVersion(ctx, tx, r.ChapterID, r.BranchID, expected, state.Segments, origin, id); err != nil {
			return err
		}
	} else if state.DraftVersion != expected {
		return app.ErrInvalidWrite
	}
	r.DraftVersion = state.DraftVersion
	r.Result = &state
	r.CurrentNode = state.CurrentNode
	r.ReviseRound = state.ReviseRound
	r.Usage = state.Usage
	// saveProgressTx 当前版本分支只保存本版评审与运行，不再增加正文版本。
	if err = saveProgressTx(ctx, tx, r, state.DraftVersion); err != nil {
		return err
	}
	return tx.Commit(ctx)
}
func (s *Store) Approve(ctx context.Context, id, actionID string, version int) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(context.Background())
	r, err := lockHuman(ctx, tx, id)
	if err != nil {
		return err
	}
	if r.Status != "running" || r.DraftVersion != version {
		return app.ErrVersionMismatch
	}
	if r.Result == nil || orchestration.ApprovalReason(*r.Result) != "" {
		return app.ErrGateBlocked
	}
	r.Status = "approved"
	r.Result.Status = "approved"
	r.Result.StopReason = "作者已批准本版候选；正式章节提交在后续接入"
	r.PendingAction = nil
	if err = saveRun(ctx, tx, r); err != nil {
		return err
	}
	if _, err = tx.Exec(ctx, "UPDATE run_actions SET status='completed' WHERE run_id=$1 AND action_id=$2 AND status='pending'", id, actionID); err != nil {
		return err
	}
	return tx.Commit(ctx)
}
