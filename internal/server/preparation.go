package server

import (
	"context"
	"inkloom/internal/agents/model"
	"inkloom/internal/app"
	"inkloom/internal/domain/manuscript"
	"inkloom/internal/domain/memory"
	"time"
)

func (s *service) prepare(ctx context.Context, r app.Run) (app.Run, manuscript.FrozenInput, error) {
	if r.Planning != nil {
		input, err := s.repo.FrozenContext(ctx, r.ID)
		return r, input, err
	}
	base, err := s.repo.PreparationInput(ctx, r.ID)
	if err != nil {
		return r, base, err
	}
	// 准备阶段也受整条 run 的超时与调用预算约束，不占 HTTP 请求。
	input, err := app.LookupContext(ctx, s.cfg, base, s.retriever, func(_ context.Context, c model.CallRecord) error {
		save, stop := context.WithTimeout(context.Background(), 5*time.Second)
		defer stop()
		if c.Phase == "started" {
			current, e := s.repo.Draft(save, r.ChapterID, r.BranchID, 0)
			if e != nil {
				return e
			}
			if current.DraftVersion != r.BaseDraftVersion {
				return app.ErrVersionMismatch
			}
		}
		return s.repo.RecordCall(save, r.ID, c)
	}, func(trace memory.LookupTrace) error {
		save, stop := context.WithTimeout(context.Background(), 5*time.Second)
		defer stop()
		return s.repo.SaveLookup(save, r.ID, trace)
	})
	if err != nil {
		return r, input, err
	}
	if err = s.repo.SealPreparedContext(ctx, r.ID, input); err != nil {
		return r, input, err
	}
	r, err = s.repo.GetRun(ctx, r.ID)
	return r, input, err
}
