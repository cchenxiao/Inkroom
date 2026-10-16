package postgres

import (
	"context"
	"encoding/json"
	"errors"
	"reflect"
	"time"

	"github.com/jackc/pgx/v5"
	"inkloom/internal/agents/model"
	"inkloom/internal/app"
	"inkloom/internal/domain/planning"
)

// 调用者已经锁住 planning_heads；所有上游版本在同一事务内读取。
func currentCoreInput(ctx context.Context, tx pgx.Tx, scope string, iv, dv, sv int, request string) (planning.CoreSettingsInput, error) {
	var in planning.CoreSettingsInput
	if iv < 1 || dv < 1 || sv < 1 {
		return in, app.ErrVersionMismatch
	}
	for _, entry := range []struct {
		sql     string
		version int
		target  any
	}{
		{"SELECT snapshot FROM planning_inputs WHERE scope=$1 AND version=$2", iv, &in.Source},
		{"SELECT record FROM planning_selections WHERE scope=$1 AND version=$2", dv, &in.Selection},
		{"SELECT record FROM planning_style_selections WHERE scope=$1 AND version=$2", sv, &in.Style},
	} {
		var raw []byte
		if err := tx.QueryRow(ctx, entry.sql, scope, entry.version).Scan(&raw); err != nil {
			return in, err
		}
		if err := json.Unmarshal(raw, entry.target); err != nil {
			return in, err
		}
	}
	in.Request = request
	if in.Selection.InputVersion != iv || in.Style.InputVersion != iv || in.Style.DirectionVersion != dv {
		return in, app.ErrVersionMismatch
	}
	if in.Validate() != nil {
		return in, app.ErrInvalidWrite
	}
	return in, nil
}
func (s *Store) StartCoreSettings(ctx context.Context, scope string, r planning.CoreStartRequest, modelName string) (planning.CoreJob, bool, error) {
	var empty planning.CoreJob
	tx, iv, dv, err := s.lockPlanning(ctx, scope)
	if err != nil {
		return empty, false, err
	}
	defer tx.Rollback(context.Background())
	var raw []byte
	err = tx.QueryRow(ctx, "SELECT record FROM planning_core_jobs WHERE id=$1 AND scope=$2", r.RequestID, scope).Scan(&raw)
	if err == nil {
		var j planning.CoreJob
		if err = json.Unmarshal(raw, &j); err != nil {
			return empty, false, err
		}
		if !reflect.DeepEqual(j.Request, r) {
			return empty, false, app.ErrVersionMismatch
		}
		return j, false, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return empty, false, err
	}
	var sv int
	if err = tx.QueryRow(ctx, "SELECT style_version FROM planning_heads WHERE scope=$1", scope).Scan(&sv); err != nil {
		return empty, false, err
	}
	if iv != r.ExpectedInputVersion || dv != r.ExpectedDirectionVersion || sv != r.ExpectedStyleVersion {
		return empty, false, app.ErrVersionMismatch
	}
	in, err := currentCoreInput(ctx, tx, scope, iv, dv, sv, r.Request)
	if err != nil {
		return empty, false, err
	}
	var busy bool
	if err = tx.QueryRow(ctx, "SELECT EXISTS(SELECT 1 FROM planning_core_jobs WHERE scope=$1 AND status='running')", scope).Scan(&busy); err != nil {
		return empty, false, err
	}
	if busy {
		return empty, false, app.ErrRunBusy
	}
	j := planning.CoreJob{ID: r.RequestID, Version: 1, Status: "running", Request: r, Input: in, Model: modelName, PromptVersion: "core_planner.v1", SchemaVersion: "core_planner.v1", Calls: []model.CallRecord{}, CreatedAt: time.Now()}
	raw, _ = json.Marshal(j)
	if _, err = tx.Exec(ctx, "INSERT INTO planning_core_jobs(id,scope,status,record) VALUES($1,$2,'running',$3)", j.ID, scope, raw); err != nil {
		return empty, false, err
	}
	return j, true, tx.Commit(ctx)
}
func (s *Store) RecordCoreCall(ctx context.Context, id string, c model.CallRecord) error {
	raw, err := json.Marshal(c)
	if err != nil {
		return err
	}
	_, err = s.pool.Exec(ctx, "INSERT INTO planning_core_calls VALUES($1,$2,$3) ON CONFLICT(job_id,number) DO UPDATE SET record=EXCLUDED.record", id, c.Number, raw)
	return err
}
func (s *Store) FinishCoreSettings(ctx context.Context, id string, report app.CoreSettingsReport, runErr error) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(context.Background())
	var raw []byte
	err = tx.QueryRow(ctx, "SELECT record FROM planning_core_jobs WHERE id=$1 AND status='running' FOR UPDATE", id).Scan(&raw)
	if errors.Is(err, pgx.ErrNoRows) {
		return app.ErrVersionMismatch
	}
	if err != nil {
		return err
	}
	var j planning.CoreJob
	if err = json.Unmarshal(raw, &j); err != nil {
		return err
	}
	j.Status = "failed"
	j.Message = "生成未完成，未采用任何设定。请查看调用记录后手动重试。"
	if runErr == nil {
		if report.Status != "completed" || report.Confirmation != "candidate" || report.Output == nil || report.Output.Validate() != nil || !reflect.DeepEqual(report.Input, j.Input) {
			return app.ErrInvalidWrite
		}
		j.Status = "completed"
		j.Output = report.Output
		j.Message = report.Message
	}
	raw, _ = json.Marshal(j)
	if _, err = tx.Exec(ctx, "UPDATE planning_core_jobs SET status=$2,record=$3 WHERE id=$1", id, j.Status, raw); err != nil {
		return err
	}
	return tx.Commit(ctx)
}
func (s *Store) SaveCoreSettings(ctx context.Context, scope string, r planning.CoreSaveRequest) (planning.CoreSelection, error) {
	var empty planning.CoreSelection
	if r.Validate() != nil {
		return empty, app.ErrInvalidWrite
	}
	tx, iv, dv, err := s.lockPlanning(ctx, scope)
	if err != nil {
		return empty, err
	}
	defer tx.Rollback(context.Background())
	var sv, cv int
	if err = tx.QueryRow(ctx, "SELECT style_version,core_version FROM planning_heads WHERE scope=$1", scope).Scan(&sv, &cv); err != nil {
		return empty, err
	}
	if iv != r.ExpectedInputVersion || dv != r.ExpectedDirectionVersion || sv != r.ExpectedStyleVersion || cv != r.ExpectedCoreVersion {
		return empty, app.ErrVersionMismatch
	}
	if _, err = currentCoreInput(ctx, tx, scope, iv, dv, sv, "作者确认设定"); err != nil {
		return empty, err
	}
	var raw []byte
	if r.SourceCoreVersion > 0 {
		if r.SourceCoreVersion != cv {
			return empty, app.ErrVersionMismatch
		}
		if err = tx.QueryRow(ctx, "SELECT record FROM planning_core_selections WHERE scope=$1 AND version=$2", scope, cv).Scan(&raw); err != nil {
			return empty, err
		}
		var source planning.CoreSelection
		if err = json.Unmarshal(raw, &source); err != nil {
			return empty, err
		}
		if source.JobID != r.JobID || source.CandidateVersion != r.CandidateVersion {
			return empty, app.ErrInvalidWrite
		}
	} else {
		err = tx.QueryRow(ctx, "SELECT record FROM planning_core_jobs WHERE id=$1 AND scope=$2", r.JobID, scope).Scan(&raw)
		if errors.Is(err, pgx.ErrNoRows) {
			return empty, app.ErrNotFound
		}
		if err != nil {
			return empty, err
		}
		var job planning.CoreJob
		if err = json.Unmarshal(raw, &job); err != nil {
			return empty, err
		}
		if job.Status != "completed" || job.Output == nil || job.Version != r.CandidateVersion || job.Input.Source.Version != iv || job.Input.Selection.Version != dv || job.Input.Style.Version != sv {
			return empty, app.ErrVersionMismatch
		}
	}
	// 新增版本而非覆盖模型结果；没有知识库、索引或正文写入。
	out := planning.CoreSelection{Version: cv + 1, InputVersion: iv, DirectionVersion: dv, StyleVersion: sv, SourceCoreVersion: r.SourceCoreVersion, JobID: r.JobID, CandidateVersion: r.CandidateVersion, Content: r.Content, Decisions: r.Decisions, CreatedAt: time.Now()}
	raw, _ = json.Marshal(out)
	if _, err = tx.Exec(ctx, "INSERT INTO planning_core_selections VALUES($1,$2,$3)", scope, out.Version, raw); err != nil {
		return empty, err
	}
	if _, err = tx.Exec(ctx, "UPDATE planning_heads SET core_version=$2 WHERE scope=$1", scope, out.Version); err != nil {
		return empty, err
	}
	return out, tx.Commit(ctx)
}
func readCorePlanning(ctx context.Context, tx pgx.Tx, scope string, state *planning.State) error {
	var raw []byte
	if state.CoreVersion > 0 {
		if err := tx.QueryRow(ctx, "SELECT record FROM planning_core_selections WHERE scope=$1 AND version=$2", scope, state.CoreVersion).Scan(&raw); err != nil {
			return err
		}
		if err := json.Unmarshal(raw, &state.CoreSelection); err != nil {
			return err
		}
	}
	rows, err := tx.Query(ctx, `SELECT j.record,COALESCE((SELECT jsonb_agg(c.record ORDER BY number) FROM planning_core_calls c WHERE c.job_id=j.id),'[]'::jsonb) FROM planning_core_jobs j WHERE scope=$1 ORDER BY created_at DESC,id DESC LIMIT 20`, scope)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var calls []byte
		if err = rows.Scan(&raw, &calls); err != nil {
			return err
		}
		var j planning.CoreJob
		if err = json.Unmarshal(raw, &j); err != nil {
			return err
		}
		if err = json.Unmarshal(calls, &j.Calls); err != nil {
			return err
		}
		state.CoreJobs = append(state.CoreJobs, j)
	}
	return rows.Err()
}
