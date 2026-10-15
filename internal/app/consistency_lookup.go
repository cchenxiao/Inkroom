package app

import (
	"context"
	"fmt"
	"inkloom/internal/agents"
	"inkloom/internal/agents/model"
	"inkloom/internal/domain/manuscript"
	"inkloom/internal/domain/memory"
	"inkloom/internal/domain/review"
	"inkloom/internal/orchestration"
	"inkloom/internal/retrieval"
	"time"
)

// CriticLookup 按稿本版本保留公开轨迹和证据，不改 Writer 的 InputDigest。
type CriticLookup struct {
	DraftVersion int                        `json:"draftVersion"`
	InputDigest  string                     `json:"inputDigest"` // 当前正文+冻结基础材料摘要，供已完成查证复用。
	Review       orchestration.CriticReview `json:"review"`
}
type CriticLookupRepository interface {
	GetRun(context.Context, string) (Run, error)
	SaveCriticLookup(context.Context, string, CriticLookup) error
}

func NewConsistencyCheck(s *retrieval.Service, repo CriticLookupRepository, runID string) orchestration.ConsistencyCheck {
	return func(ctx context.Context, chat model.ChatModel, state orchestration.ChapterState) (orchestration.CriticReview, model.Usage, error) {
		result := orchestration.CriticReview{Critic: "hard_consistency", DraftVersion: state.DraftVersion, Status: "running", Findings: []review.Finding{}}
		digest, err := manuscript.ContentDigest(struct {
			Context  manuscript.ContextBundle
			Segments []manuscript.Segment
		}{state.Context, state.Segments})
		if err != nil {
			return result, model.Usage{}, err
		}
		current, err := repo.GetRun(ctx, runID)
		if err != nil {
			return result, model.Usage{}, err
		}
		for _, c := range current.CriticLookups {
			if c.DraftVersion == state.DraftVersion && c.Review.Status == "completed" {
				if c.InputDigest != digest {
					return result, model.Usage{}, ErrContextMismatch
				}
				return c.Review, model.Usage{Known: true}, nil
			}
		}
		view := CurrentMemoryView()
		if state.Context.ProjectID != view.ProjectID || state.Context.BranchID != view.BranchID || state.Context.ChapterID != "ch7" {
			return result, model.Usage{}, fmt.Errorf("critic lookup supports current ch7/main slice only")
		}
		session, err := s.Session(ctx, view)
		if err != nil {
			return result, model.Usage{}, err
		}
		fs, evidence, trace, usage, err := agents.CheckConsistencyTools(ctx, chat, state.Segments, state.DraftVersion, state.Context, func(ctx context.Context, q string) (retrieval.Result, error) { return session.Search(ctx, view, q, 3) }, func(trace memory.LookupTrace, evidence *memory.RetrievalContext, fs []review.Finding) error {
			result.Lookup = &trace
			result.Evidence = evidence
			result.Findings = fs
			result.Status = "running"
			if trace.Stop == "ready" {
				result.Status = "completed"
			} else if trace.Stop != "" {
				result.Status = "failed"
			}
			save, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			return repo.SaveCriticLookup(save, runID, CriticLookup{DraftVersion: state.DraftVersion, InputDigest: digest, Review: result})
		})
		result.Lookup = &trace
		result.Evidence = evidence
		result.Findings = fs
		if err != nil {
			result.Status = "failed"
		} else {
			result.Status = "completed"
		}
		return result, usage, err
	}
}

// Fake 中也演示一次原生查询；真实模型自行选择是否查、查什么。
type lookupFake struct{ next model.ChatModel }

func (f lookupFake) Generate(ctx context.Context, in model.Input) (model.Output, model.Usage, error) {
	if in.Role == "hard_consistency" && in.Purpose == model.Generate && len(in.Tools) > 0 && len(in.Messages) == 0 {
		return model.Output{FinishReason: model.ToolRequested, ToolCalls: []model.ToolCall{{ID: "critic-memory", Name: "search_memory", Arguments: `{"query":"铜扣 父亲 旧外套"}`}}}, model.Usage{Known: true}, nil
	}
	return f.next.Generate(ctx, in)
}
