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

type outlineRepository interface {
	StartOutline(context.Context, string, planning.OutlineStartRequest, string) (planning.OutlineJob, bool, error)
	FinishOutline(context.Context, string, planning.OutlineContent, error) error
	RecordOutlineCall(context.Context, string, model.CallRecord) error
	SaveOutline(context.Context, string, planning.OutlineSaveRequest) (planning.OutlineSelection, error)
}

func (s *service) generateOutline(w http.ResponseWriter, r *http.Request) {
	var req planning.OutlineStartRequest
	if !planningBody(w, r, &req) {
		return
	}
	if !planningID.MatchString(req.RequestID) || req.ChapterCount < 2 || req.ChapterCount > 12 {
		fail(w, 400, "invalid_request", "请求标识或章节数无效（2–12 章）")
		return
	}
	repo, ok := s.repo.(outlineRepository)
	if !ok {
		fail(w, 503, "planning_unavailable", "章纲存储不可用")
		return
	}
	job, created, err := repo.StartOutline(r.Context(), planningScope, req, s.cfg.ModelName)
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
			out, runErr := app.GenerateOutline(ctx, s.cfg, job.Input, func(_ context.Context, c model.CallRecord) error {
				saveCtx, stop := context.WithTimeout(context.Background(), 5*time.Second)
				defer stop()
				return repo.RecordOutlineCall(saveCtx, job.ID, c)
			})
			if runErr != nil {
				slog.Warn("outline generation failed", "job_id", job.ID, "error", runErr)
			}
			saveCtx, stop := context.WithTimeout(context.Background(), 5*time.Second)
			defer stop()
			if err := repo.FinishOutline(saveCtx, job.ID, out, runErr); err != nil {
				slog.Error("outline not saved", "job_id", job.ID, "error", err)
			}
		}()
	}
	send(w, 202, job)
}
func (s *service) saveOutline(w http.ResponseWriter, r *http.Request) {
	var req planning.OutlineSaveRequest
	if !planningBodyLimit(w, r, &req, 128*1024) {
		return
	}
	repo, ok := s.repo.(outlineRepository)
	if !ok {
		fail(w, 503, "planning_unavailable", "章纲存储不可用")
		return
	}
	result, err := repo.SaveOutline(r.Context(), planningScope, req)
	if err != nil {
		storageError(w, err)
		return
	}
	send(w, 200, result)
}
