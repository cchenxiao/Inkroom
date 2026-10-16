package postgres

import (
	"context"
	"encoding/json"
	"errors"
	"github.com/jackc/pgx/v5"
	"inkloom/internal/agents/model"
	"inkloom/internal/app"
	"inkloom/internal/domain/planning"
	"time"
)

func (s *Store) StartStyleAnalysis(ctx context.Context, scope string, r planning.StyleAnalysisRequest, modelName string) (planning.StyleAnalysisJob, bool, error) {
	var empty planning.StyleAnalysisJob
	input, err := planning.NewStyleAnalysisInput(r.Title, r.Text)
	if err != nil {
		return empty, false, app.ErrInvalidWrite
	}
	tx, _, _, err := s.lockPlanning(ctx, scope)
	if err != nil {
		return empty, false, err
	}
	defer tx.Rollback(context.Background())
	var raw []byte
	err = tx.QueryRow(ctx, "SELECT record FROM planning_style_analyses WHERE id=$1 AND scope=$2", r.RequestID, scope).Scan(&raw)
	if err == nil {
		var j planning.StyleAnalysisJob
		if err = json.Unmarshal(raw, &j); err != nil {
			return empty, false, err
		}
		if j.Input.Text != r.Text || j.Input.Title != r.Title {
			return empty, false, app.ErrVersionMismatch
		}
		return j, false, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return empty, false, err
	}
	var busy bool
	if err = tx.QueryRow(ctx, "SELECT EXISTS(SELECT 1 FROM planning_style_analyses WHERE scope=$1 AND status='running')", scope).Scan(&busy); err != nil {
		return empty, false, err
	}
	if busy {
		return empty, false, app.ErrRunBusy
	}
	j := planning.StyleAnalysisJob{ID: r.RequestID, Version: 1, Status: "running", Input: input, Model: modelName, PromptVersion: "style_analyst.v1", SchemaVersion: "style_analyst.v1", Calls: []model.CallRecord{}, CreatedAt: time.Now()}
	raw, _ = json.Marshal(j)
	if _, err = tx.Exec(ctx, "INSERT INTO planning_style_analyses(id,scope,status,record) VALUES($1,$2,'running',$3)", j.ID, scope, raw); err != nil {
		return empty, false, err
	}
	return j, true, tx.Commit(ctx)
}
func (s *Store) RecordStyleAnalysisCall(ctx context.Context, id string, c model.CallRecord) error {
	raw, err := json.Marshal(c)
	if err != nil {
		return err
	}
	_, err = s.pool.Exec(ctx, "INSERT INTO planning_analysis_calls VALUES($1,$2,$3) ON CONFLICT(job_id,number) DO UPDATE SET record=EXCLUDED.record", id, c.Number, raw)
	return err
}
func (s *Store) FinishStyleAnalysis(ctx context.Context, id string, out planning.StyleAnalysisOutput, runErr error) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(context.Background())
	var raw []byte
	err = tx.QueryRow(ctx, "SELECT record FROM planning_style_analyses WHERE id=$1 AND status='running' FOR UPDATE", id).Scan(&raw)
	if errors.Is(err, pgx.ErrNoRows) {
		return app.ErrVersionMismatch
	}
	if err != nil {
		return err
	}
	var j planning.StyleAnalysisJob
	if err = json.Unmarshal(raw, &j); err != nil {
		return err
	}
	if runErr != nil {
		j.Status = "failed"
		j.Message = "分析未完成；未采用任何风格。请查看调用记录后手动重试。"
	} else {
		if out.Validate(j.Input) != nil {
			return app.ErrInvalidWrite
		}
		j.Status = "completed"
		j.Output = &out
	}
	raw, _ = json.Marshal(j)
	if _, err = tx.Exec(ctx, "UPDATE planning_style_analyses SET status=$2,record=$3 WHERE id=$1", id, j.Status, raw); err != nil {
		return err
	}
	return tx.Commit(ctx)
}
func (s *Store) ListStyleAnalyses(ctx context.Context, scope string) ([]planning.StyleAnalysisJob, error) {
	jobs := []planning.StyleAnalysisJob{}
	rows, err := s.pool.Query(ctx, `SELECT j.record,COALESCE((SELECT jsonb_agg(c.record ORDER BY number) FROM planning_analysis_calls c WHERE c.job_id=j.id),'[]'::jsonb) FROM planning_style_analyses j WHERE scope=$1 ORDER BY created_at DESC,id DESC LIMIT 5`, scope)
	if err != nil {
		return jobs, err
	}
	defer rows.Close()
	for rows.Next() {
		var raw, calls []byte
		if err = rows.Scan(&raw, &calls); err != nil {
			return jobs, err
		}
		var j planning.StyleAnalysisJob
		if err = json.Unmarshal(raw, &j); err != nil {
			return jobs, err
		}
		if err = json.Unmarshal(calls, &j.Calls); err != nil {
			return jobs, err
		}
		jobs = append(jobs, j)
	}
	return jobs, rows.Err()
}
