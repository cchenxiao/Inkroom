package server

import (
	"encoding/json"
	"io"
	"net/http"
	"strconv"
	"strings"
)

func (s *service) draft(w http.ResponseWriter, r *http.Request) {
	version := 0
	if raw := r.URL.Query().Get("version"); raw != "" {
		v, err := strconv.Atoi(raw)
		if err != nil || v < 1 {
			fail(w, 400, "invalid_version", "version must be positive")
			return
		}
		version = v
	}
	branch := r.URL.Query().Get("branchId")
	if branch == "" {
		branch = "main"
	}
	draft, err := s.repo.Draft(r.Context(), r.PathValue("id"), branch, version)
	if err != nil {
		storageError(w, err)
		return
	}
	send(w, 200, draft)
}
func (s *service) versions(w http.ResponseWriter, r *http.Request) {
	branch := r.URL.Query().Get("branchId")
	if branch == "" {
		branch = "main"
	}
	versions, err := s.repo.Versions(r.Context(), r.PathValue("id"), branch)
	if err != nil {
		storageError(w, err)
		return
	}
	send(w, 200, versions)
}
func (s *service) edit(w http.ResponseWriter, r *http.Request) {
	if !strings.HasPrefix(r.Header.Get("Content-Type"), "application/json") {
		fail(w, 415, "invalid_content_type", "Content-Type must be application/json")
		return
	}
	if origin := r.Header.Get("Origin"); origin != "" && origin != "http://127.0.0.1:5173" && origin != "http://localhost:5173" {
		fail(w, 403, "invalid_origin", "Origin is not allowed")
		return
	}
	var in struct {
		ChapterID    string `json:"chapterId"`
		BranchID     string `json:"branchId"`
		DraftVersion int    `json:"draftVersion"`
		Text         string `json:"text"`
	}
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 128*1024))
	decoder.DisallowUnknownFields()
	if decoder.Decode(&in) != nil || decoder.Decode(new(any)) != io.EOF || in.ChapterID != "ch7" || in.BranchID != "main" {
		fail(w, 400, "invalid_request", "仅支持本次候选稿 ch7/main")
		return
	}
	draft, err := s.repo.EditSegment(r.Context(), in.ChapterID, in.BranchID, r.PathValue("id"), in.DraftVersion, in.Text)
	if err != nil {
		storageError(w, err)
		return
	}
	send(w, 200, draft)
}
