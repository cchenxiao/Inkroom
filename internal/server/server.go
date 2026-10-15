// Package server 是 I3 最小 HTTP 外壳，内存运行记录不承担持久化恢复。
package server

import (
	"context"
	"crypto/rand"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"strings"
	"sync"
	"time"

	"inkloom/internal/agents/model"
	"inkloom/internal/app"
	"inkloom/internal/config"
	"inkloom/internal/orchestration"
)

type Run struct {
	AutoRevise   bool                        `json:"autoRevise"`
	Usage        model.Usage                 `json:"usage"`
	ID           string                      `json:"id"`
	ChapterID    string                      `json:"chapterId"`
	BranchID     string                      `json:"branchId"`
	DraftVersion int                         `json:"draftVersion"`
	Status       string                      `json:"status"`
	CurrentNode  string                      `json:"currentNode"`
	ReviseRound  int                         `json:"reviseRound"`
	MaxRounds    int                         `json:"maxRounds"`
	Tokens       int                         `json:"tokens"`
	ElapsedMs    int64                       `json:"elapsedMs"`
	Nodes        []any                       `json:"nodes"`
	Provider     string                      `json:"provider"`
	Model        string                      `json:"model"`
	Result       *orchestration.ChapterState `json:"result,omitempty"`
	Error        string                      `json:"error,omitempty"`
}

type service struct {
	mu     sync.Mutex
	runs   map[string]Run
	order  []string
	active bool
	root   context.Context
	cfg    config.Config
}

func Serve(ctx context.Context) error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}
	root, cancel := context.WithCancel(ctx)
	defer cancel()
	s := &service{runs: map[string]Run{}, root: root, cfg: cfg}
	mux := http.NewServeMux()
	mux.HandleFunc("POST /api/runs", s.start)
	mux.HandleFunc("GET /api/runs/{id}", s.get)
	mux.HandleFunc("GET /api/health", func(w http.ResponseWriter, r *http.Request) {
		send(w, 200, map[string]string{"status": "ok", "provider": cfg.Model, "model": cfg.ModelName})
	})
	srv := &http.Server{Addr: "127.0.0.1:8080", Handler: mux, ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 10 * time.Second, WriteTimeout: 10 * time.Second, IdleTimeout: 60 * time.Second}
	go func() {
		<-root.Done()
		shutdownCtx, stop := context.WithTimeout(context.Background(), 5*time.Second)
		defer stop()
		_ = srv.Shutdown(shutdownCtx)
	}()
	slog.Info("server.started", "address", srv.Addr, "provider", cfg.Model)
	err = srv.ListenAndServe()
	if errors.Is(err, http.ErrServerClosed) {
		return nil
	}
	return err
}

func (s *service) start(w http.ResponseWriter, r *http.Request) {
	if !strings.HasPrefix(r.Header.Get("Content-Type"), "application/json") {
		fail(w, 415, "invalid_content_type", "Content-Type must be application/json")
		return
	}
	if origin := r.Header.Get("Origin"); origin != "" && origin != "http://127.0.0.1:5173" && origin != "http://localhost:5173" {
		fail(w, 403, "invalid_origin", "Origin is not allowed")
		return
	}
	var in struct {
		ChapterID  string `json:"chapterId"`
		BranchID   string `json:"branchId"`
		MaxRounds  int    `json:"maxRounds"`
		AutoRevise bool   `json:"autoRevise"`
	}
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&in); err != nil {
		fail(w, 400, "invalid_request", "Invalid run request")
		return
	}
	if err := decoder.Decode(new(any)); err != io.EOF {
		fail(w, 400, "invalid_request", "Expected one JSON object")
		return
	}
	if in.ChapterID != "ch7" || in.BranchID != "main" {
		fail(w, 400, "unsupported_scope", "I3 仅支持内置 ch7/main 的单段试运行")
		return
	}
	if in.MaxRounds == 0 {
		in.MaxRounds = 2
	}
	if in.MaxRounds != 2 && in.MaxRounds != 3 {
		fail(w, 400, "invalid_rounds", "maxRounds must be 2 or 3")
		return
	}
	s.mu.Lock()
	if s.active {
		s.mu.Unlock()
		fail(w, 409, "run_busy", "已有试运行，请等待完成")
		return
	}
	if len(s.order) >= 50 {
		delete(s.runs, s.order[0])
		s.order = s.order[1:]
	}
	run := Run{ID: rand.Text(), ChapterID: in.ChapterID, BranchID: in.BranchID, DraftVersion: 1, Status: "running", CurrentNode: "draft", MaxRounds: in.MaxRounds, AutoRevise: in.AutoRevise, Nodes: []any{}, Provider: s.cfg.Model, Model: s.cfg.ModelName}
	s.runs[run.ID] = run
	s.order = append(s.order, run.ID)
	s.active = true
	s.mu.Unlock()
	go s.execute(run)
	send(w, http.StatusAccepted, run)
}

func (s *service) execute(run Run) {
	ctx, cancel := context.WithTimeout(s.root, 2*time.Minute)
	defer cancel()
	started := time.Now()
	result, err := app.ExecuteChapter(ctx, s.cfg, "normal", orchestration.Options{MaxRounds: run.MaxRounds, AutoRevise: run.AutoRevise, OnProgress: func(state orchestration.ChapterState) {
		s.mu.Lock()
		current := s.runs[run.ID]
		current.CurrentNode = state.CurrentNode
		current.DraftVersion = state.DraftVersion
		current.ReviseRound = state.ReviseRound
		current.Usage = state.Usage
		current.Tokens = state.Usage.InputTokens + state.Usage.OutputTokens
		current.ElapsedMs = time.Since(started).Milliseconds()
		current.Result = &state
		s.runs[run.ID] = current
		s.mu.Unlock()
	}})
	run.Usage = result.Usage
	run.ElapsedMs = time.Since(started).Milliseconds()
	run.Tokens = result.Usage.InputTokens + result.Usage.OutputTokens
	if err != nil {
		run.Status = "failed"
		run.Error = err.Error()
	} else {
		run.Status = result.Status
	}
	run.CurrentNode = result.CurrentNode
	run.DraftVersion = result.DraftVersion
	run.ReviseRound = result.ReviseRound
	run.Result = &result
	s.mu.Lock()
	s.runs[run.ID] = run
	s.active = false
	s.mu.Unlock()
}

func (s *service) get(w http.ResponseWriter, r *http.Request) {
	s.mu.Lock()
	id := r.PathValue("id")
	if id == "latest" && len(s.order) > 0 {
		id = s.order[len(s.order)-1]
	}
	run, ok := s.runs[id]
	s.mu.Unlock()
	if !ok {
		fail(w, 404, "run_not_found", "运行记录不存在或已随服务重启清空")
		return
	}
	send(w, 200, run)
}
func fail(w http.ResponseWriter, status int, code, message string) {
	send(w, status, map[string]string{"code": code, "message": message})
}
func send(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}
