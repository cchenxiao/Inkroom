// Package orchestration 决定节点顺序与循环边界，不把控制权交给模型。
package orchestration

import (
	"context"
	"errors"
	"fmt"
	"log/slog"

	"github.com/cloudwego/eino/compose"
	"inkloom/internal/agents"
	"inkloom/internal/agents/model"
	"inkloom/internal/domain/manuscript"
	"inkloom/internal/domain/review"
	"inkloom/internal/domain/revision"
	"inkloom/internal/domain/style"
)

type Options struct {
	MaxRounds  int
	AutoRevise bool // 仅授权当前隔离候选稿的 P2 字句修改，不包括正式稿和 Bible。
	OnProgress func(ChapterState)
}

type ChapterState struct {
	Context      manuscript.ContextBundle `json:"context"`
	DraftVersion int                      `json:"draftVersion"`
	Segments     []manuscript.Segment     `json:"segments"`
	Findings     []review.Finding         `json:"-"`
	Report       review.Report            `json:"report"`
	Reviews      []review.Report          `json:"reviews"`
	Metrics      []style.Stats            `json:"metrics"`
	Revisions    []revision.Revision      `json:"revisions"`
	ReviseRound  int                      `json:"reviseRound"`
	MaxRounds    int                      `json:"maxRounds"`
	Status       string                   `json:"status"`
	CurrentNode  string                   `json:"currentNode"`
	StopReason   string                   `json:"stopReason,omitempty"`
	Usage        model.Usage              `json:"usage"`
}

// NewChapter 的条件回边：aggregate → polisher → critic → aggregate。
// 初审不计返工；每次尝试 Polish 才增加轮数，格式修复只占模型调用预算。
func NewChapter(ctx context.Context, chat model.ChatModel, opts Options) (compose.Runnable[manuscript.ContextBundle, ChapterState], error) {
	if opts.MaxRounds == 0 {
		opts.MaxRounds = 2
	}
	if opts.MaxRounds != 2 && opts.MaxRounds != 3 {
		return nil, fmt.Errorf("maxRounds must be 2 or 3")
	}
	emit := func(s ChapterState) {
		if opts.OnProgress != nil {
			opts.OnProgress(s)
		}
	}
	start := func(s ChapterState, node string) ChapterState {
		s.CurrentNode = node
		emit(s)
		slog.InfoContext(ctx, "node.started", "node", node, "draft_version", s.DraftVersion, "round", s.ReviseRound)
		return s
	}
	done := func(s ChapterState) ChapterState {
		emit(s)
		slog.InfoContext(ctx, "node.finished", "node", s.CurrentNode, "draft_version", s.DraftVersion, "round", s.ReviseRound)
		return s
	}
	g := compose.NewGraph[manuscript.ContextBundle, ChapterState]()
	if err := g.AddLambdaNode("writer", compose.InvokableLambda(func(ctx context.Context, in manuscript.ContextBundle) (ChapterState, error) {
		state := start(ChapterState{Context: in, Report: review.Report{Findings: []review.Finding{}}, Status: "running", MaxRounds: opts.MaxRounds, Segments: []manuscript.Segment{}, Reviews: []review.Report{}, Revisions: []revision.Revision{}, Metrics: []style.Stats{}}, "draft")
		segment, usage, err := agents.Write(ctx, chat, in)
		if err != nil {
			return state, err
		}
		state.Segments = []manuscript.Segment{segment}
		state.DraftVersion = 1
		state.Usage = usage
		return done(state), nil
	})); err != nil {
		return nil, err
	}
	if err := g.AddLambdaNode("critic", compose.InvokableLambda(func(ctx context.Context, state ChapterState) (ChapterState, error) {
		state = start(state, "ai_taste")
		state.Metrics = style.Analyze(state.Segments, state.Context.BannedPhrases)
		findings, usage, err := agents.Critique(ctx, chat, state.Segments, state.DraftVersion, state.Metrics)
		if err != nil {
			return state, err
		}
		state.Findings = style.AddFindings(findings, state.Metrics, state.DraftVersion)
		state.Usage.InputTokens += usage.InputTokens
		state.Usage.OutputTokens += usage.OutputTokens
		return done(state), nil
	})); err != nil {
		return nil, err
	}
	if err := g.AddLambdaNode("aggregate", compose.InvokableLambda(func(ctx context.Context, state ChapterState) (ChapterState, error) {
		state = start(state, "aggregate")
		report, err := review.Aggregate(state.Findings, state.Segments, state.DraftVersion)
		if err != nil {
			return state, err
		}
		state.Report = report
		state.Reviews = append(append([]review.Report{}, state.Reviews...), report)
		switch {
		case !hasP2(report):
			state.Status = "completed"
			state.StopReason = "语言复检完成；不代表通过全章定稿门禁"
		case !opts.AutoRevise:
			state.Status = "waiting_human"
			state.StopReason = "尚未授权自动句级修订"
		case state.ReviseRound >= opts.MaxRounds:
			state.Status = "escalated"
			state.StopReason = "已达返工上限，仍有 P2 问题，交作者处理"
		}
		return done(state), nil
	})); err != nil {
		return nil, err
	}
	if err := g.AddLambdaNode("polisher", compose.InvokableLambda(func(ctx context.Context, state ChapterState) (ChapterState, error) {
		state.ReviseRound++
		state = start(state, "micro_edit")
		proposal, usage, err := agents.Polish(ctx, chat, state.Segments, state.Report.Findings, state.DraftVersion, state.Context.ProtectedTerms)
		if err != nil {
			return state, err
		}
		state.Usage.InputTokens += usage.InputTokens
		state.Usage.OutputTokens += usage.OutputTokens
		updated, err := revision.Apply(state.Segments, state.Report.Findings, state.DraftVersion, proposal, state.Context.ProtectedTerms)
		if err != nil {
			state.Status = "waiting_human"
			state.StopReason = err.Error()
			return done(state), nil
		}
		// 新建切片保留旧快照：已发给 HTTP 轮询的 state 不得再就地修改。
		state.Revisions = append(append([]revision.Revision{}, state.Revisions...), revision.Revision{Round: state.ReviseRound, FromVersion: state.DraftVersion, ToVersion: state.DraftVersion + 1, Patches: proposal.Patches})
		state.Segments = updated
		state.DraftVersion++
		state.Report = review.Report{DraftVersion: state.DraftVersion, Findings: []review.Finding{}} // 旧评审失效，等待本版复检。
		state.Findings = nil
		state.Metrics = style.Analyze(updated, state.Context.BannedPhrases)
		return done(state), nil
	})); err != nil {
		return nil, err
	}
	for _, edge := range [][2]string{{compose.START, "writer"}, {"writer", "critic"}, {"critic", "aggregate"}} {
		if err := g.AddEdge(edge[0], edge[1]); err != nil {
			return nil, err
		}
	}
	route := func(next string) func(context.Context, ChapterState) (string, error) {
		return func(_ context.Context, s ChapterState) (string, error) {
			if s.Status != "running" {
				return compose.END, nil
			}
			return next, nil
		}
	}
	if err := g.AddBranch("aggregate", compose.NewGraphBranch(route("polisher"), map[string]bool{"polisher": true, compose.END: true})); err != nil {
		return nil, err
	}
	if err := g.AddBranch("polisher", compose.NewGraphBranch(route("critic"), map[string]bool{"critic": true, compose.END: true})); err != nil {
		return nil, err
	}
	return g.Compile(ctx, compose.WithNodeTriggerMode(compose.AnyPredecessor), compose.WithMaxRunSteps(4+3*opts.MaxRounds))
}

func hasP2(r review.Report) bool {
	for _, f := range r.Findings {
		if f.Severity == review.P2 {
			return true
		}
	}
	return false
}

// TerminalError 保留最后候选；预算不足时升级人工，取消/请求失败保持失败。
func TerminalError(s ChapterState, err error) ChapterState {
	s.Status = "failed"
	s.StopReason = "运行失败；保留最后候选，尚未完成复检"
	if errors.Is(err, model.ErrBudgetExhausted) {
		s.Status = "escalated"
		s.StopReason = "模型调用预算已耗尽，交作者处理"
	}
	return s
}
