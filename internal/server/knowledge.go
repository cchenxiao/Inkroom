package server

import (
	"context"
	"net/http"
	"strconv"

	"inkloom/internal/app"
	"inkloom/internal/storage/postgres"
)

type knowledgeReader interface {
	GetKnowledge(context.Context, string, string, int) (postgres.StoredKnowledge, error)
}

// knowledgeSnapshot 仅供本地作者查看完整台账；不是 Agent 工具，范围由服务端固定。
// 采用的子集与来源版本仍在各 run 的 ContextManifest 中查看。
func (s *service) knowledgeSnapshot(w http.ResponseWriter, r *http.Request) {
	version := 0
	if raw := r.URL.Query().Get("version"); raw != "" {
		n, err := strconv.Atoi(raw)
		if err != nil || n < 0 {
			fail(w, 400, "invalid_version", "version must be a nonnegative integer")
			return
		}
		version = n
	}
	repo, ok := s.repo.(knowledgeReader)
	if !ok {
		fail(w, 500, "knowledge_unavailable", "knowledge repository unavailable")
		return
	}
	scope := app.CurrentMemoryView()
	snapshot, err := repo.GetKnowledge(r.Context(), scope.ProjectID, scope.BranchID, version)
	if err != nil {
		storageError(w, err)
		return
	}
	send(w, http.StatusOK, snapshot)
}
