package postgres

import (
	"context"
	"encoding/json"
	"errors"

	"github.com/jackc/pgx/v5"
	"inkloom/internal/app"
	"inkloom/internal/domain/manuscript"
)

func (s *Store) CreatePreparedRun(ctx context.Context, r app.Run, in manuscript.FrozenInput) error {
	if err := in.Validate(); err != nil {
		return app.ErrContextMismatch
	}
	m := in.Manifest
	if m.RunID != r.ID || m.ChapterID != r.ChapterID || m.BranchID != r.BranchID || m.BaseDraftVersion != r.BaseDraftVersion {
		return app.ErrContextMismatch
	}
	r.InputDigest = m.Digest
	return s.createRun(ctx, r, &in, nil)
}
func (s *Store) FrozenContext(ctx context.Context, id string) (manuscript.FrozenInput, error) {
	return frozenContext(ctx, s.pool, id)
}
func frozenContext(ctx context.Context, q queryRow, id string) (manuscript.FrozenInput, error) {
	var in manuscript.FrozenInput
	var raw []byte
	err := q.QueryRow(ctx, "SELECT input FROM run_contexts WHERE run_id=$1", id).Scan(&raw)
	if errors.Is(err, pgx.ErrNoRows) {
		return in, app.ErrContextMismatch
	}
	if err != nil {
		return in, err
	}
	if err = json.Unmarshal(raw, &in); err != nil {
		return in, err
	}
	if err = in.Validate(); err != nil {
		return in, app.ErrContextMismatch
	}
	return in, nil
}
