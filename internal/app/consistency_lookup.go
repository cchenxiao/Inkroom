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
		targets := state.Context.Targets
		multi := len(targets) > 0
		if !multi {
			targets = []manuscript.ContextBundle{state.Context}
		}
		usage := model.Usage{Known: true}
		allTrace := memory.LookupTrace{Steps: []memory.LookupStep{}}
		persist := func() error {
			save, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			return repo.SaveCriticLookup(save, runID, CriticLookup{DraftVersion: state.DraftVersion, InputDigest: digest, Review: result})
		}
		for i, b := range targets {
			view, e := MemoryView(b)
			if e != nil {
				return result, usage, e
			}
			session, e := s.Session(ctx, view)
			if e != nil {
				return result, usage, e
			}
			segments := state.Segments
			if multi {
				segments = nil
				for _, seg := range state.Segments {
					if seg.BeatID == b.Beat.ID {
						segments = append(segments, seg)
					}
				}
			}
			prefix := append([]memory.LookupStep{}, allTrace.Steps...)
			baseFindings := append([]review.Finding{}, result.Findings...)
			if multi {
				result.ScopedEvidence = append(result.ScopedEvidence, orchestration.ScopedReviewEvidence{BeatID: b.Beat.ID})
			}
			fs, evidence, trace, u, e := agents.CheckConsistencyTools(ctx, chat, segments, state.DraftVersion, b, func(ctx context.Context, q string) (retrieval.Result, error) { return session.Search(ctx, view, q, 3) }, func(trace memory.LookupTrace, evidence *memory.RetrievalContext, fs []review.Finding) error {
				for n := range trace.Steps {
					trace.Steps[n].Scope = b.Beat.ID
				}
				allTrace.Steps = append(append([]memory.LookupStep{}, prefix...), trace.Steps...)
				result.Lookup = &allTrace
				if multi {
					result.ScopedEvidence[i] = orchestration.ScopedReviewEvidence{BeatID: b.Beat.ID, Evidence: evidence, Lookup: trace}
				} else {
					result.Evidence = evidence
				}
				return persist()
			})
			usage.InputTokens += u.InputTokens
			usage.OutputTokens += u.OutputTokens
			usage.Known = usage.Known && u.Known
			if multi {
				for n := range fs {
					fs[n].ID = fmt.Sprintf("scope-%d-%s", i+1, fs[n].ID)
				}
				result.ScopedEvidence[i] = orchestration.ScopedReviewEvidence{BeatID: b.Beat.ID, Evidence: evidence, Lookup: trace}
			} else {
				result.Evidence = evidence
			}
			result.Findings = append(baseFindings, fs...)
			if e != nil {
				result.Status = "failed"
				allTrace.Stop = trace.Stop
				result.Lookup = &allTrace
				_ = persist()
				return result, usage, e
			}
		}
		allTrace.Stop = "ready"
		result.Lookup = &allTrace
		result.Status = "completed"
		if err := persist(); err != nil {
			return result, usage, err
		}
		return result, usage, nil
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
