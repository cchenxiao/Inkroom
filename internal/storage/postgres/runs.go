package postgres

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"inkloom/internal/agents/model"
	"inkloom/internal/app"
	"inkloom/internal/domain/manuscript"
)

func (s *Store) CreateRun(ctx context.Context, r app.Run) error { return s.createRun(ctx, r, nil, nil) }
func (s *Store) createRun(ctx context.Context, r app.Run, input, preparation *manuscript.FrozenInput) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(context.Background())
	if _, err = tx.Exec(ctx, "INSERT INTO chapters(id,branch_id) VALUES($1,$2) ON CONFLICT DO NOTHING", r.ChapterID, r.BranchID); err != nil {
		return err
	}
	var version int
	if err = tx.QueryRow(ctx, "SELECT draft_version FROM chapters WHERE id=$1 AND branch_id=$2 FOR UPDATE", r.ChapterID, r.BranchID).Scan(&version); err != nil {
		return err
	}
	if version != r.BaseDraftVersion {
		return app.ErrVersionMismatch
	}
	r.CreatedAt = time.Now().UTC()
	raw, err := json.Marshal(r)
	if err != nil {
		return err
	}
	_, err = tx.Exec(ctx, "INSERT INTO runs(id,chapter_id,branch_id,status,payload,created_at) VALUES($1,$2,$3,$4,$5,$6)", r.ID, r.ChapterID, r.BranchID, r.Status, raw, r.CreatedAt)
	var pgerr *pgconn.PgError
	if errors.As(err, &pgerr) && pgerr.Code == "23505" {
		return app.ErrRunBusy
	}
	if err != nil {
		return err
	}
	if input != nil {
		raw, err := json.Marshal(input)
		if err != nil {
			return err
		}
		if _, err = tx.Exec(ctx, "INSERT INTO run_contexts VALUES($1,$2)", r.ID, raw); err != nil {
			return err
		}
	}
	if preparation != nil {
		raw, err := json.Marshal(preparation)
		if err != nil {
			return err
		}
		if _, err = tx.Exec(ctx, "INSERT INTO run_preparations VALUES($1,$2)", r.ID, raw); err != nil {
			return err
		}
	}
	if err = appendEvent(ctx, tx, r.ID, "run.started"); err != nil {
		return err
	}
	return tx.Commit(ctx)
}
func (s *Store) GetRun(ctx context.Context, id string) (app.Run, error) {
	if id == "latest" {
		if err := s.pool.QueryRow(ctx, "SELECT id FROM runs ORDER BY created_at DESC,id DESC LIMIT 1").Scan(&id); err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return app.Run{}, app.ErrNotFound
			}
			return app.Run{}, err
		}
	}
	return snapshot(ctx, s.pool, id)
}

func (s *Store) ListRuns(ctx context.Context) ([]app.Run, error) {
	rows, err := s.pool.Query(ctx, "SELECT payload FROM runs ORDER BY created_at DESC,id DESC LIMIT 50")
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []app.Run{}
	for rows.Next() {
		var raw []byte
		if err = rows.Scan(&raw); err != nil {
			return nil, err
		}
		r, err := decodeRun(raw)
		if err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

// SaveProgress 把候选稿新版本、评审与 run 快照放进同一事务。
// expected 是上一次成功落库的版本，不是模型自己报的版本。
func (s *Store) SaveProgress(ctx context.Context, r app.Run, expected int) error {
	if r.Result == nil {
		return app.ErrInvalidWrite
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(context.Background())
	if err = saveProgressTx(ctx, tx, r, expected); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func saveProgressTx(ctx context.Context, tx pgx.Tx, r app.Run, expected int) error {
	var current int
	err := tx.QueryRow(ctx, "SELECT draft_version FROM chapters WHERE id=$1 AND branch_id=$2 FOR UPDATE", r.ChapterID, r.BranchID).Scan(&current)
	if err != nil {
		return err
	}
	if current != expected {
		return app.ErrVersionMismatch
	}
	var status, digest string
	if err = tx.QueryRow(ctx, "SELECT status,COALESCE(payload->>'inputDigest','') FROM runs WHERE id=$1 FOR UPDATE", r.ID).Scan(&status, &digest); err != nil {
		return err
	}
	if status != "running" {
		return app.ErrVersionMismatch
	}
	state := r.Result
	if digest != "" {
		actual, err := manuscript.ContentDigest(state.Context)
		if err != nil || actual != digest {
			return app.ErrContextMismatch
		}
		r.InputDigest = digest
	}
	switch state.DraftVersion {
	case expected: // 本轮只更新节点或评审，正文版本不变。
	case expected + 1:
		if err = writeVersion(ctx, tx, r.ChapterID, r.BranchID, expected, state.Segments, "agent", r.ID); err != nil {
			return err
		}
	default:
		return app.ErrInvalidWrite
	}
	for _, report := range state.Reviews {
		if report.DraftVersion != state.DraftVersion {
			continue
		}
		raw, err := json.Marshal(report)
		if err != nil {
			return err
		}
		if _, err = tx.Exec(ctx, "INSERT INTO reviews(run_id,draft_version,report) VALUES($1,$2,$3) ON CONFLICT DO NOTHING", r.ID, report.DraftVersion, raw); err != nil {
			return err
		}
	}
	raw, err := json.Marshal(r)
	if err != nil {
		return err
	}
	if _, err = tx.Exec(ctx, "UPDATE runs SET status=$2,payload=$3,updated_at=now() WHERE id=$1", r.ID, r.Status, raw); err != nil {
		return err
	}
	if err = appendEvent(ctx, tx, r.ID, stateEvent(r)); err != nil {
		return err
	}
	if state.NodePhase == "finished" {
		switch state.CurrentNode {
		case "aggregate", "human_gate":
			return appendEvent(ctx, tx, r.ID, "findings.ready")
		case "micro_edit", "scene_reviser", "structural_reviser":
			return appendEvent(ctx, tx, r.ID, "revise.round")
		case "draft", "human_edit":
			return appendEvent(ctx, tx, r.ID, "draft.saved")
		}
	}
	return nil
}

// StopRun 只改运行状态，绝不写正文。晚到的失败结果不能覆盖已保存的人稿。
func (s *Store) StopRun(ctx context.Context, id, status, reason string) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(context.Background())
	var raw []byte
	if err = tx.QueryRow(ctx, "SELECT payload FROM runs WHERE id=$1 FOR UPDATE", id).Scan(&raw); err != nil {
		return err
	}
	r, err := decodeRun(raw)
	if err != nil {
		return err
	}
	if r.Status != "running" {
		return nil
	}
	r.Status = status
	r.Error = reason
	if r.Result != nil {
		r.Result.Status = status
		r.Result.StopReason = reason
	}
	raw, err = json.Marshal(r)
	if err != nil {
		return err
	}
	if _, err = tx.Exec(ctx, "UPDATE runs SET status=$2,payload=$3,updated_at=now() WHERE id=$1", id, status, raw); err != nil {
		return err
	}
	if err = appendEvent(ctx, tx, id, stateEvent(r)); err != nil {
		return err
	}
	return tx.Commit(ctx)
}
func (s *Store) RecordCall(ctx context.Context, runID string, c model.CallRecord) error {
	raw, err := json.Marshal(c)
	if err != nil {
		return err
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(context.Background())
	// 同一 run 的并行调用先取 run 锁，再更新调用记录及事件。
	var exists string
	if err = tx.QueryRow(ctx, "SELECT id FROM runs WHERE id=$1 FOR UPDATE", runID).Scan(&exists); err != nil {
		return err
	}
	_, err = tx.Exec(ctx, `INSERT INTO llm_calls(run_id,call_number,phase,record) VALUES($1,$2,$3,$4)
 ON CONFLICT(run_id,call_number) DO UPDATE SET phase=EXCLUDED.phase,record=EXCLUDED.record`, runID, c.Number, c.Phase, raw)
	if err != nil {
		return err
	}
	if err = appendEvent(ctx, tx, runID, "model."+c.Phase); err != nil {
		return err
	}
	return tx.Commit(ctx)
}
func (s *Store) Calls(ctx context.Context, id string) ([]model.CallRecord, error) {
	if _, err := s.GetRun(ctx, id); err != nil {
		return nil, err
	}
	rows, err := s.pool.Query(ctx, "SELECT record FROM llm_calls WHERE run_id=$1 ORDER BY call_number", id)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []model.CallRecord{}
	for rows.Next() {
		var raw []byte
		if err = rows.Scan(&raw); err != nil {
			return nil, err
		}
		var c model.CallRecord
		if err = json.Unmarshal(raw, &c); err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, rows.Err()
}
