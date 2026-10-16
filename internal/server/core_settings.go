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

type coreSettingsRepository interface {
	StartCoreSettings(context.Context, string, planning.CoreStartRequest, string) (planning.CoreJob, bool, error)
	FinishCoreSettings(context.Context, string, app.CoreSettingsReport, error) error
	RecordCoreCall(context.Context, string, model.CallRecord) error
	SaveCoreSettings(context.Context, string, planning.CoreSaveRequest) (planning.CoreSelection, error)
}

func (s *service) generateCoreSettings(w http.ResponseWriter, r *http.Request) {
	var req planning.CoreStartRequest
	if !planningBody(w, r, &req) {
		return
	}
	if !planningID.MatchString(req.RequestID) {
		fail(w, 400, "invalid_request", "请求标识无效")
		return
	}
	repo, ok := s.repo.(coreSettingsRepository)
	if !ok {
		fail(w, 503, "planning_unavailable", "设定存储不可用")
		return
	}
	job, created, err := repo.StartCoreSettings(r.Context(), planningScope, req, s.cfg.ModelName)
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
			report, runErr := app.GenerateCoreSettingsWithCalls(ctx, s.cfg, job.Input, func(_ context.Context, c model.CallRecord) error {
				saveCtx, stop := context.WithTimeout(context.Background(), 5*time.Second)
				defer stop()
				return repo.RecordCoreCall(saveCtx, job.ID, c)
			})
			if runErr != nil {
				slog.Warn("core settings generation failed", "job_id", job.ID, "error", runErr)
			}
			saveCtx, stop := context.WithTimeout(context.Background(), 5*time.Second)
			defer stop()
			if err := repo.FinishCoreSettings(saveCtx, job.ID, report, runErr); err != nil {
				slog.Error("core settings not saved", "job_id", job.ID, "error", err)
			}
		}()
	}
	send(w, http.StatusAccepted, job)
}
func (s *service) saveCoreSettings(w http.ResponseWriter, r *http.Request) {
	var req planning.CoreSaveRequest
	if !planningBodyLimit(w, r, &req, 96*1024) {
		return
	}
	if err := req.Validate(); err != nil {
		fail(w, 400, "invalid_core_settings", err.Error())
		return
	}
	repo, ok := s.repo.(coreSettingsRepository)
	if !ok {
		fail(w, 503, "planning_unavailable", "设定存储不可用")
		return
	}
	result, err := repo.SaveCoreSettings(r.Context(), planningScope, req)
	if err != nil {
		storageError(w, err)
		return
	}
	send(w, 200, result)
}
