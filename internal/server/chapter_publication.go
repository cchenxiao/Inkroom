package server

import (
	"context"
	"net/http"

	"inkloom/internal/app"
)

type chapterPublicationRepository interface {
	PublishChapter(context.Context, string, app.ChapterPublicationRequest) (app.ChapterPublicationState, error)
	ChapterPublication(context.Context, string, string) (app.ChapterPublicationState, error)
}

func (s *service) publishChapter(w http.ResponseWriter, r *http.Request) {
	var req app.ChapterPublicationRequest
	if !planningBody(w, r, &req) {
		return
	}
	if !planningID.MatchString(req.RequestID) || !planningID.MatchString(req.ReviewID) || !planningID.MatchString(req.ApprovalID) {
		fail(w, 400, "invalid_request", "需要稳定请求 ID、复审批次和作者批准 ID")
		return
	}
	repo, ok := s.repo.(chapterPublicationRepository)
	if !ok {
		fail(w, 503, "publication_unavailable", "整章定稿存储不可用")
		return
	}
	out, err := repo.PublishChapter(r.Context(), planningScope, req)
	if err != nil {
		storageError(w, err)
		return
	}
	send(w, 200, out)
}
func (s *service) chapterPublication(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if !planningID.MatchString(id) {
		fail(w, 400, "invalid_request", "需要复审批次 ID")
		return
	}
	repo, ok := s.repo.(chapterPublicationRepository)
	if !ok {
		fail(w, 503, "publication_unavailable", "整章定稿存储不可用")
		return
	}
	out, err := repo.ChapterPublication(r.Context(), planningScope, id)
	if err != nil {
		storageError(w, err)
		return
	}
	send(w, 200, out)
}
