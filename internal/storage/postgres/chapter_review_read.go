package postgres

import (
	"context"
	"encoding/json"
	"errors"
	"github.com/jackc/pgx/v5"
	"inkloom/internal/agents/model"
	"inkloom/internal/app"
)

func readChapterReview(ctx context.Context, tx pgx.Tx, scope, id string) (app.ChapterReviewJob, error) {
	var j app.ChapterReviewJob
	var raw []byte
	err := tx.QueryRow(ctx, "SELECT record FROM chapter_review_jobs WHERE scope=$1 AND id=$2", scope, id).Scan(&raw)
	if errors.Is(err, pgx.ErrNoRows) {
		return j, app.ErrNotFound
	}
	if err != nil {
		return j, err
	}
	err = json.Unmarshal(raw, &j)
	return j, err
}
func decorateChapterReview(ctx context.Context, tx pgx.Tx, j app.ChapterReviewJob) (app.ChapterReviewJob, error) {
	if (j.Status == "failed" || j.Status == "interrupted") && j.Failure == nil {
		j.Failure = app.DescribeChapterReviewFailure(errors.New(j.Message))
	}
	if j.Output != nil {
		for i := range j.Output.Critics {
			c := &j.Output.Critics[i]
			if c.Status == "failed" && c.Failure == nil {
				c.Failure = app.DescribeChapterReviewFailure(errors.New(c.Error))
			}
		}
	}

	a, err := readAssembly(ctx, tx, j.Scope, j.Input.AssemblyID)
	if err != nil {
		return j, err
	}
	j.Current, err = assemblyCurrent(ctx, tx, a)
	if err != nil {
		return j, err
	}
	var latest string
	if err = tx.QueryRow(ctx, "SELECT id FROM chapter_review_jobs WHERE scope=$1 AND assembly_id=$2 ORDER BY sequence DESC LIMIT 1", j.Scope, a.ID).Scan(&latest); err != nil {
		return j, err
	}
	j.Current = j.Current && latest == j.ID
	j.ApprovalBlock = app.ChapterReviewBlock(j)
	j.CanApproveAfterJudgement = app.ChapterReviewCanJudge(j)
	rows, err := tx.Query(ctx, "SELECT record FROM chapter_review_calls WHERE job_id=$1 ORDER BY number", j.ID)
	if err != nil {
		return j, err
	}
	j.Calls, err = pgx.CollectRows(rows, func(row pgx.CollectableRow) (model.CallRecord, error) {
		var c model.CallRecord
		var raw []byte
		e := row.Scan(&raw)
		if e == nil {
			e = json.Unmarshal(raw, &c)
		}
		return c, e
	})
	if err != nil {
		return j, err
	}
	var raw []byte
	err = tx.QueryRow(ctx, "SELECT record FROM chapter_review_decisions WHERE job_id=$1", j.ID).Scan(&raw)
	if errors.Is(err, pgx.ErrNoRows) {
		return j, nil
	}
	if err != nil {
		return j, err
	}
	var d app.ChapterReviewDecision
	if err = json.Unmarshal(raw, &d); err != nil {
		return j, err
	}
	j.Decision = &d
	j.ApprovalBlock = app.ChapterReviewBlock(j)
	j.CanApproveAfterJudgement = app.ChapterReviewCanJudge(j)
	return j, nil
}
func (s *Store) ChapterReviews(ctx context.Context, scope, assembly string) (app.ChapterReviewState, error) {
	out := app.ChapterReviewState{Jobs: []app.ChapterReviewJob{}}
	tx, _, _, err := s.lockPlanning(ctx, scope)
	if err != nil {
		return out, err
	}
	defer tx.Rollback(context.Background())
	a, err := readAssembly(ctx, tx, scope, assembly)
	if err != nil {
		return out, err
	}
	out.Current, err = assemblyCurrent(ctx, tx, a)
	if err != nil {
		return out, err
	}
	if !out.Current {
		out.Reason = "章稿来源或最新版本已变化，请重新组稿"
	}
	rows, err := tx.Query(ctx, "SELECT record FROM chapter_review_jobs WHERE scope=$1 AND assembly_id=$2 ORDER BY sequence DESC LIMIT 10", scope, assembly)
	if err != nil {
		return out, err
	}
	jobs, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (app.ChapterReviewJob, error) {
		var j app.ChapterReviewJob
		var raw []byte
		e := row.Scan(&raw)
		if e == nil {
			e = json.Unmarshal(raw, &j)
		}
		return j, e
	})
	if err != nil {
		return out, err
	}
	for _, j := range jobs {
		j, err = decorateChapterReview(ctx, tx, j)
		if err != nil {
			return out, err
		}
		out.Jobs = append(out.Jobs, j)
	}
	return out, nil
}
