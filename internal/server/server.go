// Package server 提供本地 HTTP；候选稿与运行记录由 Repository 持久化。
package server

import (
	"context"
	"crypto/rand"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"slices"
	"strings"
	"sync"
	"time"

	"inkloom/internal/agents/model"
	"inkloom/internal/agents/parse"
	"inkloom/internal/app"
	"inkloom/internal/config"
	"inkloom/internal/contextlookup"
	"inkloom/internal/demo"
	"inkloom/internal/events"
	"inkloom/internal/orchestration"
	"inkloom/internal/retrieval"
	"inkloom/internal/storage/postgres"
)

type service struct {
	mu        sync.Mutex
	active    bool
	workers   sync.WaitGroup
	root      context.Context
	cfg       config.Config
	retriever *retrieval.Service
	repo      app.FinalRepository
	hub       *events.Hub
}

func Serve(ctx context.Context) error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}
	if cfg.DatabaseURL == "" {
		return fmt.Errorf("INKLOOM_DATABASE_URL is required for HTTP mode; CLI remains available without a database")
	}
	setup, cancelSetup := context.WithTimeout(ctx, 15*time.Second)
	repo, err := postgres.Open(setup, cfg.DatabaseURL)
	cancelSetup()
	if err != nil {
		return err
	}
	defer repo.Close()
	root, cancel := context.WithCancel(ctx)
	defer cancel()
	retriever, err := app.NewRetrieval(cfg, repo)
	if err != nil {
		return err
	}
	s := &service{root: root, cfg: cfg, repo: repo, retriever: retriever, hub: events.NewHub(64)}
	s.workers.Add(1)
	go func() { defer s.workers.Done(); events.Dispatch(root, repo, s.hub) }()
	mux := http.NewServeMux()
	mux.HandleFunc("POST /api/planning/outline-jobs", s.generateOutline)
	mux.HandleFunc("POST /api/planning/chapter-plan-jobs", s.generateChapterPlan)
	mux.HandleFunc("POST /api/planning/chapter-plan-selection", s.saveChapterPlan)
	mux.HandleFunc("POST /api/planning/outline-selection", s.saveOutline)
	mux.HandleFunc("POST /api/planning/core-jobs", s.generateCoreSettings)
	mux.HandleFunc("POST /api/planning/core-selection", s.saveCoreSettings)
	mux.HandleFunc("GET /api/planning", s.getPlanning)
	mux.HandleFunc("GET /api/planning/overview", s.bookOverview)
	mux.HandleFunc("GET /api/planning/archive", s.bookArchive)
	mux.HandleFunc("GET /api/planning/quality", s.bookQuality)
	mux.HandleFunc("GET /api/planning/knowledge-preview", s.planningKnowledgePreview)
	mux.HandleFunc("POST /api/planning/knowledge-publications", s.publishPlanningKnowledge)
	mux.HandleFunc("POST /api/planning/chapter-assemblies/preview", s.previewChapterAssembly)
	mux.HandleFunc("POST /api/planning/chapter-assemblies", s.saveChapterAssembly)
	mux.HandleFunc("POST /api/planning/chapter-reviews", s.startChapterReview)
	mux.HandleFunc("GET /api/planning/chapter-reviews", s.listChapterReviews)
	mux.HandleFunc("POST /api/planning/chapter-reviews/{id}/decisions", s.decideChapterReview)
	mux.HandleFunc("POST /api/planning/chapter-fact-jobs", s.startChapterFacts)
	mux.HandleFunc("POST /api/planning/chapter-fact-selections", s.selectChapterFacts)
	mux.HandleFunc("GET /api/planning/chapter-reviews/{id}/facts", s.chapterFacts)
	mux.HandleFunc("POST /api/planning/chapter-publications", s.publishChapter)
	mux.HandleFunc("GET /api/planning/chapter-reviews/{id}/publication", s.chapterPublication)
	mux.HandleFunc("GET /api/planning/chapter-runs", s.plannedRuns)
	mux.HandleFunc("POST /api/planning/chapter-runs", s.startPlannedRun)
	mux.HandleFunc("POST /api/planning/chapter-runs/{id}/dismiss", s.dismissPlannedCandidate)
	mux.HandleFunc("PATCH /api/planning/intake", s.savePlanning)
	mux.HandleFunc("POST /api/planning/jobs", s.generatePlanning)
	mux.HandleFunc("POST /api/planning/selection", s.selectPlanning)
	mux.HandleFunc("GET /api/planning/style-analyses", s.listStyleAnalyses)
	mux.HandleFunc("POST /api/planning/style-analyses", s.analyzeStyle)
	mux.HandleFunc("POST /api/planning/style-trials", s.generateStyleTrial)
	mux.HandleFunc("POST /api/planning/style-selection", s.selectStyle)
	mux.HandleFunc("GET /api/knowledge", s.knowledgeSnapshot)
	mux.HandleFunc("GET /api/memory/search", s.searchMemory)
	mux.HandleFunc("GET /api/runs/{id}/memory", s.searchRunMemory)
	mux.HandleFunc("POST /api/runs", s.start)
	mux.HandleFunc("POST /api/runs/{id}/actions", s.action)
	mux.HandleFunc("GET /api/runs/{id}", s.get)
	mux.HandleFunc("GET /api/runs", s.list)
	mux.HandleFunc("GET /api/runs/{id}/calls", s.calls)
	mux.HandleFunc("GET /api/runs/{id}/events", s.events)
	mux.HandleFunc("GET /api/runs/{id}/context-manifest", s.manifest)
	mux.HandleFunc("POST /api/runs/{id}/commit", s.finalize)
	mux.HandleFunc("GET /api/commits", s.commits)
	mux.HandleFunc("GET /api/commits/{id}", s.commit)
	mux.HandleFunc("GET /api/chapters/{id}", s.draft)
	mux.HandleFunc("GET /api/chapters/{id}/versions", s.versions)
	mux.HandleFunc("PATCH /api/segments/{id}", s.edit)
	mux.HandleFunc("GET /api/health", func(w http.ResponseWriter, r *http.Request) {
		scenarios := []string{"normal"}
		if cfg.Model == "fake" {
			scenarios = demo.Scenarios
		}
		send(w, 200, map[string]any{"status": "ok", "provider": cfg.Model, "model": cfg.ModelName, "scenarios": scenarios, "storage": "postgres"})
	})
	srv := &http.Server{Addr: "127.0.0.1:8080", Handler: mux, ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 10 * time.Second, WriteTimeout: 15 * time.Second, IdleTimeout: 60 * time.Second}
	monitorDone := make(chan struct{})
	go func() {
		defer close(monitorDone)
		ticker := time.NewTicker(3 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-root.Done():
				return
			case <-ticker.C:
				check, stop := context.WithTimeout(root, 2*time.Second)
				err := repo.Ping(check)
				stop()
				if err != nil {
					slog.Error("database service lease lost; stopping execution")
					cancel()
					return
				}
			}
		}
	}()
	shutdownDone := make(chan struct{})
	go func() {
		<-root.Done()
		shutdown, stop := context.WithTimeout(context.Background(), 5*time.Second)
		defer stop()
		_ = srv.Shutdown(shutdown)
		close(shutdownDone)
	}()
	slog.Info("server.started", "address", srv.Addr, "provider", cfg.Model, "storage", "postgres")
	err = srv.ListenAndServe()
	cancel()
	<-shutdownDone
	<-monitorDone
	s.workers.Wait()
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
		DraftVersion      *int   `json:"draftVersion"`
		AllowLocalRewrite bool   `json:"allowLocalRewrite"`
		Scenario          string `json:"scenario"`
		ChapterID         string `json:"chapterId"`
		BranchID          string `json:"branchId"`
		MaxRounds         int    `json:"maxRounds"`
		AutoRevise        bool   `json:"autoRevise"`
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
		fail(w, 400, "unsupported_scope", "当前仅支持内置 ch7/main 的单段候选")
		return
	}
	if in.MaxRounds == 0 {
		in.MaxRounds = 2
	}
	if in.MaxRounds != 2 && in.MaxRounds != 3 {
		fail(w, 400, "invalid_rounds", "maxRounds must be 2 or 3")
		return
	}
	if in.Scenario == "" {
		in.Scenario = "normal"
	}
	if !slices.Contains(demo.Scenarios, in.Scenario) || (s.cfg.Model != "fake" && in.Scenario != "normal") {
		fail(w, 400, "invalid_scenario", "演示故障场景仅支持 Fake 模型")
		return
	}
	s.mu.Lock()
	if s.active {
		s.mu.Unlock()
		fail(w, 409, "run_busy", "已有试运行，请等待完成")
		return
	}
	if in.DraftVersion == nil || *in.DraftVersion < 0 {
		s.mu.Unlock()
		fail(w, 400, "missing_version", "请先读取当前稿本，再携带 draftVersion 启动")
		return
	}
	run := app.Run{MaxCalls: s.cfg.MaxCalls, MaxTokens: s.cfg.MaxTokens, ID: rand.Text(), CreatedAt: time.Now().UTC(), BaseDraftVersion: *in.DraftVersion, DraftVersion: *in.DraftVersion, ChapterID: in.ChapterID, BranchID: in.BranchID, Scenario: in.Scenario, AllowLocalRewrite: in.AllowLocalRewrite, AutoRevise: in.AutoRevise, MaxRounds: in.MaxRounds, Status: "running", CurrentNode: "context_assemble", Nodes: []any{}, Provider: s.cfg.Model, Model: s.cfg.ModelName}
	input, err := app.PrepareContext(s.cfg, run.Scenario, run.ID, run.BaseDraftVersion)
	if err != nil {
		s.mu.Unlock()
		fail(w, 422, "context_not_ready", err.Error())
		return
	}
	if err := s.repo.CreatePreparingRun(r.Context(), run, input); err != nil {
		s.mu.Unlock()
		storageError(w, err)
		return
	}
	s.active = true
	s.workers.Add(1)
	s.mu.Unlock()
	go s.execute(run)
	send(w, http.StatusAccepted, run)
}

func (s *service) execute(run app.Run) {
	defer s.workers.Done()
	defer func() { s.mu.Lock(); s.active = false; s.mu.Unlock() }()
	ctx, cancel := context.WithTimeout(s.root, 2*time.Minute)
	defer cancel()
	started := time.Now()
	expected := run.BaseDraftVersion
	var persistErr error
	update := func(state orchestration.ChapterState) {
		run.CurrentNode = state.CurrentNode
		run.DraftVersion = state.DraftVersion
		run.ReviseRound = state.ReviseRound
		run.Usage = state.Usage
		run.Tokens = state.Usage.InputTokens + state.Usage.OutputTokens
		run.ElapsedMs = time.Since(started).Milliseconds()
		run.Result = &state
	}
	run, input, err := s.prepare(ctx, run)
	if err != nil {
		finish, stop := context.WithTimeout(context.Background(), 5*time.Second)
		defer stop()
		status, reason := "failed", executionFailureReason("context_assemble", err, nil)
		slog.Error("run.preparation_failed", "run_id", run.ID, "error", err)
		if errors.Is(err, app.ErrVersionMismatch) {
			status = "stale"
			reason = "稿本已变更，旧上下文准备失效"
		} else if s.root.Err() != nil {
			status = "interrupted"
			reason = "准备阶段中断，未自动重试模型"
		}
		_ = s.repo.StopRun(finish, run.ID, status, reason)
		return
	}
	history, err := s.repo.Calls(ctx, run.ID)
	if err != nil {
		_ = s.repo.StopRun(ctx, run.ID, "failed", "模型调用预算读取失败，未启动 Writer")
		return
	}
	result, err := app.ExecuteChapter(ctx, s.cfg, run.Scenario, orchestration.Options{
		ConsistencyCheck: s.consistencyCheck(run),
		FrozenInput:      &input,
		CallHistory:      history,
		BaseDraftVersion: run.BaseDraftVersion, AllowLocalRewrite: run.AllowLocalRewrite, AutoRevise: run.AutoRevise, MaxRounds: run.MaxRounds,
		OnModelCall: func(_ context.Context, c model.CallRecord) error {
			// 取消后的最后一次调用结果也要记账；独立短超时，不能发起新的模型调用。
			save, stop := context.WithTimeout(context.Background(), 5*time.Second)
			defer stop()
			return s.repo.RecordCall(save, run.ID, c)
		},
		OnProgress: func(state orchestration.ChapterState) {
			if persistErr != nil {
				return
			}
			update(state)
			if persistErr = s.repo.SaveProgress(ctx, run, expected); persistErr != nil {
				cancel()
				return
			}
			expected = state.DraftVersion
		},
	})
	finish, stop := context.WithTimeout(context.Background(), 5*time.Second)
	defer stop()
	if persistErr != nil || err != nil {
		status, reason := "failed", executionFailureReason(run.CurrentNode, err, persistErr)
		slog.Error("run.failed", "run_id", run.ID, "node", run.CurrentNode, "error", err, "persist_error", persistErr)
		if errors.Is(persistErr, app.ErrVersionMismatch) {
			status = "stale"
			reason = "稿本已变更，旧评审和迟到修订失效"
		} else if s.root.Err() != nil {
			status = "interrupted"
			reason = "服务中断，已保存数据保留；本阶段不自动续跑"
		}
		if saveErr := s.repo.StopRun(finish, run.ID, status, reason); saveErr != nil {
			slog.Error("run stop could not be persisted")
		}
		return
	}
	update(result)
	run.Status = "running" // 先持久化最终自动评审，再让 Eino HumanGate 保存等待检查点。
	if saveErr := s.repo.SaveProgress(finish, run, expected); saveErr != nil {
		status, reason := "failed", "最终状态写入失败，保留已落库稿本"
		if errors.Is(saveErr, app.ErrVersionMismatch) {
			status = "stale"
			reason = "稿本已变更，旧结果失效"
		}
		_ = s.repo.StopRun(finish, run.ID, status, reason)
		return
	}
	s.executeHuman(ctx, run)
}

// Keep transport/internal details out of author-facing notices, but preserve the
// failed stage and actionable validation reason instead of a generic stop message.
func executionFailureReason(node string, runErr, persistErr error) string {
	stage := "运行"
	if node == "draft" {
		stage = "正文生成"
	} else if node == "critics" {
		stage = "正文审核"
	} else if node == "context_assemble" {
		stage = "写作前材料准备"
	}
	if persistErr != nil {
		return stage + "的结果未能保存，请重试；此前已保存的稿件保留。"
	}
	var lookupFailure *retrieval.Failure
	if errors.As(runErr, &lookupFailure) {
		return stage + "未完成：" + lookupFailure.Message + "。此前已保存的稿件保留。"
	}
	if errors.Is(runErr, contextlookup.ErrInsufficient) || errors.Is(runErr, contextlookup.ErrNoNewSources) {
		return stage + "未完成：当前视角可用的材料不足，检索没有补齐所需前情。请在故事设定核对人物知情和前章定稿，补充后重试；已保存稿件保留。"
	}
	if errors.Is(runErr, contextlookup.ErrToolLimit) {
		return stage + "未完成：已达到本段 3 次查证上限，仍未完成判断。请查看查证记录，补充缺失材料后重试；已保存稿件保留。"
	}
	if errors.Is(runErr, contextlookup.ErrInvalidToolRequest) {
		return stage + "未完成：模型发出了重复或无效的检索请求。请重试；已保存稿件保留。"
	}
	var invalid *parse.Error
	if errors.As(runErr, &invalid) {
		detail := "模型未返回有效内容"
		switch invalid.Kind {
		case parse.InvalidContent:
			detail = "模型结果未通过内容校验：" + invalid.Err.Error()
		case parse.InvalidSchema:
			detail = "模型返回的字段或结构不符合本次输出要求"
		case parse.InvalidJSON:
			detail = "模型返回的格式无法读取，自动格式修复也未成功"
		case parse.Truncated:
			detail = "模型回答达到输出上限，内容被截断"
		case parse.Refused:
			detail = "模型拒绝了这次请求"
		}
		return stage + "未完成：" + detail + "。请重试；此前已保存的稿件保留。"
	}
	if errors.Is(runErr, context.DeadlineExceeded) {
		return stage + "等待超时，请重试；此前已保存的稿件保留。"
	}
	if errors.Is(runErr, model.ErrBudgetExhausted) {
		return stage + "的本次调用额度已用完，请重新发起；此前已保存的稿件保留。"
	}
	return stage + "未完成：服务执行异常，请查看运行记录后重试；此前已保存的稿件保留。"
}
func (s *service) get(w http.ResponseWriter, r *http.Request) {
	run, err := s.repo.GetRun(r.Context(), r.PathValue("id"))
	if err != nil {
		storageError(w, err)
		return
	}
	send(w, 200, run)
}
func (s *service) list(w http.ResponseWriter, r *http.Request) {
	runs, err := s.repo.ListRuns(r.Context())
	if err != nil {
		storageError(w, err)
		return
	}
	send(w, 200, runs)
}
func (s *service) calls(w http.ResponseWriter, r *http.Request) {
	calls, err := s.repo.Calls(r.Context(), r.PathValue("id"))
	if err != nil {
		storageError(w, err)
		return
	}
	send(w, 200, calls)
}
func storageError(w http.ResponseWriter, err error) {
	var validation app.ActionValidationError
	if errors.As(err, &validation) {
		fail(w, 409, "gate_blocked", validation.Reason)
		return
	}

	switch {
	case errors.Is(err, app.ErrPlanningNotReady):
		fail(w, 422, "planning_not_ready", err.Error())
	case errors.Is(err, app.ErrContextMismatch):
		fail(w, 409, "context_mismatch", "冻结输入缺失或不匹配；旧运行不能补造清单，请重新装配并启动")
	case errors.Is(err, app.ErrFactsUnconfirmed):
		fail(w, 409, "facts_unconfirmed", "仍需作者确认没有待同步事实；事实变更不得跳过处理直接定稿")
	case errors.Is(err, app.ErrGateBlocked):
		fail(w, 409, "gate_blocked", "当前候选不满足此操作条件；请查看待处理问题或先直改复检")
	case errors.Is(err, app.ErrActionMismatch):
		fail(w, 409, "action_mismatch", "操作 ID 已用于不同内容；不能改写已受理的操作")
	case errors.Is(err, app.ErrVersionMismatch):
		fail(w, 409, "version_mismatch", "稿本已更新；保留本地修改，请读取新版本后人工对照")
	case errors.Is(err, app.ErrRunBusy):
		fail(w, 409, "run_busy", "已有运行，请等待或查询其状态")
	case errors.Is(err, app.ErrNotFound):
		fail(w, 404, "not_found", "记录不存在")
	case errors.Is(err, app.ErrInvalidWrite):
		fail(w, 400, "invalid_write", "修改内容、定位或版本无效")
	default:
		fail(w, 503, "storage_unavailable", "数据库暂不可用，不能确认写入；请重新读取结果后再操作")
	}
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
