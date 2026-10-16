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

func outlineHeads(ctx context.Context, tx pgx.Tx, scope string, iv, dv int) (planning.PlanningVersions, int, error) {
	v := planning.PlanningVersions{Input: iv, Direction: dv}
	var ov int
	err := tx.QueryRow(ctx, "SELECT style_version,core_version,outline_version FROM planning_heads WHERE scope=$1", scope).Scan(&v.Style, &v.Core, &ov)
	return v, ov, err
}
func currentOutlineInput(ctx context.Context, tx pgx.Tx, scope string, v planning.PlanningVersions, request string, count int) (planning.OutlineInput, error) {
	var in planning.OutlineInput
	base, err := currentCoreInput(ctx, tx, scope, v.Input, v.Direction, v.Style, request)
	if err != nil {
		return in, err
	}
	if v.Core < 1 {
		return in, app.ErrVersionMismatch
	}
	var raw []byte
	if err = tx.QueryRow(ctx, "SELECT record FROM planning_core_selections WHERE scope=$1 AND version=$2", scope, v.Core).Scan(&raw); err != nil {
		return in, err
	}
	in = planning.OutlineInput{Versions: v, Source: base.Source, Direction: base.Selection, Style: base.Style, Request: request, ChapterCount: count}
	if err = json.Unmarshal(raw, &in.Core); err != nil {
		return in, err
	}
	if in.Core.InputVersion != v.Input || in.Core.DirectionVersion != v.Direction || in.Core.StyleVersion != v.Style {
		return in, app.ErrVersionMismatch
	}
	if in.Validate() != nil {
		return in, app.ErrInvalidWrite
	}
	return in, nil
}
func (s *Store) StartOutline(ctx context.Context, scope string, r planning.OutlineStartRequest, modelName string) (planning.OutlineJob, bool, error) {
	var empty planning.OutlineJob
	tx, iv, dv, err := s.lockPlanning(ctx, scope)
	if err != nil {
		return empty, false, err
	}
	defer tx.Rollback(context.Background())
	var raw []byte
	err = tx.QueryRow(ctx, "SELECT record FROM planning_outline_jobs WHERE id=$1 AND scope=$2", r.RequestID, scope).Scan(&raw)
	if err == nil {
		var j planning.OutlineJob
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
	v, _, err := outlineHeads(ctx, tx, scope, iv, dv)
	if err != nil {
		return empty, false, err
	}
	if v != r.Expected {
		return empty, false, app.ErrVersionMismatch
	}
	in, err := currentOutlineInput(ctx, tx, scope, v, r.Request, r.ChapterCount)
	if err != nil {
		return empty, false, err
	}
	var busy bool
	if err = tx.QueryRow(ctx, "SELECT EXISTS(SELECT 1 FROM planning_outline_jobs WHERE scope=$1 AND status='running')", scope).Scan(&busy); err != nil {
		return empty, false, err
	}
	if busy {
		return empty, false, app.ErrRunBusy
	}
	j := planning.OutlineJob{ID: r.RequestID, Version: 1, Status: "running", Request: r, Input: in, Model: modelName, PromptVersion: "story_architect.v1", SchemaVersion: "story_architect.v1", Calls: []model.CallRecord{}, CreatedAt: time.Now()}
	raw, _ = json.Marshal(j)
	if _, err = tx.Exec(ctx, "INSERT INTO planning_outline_jobs(id,scope,status,record) VALUES($1,$2,'running',$3)", j.ID, scope, raw); err != nil {
		return empty, false, err
	}
	return j, true, tx.Commit(ctx)
}
func (s *Store) RecordOutlineCall(ctx context.Context, id string, c model.CallRecord) error {
	raw, err := json.Marshal(c)
	if err != nil {
		return err
	}
	_, err = s.pool.Exec(ctx, "INSERT INTO planning_outline_calls VALUES($1,$2,$3) ON CONFLICT(job_id,number) DO UPDATE SET record=EXCLUDED.record", id, c.Number, raw)
	return err
}

// 模型局部 ID 改为任务命名空间内的稳定 ID；排序和编辑之后保持不变。
func namespaceOutline(out planning.OutlineContent, jobID string) planning.OutlineContent {
	hash := fmt.Sprintf("%x", sha256.Sum256([]byte(jobID)))[:16]
	ids := map[string]string{}
	for i, a := range out.Acts {
		ids[a.ID] = fmt.Sprintf("ol-%s-a%d", hash, i+1)
	}
	for i, c := range out.Chapters {
		ids[c.ID] = fmt.Sprintf("ol-%s-c%d", hash, i+1)
	}
	for i := range out.Acts {
		out.Acts[i].ID = ids[out.Acts[i].ID]
	}
	for i := range out.Chapters {
		out.Chapters[i].ID = ids[out.Chapters[i].ID]
		out.Chapters[i].ActID = ids[out.Chapters[i].ActID]
	}
	for i := range out.Bindings.Style {
		out.Bindings.Style[i].ChapterID = ids[out.Bindings.Style[i].ChapterID]
	}
	for i := range out.Bindings.Plans {
		for k, id := range out.Bindings.Plans[i].ChapterIDs {
			out.Bindings.Plans[i].ChapterIDs[k] = ids[id]
		}
	}
	return out
}
func (s *Store) FinishOutline(ctx context.Context, id string, out planning.OutlineContent, runErr error) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(context.Background())
	var raw []byte
	err = tx.QueryRow(ctx, "SELECT record FROM planning_outline_jobs WHERE id=$1 AND status='running' FOR UPDATE", id).Scan(&raw)
	if errors.Is(err, pgx.ErrNoRows) {
		return app.ErrVersionMismatch
	}
	if err != nil {
		return err
	}
	var j planning.OutlineJob
	if err = json.Unmarshal(raw, &j); err != nil {
		return err
	}
	j.Status = "failed"
	j.Message = "生成未完成，未采用章纲。请查看调用记录后手动重试。"
	if runErr == nil {
		if out.Validate(j.Input) != nil || len(out.Chapters) != j.Input.ChapterCount {
			return app.ErrInvalidWrite
		}
		// clone 避免修改调用者持有的模型输出。
		raw, _ = json.Marshal(out)
		var frozen planning.OutlineContent
		if err = json.Unmarshal(raw, &frozen); err != nil {
			return err
		}
		frozen = namespaceOutline(frozen, id)
		j.Status = "completed"
		j.Output = &frozen
		j.Message = "章纲候选，尚未确认；没有写入正文或角色知识。"
		if j.Model == "scripted-fake" || j.Model == "fake" {
			j.Message = "Fake 流程样例，不代表实际创作结果；仍须作者编辑确认。"
		}
	}
	raw, _ = json.Marshal(j)
	if _, err = tx.Exec(ctx, "UPDATE planning_outline_jobs SET status=$2,record=$3 WHERE id=$1", id, j.Status, raw); err != nil {
		return err
	}
	return tx.Commit(ctx)
}
func (s *Store) SaveOutline(ctx context.Context, scope string, r planning.OutlineSaveRequest) (planning.OutlineSelection, error) {
	var empty planning.OutlineSelection
	if r.JobID == "" || len(r.JobID) > 80 || r.CandidateVersion < 1 || r.SourceOutlineVersion < 0 {
		return empty, app.ErrInvalidWrite
	}
	tx, iv, dv, err := s.lockPlanning(ctx, scope)
	if err != nil {
		return empty, err
	}
	defer tx.Rollback(context.Background())
	v, ov, err := outlineHeads(ctx, tx, scope, iv, dv)
	if err != nil {
		return empty, err
	}
	if v != r.Expected || ov != r.ExpectedOutlineVersion {
		return empty, app.ErrVersionMismatch
	}
	in, err := currentOutlineInput(ctx, tx, scope, v, "作者核对全书章纲", len(r.Content.Chapters))
	if err != nil {
		return empty, err
	}
	if r.Content.Validate(in) != nil {
		return empty, app.ErrInvalidWrite
	}
	var raw []byte
	if r.SourceOutlineVersion > 0 {
		if r.SourceOutlineVersion != ov {
			return empty, app.ErrVersionMismatch
		}
		if err = tx.QueryRow(ctx, "SELECT record FROM planning_outline_selections WHERE scope=$1 AND version=$2", scope, ov).Scan(&raw); err != nil {
			return empty, err
		}
		var source planning.OutlineSelection
		if err = json.Unmarshal(raw, &source); err != nil {
			return empty, err
		}
		if source.JobID != r.JobID || source.CandidateVersion != r.CandidateVersion {
			return empty, app.ErrInvalidWrite
		}
	} else {
		err = tx.QueryRow(ctx, "SELECT record FROM planning_outline_jobs WHERE id=$1 AND scope=$2", r.JobID, scope).Scan(&raw)
		if errors.Is(err, pgx.ErrNoRows) {
			return empty, app.ErrNotFound
		}
		if err != nil {
			return empty, err
		}
		var job planning.OutlineJob
		if err = json.Unmarshal(raw, &job); err != nil {
			return empty, err
		}
		if job.Status != "completed" || job.Output == nil || job.Version != r.CandidateVersion || job.Input.Versions != v {
			return empty, app.ErrVersionMismatch
		}
	}
	// 章纲与章节绑定作为两份版本化记录原子发布，没有反写上游或正文。
	out := planning.OutlineSelection{Version: ov + 1, BindingsVersion: ov + 1, Versions: v, SourceOutlineVersion: r.SourceOutlineVersion, JobID: r.JobID, CandidateVersion: r.CandidateVersion, Content: r.Content, Confirmed: r.Confirmed, CreatedAt: time.Now()}
	raw, _ = json.Marshal(out)
	if _, err = tx.Exec(ctx, "INSERT INTO planning_outline_selections VALUES($1,$2,$3)", scope, out.Version, raw); err != nil {
		return empty, err
	}
	bindingRaw, _ := json.Marshal(out.Content.Bindings)
	if _, err = tx.Exec(ctx, "INSERT INTO planning_outline_bindings VALUES($1,$2,$3,$4,$5,$6)", scope, out.BindingsVersion, out.Version, v.Style, v.Core, bindingRaw); err != nil {
		return empty, err
	}
	if _, err = tx.Exec(ctx, "UPDATE planning_heads SET outline_version=$2 WHERE scope=$1", scope, out.Version); err != nil {
		return empty, err
	}
	return out, tx.Commit(ctx)
}
func readOutlinePlanning(ctx context.Context, tx pgx.Tx, scope string, state *planning.State) error {
	var raw []byte
	if state.OutlineVersion > 0 {
		if err := tx.QueryRow(ctx, "SELECT record FROM planning_outline_selections WHERE scope=$1 AND version=$2", scope, state.OutlineVersion).Scan(&raw); err != nil {
			return err
		}
		if err := json.Unmarshal(raw, &state.OutlineSelection); err != nil {
			return err
		}
		selected := state.OutlineSelection
		if err := tx.QueryRow(ctx, "SELECT record FROM planning_outline_bindings WHERE scope=$1 AND version=$2 AND outline_version=$3 AND style_version=$4 AND core_version=$5", scope, selected.BindingsVersion, selected.Version, selected.Versions.Style, selected.Versions.Core).Scan(&raw); err != nil {
			return err
		}
		if err := json.Unmarshal(raw, &selected.Content.Bindings); err != nil {
			return err
		}
	}
	rows, err := tx.Query(ctx, `SELECT j.record,COALESCE((SELECT jsonb_agg(c.record ORDER BY number) FROM planning_outline_calls c WHERE c.job_id=j.id),'[]'::jsonb) FROM planning_outline_jobs j WHERE scope=$1 ORDER BY created_at DESC,id DESC LIMIT 20`, scope)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var calls []byte
		if err = rows.Scan(&raw, &calls); err != nil {
			return err
		}
		var j planning.OutlineJob
		if err = json.Unmarshal(raw, &j); err != nil {
			return err
		}
		if err = json.Unmarshal(calls, &j.Calls); err != nil {
			return err
		}
		state.OutlineJobs = append(state.OutlineJobs, j)
	}
	return rows.Err()
}
