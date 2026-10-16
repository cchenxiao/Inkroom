package server

import (
	"context"
	"inkloom/internal/app"
	"net/http"
)

type chapterAssemblyRepository interface {
	PreviewChapterAssembly(context.Context, string, app.AssemblyPreviewRequest) (app.AssemblyPreview, error)
	SaveChapterAssembly(context.Context, string, app.AssemblySaveRequest) (app.ChapterAssembly, error)
}

func (s *service) previewChapterAssembly(w http.ResponseWriter, r *http.Request) {
	var req app.AssemblyPreviewRequest
	if !planningBody(w, r, &req) {
		return
	}
	repo, ok := s.repo.(chapterAssemblyRepository)
	if !ok {
		fail(w, 503, "assembly_unavailable", "章稿存储不可用")
		return
	}
	result, err := repo.PreviewChapterAssembly(r.Context(), planningScope, req)
	if err != nil {
		storageError(w, err)
		return
	}
	send(w, 200, result)
}
func (s *service) saveChapterAssembly(w http.ResponseWriter, r *http.Request) {
	var req app.AssemblySaveRequest
	if !planningBody(w, r, &req) {
		return
	}
	if !planningID.MatchString(req.RequestID) {
		fail(w, 400, "invalid_request", "需要稳定请求 ID")
		return
	}
	repo, ok := s.repo.(chapterAssemblyRepository)
	if !ok {
		fail(w, 503, "assembly_unavailable", "章稿存储不可用")
		return
	}
	result, err := repo.SaveChapterAssembly(r.Context(), planningScope, req)
	if err != nil {
		storageError(w, err)
		return
	}
	send(w, 200, result)
}
