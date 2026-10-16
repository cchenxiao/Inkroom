package server

import (
	"context"
	"inkloom/internal/app"
	"net/http"
)

func (s *service) bookOverview(w http.ResponseWriter, r *http.Request) {
	repo, ok := s.repo.(interface {
		BookOverview(context.Context, string) (app.BookOverview, error)
	})
	if !ok {
		fail(w, 503, "overview_unavailable", "作品总览暂不可用")
		return
	}
	out, err := repo.BookOverview(r.Context(), planningScope)
	if err != nil {
		storageError(w, err)
		return
	}
	send(w, 200, out)
}
