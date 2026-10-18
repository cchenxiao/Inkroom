package postgres

import (
	"context"
	"encoding/json"
	"errors"
	"github.com/jackc/pgx/v5"
	"inkloom/internal/app"
)

// Dismissal changes the author's working choice, never deletes a draft, adoption,
// chapter review or fact selection. Every affected beat must have an adopted fallback.
func canDismissCandidate(ctx context.Context, q queryRow, r app.Run) (bool, error) {
	if r.Dismissed || r.Planning == nil || r.CommitID != "" || r.Result == nil || len(r.Result.Segments) == 0 || r.Status == "running" || r.PendingAction != nil {
		return false, nil
	}
	var head int
	if err := q.QueryRow(ctx, "SELECT draft_version FROM chapters WHERE id=$1 AND branch_id=$2", r.ChapterID, r.BranchID).Scan(&head); err != nil {
		return false, err
	}
	if head != r.DraftVersion {
		return false, nil
	}
	seen := map[string]bool{}
	for _, seg := range r.Result.Segments {
		if seen[seg.BeatID] {
			continue
		}
		seen[seg.BeatID] = true
		p, err := adoptedPassage(ctx, q, r.Planning.Scope, r.Planning.ChapterID, seg.BeatID)
		if err != nil {
			return false, err
		}
		if p.Version == 0 {
			return false, nil
		}
	}
	return true, nil
}

func (s *Store) DismissPlannedCandidate(ctx context.Context, scope, id string, version int) (app.Run, error) {
	tx, _, _, err := s.lockPlanning(ctx, scope)
	if err != nil {
		return app.Run{}, err
	}
	defer tx.Rollback(context.Background())
	var chapter, branch string
	err = tx.QueryRow(ctx, `SELECT r.chapter_id,r.branch_id FROM runs r JOIN planning_run_inputs p ON p.run_id=r.id WHERE r.id=$1 AND p.scope=$2`, id, scope).Scan(&chapter, &branch)
	if errors.Is(err, pgx.ErrNoRows) {
		return app.Run{}, app.ErrNotFound
	}
	if err != nil {
		return app.Run{}, err
	}
	var head int
	if err = tx.QueryRow(ctx, "SELECT draft_version FROM chapters WHERE id=$1 AND branch_id=$2 FOR UPDATE", chapter, branch).Scan(&head); err != nil {
		return app.Run{}, err
	}
	var raw []byte
	if err = tx.QueryRow(ctx, "SELECT payload FROM runs WHERE id=$1 FOR UPDATE", id).Scan(&raw); err != nil {
		return app.Run{}, err
	}
	var r app.Run
	if err = json.Unmarshal(raw, &r); err != nil {
		return r, err
	}
	if r.DraftVersion != version {
		return r, app.ErrVersionMismatch
	}
	if r.Dismissed {
		return s.GetRun(ctx, id)
	} // Safe retry after an uncertain response.
	if head != version {
		return r, app.ErrVersionMismatch
	}
	allowed, err := canDismissCandidate(ctx, tx, r)
	if err != nil {
		return r, err
	}
	if !allowed {
		return r, app.ErrGateBlocked
	}
	r.Dismissed = true
	if err = saveRun(ctx, tx, r); err != nil {
		return r, err
	}
	if err = tx.Commit(ctx); err != nil {
		return r, err
	}
	return s.GetRun(ctx, id)
}
