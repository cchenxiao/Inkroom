package postgres

import (
	"context"
	"encoding/json"
	"inkloom/internal/app"
	"inkloom/internal/domain/manuscript"
	"inkloom/internal/domain/review"
)

func (s *Store) SaveCriticLookup(ctx context.Context, id string, c app.CriticLookup) error {
	if c.DraftVersion < 1 || len(c.InputDigest) != 64 || c.Review.Critic != "hard_consistency" || c.Review.DraftVersion != c.DraftVersion || c.Review.Lookup == nil || len(c.Review.Lookup.Steps) > 24 {
		return app.ErrInvalidWrite
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(context.Background())
	r, err := lockHuman(ctx, tx, id)
	if err != nil {
		return err
	}
	if r.Status != "running" || r.Result == nil || r.DraftVersion != c.DraftVersion {
		return app.ErrVersionMismatch
	}
	digest, err := manuscript.ContentDigest(struct {
		Context  manuscript.ContextBundle
		Segments []manuscript.Segment
	}{r.Result.Context, r.Result.Segments})
	if err != nil || digest != c.InputDigest {
		return app.ErrContextMismatch
	}
	counts := map[string]int{}
	for _, step := range c.Review.Lookup.Steps {
		if _, ok := r.Result.Context.ForBeat(step.Scope); step.Scope != "" && !ok {
			return app.ErrContextMismatch
		}
		counts[step.Scope]++
		if counts[step.Scope] > 3 {
			return app.ErrInvalidWrite
		}
	}
	b, err := c.Review.WithEvidence(r.Result.Context)
	if err != nil {
		return err
	}
	if c.Review.Status == "completed" {
		if c.Review.Lookup.Stop != "ready" {
			return app.ActionValidationError{Reason: "一致性查证尚未完成，不能保存为已完成的审核，请补齐查证后重试"}
		}
		if _, err = review.Aggregate(c.Review.Findings, r.Result.Segments, c.DraftVersion, b.ReadingSources()...); err != nil {
			return err
		}
	}
	raw, err := json.Marshal(c)
	if err != nil {
		return err
	}
	// 已完成的查证不可覆盖；显式重试仅能重新执行未完成的版本，仍受总调用预算约束。
	tag, err := tx.Exec(ctx, `INSERT INTO critic_lookups VALUES($1,$2,$3) ON CONFLICT(run_id,draft_version) DO UPDATE SET payload=EXCLUDED.payload WHERE critic_lookups.payload->'review'->>'status'<>'completed'`, id, c.DraftVersion, raw)
	if err != nil {
		return err
	}
	if tag.RowsAffected() != 1 {
		return app.ActionValidationError{Reason: "本版本的一致性查证结果已经保存，不能被旧请求覆盖，请更新状态查看结果"}
	}
	if err = appendEvent(ctx, tx, id, "critic.lookup"); err != nil {
		return err
	}
	return tx.Commit(ctx)
}
