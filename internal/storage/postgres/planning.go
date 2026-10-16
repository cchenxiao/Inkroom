package postgres

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"inkloom/internal/agents/model"
	"inkloom/internal/app"
	"inkloom/internal/domain/planning"
)

// 每次写入先锁作品头，输入与采用版本分别增长；候选与原始模型输出不可变。
func (s *Store) lockPlanning(ctx context.Context, scope string) (pgx.Tx, int, int, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, 0, 0, err
	}
	if _, err = tx.Exec(ctx, "INSERT INTO planning_heads(scope) VALUES($1) ON CONFLICT DO NOTHING", scope); err != nil {
		tx.Rollback(ctx)
		return nil, 0, 0, err
	}
	var iv, dv int
	err = tx.QueryRow(ctx, "SELECT input_version,direction_version FROM planning_heads WHERE scope=$1 FOR UPDATE", scope).Scan(&iv, &dv)
	if err != nil {
		tx.Rollback(ctx)
		return nil, 0, 0, err
	}
	return tx, iv, dv, nil
}
func (s *Store) SavePlanningInput(ctx context.Context, scope string, expected int, in planning.Intake) (planning.InputSnapshot, error) {
	if err := in.Validate(); err != nil {
		return planning.InputSnapshot{}, app.ErrInvalidWrite
	}
	tx, iv, _, err := s.lockPlanning(ctx, scope)
	if err != nil {
		return planning.InputSnapshot{}, err
	}
	defer tx.Rollback(context.Background())
	if expected != iv {
		return planning.InputSnapshot{}, app.ErrVersionMismatch
	}
	snapshot := planning.Snapshot(iv+1, in)
	raw, _ := json.Marshal(snapshot)
	if _, err = tx.Exec(ctx, "INSERT INTO planning_inputs VALUES($1,$2,$3)", scope, iv+1, raw); err != nil {
		return snapshot, err
	}
	if _, err = tx.Exec(ctx, "UPDATE planning_heads SET input_version=$2 WHERE scope=$1", scope, iv+1); err != nil {
		return snapshot, err
	}
	return snapshot, tx.Commit(ctx)
}
func (s *Store) StartPlanningJob(ctx context.Context, scope, id string, expected int, modelName string) (planning.Job, bool, error) {
	tx, iv, _, err := s.lockPlanning(ctx, scope)
	if err != nil {
		return planning.Job{}, false, err
	}
	defer tx.Rollback(context.Background())
	var raw []byte
	err = tx.QueryRow(ctx, "SELECT record FROM planning_jobs WHERE id=$1 AND scope=$2", id, scope).Scan(&raw)
	if err == nil {
		var j planning.Job
		if err = json.Unmarshal(raw, &j); err != nil {
			return j, false, err
		}
		if j.Input.Version != expected {
			return j, false, app.ErrVersionMismatch
		}
		return j, false, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return planning.Job{}, false, err
	}
	if iv == 0 || iv != expected {
		return planning.Job{}, false, app.ErrVersionMismatch
	}
	var busy bool
	if err = tx.QueryRow(ctx, "SELECT EXISTS(SELECT 1 FROM planning_jobs WHERE scope=$1 AND status='running')", scope).Scan(&busy); err != nil {
		return planning.Job{}, false, err
	}
	if busy {
		return planning.Job{}, false, app.ErrRunBusy
	}
	if err = tx.QueryRow(ctx, "SELECT snapshot FROM planning_inputs WHERE scope=$1 AND version=$2", scope, iv).Scan(&raw); err != nil {
		return planning.Job{}, false, err
	}
	var input planning.InputSnapshot
	if err = json.Unmarshal(raw, &input); err != nil {
		return planning.Job{}, false, err
	}
	j := planning.Job{ID: id, Version: 1, Status: "running", Input: input, Model: modelName, PromptVersion: "tone_director.v1", SchemaVersion: "tone_director.v1", CreatedAt: time.Now(), Directions: []planning.Direction{}, Calls: []model.CallRecord{}}
	raw, _ = json.Marshal(j)
	if _, err = tx.Exec(ctx, "INSERT INTO planning_jobs(id,scope,status,record) VALUES($1,$2,'running',$3)", id, scope, raw); err != nil {
		return j, false, err
	}
	return j, true, tx.Commit(ctx)
}
func (s *Store) FinishPlanningJob(ctx context.Context, id string, out planning.Output, runErr error) error {
	status, message := "completed", ""
	if runErr != nil {
		status = "failed"
		message = "生成未完成，请查看调用记录后手动重试；未自动重复任务。"
		out.Directions = []planning.Direction{}
	} else if err := out.Validate(); err != nil {
		return app.ErrInvalidWrite
	}
	raw, _ := json.Marshal(out.Directions)
	tag, err := s.pool.Exec(ctx, `UPDATE planning_jobs SET status=$2, record=record || jsonb_build_object('status',$2::text,'message',$3::text,'directions',$4::jsonb) WHERE id=$1 AND status='running'`, id, status, message, raw)
	if err == nil && tag.RowsAffected() != 1 {
		return app.ErrVersionMismatch
	}
	return err
}
func (s *Store) RecordPlanningCall(ctx context.Context, id string, c model.CallRecord) error {
	raw, err := json.Marshal(c)
	if err != nil {
		return err
	}
	_, err = s.pool.Exec(ctx, "INSERT INTO planning_calls VALUES($1,$2,$3) ON CONFLICT(job_id,number) DO UPDATE SET record=EXCLUDED.record", id, c.Number, raw)
	return err
}
func (s *Store) SelectPlanningDirection(ctx context.Context, scope string, r planning.SelectRequest) (planning.Selection, error) {
	var empty planning.Selection
	if r.Direction.Validate() != nil {
		return empty, app.ErrInvalidWrite
	}
	tx, iv, dv, err := s.lockPlanning(ctx, scope)
	if err != nil {
		return empty, err
	}
	defer tx.Rollback(context.Background())
	if iv == 0 || iv != r.ExpectedInputVersion || dv != r.ExpectedDirectionVersion {
		return empty, app.ErrVersionMismatch
	}
	var raw []byte
	if r.JobID != "" {
		if err = tx.QueryRow(ctx, "SELECT record FROM planning_jobs WHERE id=$1 AND scope=$2", r.JobID, scope).Scan(&raw); errors.Is(err, pgx.ErrNoRows) {
			return empty, app.ErrNotFound
		} else if err != nil {
			return empty, err
		}
		var job planning.Job
		if err = json.Unmarshal(raw, &job); err != nil {
			return empty, err
		}
		if job.Status != "completed" || job.Input.Version != iv || r.CandidateVersion != job.Version {
			return empty, app.ErrVersionMismatch
		}
		if r.CandidateIndex < 0 || r.CandidateIndex >= len(job.Directions) {
			return empty, app.ErrInvalidWrite
		}
	} else if r.CandidateVersion != 0 || r.CandidateIndex != -1 {
		return empty, app.ErrInvalidWrite
	}
	if err = tx.QueryRow(ctx, "SELECT snapshot FROM planning_inputs WHERE scope=$1 AND version=$2", scope, iv).Scan(&raw); err != nil {
		return empty, err
	}
	var input planning.InputSnapshot
	if err = json.Unmarshal(raw, &input); err != nil {
		return empty, err
	}
	selected := planning.Selection{Version: dv + 1, InputVersion: iv, InputDigest: input.Digest, JobID: r.JobID, CandidateVersion: r.CandidateVersion, CandidateIndex: r.CandidateIndex, Direction: r.Direction, CreatedAt: time.Now()}
	raw, _ = json.Marshal(selected)
	if _, err = tx.Exec(ctx, "INSERT INTO planning_selections VALUES($1,$2,$3)", scope, dv+1, raw); err != nil {
		return empty, err
	}
	if _, err = tx.Exec(ctx, "UPDATE planning_heads SET direction_version=$2 WHERE scope=$1", scope, dv+1); err != nil {
		return empty, err
	}
	return selected, tx.Commit(ctx)
}

// 一致性读：头、输入与选择共享同一个数据库快照，避免拼出跨版本页面。
func (s *Store) GetPlanning(ctx context.Context, scope string) (planning.State, error) {
	state := planning.State{OutlineJobs: []planning.OutlineJob{}, CoreJobs: []planning.CoreJob{}, StyleJobs: []planning.StyleJob{}, Jobs: []planning.Job{}, Packs: planning.Catalog()}
	tx, err := s.pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
	if err != nil {
		return state, err
	}
	defer tx.Rollback(context.Background())
	var iv int
	err = tx.QueryRow(ctx, "SELECT input_version,direction_version,style_version,core_version,outline_version FROM planning_heads WHERE scope=$1", scope).Scan(&iv, &state.DirectionVersion, &state.StyleVersion, &state.CoreVersion, &state.OutlineVersion)
	if errors.Is(err, pgx.ErrNoRows) {
		return state, nil
	}
	if err != nil {
		return state, err
	}
	var raw []byte
	if iv > 0 {
		if err = tx.QueryRow(ctx, "SELECT snapshot FROM planning_inputs WHERE scope=$1 AND version=$2", scope, iv).Scan(&raw); err != nil {
			return state, err
		}
		if err = json.Unmarshal(raw, &state.Input); err != nil {
			return state, err
		}
	}
	if state.DirectionVersion > 0 {
		if err = tx.QueryRow(ctx, "SELECT record FROM planning_selections WHERE scope=$1 AND version=$2", scope, state.DirectionVersion).Scan(&raw); err != nil {
			return state, err
		}
		if err = json.Unmarshal(raw, &state.Selection); err != nil {
			return state, err
		}
	}
	rows, err := tx.Query(ctx, `SELECT j.record, COALESCE((SELECT jsonb_agg(c.record ORDER BY number) FROM planning_calls c WHERE c.job_id=j.id),'[]'::jsonb) FROM planning_jobs j WHERE scope=$1 ORDER BY created_at DESC,id DESC LIMIT 20`, scope)
	if err != nil {
		return state, err
	}
	for rows.Next() {
		var raw, calls []byte
		if err = rows.Scan(&raw, &calls); err != nil {
			rows.Close()
			return state, err
		}
		var j planning.Job
		if err = json.Unmarshal(raw, &j); err != nil {
			rows.Close()
			return state, err
		}
		if err = json.Unmarshal(calls, &j.Calls); err != nil {
			rows.Close()
			return state, err
		}
		state.Jobs = append(state.Jobs, j)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return state, err
	}
	if err = readStylePlanning(ctx, tx, scope, &state); err != nil {
		return state, err
	}
	if err = readCorePlanning(ctx, tx, scope, &state); err != nil {
		return state, err
	}
	if err = readOutlinePlanning(ctx, tx, scope, &state); err != nil {
		return state, err
	}
	return state, tx.Commit(ctx)
}
