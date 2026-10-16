package postgres

import (
	"context"
	"crypto/rand"
	"errors"
	"inkloom/internal/app"
	"inkloom/internal/config"
	"inkloom/internal/domain/planning"
	"os"
	"testing"
	"time"
)

// 一条实际数据库链路覆盖迟到候选、作者选定竞争与重启。只操作独立测试 scope。
func TestPlanningVersionsAndRestart(t *testing.T) {
	url := os.Getenv("INKLOOM_TEST_DATABASE_URL")
	if url == "" {
		t.Skip("requires dedicated test database")
	}
	ctx := context.Background()
	s, err := Open(ctx, url)
	if err != nil {
		t.Fatal(err)
	}
	scope := "planning-test-" + rand.Text()
	defer func() {
		for _, sql := range []string{
			"DELETE FROM planning_calls WHERE job_id IN (SELECT id FROM planning_jobs WHERE scope=$1)",
			"DELETE FROM planning_jobs WHERE scope=$1", "DELETE FROM planning_selections WHERE scope=$1", "DELETE FROM planning_inputs WHERE scope=$1", "DELETE FROM planning_heads WHERE scope=$1",
		} {
			if _, e := s.pool.Exec(ctx, sql, scope); e != nil {
				t.Error(e)
			}
		}
		s.Close()
	}()
	input, err := s.SavePlanningInput(ctx, scope, 0, planning.Intake{Premise: "修钟人收到了明天寄出的返修单。"})
	if err != nil {
		t.Fatal(err)
	}
	job, created, err := s.StartPlanningJob(ctx, scope, rand.Text(), 1, "scripted-fake")
	if err != nil || !created {
		t.Fatal(err)
	}
	_, created, err = s.StartPlanningJob(ctx, scope, job.ID, 1, "scripted-fake")
	if err != nil || created {
		t.Fatal("same request must not regenerate", err)
	}
	out, err := app.GenerateDirections(ctx, config.Config{Model: "fake", ModelName: "scripted-fake", MaxCalls: 3, MaxTokens: 24000, MaxOutputTokens: 2048, CallTimeout: time.Second}, input, nil)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = s.SavePlanningInput(ctx, scope, 1, planning.Intake{Premise: "改成两位修钟人为了保住小店而合作。"}); err != nil {
		t.Fatal(err)
	}
	if err = s.FinishPlanningJob(ctx, job.ID, out, nil); err != nil {
		t.Fatal(err)
	}
	req := planning.SelectRequest{ExpectedInputVersion: 2, JobID: job.ID, CandidateVersion: 1, CandidateIndex: 0, Direction: out.Directions[0]}
	if _, err = s.SelectPlanningDirection(ctx, scope, req); !errors.Is(err, app.ErrVersionMismatch) {
		t.Fatal("late candidate accepted", err)
	}
	job, _, err = s.StartPlanningJob(ctx, scope, rand.Text(), 2, "scripted-fake")
	if err != nil {
		t.Fatal(err)
	}
	if err = s.FinishPlanningJob(ctx, job.ID, out, nil); err != nil {
		t.Fatal(err)
	}
	req.JobID = job.ID
	req.Direction.Title = "作者调整后的方向"
	chosen, err := s.SelectPlanningDirection(ctx, scope, req)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = s.SelectPlanningDirection(ctx, scope, req); !errors.Is(err, app.ErrVersionMismatch) {
		t.Fatal("stale author selection overwritten", err)
	}
	pending, _, err := s.StartPlanningJob(ctx, scope, rand.Text(), 2, "scripted-fake")
	if err != nil {
		t.Fatal(err)
	}
	s.Close()
	s, err = Open(ctx, url)
	if err != nil {
		t.Fatal(err)
	}
	state, err := s.GetPlanning(ctx, scope)
	if err != nil {
		t.Fatal(err)
	}
	if state.Selection == nil || state.Selection.Version != chosen.Version || state.Selection.Direction.Title != req.Direction.Title {
		t.Fatal("selection lost after restart")
	}
	for _, j := range state.Jobs {
		if j.ID == pending.ID && j.Status != "interrupted" {
			t.Fatal("pending task should be interrupted")
		}
	}
	if _, err = s.SavePlanningInput(ctx, scope, 2, planning.Intake{Premise: "再换一个想法"}); err != nil {
		t.Fatal(err)
	}
	state, err = s.GetPlanning(ctx, scope)
	if err != nil || state.Selection.InputVersion == state.Input.Version {
		t.Fatal("selection must retain old dependency", err)
	}
}
