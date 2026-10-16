package postgres

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"reflect"
	"time"

	"github.com/jackc/pgx/v5"
	"inkloom/internal/agents/model"
	"inkloom/internal/app"
	"inkloom/internal/domain/planning"
)

func (s *Store) StartStyleTrial(ctx context.Context, scope string, r planning.StartTrialRequest, modelName string) (planning.StyleJob, bool, error) {
	var empty planning.StyleJob
	tx, iv, dv, err := s.lockPlanning(ctx, scope)
	if err != nil {
		return empty, false, err
	}
	defer tx.Rollback(context.Background())
	var raw []byte
	err = tx.QueryRow(ctx, "SELECT record FROM planning_style_jobs WHERE id=$1 AND scope=$2", r.RequestID, scope).Scan(&raw)
	if err == nil {
		var j planning.StyleJob
		if err = json.Unmarshal(raw, &j); err != nil {
			return empty, false, err
		}
		if !reflect.DeepEqual(j.Request, r) {
			return empty, false, app.ErrVersionMismatch
		}
		return j, false, nil // 同一请求永远不重发，即使其输入后来失效。
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return empty, false, err
	}
	if iv == 0 || dv == 0 || iv != r.ExpectedInputVersion || dv != r.ExpectedDirectionVersion {
		return empty, false, app.ErrVersionMismatch
	}
	var busy bool
	if err = tx.QueryRow(ctx, "SELECT EXISTS(SELECT 1 FROM planning_style_jobs WHERE scope=$1 AND status='running')", scope).Scan(&busy); err != nil {
		return empty, false, err
	}
	if busy {
		return empty, false, app.ErrRunBusy
	}
	var in planning.TrialInput
	if err = tx.QueryRow(ctx, "SELECT snapshot FROM planning_inputs WHERE scope=$1 AND version=$2", scope, iv).Scan(&raw); err != nil {
		return empty, false, err
	}
	if err = json.Unmarshal(raw, &in.Source); err != nil {
		return empty, false, err
	}
	if err = tx.QueryRow(ctx, "SELECT record FROM planning_selections WHERE scope=$1 AND version=$2", scope, dv).Scan(&raw); err != nil {
		return empty, false, err
	}
	if err = json.Unmarshal(raw, &in.Selection); err != nil {
		return empty, false, err
	}
	if in.Selection.InputVersion != iv {
		return empty, false, app.ErrVersionMismatch
	}
	in.Beat = r.Beat
	in.Variants = r.Variants
	if in.Validate() != nil {
		return empty, false, app.ErrInvalidWrite
	}
	raw, _ = json.Marshal(in)
	j := planning.StyleJob{ID: r.RequestID, Version: 1, Request: r, PromptVersion: "trial_writer.v1", SchemaVersion: "trial_writer.v1", CreatedAt: time.Now(), Report: planning.TrialReport{Status: "running", Model: modelName, Input: in, InputDigest: fmt.Sprintf("%x", sha256.Sum256(raw)), Samples: []planning.TrialSample{}, Calls: []model.CallRecord{}}}
	raw, _ = json.Marshal(j)
	if _, err = tx.Exec(ctx, "INSERT INTO planning_style_jobs(id,scope,status,record) VALUES($1,$2,'running',$3)", j.ID, scope, raw); err != nil {
		return empty, false, err
	}
	return j, true, tx.Commit(ctx)
}

func (s *Store) RecordStyleCall(ctx context.Context, id string, c model.CallRecord) error {
	raw, err := json.Marshal(c)
	if err != nil {
		return err
	}
	_, err = s.pool.Exec(ctx, "INSERT INTO planning_style_calls VALUES($1,$2,$3) ON CONFLICT(job_id,number) DO UPDATE SET record=EXCLUDED.record", id, c.Number, raw)
	return err
}
func (s *Store) FinishStyleTrial(ctx context.Context, id string, report planning.TrialReport, runErr error) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(context.Background())
	var raw []byte
	err = tx.QueryRow(ctx, "SELECT record FROM planning_style_jobs WHERE id=$1 AND status='running' FOR UPDATE", id).Scan(&raw)
	if errors.Is(err, pgx.ErrNoRows) {
		return app.ErrVersionMismatch
	}
	if err != nil {
		return err
	}
	var j planning.StyleJob
	if err = json.Unmarshal(raw, &j); err != nil {
		return err
	}
	if runErr == nil && (report.Status != "completed" || len(report.Samples) != 2 || report.InputDigest != j.Report.InputDigest) {
		return app.ErrInvalidWrite
	}
	// worker 早期失败时可能尚无 report，保留已冻结的请求与审计材料。
	j.Report.Samples = report.Samples
	j.Report.Usage = report.Usage
	j.Report.Message = report.Message
	if j.Report.Samples == nil {
		j.Report.Samples = []planning.TrialSample{}
	}
	j.Report.Status = "completed"
	if runErr != nil {
		j.Report.Status = "failed"
		j.Report.Message = "试笔未全部完成，已生成样本仅供查看；请检查调用记录后手动重试。"
	}
	raw, _ = json.Marshal(j)
	if _, err = tx.Exec(ctx, "UPDATE planning_style_jobs SET status=$2,record=$3 WHERE id=$1", id, j.Report.Status, raw); err != nil {
		return err
	}
	return tx.Commit(ctx)
}
func (s *Store) SelectStyle(ctx context.Context, scope string, r planning.StyleSelectionRequest) (planning.StyleSelection, error) {
	var empty planning.StyleSelection
	if r.Validate() != nil {
		return empty, app.ErrInvalidWrite
	}
	tx, iv, dv, err := s.lockPlanning(ctx, scope)
	if err != nil {
		return empty, err
	}
	defer tx.Rollback(context.Background())
	var sv int
	if err = tx.QueryRow(ctx, "SELECT style_version FROM planning_heads WHERE scope=$1", scope).Scan(&sv); err != nil {
		return empty, err
	}
	if iv != r.ExpectedInputVersion || dv != r.ExpectedDirectionVersion || sv != r.ExpectedStyleVersion {
		return empty, app.ErrVersionMismatch
	}
	var raw []byte
	if iv == 0 || dv == 0 {
		return empty, app.ErrVersionMismatch
	}
	if err = tx.QueryRow(ctx, "SELECT record FROM planning_selections WHERE scope=$1 AND version=$2", scope, dv).Scan(&raw); err != nil {
		return empty, err
	}
	var direction planning.Selection
	if err = json.Unmarshal(raw, &direction); err != nil {
		return empty, err
	}
	if direction.InputVersion != iv {
		return empty, app.ErrVersionMismatch
	}
	if r.SourceStyleVersion > 0 {
		if r.SourceStyleVersion != sv {
			return empty, app.ErrVersionMismatch
		}
		if err = tx.QueryRow(ctx, "SELECT record FROM planning_style_selections WHERE scope=$1 AND version=$2", scope, sv).Scan(&raw); err != nil {
			return empty, err
		}
		var source planning.StyleSelection
		if err = json.Unmarshal(raw, &source); err != nil {
			return empty, err
		}
		// 作者显式复核旧风格，可改变方向依赖；原始样本来源不能随手改写。
		if source.JobID != r.JobID || source.CandidateVersion != r.CandidateVersion || source.VariantID != r.VariantID {
			return empty, app.ErrInvalidWrite
		}
	} else if r.JobID != "" {
		err = tx.QueryRow(ctx, "SELECT record FROM planning_style_jobs WHERE id=$1 AND scope=$2", r.JobID, scope).Scan(&raw)
		if errors.Is(err, pgx.ErrNoRows) {
			return empty, app.ErrNotFound
		}
		if err != nil {
			return empty, err
		}
		var j planning.StyleJob
		if err = json.Unmarshal(raw, &j); err != nil {
			return empty, err
		}
		if j.Report.Status != "completed" || j.Version != r.CandidateVersion || j.Report.Input.Source.Version != iv || j.Report.Input.Selection.Version != dv {
			return empty, app.ErrVersionMismatch
		}
		found := false
		for _, sample := range j.Report.Samples {
			if sample.Variant.ID == r.VariantID {
				found = true
			}
		}
		if !found {
			return empty, app.ErrInvalidWrite
		}

	}
	out := planning.StyleSelection{SourceStyleVersion: r.SourceStyleVersion, Version: sv + 1, InputVersion: iv, DirectionVersion: dv, AnchorVersion: sv + 1, JobID: r.JobID, CandidateVersion: r.CandidateVersion, VariantID: r.VariantID, AnchorText: r.AnchorText, Rules: r.Rules, CreatedAt: time.Now()}
	raw, _ = json.Marshal(out)
	if _, err = tx.Exec(ctx, "INSERT INTO planning_style_selections VALUES($1,$2,$3)", scope, sv+1, raw); err != nil {
		return empty, err
	}
	if _, err = tx.Exec(ctx, "UPDATE planning_heads SET style_version=$2 WHERE scope=$1", scope, sv+1); err != nil {
		return empty, err
	}
	return out, tx.Commit(ctx)
}

// 与规划读共享 repeatable-read 快照，避免同屏出现不同年代的方向与风格。
func readStylePlanning(ctx context.Context, tx pgx.Tx, scope string, state *planning.State) error {
	var raw []byte
	if state.StyleVersion > 0 {
		if err := tx.QueryRow(ctx, "SELECT record FROM planning_style_selections WHERE scope=$1 AND version=$2", scope, state.StyleVersion).Scan(&raw); err != nil {
			return err
		}
		if err := json.Unmarshal(raw, &state.StyleSelection); err != nil {
			return err
		}
	}
	rows, err := tx.Query(ctx, `SELECT j.record,COALESCE((SELECT jsonb_agg(c.record ORDER BY number) FROM planning_style_calls c WHERE c.job_id=j.id),'[]'::jsonb) FROM planning_style_jobs j WHERE scope=$1 ORDER BY created_at DESC,id DESC LIMIT 20`, scope)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var calls []byte
		if err = rows.Scan(&raw, &calls); err != nil {
			return err
		}
		var j planning.StyleJob
		if err = json.Unmarshal(raw, &j); err != nil {
			return err
		}
		if err = json.Unmarshal(calls, &j.Report.Calls); err != nil {
			return err
		}
		state.StyleJobs = append(state.StyleJobs, j)
	}
	return rows.Err()
}
