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
	ConsistencyCheck  ConsistencyCheck
	CallHistory       []model.CallRecord
	FrozenInput       *manuscript.FrozenInput // HTTP 在 Writer 前持久化；CLI 可由应用层即时装配。
	BaseDraftVersion  int                     // 已持久化的章节版本；初稿从它递增。
	OnModelCall       func(context.Context, model.CallRecord) error
	AllowLocalRewrite bool // 仅授权冻结的本场/Beat 候选正文，不能改设定/大纲/事件结果。
	MaxRounds         int
	AutoRevise        bool // 仅授权当前隔离候选稿的 P2 字句修改，不包括正式稿和 Bible。
	OnProgress        func(ChapterState)
}

type ChapterState struct {
	FindingProposal  *FindingProposal          `json:"findingProposal,omitempty"`
	FindingChanges   []FindingChange           `json:"findingChanges,omitempty"`
	ReviewPending    bool                      `json:"reviewPending,omitempty"`
	FindingDecisions []FindingDecision         `json:"findingDecisions,omitempty"`
	AuthorRequest    *manuscript.AuthorRewrite `json:"authorRequest,omitempty"`
	NodePhase        string                    `json:"nodePhase,omitempty"`
	CriticReviews    []CriticReview            `json:"criticReviews"`
	Route            review.Decision           `json:"route"`
	Context          manuscript.ContextBundle  `json:"context"`
	DraftVersion     int                       `json:"draftVersion"`
	Segments         []manuscript.Segment      `json:"segments"`
	Findings         []review.Finding          `json:"-"`
	Report           review.Report             `json:"report"`
	Reviews          []review.Report           `json:"reviews"`
	Metrics          []style.Stats             `json:"metrics"`
	Revisions        []revision.Revision       `json:"revisions"`
	ReviseRound      int                       `json:"reviseRound"`
	MaxRounds        int                       `json:"maxRounds"`
	Status           string                    `json:"status"`
	CurrentNode      string                    `json:"currentNode"`
	StopReason       string                    `json:"stopReason,omitempty"`
	Usage            model.Usage               `json:"usage"`
}

// NewChapter 的条件回边：aggregate → polisher/scene_reviser/structural_reviser → critics → aggregate。
// 初审不计返工；每次执行选中的修订节点增加轮数，格式修复只占模型调用预算。
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
		s.NodePhase = "started"
		emit(s)
		slog.InfoContext(ctx, "node.started", "node", node, "draft_version", s.DraftVersion, "round", s.ReviseRound)
		return s
	}
	done := func(s ChapterState) ChapterState {
		s.NodePhase = "finished"
		emit(s)
		slog.InfoContext(ctx, "node.finished", "node", s.CurrentNode, "draft_version", s.DraftVersion, "round", s.ReviseRound)
		return s
	}
	g := compose.NewGraph[manuscript.ContextBundle, ChapterState]()
	if err := g.AddLambdaNode("writer", compose.InvokableLambda(func(ctx context.Context, in manuscript.ContextBundle) (ChapterState, error) {
		frozen, err := in.Freeze()
		if err != nil {
			return ChapterState{}, err
		}
		request := frozen.Rewrite
		if request == nil {
			request = frozen.RevisionRequest
		}
		state := start(ChapterState{Context: frozen, AuthorRequest: request, CriticReviews: []CriticReview{}, Report: review.Report{Findings: []review.Finding{}}, Status: "running", DraftVersion: opts.BaseDraftVersion, MaxRounds: opts.MaxRounds, Segments: []manuscript.Segment{}, Reviews: []review.Report{}, Revisions: []revision.Revision{}, Metrics: []style.Stats{}}, "draft")
		segments, usage, err := agents.WriteScope(ctx, chat, frozen)
		if err != nil {
			return state, err
		}
		for i := range segments {
			segments[i].Version = opts.BaseDraftVersion + 1
		}
		state.Segments = segments
		state.DraftVersion = opts.BaseDraftVersion + 1
		state.Usage = usage
		return done(state), nil
	})); err != nil {
		return nil, err
	}
	if err := g.AddLambdaNode("critic", compose.InvokableLambda(func(ctx context.Context, state ChapterState) (ChapterState, error) {
		state.CriticReviews = []CriticReview{}
		state = start(state, "critics")
		state.Metrics = style.Analyze(state.Segments, state.Context.BannedPhrases)
		results, usage, err := reviewTogether(ctx, chat, state, opts.ConsistencyCheck)
		state.CriticReviews = results
		state.Usage.InputTokens += usage.InputTokens
		state.Usage.OutputTokens += usage.OutputTokens
		if err != nil {
			emit(state)
			return state, err
		}
		state.Findings = []review.Finding{}
		for _, r := range results {
			state.Findings = append(state.Findings, r.Findings...)
		}
		return done(state), nil
	})); err != nil {
		return nil, err
	}
	if err := g.AddLambdaNode("aggregate", compose.InvokableLambda(func(ctx context.Context, state ChapterState) (ChapterState, error) {
		state = start(state, "aggregate")
		evidence, err := state.ReviewContext()
		if err != nil {
			return state, err
		}
		report, err := review.Aggregate(state.Findings, state.Segments, state.DraftVersion, evidence.ReadingSources()...)
		if err != nil {
			return state, err
		}
		state.Report = report
		state.Reviews = append(append([]review.Report{}, state.Reviews...), report)
		state.Route = review.Route(report, state.Segments, state.Context, opts.AutoRevise, opts.AllowLocalRewrite)
		switch {
		case state.Route.NeedsHuman:
			state.Status = "needs_human"
			// 保持 I4 仅缺少微改授权时的状态兼容。
			if state.Route.Kind == "micro" {
				state.Status = "waiting_human"
			}
			state.StopReason = state.Route.Reason
		case state.Route.Kind == "none":
			state.Status = "completed"
			state.StopReason = "一致性与语言评审已完成；候选仍须作者审核，不代表全章定稿"
		case state.ReviseRound >= opts.MaxRounds:
			state.Status = "escalated"
			state.StopReason = "已达返工上限，仍有阻断问题，交作者处理"
		}
		return done(state), nil
	})); err != nil {
		return nil, err
	}
	for _, node := range []string{"polisher", "scene_reviser", "structural_reviser"} {
		if err := g.AddLambdaNode(node, compose.InvokableLambda(func(ctx context.Context, state ChapterState) (ChapterState, error) {
			state.ReviseRound++
			current := node
			if node == "polisher" {
				current = "micro_edit"
			}
			state = start(state, current)
			var proposal revision.Proposal
			var usage model.Usage
			var err error
			if node == "polisher" {
				proposal, usage, err = agents.Polish(ctx, chat, state.Segments, state.Report.Findings, state.DraftVersion, state.Context.ProtectedTerms, state.Context)
			} else {
				var evidence manuscript.ContextBundle
				evidence, err = state.ReviewContext()
				if err == nil {
					proposal, usage, err = agents.Rewrite(ctx, chat, state.Segments, state.Report, evidence, state.Route)
				}
			}
			if err != nil {
				return state, err
			}
			state.Usage.InputTokens += usage.InputTokens
			state.Usage.OutputTokens += usage.OutputTokens
			var updated []manuscript.Segment
			if node == "polisher" {
				updated, err = revision.Apply(state.Segments, state.Report.Findings, state.DraftVersion, proposal, state.Context.ProtectedTerms)
			} else {
				updated, err = revision.ApplyScoped(state.Segments, state.Report, state.Route, proposal)
			}
			if err != nil {
				state.Status = "needs_human"
				if node == "polisher" {
					state.Status = "waiting_human"
				}
				state.StopReason = err.Error()
				return done(state), nil
			}
			state.Revisions = append(append([]revision.Revision{}, state.Revisions...), revision.Revision{Kind: state.Route.Kind, Round: state.ReviseRound, FromVersion: state.DraftVersion, ToVersion: state.DraftVersion + 1, Patches: proposal.Patches})
			state.Segments = updated
			state.DraftVersion++
			state.Report = review.Report{DraftVersion: state.DraftVersion, Findings: []review.Finding{}}
			state.Findings = nil
			state.CriticReviews = []CriticReview{}
			state.Route = review.Decision{Kind: "pending", TargetIDs: []string{}, FindingIDs: []string{}, Reason: "本版等待两个 Critic 复检"}
			state.Metrics = style.Analyze(updated, state.Context.BannedPhrases)
			return done(state), nil
		})); err != nil {
			return nil, err
		}
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
	if err := g.AddBranch("aggregate", compose.NewGraphBranch(func(_ context.Context, s ChapterState) (string, error) {
		if s.Status != "running" {
			return compose.END, nil
		}
		switch s.Route.Kind {
		case "structural":
			return "structural_reviser", nil
		case "scene":
			return "scene_reviser", nil
		case "micro":
			return "polisher", nil
		}
		return "", fmt.Errorf("unexpected route %q", s.Route.Kind)
	}, map[string]bool{"polisher": true, "scene_reviser": true, "structural_reviser": true, compose.END: true})); err != nil {
		return nil, err
	}
	for _, node := range []string{"polisher", "scene_reviser", "structural_reviser"} {
		if err := g.AddBranch(node, compose.NewGraphBranch(route("critic"), map[string]bool{"critic": true, compose.END: true})); err != nil {
			return nil, err
		}
	}
	return g.Compile(ctx, compose.WithNodeTriggerMode(compose.AnyPredecessor), compose.WithMaxRunSteps(4+3*opts.MaxRounds))
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
