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

func readAssembly(ctx context.Context, tx pgx.Tx, scope, id string) (app.ChapterAssembly, error) {
	var a app.ChapterAssembly
	var raw []byte
	err := tx.QueryRow(ctx, "SELECT record FROM chapter_assemblies WHERE scope=$1 AND id=$2", scope, id).Scan(&raw)
	if errors.Is(err, pgx.ErrNoRows) {
		return a, app.ErrNotFound
	}
	if err != nil {
		return a, err
	}
	err = json.Unmarshal(raw, &a)
	return a, err
}

// Planning head is already locked. assemblyPreview locks knowledge and draft heads in the same order as creation/approval.
func assemblyCurrent(ctx context.Context, tx pgx.Tx, a app.ChapterAssembly) (bool, error) {
	choices := map[string]string{}
	for _, p := range a.Parts {
		choices[p.BeatID] = p.CommitID
	}
	p, err := assemblyPreview(ctx, tx, a.Scope, app.AssemblyPreviewRequest{ChapterID: a.ChapterID, Choices: choices})
	if errors.Is(err, app.ErrVersionMismatch) || errors.Is(err, app.ErrInvalidWrite) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	if !p.Ready || len(p.History) == 0 || p.History[0].ID != a.ID {
		return false, nil
	}
	p.Draft.Version = a.Version
	digest, err := manuscript.ContentDigest(p.Draft)
	return digest == a.Digest, err
}
func (s *Store) StartChapterReview(ctx context.Context, scope string, req app.ChapterReviewRequest, cfg config.Config) (app.ChapterReviewJob, bool, error) {
	var j app.ChapterReviewJob
	if strings.TrimSpace(req.RequestID) == "" || len(req.RequestID) > 80 || req.AssemblyID == "" || len(req.AssemblyID) > 80 || req.AssemblyVersion < 1 || len(req.AssemblyDigest) != 64 {
		return j, false, app.ErrInvalidWrite
	}
	tx, _, _, err := s.lockPlanning(ctx, scope)
	if err != nil {
		return j, false, err
	}
	defer tx.Rollback(context.Background())
	old, err := readChapterReview(ctx, tx, scope, req.RequestID)
	if err == nil {
		if !reflect.DeepEqual(old.Request, req) {
			return j, false, app.ErrActionMismatch
		}
		old, err = decorateChapterReview(ctx, tx, old)
		return old, false, err
	}
	if !errors.Is(err, app.ErrNotFound) {
		return j, false, err
	}
	a, err := readAssembly(ctx, tx, scope, req.AssemblyID)
	if err != nil {
		return j, false, err
	}
	if a.Version != req.AssemblyVersion || a.Digest != req.AssemblyDigest {
		return j, false, app.ErrVersionMismatch
	}
	current, err := assemblyCurrent(ctx, tx, a)
	if err != nil {
		return j, false, err
	}
	if !current {
		return j, false, app.ErrVersionMismatch
	}
	var busy bool
	if err = tx.QueryRow(ctx, "SELECT EXISTS(SELECT 1 FROM chapter_review_jobs WHERE scope=$1 AND status='running')", scope).Scan(&busy); err != nil {
		return j, false, err
	}
	if busy {
		return j, false, app.ErrRunBusy
	}
	contexts := map[string]manuscript.FrozenInput{}
	for _, part := range a.Parts {
		var raw []byte
		var c app.FinalCommit
		if err = tx.QueryRow(ctx, "SELECT payload FROM manuscript_commits WHERE id=$1", part.CommitID).Scan(&raw); err != nil {
			return j, false, err
		}
		if err = json.Unmarshal(raw, &c); err != nil {
			return j, false, err
		}
		if c.DraftVersion != part.DraftVersion || !reflect.DeepEqual(c.Segments, part.Segments) {
			return j, false, app.ErrContextMismatch
		}
		input, e := frozenContext(ctx, tx, c.RunID)
		if e != nil {
			return j, false, e
		}
		contexts[part.CommitID] = input
	}
	input, err := app.BuildChapterReviewInput(a, contexts)
	if err != nil {
		return j, false, err
	}
	input.EnhancedContinuity = req.EnhancedContinuity
	digest, err := manuscript.ContentDigest(input)
	if err != nil {
		return j, false, err
	}
	j = app.ChapterReviewJob{ID: req.RequestID, Scope: scope, ChapterID: a.ChapterID, Status: "running", Request: req, Input: input, InputDigest: digest, Provider: cfg.Model, Model: cfg.ModelName, Calls: []model.CallRecord{}, CreatedAt: time.Now().UTC()}
	raw, err := json.Marshal(j)
	if err != nil {
		return j, false, err
	}
	if _, err = tx.Exec(ctx, "INSERT INTO chapter_review_jobs(id,scope,assembly_id,status,record) VALUES($1,$2,$3,$4,$5)", j.ID, scope, a.ID, j.Status, raw); err != nil {
		return j, false, err
	}
	if err = tx.Commit(ctx); err != nil {
		return j, false, err
	}
	j.Current = true
	j.ApprovalBlock = app.ChapterReviewBlock(j)
	return j, true, nil
}
func (s *Store) RecordChapterReviewCall(ctx context.Context, id string, c model.CallRecord) error {
	raw, err := json.Marshal(c)
	if err != nil {
		return err
	}
	_, err = s.pool.Exec(ctx, "INSERT INTO chapter_review_calls VALUES($1,$2,$3) ON CONFLICT(job_id,number) DO UPDATE SET record=EXCLUDED.record", id, c.Number, raw)
	return err
}
func (s *Store) FinishChapterReview(ctx context.Context, id string, out app.ChapterReviewOutput, runErr error) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(context.Background())
	var raw []byte
	var j app.ChapterReviewJob
	err = tx.QueryRow(ctx, "SELECT record FROM chapter_review_jobs WHERE id=$1 AND status='running' FOR UPDATE", id).Scan(&raw)
	if errors.Is(err, pgx.ErrNoRows) {
		return app.ErrVersionMismatch
	}
	if err != nil {
		return err
	}
	if err = json.Unmarshal(raw, &j); err != nil {
		return err
	}
	if out.Critics == nil {
		out.Critics = []app.ChapterCriticResult{}
	}
	j.Output = &out
	j.Status = "failed"
	j.Message = "整章复审未完整完成，不能批准；可查看调用记录后手动重试。"
	if runErr != nil {
		j.Message = runErr.Error()
	}
	valid := len(out.Critics) == 2
	seen := map[string]bool{}
	for _, c := range out.Critics {
		if seen[c.Critic] || (c.Critic != "hard_consistency" && c.Critic != "ai_taste") || c.Status != "completed" || app.ValidateChapterFindings(j.Input, c.Critic, c.Findings) != nil {
			valid = false
		}
		seen[c.Critic] = true
	}
	if runErr == nil && valid {
		j.Status = "completed"
		j.Message = "整章复审已完成，等待作者决定；空意见不表示查证完备。"
	} else if runErr == nil {
		j.Output = nil
	}
	raw, err = json.Marshal(j)
	if err != nil {
		return err
	}
	if _, err = tx.Exec(ctx, "UPDATE chapter_review_jobs SET status=$2,record=$3 WHERE id=$1", id, j.Status, raw); err != nil {
		return err
	}
	return tx.Commit(ctx)
}
func (s *Store) DecideChapterReview(ctx context.Context, scope, id string, req app.ChapterReviewDecision) (app.ChapterReviewJob, error) {
	var empty app.ChapterReviewJob
	if strings.TrimSpace(req.RequestID) == "" || len(req.RequestID) > 80 || req.AssemblyVersion < 1 || len(req.InputDigest) != 64 || (req.Action != "approve" && req.Action != "request_changes") || strings.TrimSpace(req.Reason) == "" || len(req.Reason) > 2400 {
		return empty, app.ErrInvalidWrite
	}
	req.CreatedAt = time.Time{} // server owns timestamps
	tx, _, _, err := s.lockPlanning(ctx, scope)
	if err != nil {
		return empty, err
	}
	defer tx.Rollback(context.Background())
	j, err := readChapterReview(ctx, tx, scope, id)
	if err != nil {
		return empty, err
	}
	var raw []byte
	var owner string
	err = tx.QueryRow(ctx, "SELECT job_id,record FROM chapter_review_decisions WHERE request_id=$1 OR job_id=$2", req.RequestID, id).Scan(&owner, &raw)
	if err == nil {
		var old app.ChapterReviewDecision
		if err = json.Unmarshal(raw, &old); err != nil {
			return empty, err
		}
		old.CreatedAt = time.Time{}
		if owner != id || !reflect.DeepEqual(old, req) {
			return empty, app.ErrActionMismatch
		}
		return decorateChapterReview(ctx, tx, j)
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return empty, err
	}
	j, err = decorateChapterReview(ctx, tx, j)
	if err != nil {
		return empty, err
	}
	if !j.Current || req.AssemblyVersion != j.Input.DraftVersion || req.InputDigest != j.InputDigest {
		return empty, app.ErrVersionMismatch
	}
	if j.Status == "running" || req.Action == "approve" && j.ApprovalBlock != "" {
		return empty, app.ErrGateBlocked
	}
	req.CreatedAt = time.Now().UTC()
	raw, err = json.Marshal(req)
	if err != nil {
		return empty, err
	}
	if _, err = tx.Exec(ctx, "INSERT INTO chapter_review_decisions VALUES($1,$2,$3)", req.RequestID, id, raw); err != nil {
		return empty, err
	}
	if err = tx.Commit(ctx); err != nil {
		return empty, err
	}
	j.Decision = &req
	return j, nil
}
