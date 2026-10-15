package server

import (
	"encoding/json"
	"io"
	"net/http"
	"strings"

	"inkloom/internal/app"
)

func (s *service) manifest(w http.ResponseWriter, r *http.Request) {
	input, err := s.repo.FrozenContext(r.Context(), r.PathValue("id"))
	if err != nil {
		storageError(w, err)
		return
	}
	send(w, 200, input.Manifest)
}
func (s *service) finalize(w http.ResponseWriter, r *http.Request) {
	if !strings.HasPrefix(r.Header.Get("Content-Type"), "application/json") {
		fail(w, 415, "invalid_content_type", "Content-Type must be application/json")
		return
	}
	if origin := r.Header.Get("Origin"); origin != "" && origin != "http://127.0.0.1:5173" && origin != "http://localhost:5173" {
		fail(w, 403, "invalid_origin", "Origin is not allowed")
		return
	}
	var in app.FinalizeInput
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096))
	decoder.DisallowUnknownFields()
	if decoder.Decode(&in) != nil || decoder.Decode(new(any)) != io.EOF {
		fail(w, 400, "invalid_request", "定稿需携带稳定 id、稿本版本、输入摘要和事实确认")
		return
	}
	commit, err := s.repo.Finalize(r.Context(), r.PathValue("id"), in)
	if err != nil {
		storageError(w, err)
		return
	}
	send(w, 200, commit)
}
func (s *service) commits(w http.ResponseWriter, r *http.Request) {
	chapter, branch := r.URL.Query().Get("chapterId"), r.URL.Query().Get("branchId")
	if chapter != "ch7" || branch != "main" {
		fail(w, 400, "unsupported_scope", "当前定稿历史仅支持 ch7/main")
		return
	}
	commits, err := s.repo.Commits(r.Context(), chapter, branch)
	if err != nil {
		storageError(w, err)
		return
	}
	send(w, 200, commits)
}
func (s *service) commit(w http.ResponseWriter, r *http.Request) {
	commit, err := s.repo.GetCommit(r.Context(), r.PathValue("id"))
	if err != nil {
		storageError(w, err)
		return
	}
	send(w, 200, commit)
}
