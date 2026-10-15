package server

import (
	"context"
	"inkloom/internal/app"
	"net/http"
	"time"
)

// searchMemory 是作者查看当前 ch7/main/沈砚 检索结果的只读入口，范围不来自 URL。
func (s *service) searchMemory(w http.ResponseWriter, r *http.Request) {
	query := r.URL.Query().Get("q")
	if len(query) == 0 || len(query) > 2000 {
		fail(w, 400, "invalid_query", "q is required and must be at most 2000 bytes")
		return
	}
	ctx, stop := context.WithTimeout(r.Context(), 10*time.Second)
	defer stop()
	result, err := s.retriever.Search(ctx, app.CurrentMemoryView(), query, 3)
	if err != nil {
		fail(w, 422, "retrieval_failed", err.Error())
		return
	}
	send(w, 200, result)
}
