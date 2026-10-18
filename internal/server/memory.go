package server

import (
	"context"
	"errors"
	"inkloom/internal/app"
	"inkloom/internal/retrieval"
	"log/slog"
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

// Run-bound search is read-only. Browser can select a beat in the frozen chapter,
// never a different project, publication, character or story time.
func (s *service) searchRunMemory(w http.ResponseWriter, r *http.Request) {
	query := r.URL.Query().Get("q")
	if len(query) == 0 || len([]rune(query)) > 500 {
		fail(w, 400, "invalid_query", "请输入 1–500 字的查询内容")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
	defer cancel()
	frozen, err := s.repo.FrozenContext(ctx, r.PathValue("id"))
	if err != nil {
		storageError(w, err)
		return
	}
	b := frozen.Bundle
	if beat := r.URL.Query().Get("beatId"); beat != "" {
		var ok bool
		b, ok = b.ForBeat(beat)
		if !ok {
			fail(w, 400, "invalid_scope", "所选段落不属于这次写作材料")
			return
		}
	}
	view, err := app.MemoryView(b)
	if err != nil {
		storageError(w, err)
		return
	}
	var result retrieval.Result
	switch r.URL.Query().Get("audience") {
	case "", "character":
		result, err = s.retriever.Search(ctx, view, query, 6)
	case "author":
		result, err = s.retriever.SearchForAuthor(ctx, view, query, 6)
	default:
		fail(w, 400, "invalid_audience", "请选择人物已知材料或作者查阅范围")
		return
	}
	if err != nil {
		slog.Error("run.memory.failed", "run", r.PathValue("id"), "error", err)
		var failure *retrieval.Failure
		if errors.As(err, &failure) {
			fail(w, 503, failure.Code, failure.Message)
		} else {
			fail(w, 503, "retrieval_failed", "前情检索返回的数据未通过校验，请重试；正文未改变。")
		}
		return
	}
	send(w, 200, result)
}
