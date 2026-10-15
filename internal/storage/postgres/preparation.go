package postgres

import (
	"context"
	"encoding/json"
	"errors"

	"inkloom/internal/app"
	"inkloom/internal/domain/manuscript"
	"inkloom/internal/domain/memory"
)

func (s *Store) CreatePreparingRun(ctx context.Context, r app.Run, in manuscript.FrozenInput) error {
	m := in.Manifest
	if in.Validate() != nil || r.Status != "running" || r.CurrentNode != "context_assemble" || r.InputDigest != "" || m.RunID != r.ID || m.ChapterID != r.ChapterID || m.BranchID != r.BranchID || m.BaseDraftVersion != r.BaseDraftVersion {
		return app.ErrContextMismatch
	}
	return s.createRun(ctx, r, nil, &in)
}
func (s *Store) PreparationInput(ctx context.Context, id string) (manuscript.FrozenInput, error) {
	var in manuscript.FrozenInput
	var raw []byte
	if err := s.pool.QueryRow(ctx, "SELECT input FROM run_preparations WHERE run_id=$1", id).Scan(&raw); err != nil {
		return in, err
	}
	if err := json.Unmarshal(raw, &in); err != nil {
		return in, err
	}
	return in, in.Validate()
}
func (s *Store) SaveLookup(ctx context.Context, id string, trace memory.LookupTrace) error {
	if len(trace.Steps) > 3 {
		return app.ErrInvalidWrite
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(context.Background())
	var raw []byte
	if err = tx.QueryRow(ctx, "SELECT payload FROM runs WHERE id=$1 FOR UPDATE", id).Scan(&raw); err != nil {
		return err
	}
	r, err := decodeRun(raw)
	if err != nil {
		return err
	}
	if r.Status != "running" || r.CurrentNode != "context_assemble" {
		return app.ErrVersionMismatch
	}
	r.Lookup = &trace
	raw, err = json.Marshal(r)
	if err != nil {
		return err
	}
	if _, err = tx.Exec(ctx, "UPDATE runs SET payload=$2,updated_at=now() WHERE id=$1", id, raw); err != nil {
		return err
	}
	if err = appendEvent(ctx, tx, id, "context.lookup"); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// SealPreparedContext 原子校验作者稿本并写入唯一的最终上下文；重启不重跑准备阶段。
func (s *Store) SealPreparedContext(ctx context.Context, id string, in manuscript.FrozenInput) error {
	if in.Validate() != nil || in.Manifest.RunID != id {
		return app.ErrContextMismatch
	}
	base, err := s.PreparationInput(ctx, id)
	if err != nil {
		return err
	}
	candidate := in.Bundle
	candidate.Retrieval = nil
	candidate.POVCharacterID = base.Bundle.POVCharacterID
	digest, err := manuscript.ContentDigest(candidate)
	if err != nil || digest != base.Manifest.Digest || in.Manifest.BaseDraftVersion != base.Manifest.BaseDraftVersion || in.Manifest.Budget != base.Manifest.Budget || in.Manifest.ReservedOutputTokens != base.Manifest.ReservedOutputTokens {
		return app.ErrContextMismatch
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(context.Background())
	var current int
	if err = tx.QueryRow(ctx, "SELECT draft_version FROM chapters WHERE id=$1 AND branch_id=$2 FOR UPDATE", base.Bundle.ChapterID, base.Bundle.BranchID).Scan(&current); err != nil {
		return err
	}
	if current != base.Manifest.BaseDraftVersion {
		return app.ErrVersionMismatch
	}
	var raw []byte
	if err = tx.QueryRow(ctx, "SELECT payload FROM runs WHERE id=$1 FOR UPDATE", id).Scan(&raw); err != nil {
		return err
	}
	r, err := decodeRun(raw)
	if err != nil {
		return err
	}
	if r.Status != "running" || r.CurrentNode != "context_assemble" || r.Lookup == nil || r.Lookup.Stop != "ready" {
		return app.ErrGateBlocked
	}
	if _, err = frozenContext(ctx, tx, id); !errors.Is(err, app.ErrContextMismatch) {
		if err == nil {
			return app.ErrGateBlocked
		}
		return err
	}
	raw, err = json.Marshal(in)
	if err != nil {
		return err
	}
	if _, err = tx.Exec(ctx, "INSERT INTO run_contexts VALUES($1,$2)", id, raw); err != nil {
		return err
	}
	r.InputDigest = in.Manifest.Digest
	r.CurrentNode = "draft"
	raw, err = json.Marshal(r)
	if err != nil {
		return err
	}
	if _, err = tx.Exec(ctx, "UPDATE runs SET payload=$2,updated_at=now() WHERE id=$1", id, raw); err != nil {
		return err
	}
	if err = appendEvent(ctx, tx, id, "context.ready"); err != nil {
		return err
	}
	return tx.Commit(ctx)
}
