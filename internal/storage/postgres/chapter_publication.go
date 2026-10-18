package postgres

import (
	"context"
	"encoding/json"
	"errors"
	"reflect"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"inkloom/internal/app"
)

// PublishChapter uses the same planning → knowledge → draft locks as review approval.
// After waiting for those locks, it revalidates the review, its decision and all sources.
func (s *Store) PublishChapter(ctx context.Context, scope string, req app.ChapterPublicationRequest) (app.ChapterPublicationState, error) {
	var out app.ChapterPublicationState
	if strings.TrimSpace(req.RequestID) == "" || len(req.RequestID) > 80 || req.ReviewID == "" || len(req.ReviewID) > 80 || req.AssemblyVersion < 1 || len(req.InputDigest) != 64 || req.ApprovalID == "" || len(req.ApprovalID) > 80 {
		return out, app.ErrInvalidWrite
	}
	if !req.NoPendingFacts {
		return out, app.ErrFactsUnconfirmed
	}
	tx, _, _, err := s.lockPlanning(ctx, scope)
	if err != nil {
		return out, err
	}
	defer tx.Rollback(context.Background())
	// A committed request remains retrievable after edits. It never approves the new version.
	var raw []byte
	err = tx.QueryRow(ctx, "SELECT record FROM chapter_publications WHERE id=$1 OR review_id=$2 ORDER BY (id=$1) DESC LIMIT 1", req.RequestID, req.ReviewID).Scan(&raw)
	if err == nil {
		var old app.ChapterPublication
		if err = json.Unmarshal(raw, &old); err != nil {
			return out, err
		}
		if old.Scope != scope || !reflect.DeepEqual(old.Request, req) {
			return out, app.ErrActionMismatch
		}
		return decoratePublication(ctx, tx, old)
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return out, err
	}
	j, err := readChapterReview(ctx, tx, scope, req.ReviewID)
	if err != nil {
		return out, err
	}
	j, err = decorateChapterReview(ctx, tx, j)
	if err != nil {
		return out, err
	}
	if !j.Current || req.AssemblyVersion != j.Input.DraftVersion || req.InputDigest != j.InputDigest {
		return out, app.ErrVersionMismatch
	}
	if j.ApprovalBlock != "" {
		return out, app.ActionValidationError{Reason: j.ApprovalBlock}
	}
	if j.Decision == nil || j.Decision.Action != "approve" {
		return out, app.ActionValidationError{Reason: "请先确认整章复审通过，再核对事实并定稿"}
	}
	if j.Decision.RequestID != req.ApprovalID {
		return out, app.ErrVersionMismatch
	}
	facts, err := chapterFactsState(ctx, tx, scope, j.ID)
	if err != nil {
		return out, err
	}
	if facts.Block != "" {
		return out, app.ActionValidationError{Reason: facts.Block, Cause: app.ErrFactsUnconfirmed}
	}
	if facts.Job != nil {
		if facts.Selection == nil || req.FactJobID != facts.Job.ID || req.FactVersion != facts.Selection.Version {
			return out, app.ErrVersionMismatch
		}
	} else if req.FactJobID != "" || req.FactVersion != 0 {
		return out, app.ErrVersionMismatch
	}
	a, err := readAssembly(ctx, tx, scope, j.Input.AssemblyID)
	if err != nil {
		return out, err
	}
	p := app.ChapterPublication{ID: req.RequestID, Scope: scope, ChapterID: a.ChapterID, Version: 1, Request: req, Assembly: a, Review: j,
		FactConfirmation: app.FactConfirmation{DraftVersion: a.Version, Method: "author_no_pending_facts", NoPendingFacts: true}, CreatedAt: time.Now().UTC()}
	p.FactReview, p.FactSelection = facts.Job, facts.Selection
	if facts.Selection != nil {
		p.FactConfirmation.Method = "author_reviewed_fact_candidates"
	}
	var parentVersion int
	err = tx.QueryRow(ctx, "SELECT id,version FROM chapter_publications WHERE scope=$1 AND chapter_id=$2 ORDER BY version DESC LIMIT 1", scope, a.ChapterID).Scan(&p.ParentPublicationID, &parentVersion)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return out, err
	}
	p.Version = parentVersion + 1
	raw, err = json.Marshal(p)
	if err != nil {
		return out, err
	}
	_, err = tx.Exec(ctx, "INSERT INTO chapter_publications(id,scope,chapter_id,review_id,assembly_id,approval_id,version,record) VALUES($1,$2,$3,$4,$5,$6,$7,$8)", p.ID, scope, p.ChapterID, j.ID, a.ID, req.ApprovalID, p.Version, raw)
	var conflict *pgconn.PgError
	if errors.As(err, &conflict) && conflict.Code == "23505" {
		return out, app.ErrActionMismatch
	}
	if err != nil {
		return out, err
	}
	if err = tx.Commit(ctx); err != nil {
		return out, err
	}
	return app.ChapterPublicationState{Publication: &p, Current: true}, nil
}

func decoratePublication(ctx context.Context, tx pgx.Tx, p app.ChapterPublication) (app.ChapterPublicationState, error) {
	out := app.ChapterPublicationState{Publication: &p}
	j, err := readChapterReview(ctx, tx, p.Scope, p.Request.ReviewID)
	if err != nil {
		return out, err
	}
	j, err = decorateChapterReview(ctx, tx, j)
	if err != nil {
		return out, err
	}
	var latest string
	if err = tx.QueryRow(ctx, "SELECT id FROM chapter_publications WHERE scope=$1 AND chapter_id=$2 ORDER BY version DESC LIMIT 1", p.Scope, p.ChapterID).Scan(&latest); err != nil {
		return out, err
	}
	out.Current = latest == p.ID && j.Current && j.ApprovalBlock == "" && j.Decision != nil && j.Decision.Action == "approve" && j.Decision.RequestID == p.Request.ApprovalID
	if !out.Current {
		out.Reason = "这是历史定稿；正文、规划、知识或复审批次已有变化，不能作为当前有效定稿。"
	}
	return out, nil
}

func (s *Store) ChapterPublication(ctx context.Context, scope, reviewID string) (app.ChapterPublicationState, error) {
	var out app.ChapterPublicationState
	tx, _, _, err := s.lockPlanning(ctx, scope)
	if err != nil {
		return out, err
	}
	defer tx.Rollback(context.Background())
	if _, err = readChapterReview(ctx, tx, scope, reviewID); err != nil {
		return out, err
	}
	var raw []byte
	err = tx.QueryRow(ctx, "SELECT record FROM chapter_publications WHERE scope=$1 AND review_id=$2", scope, reviewID).Scan(&raw)
	if errors.Is(err, pgx.ErrNoRows) {
		return out, nil
	}
	if err != nil {
		return out, err
	}
	var p app.ChapterPublication
	if err = json.Unmarshal(raw, &p); err != nil {
		return out, err
	}
	return decoratePublication(ctx, tx, p)
}
