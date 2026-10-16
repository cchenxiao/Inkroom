package orchestration

import (
	"context"
	"errors"
	"sync"

	"inkloom/internal/agents"
	"inkloom/internal/agents/model"
	"inkloom/internal/domain/manuscript"
	"inkloom/internal/domain/memory"
	"inkloom/internal/domain/review"
	"inkloom/internal/domain/style"
)

type ConsistencyCheck func(context.Context, model.ChatModel, ChapterState) (CriticReview, model.Usage, error)

type CriticReview struct {
	Lookup       *memory.LookupTrace      `json:"lookup,omitempty"`
	Evidence     *memory.RetrievalContext `json:"evidence,omitempty"`
	Critic       string                   `json:"critic"`
	DraftVersion int                      `json:"draftVersion"`
	Status       string                   `json:"status"`
	Findings     []review.Finding         `json:"findings"`
	Error        string                   `json:"error,omitempty"`
}

// reviewTogether 是 fan-out/barrier：两个 goroutine 各写自己的槽位，Wait 后主协程才合并。
// 不在子协程调用 OnProgress，也不并发修改 ChapterState 或 HTTP 快照。
func reviewTogether(ctx context.Context, chat model.ChatModel, state ChapterState, checks ...ConsistencyCheck) ([]CriticReview, model.Usage, error) {
	ctx, cancel := context.WithCancel(ctx)
	defer cancel()
	roles := []string{"hard_consistency", "ai_taste"}
	results := make([]CriticReview, len(roles))
	usages := make([]model.Usage, len(roles))
	errs := make([]error, len(roles))
	var wg sync.WaitGroup
	for i, role := range roles {
		wg.Add(1)
		go func(i int, role string) {
			defer wg.Done()
			var fs []review.Finding
			if role == "hard_consistency" {
				if len(checks) > 0 && checks[0] != nil {
					results[i], usages[i], errs[i] = checks[0](ctx, chat, state)
					if errs[i] != nil {
						results[i].Status = "failed"
						results[i].Error = errs[i].Error()
						results[i].Findings = []review.Finding{}
						cancel()
					}
					return
				}
				fs, usages[i], errs[i] = agents.CheckConsistency(ctx, chat, state.Segments, state.DraftVersion, state.Context)
			} else {
				fs, usages[i], errs[i] = agents.Critique(ctx, chat, state.Segments, state.DraftVersion, state.Metrics, state.Context)
				if errs[i] == nil {
					fs = style.AddFindings(fs, state.Metrics, state.DraftVersion)
				}
			}
			r := CriticReview{Critic: role, DraftVersion: state.DraftVersion, Status: "completed", Findings: fs}
			if errs[i] != nil {
				r.Status = "failed"
				r.Error = errs[i].Error()
				r.Findings = []review.Finding{}
				cancel()
			}
			results[i] = r
		}(i, role)
	}
	wg.Wait()
	total := model.Usage{Known: true}
	for _, u := range usages {
		total.InputTokens += u.InputTokens
		total.OutputTokens += u.OutputTokens
		total.Known = total.Known && u.Known
	}
	return results, total, errors.Join(errs...)
}

// ReviewContext 只为当前版本的校验和修订附加查证事实；不回写 Context。
func (s ChapterState) ReviewContext() (manuscript.ContextBundle, error) {
	for _, r := range s.CriticReviews {
		if r.Critic == "hard_consistency" && r.DraftVersion == s.DraftVersion && r.Status == "completed" {
			return s.Context.WithReviewEvidence(r.Evidence)
		}
	}
	return s.Context.Freeze()
}
