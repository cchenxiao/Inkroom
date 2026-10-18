package postgres

import (
	"context"
	"encoding/json"
	"errors"
	"reflect"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"inkloom/internal/agents/model"
	"inkloom/internal/app"
	"inkloom/internal/config"
	"inkloom/internal/domain/manuscript"
)

func (s *Store) StartChapterFacts(ctx context.Context, scope string, req app.ChapterFactsRequest, cfg config.Config) (app.ChapterFactsJob, bool, error) {
	var job app.ChapterFactsJob
	if strings.TrimSpace(req.RequestID) == "" || len(req.RequestID) > 80 || req.ReviewID == "" || len(req.ReviewID) > 80 || len(req.InputDigest) != 64 || (req.Mode != "model" && req.Mode != "manual") {
		return job, false, app.ErrInvalidWrite
	}
	tx, _, _, err := s.lockPlanning(ctx, scope)
	if err != nil {
		return job, false, err
	}
	defer tx.Rollback(context.Background())
	var raw []byte
	err = tx.QueryRow(ctx, "SELECT record FROM chapter_fact_jobs WHERE id=$1", req.RequestID).Scan(&raw)
	if err == nil {
		if err = json.Unmarshal(raw, &job); err != nil {
			return job, false, err
		}
		if job.Scope != scope || !reflect.DeepEqual(job.Request, req) {
			return job, false, app.ErrActionMismatch
		}
		return job, false, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return job, false, err
	}
	j, err := readChapterReview(ctx, tx, scope, req.ReviewID)
	if err != nil {
		return job, false, err
	}
	j, err = decorateChapterReview(ctx, tx, j)
	if err != nil {
		return job, false, err
	}
	if !j.Current || j.InputDigest != req.InputDigest {
		return job, false, app.ErrVersionMismatch
	}
	if j.ApprovalBlock != "" || j.Decision == nil || j.Decision.Action != "approve" {
		return job, false, app.ErrGateBlocked
	}
	var published, busy bool
	if err = tx.QueryRow(ctx, "SELECT EXISTS(SELECT 1 FROM chapter_publications WHERE review_id=$1),EXISTS(SELECT 1 FROM chapter_fact_jobs WHERE scope=$2 AND status='running')", j.ID, scope).Scan(&published, &busy); err != nil {
		return job, false, err
	}
	if published {
		return job, false, app.ErrGateBlocked
	}
	if busy {
		return job, false, app.ErrRunBusy
	}
	a, err := readAssembly(ctx, tx, scope, j.Input.AssemblyID)
	if err != nil {
		return job, false, err
	}
	project, branch, _ := strings.Cut(scope, "/")
	if a.Knowledge == nil {
		return job, false, app.ErrContextMismatch
	}
	k, err := readKnowledge(ctx, tx, project, branch, a.Knowledge.Version)
	if err != nil {
		return job, false, err
	}
	if k.Digest != a.Knowledge.Digest {
		return job, false, app.ErrContextMismatch
	}
	job = app.ChapterFactsJob{ID: req.RequestID, Scope: scope, Request: req, Input: app.ChapterFactsInput{ChapterID: a.ChapterID, Review: j.Input, BaseKnowledge: *a.Knowledge, Knowledge: k.Snapshot}, Status: "running", Provider: cfg.Model, Model: cfg.ModelName, Calls: []model.CallRecord{}, CreatedAt: time.Now().UTC()}
	job.Input.CharacterNames = map[string]string{}
	for _, part := range a.Parts {
		var raw []byte
		if e := tx.QueryRow(ctx, "SELECT rc.input FROM manuscript_commits c JOIN run_contexts rc ON rc.run_id=c.run_id WHERE c.id=$1", part.CommitID).Scan(&raw); e != nil {
			return job, false, e
		}
		var frozen manuscript.FrozenInput
		if e := json.Unmarshal(raw, &frozen); e != nil {
			return job, false, e
		}
		b, ok := frozen.Bundle.ForBeat(part.BeatID)
		if !ok {
			return job, false, app.ErrContextMismatch
		}
		for _, c := range b.Characters {
			job.Input.CharacterNames[c.ID] = c.Name
		}
	}
	if req.Mode == "manual" {
		job.Status = "completed"
		job.Provider = "human"
		job.Model = ""
		job.Output = &app.ChapterFactsOutput{Candidates: []app.ChapterFactCandidate{}}
		job.Message = "请按原文补充候选并逐条决定"
	}
	raw, err = json.Marshal(job)
	if err != nil {
		return job, false, err
	}
	if _, err = tx.Exec(ctx, "INSERT INTO chapter_fact_jobs(id,scope,review_id,status,record) VALUES($1,$2,$3,$4,$5)", job.ID, scope, j.ID, job.Status, raw); err != nil {
		return job, false, err
	}
	if err = tx.Commit(ctx); err != nil {
		return job, false, err
	}
	return job, true, nil
}
func (s *Store) RecordChapterFactsCall(ctx context.Context, id string, c model.CallRecord) error {
	raw, err := json.Marshal(c)
	if err != nil {
		return err
	}
	_, err = s.pool.Exec(ctx, "INSERT INTO chapter_fact_calls VALUES($1,$2,$3) ON CONFLICT(job_id,number) DO UPDATE SET record=EXCLUDED.record", id, c.Number, raw)
	return err
}
func (s *Store) FinishChapterFacts(ctx context.Context, id string, out app.ChapterFactsOutput, runErr error) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(context.Background())
	var raw []byte
	var job app.ChapterFactsJob
	if err = tx.QueryRow(ctx, "SELECT record FROM chapter_fact_jobs WHERE id=$1 AND status='running' FOR UPDATE", id).Scan(&raw); errors.Is(err, pgx.ErrNoRows) {
		return app.ErrVersionMismatch
	} else if err != nil {
		return err
	}
	if err = json.Unmarshal(raw, &job); err != nil {
		return err
	}
	job.Status = "failed"
	job.Message = "事实候选提取未完成，请重试或手动整理"
	if runErr == nil {
		runErr = app.ValidateChapterFactCandidates(job.Input, out)
	}
	job.Failure = app.ClassifyChapterFactFailure(runErr)
	if job.Failure != nil {
		job.Message = job.Failure.Message
	}
	if runErr == nil {
		job.Status = "completed"
		job.Output = &out
		job.Message = "候选待作者逐条确认；空列表不表示没有新增事实"
	}
	raw, err = json.Marshal(job)
	if err != nil {
		return err
	}
	if _, err = tx.Exec(ctx, "UPDATE chapter_fact_jobs SET status=$2,record=$3 WHERE id=$1", id, job.Status, raw); err != nil {
		return err
	}
	return tx.Commit(ctx)
}
func (s *Store) ChapterFacts(ctx context.Context, scope, review string) (app.ChapterFactsState, error) {
	tx, _, _, err := s.lockPlanning(ctx, scope)
	if err != nil {
		return app.ChapterFactsState{}, err
	}
	defer tx.Rollback(context.Background())
	return chapterFactsState(ctx, tx, scope, review)
}
func chapterFactsState(ctx context.Context, tx pgx.Tx, scope, review string) (app.ChapterFactsState, error) {
	var out app.ChapterFactsState
	j, err := readChapterReview(ctx, tx, scope, review)
	if err != nil {
		return out, err
	}
	j, err = decorateChapterReview(ctx, tx, j)
	if err != nil {
		return out, err
	}
	out.Current = j.Current && j.Decision != nil && j.Decision.Action == "approve" && j.ApprovalBlock == ""
	if !out.Current {
		out.Block = "章稿或复审批次已变化，请重新审核"
	}
	if err = tx.QueryRow(ctx, "SELECT EXISTS(SELECT 1 FROM chapter_publications WHERE review_id=$1)", review).Scan(&out.Published); err != nil {
		return out, err
	}
	var raw []byte
	var job app.ChapterFactsJob
	err = tx.QueryRow(ctx, "SELECT record FROM chapter_fact_jobs WHERE scope=$1 AND review_id=$2 ORDER BY sequence DESC LIMIT 1", scope, review).Scan(&raw)
	if errors.Is(err, pgx.ErrNoRows) {
		return out, nil
	}
	if err != nil {
		return out, err
	}
	if err = json.Unmarshal(raw, &job); err != nil {
		return out, err
	}
	out.Job = &job
	rows, err := tx.Query(ctx, "SELECT record FROM chapter_fact_calls WHERE job_id=$1 ORDER BY number", job.ID)
	if err != nil {
		return out, err
	}
	job.Calls, err = pgx.CollectRows(rows, func(row pgx.CollectableRow) (model.CallRecord, error) {
		var c model.CallRecord
		var b []byte
		e := row.Scan(&b)
		if e == nil {
			e = json.Unmarshal(b, &c)
		}
		return c, e
	})
	if err != nil {
		return out, err
	}
	var sel app.ChapterFactsSelection
	err = tx.QueryRow(ctx, "SELECT record FROM chapter_fact_selections WHERE job_id=$1 ORDER BY version DESC LIMIT 1", job.ID).Scan(&raw)
	if err == nil {
		if err = json.Unmarshal(raw, &sel); err != nil {
			return out, err
		}
		out.Selection = &sel
	} else if !errors.Is(err, pgx.ErrNoRows) {
		return out, err
	}
	if !out.Current {
		return out, nil
	}
	if job.Status != "completed" || job.Output == nil {
		out.Block = "事实整理尚未完整完成，不能定稿"
	} else if out.Selection == nil {
		out.Block = "请保存逐条事实决定，再确认整章定稿"
	} else {
		out.Block = sel.Block
	}
	return out, nil
}
func (s *Store) SelectChapterFacts(ctx context.Context, scope string, req app.ChapterFactsSelectionRequest) (app.ChapterFactsSelection, error) {
	var empty app.ChapterFactsSelection
	if req.RequestID == "" || len(req.RequestID) > 80 || req.JobID == "" || len(req.JobID) > 80 || req.ExpectedVersion < 0 {
		return empty, app.ErrInvalidWrite
	}
	tx, _, _, err := s.lockPlanning(ctx, scope)
	if err != nil {
		return empty, err
	}
	defer tx.Rollback(context.Background())
	var raw []byte
	var job app.ChapterFactsJob
	if err = tx.QueryRow(ctx, "SELECT record FROM chapter_fact_jobs WHERE scope=$1 AND id=$2", scope, req.JobID).Scan(&raw); errors.Is(err, pgx.ErrNoRows) {
		return empty, app.ErrNotFound
	} else if err != nil {
		return empty, err
	}
	if err = json.Unmarshal(raw, &job); err != nil {
		return empty, err
	}
	err = tx.QueryRow(ctx, "SELECT record FROM chapter_fact_selections WHERE request_id=$1", req.RequestID).Scan(&raw)
	if err == nil {
		var old app.ChapterFactsSelection
		if err = json.Unmarshal(raw, &old); err != nil {
			return empty, err
		}
		if !reflect.DeepEqual(old.Request, req) {
			return empty, app.ErrActionMismatch
		}
		return old, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return empty, err
	}
	state, err := chapterFactsState(ctx, tx, scope, job.Request.ReviewID)
	if err != nil {
		return empty, err
	}
	if !state.Current || state.Job == nil || state.Job.ID != job.ID {
		return empty, app.ErrVersionMismatch
	}
	if state.Published || job.Status != "completed" || job.Output == nil {
		return empty, app.ErrGateBlocked
	}
	version := 0
	if state.Selection != nil {
		version = state.Selection.Version
	}
	if version != req.ExpectedVersion {
		return empty, app.ErrVersionMismatch
	}
	pack, block, err := app.BuildChapterFacts(job.Input, *job.Output, req)
	if err != nil {
		return empty, err
	}
	sel := app.ChapterFactsSelection{Version: version + 1, Request: req, Package: pack, Block: block, CreatedAt: time.Now().UTC()}
	raw, err = json.Marshal(sel)
	if err != nil {
		return empty, err
	}
	if _, err = tx.Exec(ctx, "INSERT INTO chapter_fact_selections VALUES($1,$2,$3,$4)", req.RequestID, job.ID, sel.Version, raw); err != nil {
		return empty, err
	}
	if err = tx.Commit(ctx); err != nil {
		return empty, err
	}
	return sel, nil
}
