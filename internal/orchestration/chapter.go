// Package orchestration 决定执行顺序。节点薄，生成与校验规则在各自包里。
package orchestration

import (
	"context"
	"log/slog"

	"github.com/cloudwego/eino/compose"

	"inkloom/internal/agents"
	"inkloom/internal/agents/model"
	"inkloom/internal/domain/manuscript"
	"inkloom/internal/domain/review"
)

// ChapterState 沿图传递本次运行的产物，不是全局变量或永久数据库。
// I1 只有串行节点；到 I5 并行评审时，各节点返回独立结果再统一聚合。
type ChapterState struct {
	Context      manuscript.ContextBundle `json:"context"`
	DraftVersion int                      `json:"draftVersion"`
	Segments     []manuscript.Segment     `json:"segments"`
	Findings     []review.Finding         `json:"-"`
	Report       review.Report            `json:"report"`
	Usage        model.Usage              `json:"usage"`
}

// NewChapter 编译显式图：START → writer → critic → aggregate → END。
// 编译检查连接和输入输出类型；Invoke 才真正执行模型调用。
func NewChapter(ctx context.Context, chat model.ChatModel) (compose.Runnable[manuscript.ContextBundle, ChapterState], error) {
	g := compose.NewGraph[manuscript.ContextBundle, ChapterState]()
	if err := g.AddLambdaNode("writer", compose.InvokableLambda(func(ctx context.Context, in manuscript.ContextBundle) (ChapterState, error) {
		slog.InfoContext(ctx, "node.started", "node", "writer")
		segment, usage, err := agents.Write(ctx, chat, in)
		if err != nil {
			return ChapterState{}, err
		}
		slog.InfoContext(ctx, "node.finished", "node", "writer", "draft_version", 1)
		return ChapterState{Context: in, DraftVersion: 1, Segments: []manuscript.Segment{segment}, Usage: usage}, nil
	})); err != nil {
		return nil, err
	}
	if err := g.AddLambdaNode("critic", compose.InvokableLambda(func(ctx context.Context, state ChapterState) (ChapterState, error) {
		slog.InfoContext(ctx, "node.started", "node", "critic")
		findings, usage, err := agents.Critique(ctx, chat, state.Segments, state.DraftVersion)
		if err != nil {
			return ChapterState{}, err
		}
		state.Findings = findings
		state.Usage.InputTokens += usage.InputTokens
		state.Usage.OutputTokens += usage.OutputTokens
		state.Usage.Known = state.Usage.Known && usage.Known
		slog.InfoContext(ctx, "node.finished", "node", "critic")
		return state, nil
	})); err != nil {
		return nil, err
	}
	if err := g.AddLambdaNode("aggregate", compose.InvokableLambda(func(ctx context.Context, state ChapterState) (ChapterState, error) {
		slog.InfoContext(ctx, "node.started", "node", "aggregate")
		report, err := review.Aggregate(state.Findings, state.Segments, state.DraftVersion)
		if err != nil {
			return ChapterState{}, err
		}
		state.Report = report
		slog.InfoContext(ctx, "node.finished", "node", "aggregate", "findings", len(report.Findings))
		return state, nil
	})); err != nil {
		return nil, err
	}
	for _, edge := range [][2]string{{compose.START, "writer"}, {"writer", "critic"}, {"critic", "aggregate"}, {"aggregate", compose.END}} {
		if err := g.AddEdge(edge[0], edge[1]); err != nil {
			return nil, err
		}
	}
	return g.Compile(ctx)
}
