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

type chapterReviewRepository interface {
	StartChapterReview(context.Context, string, app.ChapterReviewRequest, config.Config) (app.ChapterReviewJob, bool, error)
	FinishChapterReview(context.Context, string, app.ChapterReviewOutput, error) error
	RecordChapterReviewCall(context.Context, string, model.CallRecord) error
	ChapterReviews(context.Context, string, string) (app.ChapterReviewState, error)
	DecideChapterReview(context.Context, string, string, app.ChapterReviewDecision) (app.ChapterReviewJob, error)
}

func (s *service) startChapterReview(w http.ResponseWriter, r *http.Request) {
	var req app.ChapterReviewRequest
	if !planningBody(w, r, &req) {
		return
	}
	if !planningID.MatchString(req.RequestID) {
		fail(w, 400, "invalid_request", "需要稳定请求 ID")
		return
	}
	repo, ok := s.repo.(chapterReviewRepository)
	if !ok {
		fail(w, 503, "review_unavailable", "整章复审存储不可用")
		return
	}
	job, created, err := repo.StartChapterReview(r.Context(), planningScope, req, s.cfg)
	if err != nil {
		storageError(w, err)
		return
	}
	if created {
		s.workers.Add(1)
		go func() {
			defer s.workers.Done()
			ctx, cancel := context.WithTimeout(s.root, 3*time.Minute)
			defer cancel()
			out, runErr := app.ReviewChapter(ctx, s.cfg, job.Input, func(_ context.Context, c model.CallRecord) error {
				saveCtx, stop := context.WithTimeout(context.Background(), 5*time.Second)
				defer stop()
				return repo.RecordChapterReviewCall(saveCtx, job.ID, c)
			})
			saveCtx, stop := context.WithTimeout(context.Background(), 5*time.Second)
			defer stop()
			if err := repo.FinishChapterReview(saveCtx, job.ID, out, runErr); err != nil {
				slog.Error("chapter review result not saved", "job_id", job.ID, "error", err)
			}
		}()
	}
	send(w, 202, job)
}
func (s *service) listChapterReviews(w http.ResponseWriter, r *http.Request) {
	id := r.URL.Query().Get("assemblyId")
	if id == "" || len(id) > 80 {
		fail(w, 400, "invalid_request", "需要章稿 ID")
		return
	}
	repo, ok := s.repo.(chapterReviewRepository)
	if !ok {
		fail(w, 503, "review_unavailable", "整章复审存储不可用")
		return
	}
	jobs, err := repo.ChapterReviews(r.Context(), planningScope, id)
	if err != nil {
		storageError(w, err)
		return
	}
	send(w, 200, jobs)
}
func (s *service) decideChapterReview(w http.ResponseWriter, r *http.Request) {
	var req app.ChapterReviewDecision
	if !planningBody(w, r, &req) {
		return
	}
	if !planningID.MatchString(req.RequestID) {
		fail(w, 400, "invalid_request", "需要稳定请求 ID")
		return
	}
	repo, ok := s.repo.(chapterReviewRepository)
	if !ok {
		fail(w, 503, "review_unavailable", "整章复审存储不可用")
		return
	}
	job, err := repo.DecideChapterReview(r.Context(), planningScope, r.PathValue("id"), req)
	if err != nil {
		storageError(w, err)
		return
	}
	send(w, 200, job)
}
