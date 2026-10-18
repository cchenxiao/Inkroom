package app

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/cloudwego/eino/compose"
	"inkloom/internal/agents/adapters"
	"inkloom/internal/agents/model"
	"inkloom/internal/agents/prompts"
	"inkloom/internal/config"
	"inkloom/internal/demo"
	"inkloom/internal/orchestration"
)

// gateStore 让 checkpoint 字节、等待状态、人工操作回执同事务落库。
// 仅更新 Go 中的 pending，不提前暴露“可审核”，Eino 真正 Set 成功后才可审核。
type gateStore struct {
	repo     HumanRepository
	runID    string
	pending  orchestration.ChapterState
	actionID string
}

func (s *gateStore) Get(ctx context.Context, id string) ([]byte, bool, error) {
	return s.repo.Checkpoint(ctx, id)
}
func (s *gateStore) Set(ctx context.Context, id string, raw []byte) error {
	return s.repo.SaveCheckpoint(ctx, id, raw, s.pending, s.actionID)
}

func ExecuteHuman(ctx context.Context, cfg config.Config, r Run, repo HumanRepository, checks ...orchestration.ConsistencyCheck) error {
	if r.Result == nil {
		return ErrGateBlocked
	}
	var chat model.ChatModel
	var err error
	if r.Provider == "fake" {
		chat = lookupFake{next: demo.NewHumanFake(*r.Result)}
		if r.PendingAction != nil && (r.PendingAction.Type == "rewrite" || r.PendingAction.Type == "propose_finding" || r.PendingAction.Type == "propose_selection") && r.PendingAction.Rewrite != nil {
			req := r.PendingAction.Rewrite
			if err := req.Validate(r.Result.Segments); err != nil {
				return err
			}
			text := string([]rune(req.Original)[req.Start:req.End]) + "（演示修改）"
			raw, _ := json.Marshal(map[string]string{"text": text})
			chat = model.NewFake([]model.Step{{Role: "planned_writer", Content: string(raw)}, {Role: "hard_consistency", Content: `{"findings":[]}`}, {Role: "ai_taste", Content: `{"findings":[]}`}})
		}
		chat = authorReviewFake{next: chat}
	} else {
		if cfg.Model != r.Provider || cfg.ModelName != r.Model {
			return fmt.Errorf("恢复需要与原运行相同的供应商和模型配置")
		}
		chat, err = adapters.NewDeepSeek(cfg)
		if err != nil {
			return err
		}
	}
	calls, err := repo.Calls(ctx, r.ID)
	if err != nil {
		return err
	}
	var budgetSince time.Time
	if r.PendingAction != nil {
		budgetSince, err = repo.ActionStartedAt(ctx, r.ID, r.PendingAction.ID)
		if err != nil {
			return err
		}
	}
	tokenLimit := cfg.HumanOperationTokens
	if tokenLimit <= 0 {
		tokenLimit = r.MaxTokens
	}
	guard := model.NewGuard(chat, model.Limits{BudgetSince: budgetSince, History: calls, Calls: r.MaxCalls, Tokens: tokenLimit, OutputTokens: cfg.MaxOutputTokens, ConsistencyOutputTokens: cfg.ConsistencyOutputTokens, ConsistencyTimeout: cfg.ConsistencyTimeout, Timeout: cfg.CallTimeout, ModelName: r.Model, OnCall: func(_ context.Context, c model.CallRecord) error {
		save, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		return repo.RecordCall(save, r.ID, c)
	}})
	var check orchestration.ConsistencyCheck
	if len(checks) > 0 {
		check = checks[0]
	}
	cp := &gateStore{repo: repo, runID: r.ID}
	actionID := ""
	if r.PendingAction != nil {
		actionID = r.PendingAction.ID
	}
	_, err = orchestration.RunHuman(ctx, *r.Result, prompts.Bind(guard), orchestration.HumanOptions{
		ConsistencyCheck: check, RunID: r.ID, Action: r.PendingAction, Checkpoints: cp, Usage: guard.Usage,
		Pause: func(s orchestration.ChapterState, id string) {
			s.Usage = guard.Usage()
			cp.pending = s
			cp.actionID = id
		},
		Load: func(ctx context.Context, key string) (orchestration.ChapterState, bool, error) {
			return repo.LoadArtifact(ctx, r.ID, key)
		},
		Save: func(ctx context.Context, key string, expected int, s orchestration.ChapterState, origin string) error {
			return repo.CommitArtifact(ctx, r.ID, actionID, key, expected, s, origin)
		},
		Approve: func(ctx context.Context, version int) error { return repo.Approve(ctx, r.ID, actionID, version) },
	})
	if _, ok := compose.ExtractInterruptInfo(err); ok {
		return nil
	}
	return err
}
