package server

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"inkloom/internal/app"
	"inkloom/internal/orchestration"
)

func (s *service) action(w http.ResponseWriter, r *http.Request) {
	if !strings.HasPrefix(r.Header.Get("Content-Type"), "application/json") {
		fail(w, 415, "invalid_content_type", "Content-Type must be application/json")
		return
	}
	if origin := r.Header.Get("Origin"); origin != "" && origin != "http://127.0.0.1:5173" && origin != "http://localhost:5173" {
		fail(w, 403, "invalid_origin", "Origin is not allowed")
		return
	}
	var a orchestration.HumanAction
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 128*1024))
	decoder.DisallowUnknownFields()
	if decoder.Decode(&a) != nil || decoder.Decode(new(any)) != io.EOF || a.ID == "" || len(a.ID) > 100 || a.DraftVersion < 1 {
		fail(w, 400, "invalid_request", "操作需携带固定 id 和 draftVersion")
		return
	}
	s.mu.Lock()
	if s.active {
		s.mu.Unlock()
		fail(w, 409, "run_busy", "已有运行，请等待完成")
		return
	}
	run, execute, err := s.repo.ClaimAction(r.Context(), r.PathValue("id"), a)
	if err != nil {
		s.mu.Unlock()
		storageError(w, err)
		return
	}
	if !execute {
		s.mu.Unlock()
		send(w, 200, run)
		return
	}
	s.active = true
	s.workers.Add(1)
	s.mu.Unlock()
	go func() {
		defer s.workers.Done()
		defer func() { s.mu.Lock(); s.active = false; s.mu.Unlock() }()
		ctx, cancel := context.WithTimeout(s.root, 2*time.Minute)
		defer cancel()
		s.executeHuman(ctx, run)
	}()
	send(w, 202, run)
}
func (s *service) executeHuman(ctx context.Context, run app.Run) {
	if err := app.ExecuteHuman(ctx, s.cfg, run, s.repo, s.consistencyCheck(run)); err != nil {
		status, reason := "failed", "本次人工操作未完成；已落库产物保留，可用同一操作 ID 继续"
		if errors.Is(err, app.ErrVersionMismatch) {
			status, reason = "stale", "稿本已更新，旧审核与操作失效"
		} else if s.root.Err() != nil {
			status, reason = "interrupted", "服务中断；可继续已受理操作，已保存产物不会重复提交"
		}
		finish, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if saveErr := s.repo.StopRun(finish, run.ID, status, reason); saveErr != nil {
			slog.Error("human operation stop could not be persisted")
		}
		// 不输出供应商响应、连接串或故事材料。
		slog.Error("human operation stopped", "run_id", run.ID, "kind", status)
	}
}
