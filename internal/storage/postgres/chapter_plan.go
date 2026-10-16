package postgres

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/jackc/pgx/v5"
	"inkloom/internal/agents/model"
	"inkloom/internal/app"
	"inkloom/internal/domain/planning"
	"reflect"
	"time"
)

func (s *Store) StartChapterPlan(ctx context.Context, scope string, r planning.ChapterPlanStartRequest, modelName string) (planning.ChapterPlanJob, bool, error) {
	var empty planning.ChapterPlanJob
	tx, iv, dv, err := s.lockPlanning(ctx, scope)
	if err != nil {
		return empty, false, err
	}
	defer tx.Rollback(context.Background())
	var raw []byte
	err = tx.QueryRow(ctx, "SELECT record FROM planning_chapter_plan_jobs WHERE id=$1 AND scope=$2", r.RequestID, scope).Scan(&raw)
	if err == nil {
		var j planning.ChapterPlanJob
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
	v, err := chapterPlanHeads(ctx, tx, scope, iv, dv)
	if err != nil {
		return empty, false, err
	}
	if v != r.Expected {
		return empty, false, app.ErrVersionMismatch
	}
	in, err := currentChapterPlanInput(ctx, tx, scope, v, r.ChapterID, r.Request)
	if err != nil {
		return empty, false, err
	}
	var busy bool
	if err = tx.QueryRow(ctx, "SELECT EXISTS(SELECT 1 FROM planning_chapter_plan_jobs WHERE scope=$1 AND status='running')", scope).Scan(&busy); err != nil {
		return empty, false, err
	}
	if busy {
		return empty, false, app.ErrRunBusy
	}
	j := planning.ChapterPlanJob{ID: r.RequestID, Version: 1, Status: "running", Request: r, Input: in, Model: modelName, PromptVersion: "showrunner.v1", SchemaVersion: "showrunner.v1", Calls: []model.CallRecord{}, CreatedAt: time.Now()}
	raw, _ = json.Marshal(j)
	if _, err = tx.Exec(ctx, "INSERT INTO planning_chapter_plan_jobs(id,scope,status,record) VALUES($1,$2,'running',$3)", j.ID, scope, raw); err != nil {
		return empty, false, err
	}
	return j, true, tx.Commit(ctx)
}
func (s *Store) RecordChapterPlanCall(ctx context.Context, id string, c model.CallRecord) error {
	raw, err := json.Marshal(c)
	if err != nil {
		return err
	}
	_, err = s.pool.Exec(ctx, "INSERT INTO planning_chapter_plan_calls VALUES($1,$2,$3) ON CONFLICT(job_id,number) DO UPDATE SET record=EXCLUDED.record", id, c.Number, raw)
	return err
}

// 模型局部 ID 改为任务命名空间内的稳定 ID；排序和编辑之后保持不变。
func namespaceChapterPlan(out planning.ChapterPlanContent, jobID string) planning.ChapterPlanContent {
	hash := fmt.Sprintf("%x", sha256.Sum256([]byte(jobID)))[:16]
	for i := range out.Scenes {
		out.Scenes[i].ID = fmt.Sprintf("cp-%s-s%d", hash, i+1)
		for k := range out.Scenes[i].Beats {
			b := &out.Scenes[i].Beats[k]
			id := fmt.Sprintf("cp-%s-s%d-b%d", hash, i+1, k+1)
			if out.Brief.SelectedBeatID == b.ID {
				out.Brief.SelectedBeatID = id
			}
			b.ID = id
		}
	}
	return out
}
func (s *Store) FinishChapterPlan(ctx context.Context, id string, out planning.ChapterPlanContent, runErr error) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(context.Background())
	var raw []byte
	err = tx.QueryRow(ctx, "SELECT record FROM planning_chapter_plan_jobs WHERE id=$1 AND status='running' FOR UPDATE", id).Scan(&raw)
	if errors.Is(err, pgx.ErrNoRows) {
		return app.ErrVersionMismatch
	}
	if err != nil {
		return err
	}
	var j planning.ChapterPlanJob
	if err = json.Unmarshal(raw, &j); err != nil {
		return err
	}
	j.Status = "failed"
	j.Message = "生成未完成，未采用细纲。请查看调用记录后手动重试。"
	if runErr == nil {
		if out.Validate(j.Input) != nil {
			return app.ErrInvalidWrite
		}
		// clone 避免修改调用者持有的模型输出。
		raw, _ = json.Marshal(out)
		var frozen planning.ChapterPlanContent
		if err = json.Unmarshal(raw, &frozen); err != nil {
			return err
		}
		frozen = namespaceChapterPlan(frozen, id)
		j.Status = "completed"
		j.Output = &frozen
		j.Message = "细纲候选，尚未确认；没有写入正文或角色知识。"
		if j.Model == "scripted-fake" || j.Model == "fake" {
			j.Message = "Fake 流程样例，不代表实际创作结果；仍须作者编辑确认。"
		}
	}
	raw, _ = json.Marshal(j)
	if _, err = tx.Exec(ctx, "UPDATE planning_chapter_plan_jobs SET status=$2,record=$3 WHERE id=$1", id, j.Status, raw); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func chapterPlanHeads(ctx context.Context, tx pgx.Tx, scope string, iv, dv int) (planning.ChapterPlanVersions, error) {
	v, ov, err := outlineHeads(ctx, tx, scope, iv, dv)
	if err != nil {
		return planning.ChapterPlanVersions{}, err
	}
	var bv int
	if ov > 0 {
		err = tx.QueryRow(ctx, "SELECT (record->>'bindingsVersion')::int FROM planning_outline_selections WHERE scope=$1 AND version=$2", scope, ov).Scan(&bv)
	}
	return planning.ChapterPlanVersions{Planning: v, Outline: ov, Bindings: bv}, err
}
func currentChapterPlanInput(ctx context.Context, tx pgx.Tx, scope string, v planning.ChapterPlanVersions, chapterID, request string) (planning.ChapterPlanInput, error) {
	var in planning.ChapterPlanInput
	if v.Outline < 1 {
		return in, app.ErrVersionMismatch
	}
	var raw []byte
	if err := tx.QueryRow(ctx, "SELECT record FROM planning_outline_selections WHERE scope=$1 AND version=$2", scope, v.Outline).Scan(&raw); err != nil {
		return in, err
	}
	if err := json.Unmarshal(raw, &in.Outline); err != nil {
		return in, err
	}
	if !in.Outline.Confirmed || in.Outline.Versions != v.Planning || in.Outline.BindingsVersion != v.Bindings {
		return in, app.ErrVersionMismatch
	}
	// 绑定从独立版本记录读取，与上游章纲和基础设定保持一致。
	if err := tx.QueryRow(ctx, "SELECT record FROM planning_outline_bindings WHERE scope=$1 AND version=$2 AND outline_version=$3 AND style_version=$4 AND core_version=$5", scope, v.Bindings, v.Outline, v.Planning.Style, v.Planning.Core).Scan(&raw); err != nil {
		return in, err
	}
	if err := json.Unmarshal(raw, &in.Outline.Content.Bindings); err != nil {
		return in, err
	}
	base, err := currentOutlineInput(ctx, tx, scope, v.Planning, "展开本章细纲", len(in.Outline.Content.Chapters))
	if err != nil {
		return in, err
	}
	in.Base = base
	in.ChapterID = chapterID
	in.Request = request
	if in.Validate() != nil {
		return in, app.ErrInvalidWrite
	}
	return in, nil
}
func (s *Store) SaveChapterPlan(ctx context.Context, scope string, r planning.ChapterPlanSaveRequest) (planning.ChapterPlanSelection, error) {
	var empty planning.ChapterPlanSelection
	if r.JobID == "" || len(r.JobID) > 80 || r.CandidateVersion < 1 || r.SourceVersion < 0 || r.ExpectedVersion < 0 {
		return empty, app.ErrInvalidWrite
	}
	tx, iv, dv, err := s.lockPlanning(ctx, scope)
	if err != nil {
		return empty, err
	}
	defer tx.Rollback(context.Background())
	v, err := chapterPlanHeads(ctx, tx, scope, iv, dv)
	if err != nil {
		return empty, err
	}
	var current int
	if err = tx.QueryRow(ctx, "SELECT COALESCE(MAX(version),0) FROM planning_chapter_plan_selections WHERE scope=$1 AND chapter_id=$2", scope, r.ChapterID).Scan(&current); err != nil {
		return empty, err
	}
	if v != r.Expected || current != r.ExpectedVersion {
		return empty, app.ErrVersionMismatch
	}
	in, err := currentChapterPlanInput(ctx, tx, scope, v, r.ChapterID, "作者复核本章细纲与 Brief")
	if err != nil {
		return empty, err
	}
	if r.Content.Validate(in) != nil {
		return empty, app.ErrInvalidWrite
	}
	var raw []byte
	if r.SourceVersion > 0 {
		if r.SourceVersion != current {
			return empty, app.ErrVersionMismatch
		}
		if err = tx.QueryRow(ctx, "SELECT record FROM planning_chapter_plan_selections WHERE scope=$1 AND chapter_id=$2 AND version=$3", scope, r.ChapterID, current).Scan(&raw); err != nil {
			return empty, err
		}
		var source planning.ChapterPlanSelection
		if err = json.Unmarshal(raw, &source); err != nil {
			return empty, err
		}
		if source.JobID != r.JobID || source.CandidateVersion != r.CandidateVersion {
			return empty, app.ErrInvalidWrite
		}
	} else {
		err = tx.QueryRow(ctx, "SELECT record FROM planning_chapter_plan_jobs WHERE id=$1 AND scope=$2", r.JobID, scope).Scan(&raw)
		if errors.Is(err, pgx.ErrNoRows) {
			return empty, app.ErrNotFound
		}
		if err != nil {
			return empty, err
		}
		var job planning.ChapterPlanJob
		if err = json.Unmarshal(raw, &job); err != nil {
			return empty, err
		}
		if job.Status != "completed" || job.Output == nil || job.Version != r.CandidateVersion || job.Input.ChapterID != r.ChapterID || job.Input.Versions() != v {
			return empty, app.ErrVersionMismatch
		}
	}
	// 保存规划确认；不发布正式知识、不创建正文、不启动 run。
	out := planning.ChapterPlanSelection{Version: current + 1, Versions: v, ChapterID: r.ChapterID, SourceVersion: r.SourceVersion, JobID: r.JobID, CandidateVersion: r.CandidateVersion, Input: in, Content: r.Content, Knowledge: r.Content.Knowledge(in), Confirmed: r.Confirmed, CreatedAt: time.Now()}
	raw, err = json.Marshal(out)
	if err != nil {
		return empty, err
	}
	if _, err = tx.Exec(ctx, "INSERT INTO planning_chapter_plan_selections VALUES($1,$2,$3,$4)", scope, r.ChapterID, out.Version, raw); err != nil {
		return empty, err
	}
	return out, tx.Commit(ctx)
}
func readChapterPlanPlanning(ctx context.Context, tx pgx.Tx, scope string, state *planning.State) error {
	rows, err := tx.Query(ctx, "SELECT DISTINCT ON(chapter_id) record FROM planning_chapter_plan_selections WHERE scope=$1 ORDER BY chapter_id,version DESC", scope)
	if err != nil {
		return err
	}
	for rows.Next() {
		var raw []byte
		var s planning.ChapterPlanSelection
		if err = rows.Scan(&raw); err != nil {
			rows.Close()
			return err
		}
		if err = json.Unmarshal(raw, &s); err != nil {
			rows.Close()
			return err
		}
		state.ChapterPlans = append(state.ChapterPlans, s)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return err
	}
	rows, err = tx.Query(ctx, `SELECT j.record,COALESCE((SELECT jsonb_agg(c.record ORDER BY number) FROM planning_chapter_plan_calls c WHERE c.job_id=j.id),'[]'::jsonb) FROM planning_chapter_plan_jobs j WHERE scope=$1 ORDER BY created_at DESC,id DESC LIMIT 20`, scope)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var raw, calls []byte
		var j planning.ChapterPlanJob
		if err = rows.Scan(&raw, &calls); err != nil {
			return err
		}
		if err = json.Unmarshal(raw, &j); err != nil {
			return err
		}
		if err = json.Unmarshal(calls, &j.Calls); err != nil {
			return err
		}
		state.ChapterPlanJobs = append(state.ChapterPlanJobs, j)
	}
	return rows.Err()
}
