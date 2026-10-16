package server

import (
	"context"
	"inkloom/internal/app"
	"inkloom/internal/storage/postgres"
	"net/http"
)

type planningKnowledgeRepository interface {
	PlanningKnowledgePreview(context.Context, string) (app.KnowledgePreview, error)
	PublishPlanningKnowledge(context.Context, string, app.KnowledgePublishRequest) (postgres.StoredKnowledge, error)
}

func (s *service) planningKnowledgePreview(w http.ResponseWriter, r *http.Request) {
	repo, ok := s.repo.(planningKnowledgeRepository)
	if !ok {
		fail(w, 503, "knowledge_unavailable", "知识发布存储不可用")
		return
	}
	preview, err := repo.PlanningKnowledgePreview(r.Context(), planningScope)
	if err != nil {
		storageError(w, err)
		return
	}
	send(w, 200, preview)
}
func (s *service) publishPlanningKnowledge(w http.ResponseWriter, r *http.Request) {
	var req app.KnowledgePublishRequest
	if !planningBody(w, r, &req) {
		return
	}
	repo, ok := s.repo.(planningKnowledgeRepository)
	if !ok {
		fail(w, 503, "knowledge_unavailable", "知识发布存储不可用")
		return
	}
	saved, err := repo.PublishPlanningKnowledge(r.Context(), planningScope, req)
	if err != nil {
		storageError(w, err)
		return
	}
	send(w, 200, saved)
}
