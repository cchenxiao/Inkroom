package server

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"regexp"
	"strings"
	"time"

	"inkloom/internal/agents/model"
	"inkloom/internal/app"
	"inkloom/internal/domain/planning"
)

const planningScope = "zhuoliu/main"

// 狭窄能力接口，作品规划不依赖章节运行仓储方法。
type planningRepository interface {
	GetPlanning(context.Context, string) (planning.State, error)
	SavePlanningInput(context.Context, string, int, planning.Intake) (planning.InputSnapshot, error)
	StartPlanningJob(context.Context, string, string, int, string) (planning.Job, bool, error)
	FinishPlanningJob(context.Context, string, planning.Output, error) error
	RecordPlanningCall(context.Context, string, model.CallRecord) error
	SelectPlanningDirection(context.Context, string, planning.SelectRequest) (planning.Selection, error)
}

func (s *service) planningRepo(w http.ResponseWriter) planningRepository {
	repo, ok := s.repo.(planningRepository)
	if !ok {
		fail(w, 503, "planning_unavailable", "作品规划存储不可用")
		return nil
	}
	return repo
}
func (s *service) getPlanning(w http.ResponseWriter, r *http.Request) {
	repo := s.planningRepo(w)
	if repo == nil {
		return
	}
	state, err := repo.GetPlanning(r.Context(), planningScope)
	if err != nil {
		storageError(w, err)
		return
	}
	send(w, 200, state)
}

// 与本地编辑端点同样限制来源，并拒绝未知字段与拼接 JSON。
func planningBody(w http.ResponseWriter, r *http.Request, out any) bool {
	origin := r.Header.Get("Origin")
	if origin != "" && origin != "http://127.0.0.1:5173" && origin != "http://localhost:5173" {
		fail(w, 403, "origin_forbidden", "不接受此来源的写入")
		return false
	}
	if !strings.HasPrefix(r.Header.Get("Content-Type"), "application/json") {
		fail(w, 415, "json_required", "请提交 JSON")
		return false
	}
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 32*1024))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(out); err != nil {
		fail(w, 400, "invalid_request", "请求内容无效或过长")
		return false
	}
	if decoder.Decode(new(any)) != io.EOF {
		fail(w, 400, "invalid_request", "只接受一个 JSON 对象")
		return false
	}
	return true
}
func (s *service) savePlanning(w http.ResponseWriter, r *http.Request) {
	var req struct {
		ExpectedVersion *int            `json:"expectedVersion"`
		Intake          planning.Intake `json:"intake"`
	}
	if !planningBody(w, r, &req) {
		return
	}
	if req.ExpectedVersion == nil || *req.ExpectedVersion < 0 || req.Intake.Validate() != nil {
		fail(w, 400, "invalid_intake", "请填写立意并检查输入长度、参考维度和模板版本")
		return
	}
	repo := s.planningRepo(w)
	if repo == nil {
		return
	}
	value, err := repo.SavePlanningInput(r.Context(), planningScope, *req.ExpectedVersion, req.Intake)
	if err != nil {
		storageError(w, err)
		return
	}
	send(w, 200, value)
}

var planningID = regexp.MustCompile(`^[a-zA-Z0-9_-]{8,80}$`)

func (s *service) generatePlanning(w http.ResponseWriter, r *http.Request) {
	var req struct {
		RequestID            string `json:"requestId"`
		ExpectedInputVersion int    `json:"expectedInputVersion"`
	}
	if !planningBody(w, r, &req) {
		return
	}
	if !planningID.MatchString(req.RequestID) || req.ExpectedInputVersion <= 0 {
		fail(w, 400, "invalid_request", "请求标识与输入版本必填")
		return
	}
	repo := s.planningRepo(w)
	if repo == nil {
		return
	}
	job, created, err := repo.StartPlanningJob(r.Context(), planningScope, req.RequestID, req.ExpectedInputVersion, s.cfg.ModelName)
	if err != nil {
		storageError(w, err)
		return
	}
	if created {
		s.workers.Add(1)
		go func() {
			defer s.workers.Done()
			ctx, cancel := context.WithTimeout(s.root, 2*time.Minute)
			defer cancel()
			output, runErr := app.GenerateDirections(ctx, s.cfg, job.Input, func(_ context.Context, c model.CallRecord) error {
				saveCtx, stop := context.WithTimeout(context.Background(), 5*time.Second)
				defer stop()
				return repo.RecordPlanningCall(saveCtx, job.ID, c)
			})
			if runErr != nil {
				slog.Warn("planning generation failed", "job_id", job.ID, "error", runErr)
			}
			saveCtx, stop := context.WithTimeout(context.Background(), 5*time.Second)
			defer stop()
			if err := repo.FinishPlanningJob(saveCtx, job.ID, output, runErr); err != nil {
				slog.Error("planning result not saved", "job_id", job.ID, "error", err)
			}
		}()
	}
	send(w, http.StatusAccepted, job)
}
func (s *service) selectPlanning(w http.ResponseWriter, r *http.Request) {
	var req planning.SelectRequest
	if !planningBody(w, r, &req) {
		return
	}
	repo := s.planningRepo(w)
	if repo == nil {
		return
	}
	selection, err := repo.SelectPlanningDirection(r.Context(), planningScope, req)
	if err != nil {
		storageError(w, err)
		return
	}
	send(w, 200, selection)
}
