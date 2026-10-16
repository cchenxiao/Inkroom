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

type styleAnalysisRepository interface {
	StartStyleAnalysis(context.Context, string, planning.StyleAnalysisRequest, string) (planning.StyleAnalysisJob, bool, error)
	FinishStyleAnalysis(context.Context, string, planning.StyleAnalysisOutput, error) error
	RecordStyleAnalysisCall(context.Context, string, model.CallRecord) error
	ListStyleAnalyses(context.Context, string) ([]planning.StyleAnalysisJob, error)
}

func (s *service) listStyleAnalyses(w http.ResponseWriter, r *http.Request) {
	repo, ok := s.repo.(styleAnalysisRepository)
	if !ok {
		fail(w, 503, "planning_unavailable", "风格分析存储不可用")
		return
	}
	jobs, err := repo.ListStyleAnalyses(r.Context(), planningScope)
	if err != nil {
		storageError(w, err)
		return
	}
	send(w, 200, jobs)
}
func (s *service) analyzeStyle(w http.ResponseWriter, r *http.Request) {
	var req planning.StyleAnalysisRequest
	if !planningBodyLimit(w, r, &req, 256*1024) {
		return
	}
	if !planningID.MatchString(req.RequestID) {
		fail(w, 400, "invalid_request", "请求标识无效")
		return
	}
	if _, err := planning.NewStyleAnalysisInput(req.Title, req.Text); err != nil {
		fail(w, 400, "invalid_reference", err.Error())
		return
	}
	repo, ok := s.repo.(styleAnalysisRepository)
	if !ok {
		fail(w, 503, "planning_unavailable", "风格分析存储不可用")
		return
	}
	job, created, err := repo.StartStyleAnalysis(r.Context(), planningScope, req, s.cfg.ModelName)
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
			output, runErr := app.AnalyzeReferenceStyle(ctx, s.cfg, job.Input, func(_ context.Context, c model.CallRecord) error {
				saveCtx, stop := context.WithTimeout(context.Background(), 5*time.Second)
				defer stop()
				return repo.RecordStyleAnalysisCall(saveCtx, job.ID, c)
			})
			if runErr != nil {
				slog.Warn("style analysis failed", "job_id", job.ID, "error", runErr)
			}
			saveCtx, stop := context.WithTimeout(context.Background(), 5*time.Second)
			defer stop()
			if err := repo.FinishStyleAnalysis(saveCtx, job.ID, output, runErr); err != nil {
				slog.Error("style analysis not saved", "job_id", job.ID, "error", err)
			}
		}()
	}
	send(w, http.StatusAccepted, job)
}
