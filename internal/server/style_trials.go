package server

import (
	"context"
	"inkloom/internal/agents/model"
	"inkloom/internal/app"
	"inkloom/internal/domain/planning"
	"log/slog"
	"net/http"
	"time"
)

type styleTrialRepository interface {
	StartStyleTrial(context.Context, string, planning.StartTrialRequest, string) (planning.StyleJob, bool, error)
	FinishStyleTrial(context.Context, string, planning.TrialReport, error) error
	RecordStyleCall(context.Context, string, model.CallRecord) error
	SelectStyle(context.Context, string, planning.StyleSelectionRequest) (planning.StyleSelection, error)
}

func (s *service) generateStyleTrial(w http.ResponseWriter, r *http.Request) {
	var req planning.StartTrialRequest
	if !planningBody(w, r, &req) {
		return
	}
	if !planningID.MatchString(req.RequestID) || req.ExpectedInputVersion < 1 || req.ExpectedDirectionVersion < 1 {
		fail(w, 400, "invalid_request", "请先选定方向并提供请求标识")
		return
	}
	repo, ok := s.repo.(styleTrialRepository)
	if !ok {
		fail(w, 503, "planning_unavailable", "试笔存储不可用")
		return
	}
	job, created, err := repo.StartStyleTrial(r.Context(), planningScope, req, s.cfg.ModelName)
	if err != nil {
		storageError(w, err)
		return
	}
	if created {
		s.workers.Add(1)
		go func() {
			defer s.workers.Done()
			ctx, cancel := context.WithTimeout(s.root, 2*time.Minute)
			defer cancel()
			report, runErr := app.GenerateStyleTrials(ctx, s.cfg, job.Report.Input, func(_ context.Context, c model.CallRecord) error {
				saveCtx, stop := context.WithTimeout(context.Background(), 5*time.Second)
				defer stop()
				return repo.RecordStyleCall(saveCtx, job.ID, c)
			})
			if runErr != nil {
				slog.Warn("style trial failed", "job_id", job.ID, "error", runErr)
			}
			saveCtx, stop := context.WithTimeout(context.Background(), 5*time.Second)
			defer stop()
			if err := repo.FinishStyleTrial(saveCtx, job.ID, report, runErr); err != nil {
				slog.Error("style trial result not saved", "job_id", job.ID, "error", err)
			}
		}()
	}
	send(w, http.StatusAccepted, job)
}
func (s *service) selectStyle(w http.ResponseWriter, r *http.Request) {
	var req planning.StyleSelectionRequest
	if !planningBody(w, r, &req) {
		return
	}
	repo, ok := s.repo.(styleTrialRepository)
	if !ok {
		fail(w, 503, "planning_unavailable", "试笔存储不可用")
		return
	}
	value, err := repo.SelectStyle(r.Context(), planningScope, req)
	if err != nil {
		storageError(w, err)
		return
	}
	send(w, http.StatusOK, value)
}
