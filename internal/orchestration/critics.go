package orchestration

import (
	"context"
	"errors"
	"fmt"
	"sync"

	"inkloom/internal/agents"
	"inkloom/internal/agents/model"
	"inkloom/internal/agents/parse"
	"inkloom/internal/domain/manuscript"
	"inkloom/internal/domain/memory"
	"inkloom/internal/domain/review"
	"inkloom/internal/domain/style"
)

type ConsistencyCheck func(context.Context, model.ChatModel, ChapterState) (CriticReview, model.Usage, error)

type CriticReview struct {
	ScopedEvidence []ScopedReviewEvidence    `json:"scopedEvidence,omitempty"`
	Length         *manuscript.LengthSummary `json:"length,omitempty"`
	Continuity     []review.ContinuityCheck  `json:"continuity,omitempty"`
	AuthorCheck    *review.AuthorCheck       `json:"authorCheck,omitempty"`
	Lookup         *memory.LookupTrace       `json:"lookup,omitempty"`
	Evidence       *memory.RetrievalContext  `json:"evidence,omitempty"`
	Critic         string                    `json:"critic"`
	DraftVersion   int                       `json:"draftVersion"`
	Status         string                    `json:"status"`
	Findings       []review.Finding          `json:"findings"`
	FailureCode    string                    `json:"failureCode,omitempty"`
	Error          string                    `json:"error,omitempty"`
}

type ScopedReviewEvidence struct {
	BeatID   string                   `json:"beatId"`
	Evidence *memory.RetrievalContext `json:"evidence,omitempty"`
	Lookup   memory.LookupTrace       `json:"lookup"`
}

func (r CriticReview) WithEvidence(b manuscript.ContextBundle) (manuscript.ContextBundle, error) {
	out, err := b.WithReviewEvidence(r.Evidence)
	if err != nil {
		return out, err
	}
	seen := map[string]bool{}
	for _, scope := range r.ScopedEvidence {
		if seen[scope.BeatID] {
			return out, fmt.Errorf("duplicate review scope")
		}
		seen[scope.BeatID] = true
		found := false
		for i, t := range out.Targets {
			if t.Beat.ID == scope.BeatID {
				found = true
				out.Targets[i], err = t.WithReviewEvidence(scope.Evidence)
				if err != nil {
					return out, err
				}
			}
		}
		if !found {
			return out, fmt.Errorf("review evidence target not in chapter")
		}
	}
	return out, nil
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
					if errs[i] == nil && state.RewriteRequest() != nil {
						b, e := results[i].WithEvidence(state.Context)
						if e != nil {
							errs[i] = e
						} else {
							var extra model.Usage
							assessment, usage, err := agents.AssessConsistency(ctx, chat, state.Segments, state.DraftVersion, b, state.RewriteRequest())
							fs, results[i].AuthorCheck, results[i].Continuity, extra, errs[i] = assessment.Findings, assessment.AuthorCheck, assessment.Continuity, usage, err
							ids := map[string]bool{}
							for _, existing := range results[i].Findings {
								ids[existing.ID] = true
							}
							for _, f := range fs {
								originalID := f.ID
								for n := 1; ids[f.ID]; n++ {
									f.ID = fmt.Sprintf("author-check-%d-%s", n, originalID)
								}
								ids[f.ID] = true
								results[i].Findings = append(results[i].Findings, f)
							}
							usages[i].InputTokens += extra.InputTokens
							usages[i].OutputTokens += extra.OutputTokens
							usages[i].Known = usages[i].Known && extra.Known
						}
					}
					if errs[i] != nil {
						results[i].Status = "failed"
						results[i].Error = errs[i].Error()
						results[i].FailureCode = reviewFailureCode(errs[i])
						results[i].Findings = []review.Finding{}
						cancel()
					}
					return
				}
				assessment, usage, err := agents.AssessConsistency(ctx, chat, state.Segments, state.DraftVersion, state.Context, state.RewriteRequest())
				fs, results[i].AuthorCheck, results[i].Continuity, usages[i], errs[i] = assessment.Findings, assessment.AuthorCheck, assessment.Continuity, usage, err
			} else {
				fs, usages[i], errs[i] = agents.Critique(ctx, chat, state.Segments, state.DraftVersion, state.Metrics, state.Context)
				if errs[i] == nil {
					fs = style.AddFindings(fs, state.Metrics, state.DraftVersion)
				}
			}
			if role == "ai_taste" {
				results[i].Length = manuscript.MeasureLength(state.Segments, state.Context)
			}
			r := CriticReview{Length: results[i].Length, Continuity: results[i].Continuity, AuthorCheck: results[i].AuthorCheck, Critic: role, DraftVersion: state.DraftVersion, Status: "completed", Findings: fs}
			if errs[i] != nil {
				r.Status = "failed"
				r.Error = errs[i].Error()
				r.FailureCode = reviewFailureCode(errs[i])
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
			return r.WithEvidence(s.Context)
		}
	}
	return s.Context.Freeze()
}

// RewriteRequest preserves legacy fork requests while keeping frozen context immutable.
func (s ChapterState) RewriteRequest() *manuscript.AuthorRewrite {
	if s.AuthorRequest != nil {
		return s.AuthorRequest
	}
	if s.Context.RevisionRequest != nil {
		return s.Context.RevisionRequest
	}
	return s.Context.Rewrite
}

// Stable business-facing classification; raw provider details stay out of UI copy.
func reviewFailureCode(err error) string {
	var output *parse.Error
	switch {
	case errors.As(err, &output):
		return string(output.Kind)
	case errors.Is(err, context.DeadlineExceeded):
		return "timeout"
	case errors.Is(err, context.Canceled):
		return "canceled"
	case errors.Is(err, model.ErrBudgetExhausted):
		return "budget_exhausted"
	default:
		return "review_failed"
	}
}
