package server

import (
	"context"
	"inkloom/internal/app"
	"inkloom/internal/config"
	"inkloom/internal/orchestration"
	"net/http"
)

type plannedRunRepository interface {
	StartPlannedRun(context.Context, string, app.PlannedRunRequest, config.Config) (app.Run, bool, error)
	PlannedRunReadiness(context.Context, string, string, config.Config, ...string) (app.PlannedRunReadiness, error)
}

func (s *service) startPlannedRun(w http.ResponseWriter, r *http.Request) {
	var req app.PlannedRunRequest
	if !planningBody(w, r, &req) {
		return
	}
	if !planningID.MatchString(req.RequestID) || !app.ValidPlannedRequest(req) {
		fail(w, 400, "invalid_request", "需要有效章节、规划版本、稿本版本与稳定请求 ID")
		return
	}
	repo, ok := s.repo.(plannedRunRepository)
	if !ok {
		fail(w, 503, "planning_unavailable", "规划写作存储不可用")
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.active {
		fail(w, 409, "run_busy", "已有运行，请等待完成或查询本章记录")
		return
	}
	run, created, err := repo.StartPlannedRun(r.Context(), planningScope, req, s.cfg)
	if err != nil {
		storageError(w, err)
		return
	}
	if created {
		s.active = true
		s.workers.Add(1)
		go s.execute(run)
	}
	send(w, 202, run)
}
func (s *service) plannedRuns(w http.ResponseWriter, r *http.Request) {
	id := r.URL.Query().Get("chapterId")
	if id == "" || len(id) > 80 {
		fail(w, 400, "invalid_request", "需要章纲中的章节 ID")
		return
	}
	repo, ok := s.repo.(plannedRunRepository)
	if !ok {
		fail(w, 503, "planning_unavailable", "规划写作存储不可用")
		return
	}
	result, err := repo.PlannedRunReadiness(r.Context(), planningScope, id, s.cfg, r.URL.Query().Get("beatId"))
	if err != nil {
		storageError(w, err)
		return
	}
	send(w, 200, result)
}
func (s *service) consistencyCheck(run app.Run) orchestration.ConsistencyCheck {
	if run.Planning != nil {
		return nil
	} // 仅固定初始材料，不能查询教学 ch7 的检索目录。
	return app.NewConsistencyCheck(s.retriever, s.repo, run.ID)
}
