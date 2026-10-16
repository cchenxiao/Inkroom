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

type chapterPlanRepository interface {
	StartChapterPlan(context.Context, string, planning.ChapterPlanStartRequest, string) (planning.ChapterPlanJob, bool, error)
	FinishChapterPlan(context.Context, string, planning.ChapterPlanContent, error) error
	RecordChapterPlanCall(context.Context, string, model.CallRecord) error
	SaveChapterPlan(context.Context, string, planning.ChapterPlanSaveRequest) (planning.ChapterPlanSelection, error)
}

func (s *service) generateChapterPlan(w http.ResponseWriter, r *http.Request) {
	var req planning.ChapterPlanStartRequest
	if !planningBody(w, r, &req) {
		return
	}
	if !planningID.MatchString(req.RequestID) || len(req.ChapterID) == 0 || len(req.ChapterID) > 80 {
		fail(w, 400, "invalid_request", "请求标识或章节 ID 无效")
		return
	}
	repo, ok := s.repo.(chapterPlanRepository)
	if !ok {
		fail(w, 503, "planning_unavailable", "细纲存储不可用")
		return
	}
	job, created, err := repo.StartChapterPlan(r.Context(), planningScope, req, s.cfg.ModelName)
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
			out, runErr := app.GenerateChapterPlan(ctx, s.cfg, job.Input, func(_ context.Context, c model.CallRecord) error {
				saveCtx, stop := context.WithTimeout(context.Background(), 5*time.Second)
				defer stop()
				return repo.RecordChapterPlanCall(saveCtx, job.ID, c)
			})
			if runErr != nil {
				slog.Warn("chapterPlan generation failed", "job_id", job.ID, "error", runErr)
			}
			saveCtx, stop := context.WithTimeout(context.Background(), 5*time.Second)
			defer stop()
			if err := repo.FinishChapterPlan(saveCtx, job.ID, out, runErr); err != nil {
				slog.Error("chapterPlan not saved", "job_id", job.ID, "error", err)
			}
		}()
	}
	send(w, 202, job)
}
func (s *service) saveChapterPlan(w http.ResponseWriter, r *http.Request) {
	var req planning.ChapterPlanSaveRequest
	if !planningBodyLimit(w, r, &req, 128*1024) {
		return
	}
	repo, ok := s.repo.(chapterPlanRepository)
	if !ok {
		fail(w, 503, "planning_unavailable", "细纲存储不可用")
		return
	}
	result, err := repo.SaveChapterPlan(r.Context(), planningScope, req)
	if err != nil {
		storageError(w, err)
		return
	}
	send(w, 200, result)
}
