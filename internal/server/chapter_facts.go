package server

import (
	"context"
	"inkloom/internal/agents/model"
	"inkloom/internal/app"
	"inkloom/internal/config"
	"log/slog"
	"net/http"
	"time"
)

type chapterFactsRepository interface {
	StartChapterFacts(context.Context, string, app.ChapterFactsRequest, config.Config) (app.ChapterFactsJob, bool, error)
	ChapterFacts(context.Context, string, string) (app.ChapterFactsState, error)
	SelectChapterFacts(context.Context, string, app.ChapterFactsSelectionRequest) (app.ChapterFactsSelection, error)
	FinishChapterFacts(context.Context, string, app.ChapterFactsOutput, error) error
	RecordChapterFactsCall(context.Context, string, model.CallRecord) error
}

func (s *service) startChapterFacts(w http.ResponseWriter, r *http.Request) {
	var req app.ChapterFactsRequest
	if !planningBody(w, r, &req) {
		return
	}
	if !planningID.MatchString(req.RequestID) || !planningID.MatchString(req.ReviewID) {
		fail(w, 400, "invalid_request", "需要稳定请求与复审批次 ID")
		return
	}
	repo, ok := s.repo.(chapterFactsRepository)
	if !ok {
		fail(w, 503, "facts_unavailable", "事实整理不可用")
		return
	}
	job, created, err := repo.StartChapterFacts(r.Context(), planningScope, req, s.cfg)
	if err != nil {
		storageError(w, err)
		return
	}
	if created && job.Status == "running" {
		s.workers.Add(1)
		go func() {
			defer s.workers.Done()
			ctx, cancel := context.WithTimeout(s.root, 3*time.Minute)
			defer cancel()
			out, runErr := app.ExtractChapterFacts(ctx, s.cfg, job.Input, func(_ context.Context, c model.CallRecord) error {
				save, stop := context.WithTimeout(context.Background(), 5*time.Second)
				defer stop()
				return repo.RecordChapterFactsCall(save, job.ID, c)
			})
			save, stop := context.WithTimeout(context.Background(), 5*time.Second)
			defer stop()
			if err := repo.FinishChapterFacts(save, job.ID, out, runErr); err != nil {
				slog.Error("chapter facts not saved", "job_id", job.ID, "error", err)
			}
		}()
	}
	send(w, 202, job)
}
func (s *service) chapterFacts(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if !planningID.MatchString(id) {
		fail(w, 400, "invalid_request", "需要复审批次 ID")
		return
	}
	repo, ok := s.repo.(chapterFactsRepository)
	if !ok {
		fail(w, 503, "facts_unavailable", "事实整理不可用")
		return
	}
	state, err := repo.ChapterFacts(r.Context(), planningScope, id)
	if err != nil {
		storageError(w, err)
		return
	}
	send(w, 200, state)
}
func (s *service) selectChapterFacts(w http.ResponseWriter, r *http.Request) {
	var req app.ChapterFactsSelectionRequest
	if !planningBody(w, r, &req) {
		return
	}
	if !planningID.MatchString(req.RequestID) || !planningID.MatchString(req.JobID) {
		fail(w, 400, "invalid_request", "需要稳定请求与候选批次 ID")
		return
	}
	repo, ok := s.repo.(chapterFactsRepository)
	if !ok {
		fail(w, 503, "facts_unavailable", "事实整理不可用")
		return
	}
	sel, err := repo.SelectChapterFacts(r.Context(), planningScope, req)
	if err != nil {
		storageError(w, err)
		return
	}
	send(w, 200, sel)
}
