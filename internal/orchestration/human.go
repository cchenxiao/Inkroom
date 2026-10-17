package orchestration

import (
	"context"
	"fmt"
	"strings"
	"unicode/utf8"

	"github.com/cloudwego/eino/compose"
	"github.com/cloudwego/eino/schema"
	"inkloom/internal/agents"
	"inkloom/internal/agents/model"
	"inkloom/internal/domain/manuscript"
	"inkloom/internal/domain/review"
	"inkloom/internal/domain/revision"
	"inkloom/internal/domain/style"
)

const HumanWorkflowVersion = "human.v1"

// ID 是作者一次操作的稳定业务键；网络重试沿用 ID，不是模型 attempt。
type HumanAction struct {
	Rewrite      *manuscript.AuthorRewrite `json:"rewrite,omitempty"`
	ID           string                    `json:"id"`
	Type         string                    `json:"type"`
	DraftVersion int                       `json:"draftVersion"`
	Instruction  string                    `json:"instruction,omitempty"`
	SegmentID    string                    `json:"segmentId,omitempty"`
	Text         string                    `json:"text,omitempty"`
}
type humanState struct {
	Chapter ChapterState
	Action  HumanAction
}

func init() {
	schema.RegisterName[humanState]("inkloom.human.v1")
}

type HumanOptions struct {
	ConsistencyCheck ConsistencyCheck
	Checkpoints      compose.CheckPointStore
	RunID            string
	Action           *HumanAction
	Pause            func(ChapterState, string)
	Load             func(context.Context, string) (ChapterState, bool, error)
	Save             func(context.Context, string, int, ChapterState, string) error
	Approve          func(context.Context, int) error
	Usage            func() model.Usage
}

// ApprovalReason 是程序门禁，不由模型自报 approved。通过仅表示候选审核，正式 commit 在 I9。
func ApprovalReason(s ChapterState) string {
	if s.RewriteRequest() != nil {
		checked := false
		for _, c := range s.CriticReviews {
			if c.Critic == "hard_consistency" && c.Status == "completed" && c.DraftVersion == s.DraftVersion && c.AuthorCheck != nil && c.AuthorCheck.Status == "addressed" {
				checked = true
			}
		}
		if !checked {
			return "作者修改要求尚未核对通过，请查看修改核对结果并重新复检"
		}
	}
	if s.Report.DraftVersion != s.DraftVersion || len(s.CriticReviews) != 2 {
		return "当前稿本尚未完成两个必要评审"
	}
	for _, c := range s.CriticReviews {
		if c.Status != "completed" || c.DraftVersion != s.DraftVersion {
			return "当前稿本尚未完成两个必要评审"
		}
	}
	for _, f := range s.Report.Findings {
		if f.Severity != review.P3 || f.RequiresHuman || f.PossibleDialogueLie {
			return "仍有阻断问题或待裁定事实，请先修改并复检"
		}
	}
	return ""
}
func InstructionReason(s ChapterState) string {
	if s.ReviseRound >= s.MaxRounds {
		return "已达返工上限，请人工直改后复检"
	}
	if s.Report.DraftVersion != s.DraftVersion {
		return "当前版本尚未评审"
	}
	d := review.Route(s.Report, s.Segments, s.Context, true, true)
	if d.NeedsHuman || d.Kind == "none" || d.Kind == "human" {
		return "此入口仅修复已有局部问题；事实裁决、跨章和新结构调整请人工处理"
	}
	return ""
}
func ValidateHumanAction(s ChapterState, a HumanAction) error {
	if a.ID == "" || len(a.ID) > 100 || a.DraftVersion != s.DraftVersion {
		return fmt.Errorf("操作标识或稿本版本无效")
	}
	switch a.Type {
	case "approve":
		if why := ApprovalReason(s); why != "" {
			return fmt.Errorf("%s", why)
		}
	case "instruct":
		if why := InstructionReason(s); why != "" {
			return fmt.Errorf("%s", why)
		}
		if strings.TrimSpace(a.Instruction) == "" || utf8.RuneCountInString(a.Instruction) > 1000 {
			return fmt.Errorf("请填写 1–1000 字局部修改要求")
		}
	case "rewrite":
		if a.Rewrite == nil {
			return fmt.Errorf("缺少重写目标")
		}
		return a.Rewrite.Validate(s.Segments)
	case "inline_edit":
		if strings.TrimSpace(a.Text) == "" || utf8.RuneCountInString(a.Text) > 20000 {
			return fmt.Errorf("正文需为 1–20000 字")
		}
		for _, seg := range s.Segments {
			if seg.ID == a.SegmentID && seg.Text != a.Text {
				return nil
			}
		}
		return fmt.Errorf("目标段不存在或正文没有变化")
	default:
		return fmt.Errorf("不支持的人工操作")
	}
	return nil
}

// RunHuman 只有人工门禁、修改、复检三个节点；恢复复用已保存的修改产物，不重复调用 Writer。
// Eino 保存执行位置，业务 Save/Load 另行保证节点产物幂等。
func RunHuman(ctx context.Context, initial ChapterState, chat model.ChatModel, opts HumanOptions) (ChapterState, error) {
	g := compose.NewGraph[humanState, humanState]()
	consumed := false
	add := func(name string, fn func(context.Context, humanState) (humanState, error)) error {
		return g.AddLambdaNode(name, compose.InvokableLambda(fn))
	}
	if err := add("human_gate", func(ctx context.Context, in humanState) (humanState, error) {
		was, has, saved := compose.GetInterruptState[humanState](ctx)
		if was && has && !consumed {
			in = saved
		}
		// 此图只有一个人审点；应用层已完成版本与操作权校验，采用 Eino implicit resume。
		if was && has && opts.Action != nil && !consumed {
			if err := ValidateHumanAction(in.Chapter, *opts.Action); err != nil {
				return in, err
			}
			consumed = true
			in.Action = *opts.Action
			return in, nil
		}
		opts.Pause(in.Chapter, in.Action.ID)
		return in, compose.StatefulInterrupt(ctx, "等待作者审核当前候选稿", in)
	}); err != nil {
		return initial, err
	}
	if err := add("apply", func(ctx context.Context, in humanState) (humanState, error) {
		if in.Action.Type == "approve" {
			if err := opts.Approve(ctx, in.Chapter.DraftVersion); err != nil {
				return in, err
			}
			in.Chapter.Status = "approved"
			return in, nil
		}
		key := in.Action.ID + "/apply"
		if cached, ok, err := opts.Load(ctx, key); err != nil {
			return in, err
		} else if ok {
			in.Chapter = cached
			return in, nil
		}
		s := in.Chapter
		expected := s.DraftVersion
		origin := "agent"
		s.Segments = append([]manuscript.Segment{}, s.Segments...)
		if in.Action.Type == "inline_edit" {
			origin = "human_inline"
			for i := range s.Segments {
				if s.Segments[i].ID == in.Action.SegmentID {
					s.Segments[i].Text = in.Action.Text
					s.Segments[i].Version = expected + 1
				}
			}
		} else if in.Action.Type == "rewrite" {
			updated, usage, err := agents.RewriteAuthor(ctx, chat, s.Segments, s.Context, *in.Action.Rewrite)
			if err != nil {
				return in, err
			}
			request := *in.Action.Rewrite
			s.AuthorRequest = &request
			s.Segments = updated
			for i := range s.Segments {
				if s.Segments[i].ID == in.Action.Rewrite.SegmentID {
					s.Segments[i].Version = expected + 1
				}
			}
			s.Usage.InputTokens += usage.InputTokens
			s.Usage.OutputTokens += usage.OutputTokens
		} else {
			s.Route = review.Route(s.Report, s.Segments, s.Context, true, true)
			var p revision.Proposal
			var err error
			if s.Route.Kind == "micro" {
				p, _, err = agents.PolishWithInstruction(ctx, chat, s.Segments, s.Report.Findings, s.DraftVersion, s.Context.ProtectedTerms, in.Action.Instruction, s.Context)
			} else {
				evidence, e := s.ReviewContext()
				if e != nil {
					return in, e
				}
				p, _, err = agents.RewriteWithInstruction(ctx, chat, s.Segments, s.Report, evidence, s.Route, in.Action.Instruction)
			}
			if err != nil {
				return in, err
			}
			if s.Route.Kind == "micro" {
				s.Segments, err = revision.Apply(s.Segments, s.Report.Findings, s.DraftVersion, p, s.Context.ProtectedTerms)
			} else {
				s.Segments, err = revision.ApplyScoped(s.Segments, s.Report, s.Route, p)
			}
			if err != nil {
				return in, err
			}
			s.ReviseRound++
			s.Revisions = append(append([]revision.Revision{}, s.Revisions...), revision.Revision{Kind: s.Route.Kind, Round: s.ReviseRound, FromVersion: expected, ToVersion: expected + 1, Patches: p.Patches})
		}
		s.DraftVersion++
		s.Report = review.Report{DraftVersion: s.DraftVersion, Findings: []review.Finding{}}
		s.CriticReviews = []CriticReview{}
		s.Findings = nil
		s.Status = "running"
		s.CurrentNode = "human_edit"
		s.NodePhase = "finished"
		s.StopReason = "作者修改已保存，等待双 Critic 复检"
		s.Usage = opts.Usage()
		if err := opts.Save(ctx, key, expected, s, origin); err != nil {
			return in, err
		}
		in.Chapter = s
		return in, nil
	}); err != nil {
		return initial, err
	}
	if err := add("recheck", func(ctx context.Context, in humanState) (humanState, error) {
		key := in.Action.ID + "/recheck"
		if cached, ok, err := opts.Load(ctx, key); err != nil {
			return in, err
		} else if ok {
			in.Chapter = cached
			return in, nil
		}
		s := in.Chapter
		s.Metrics = style.Analyze(s.Segments, s.Context.BannedPhrases)
		critics, _, err := reviewTogether(ctx, chat, s, opts.ConsistencyCheck)
		if err != nil {
			return in, err
		}
		s.CriticReviews = critics
		fs := []review.Finding{}
		for _, c := range critics {
			fs = append(fs, c.Findings...)
		}
		evidence, err := s.ReviewContext()
		if err != nil {
			return in, err
		}
		report, err := review.Aggregate(fs, s.Segments, s.DraftVersion, evidence.ReadingSources()...)
		if err != nil {
			return in, err
		}
		s.Report = report
		s.Reviews = append(append([]review.Report{}, s.Reviews...), report)
		s.Route = review.Route(report, s.Segments, s.Context, false, false)
		s.Status = "waiting_human"
		s.CurrentNode = "human_gate"
		s.NodePhase = "finished"
		s.StopReason = "复检完成，请作者审核新版本"
		s.Usage = opts.Usage()
		if err := opts.Save(ctx, key, s.DraftVersion, s, "agent"); err != nil {
			return in, err
		}
		in.Chapter = s
		return in, nil
	}); err != nil {
		return initial, err
	}
	for _, e := range [][2]string{{compose.START, "human_gate"}, {"human_gate", "apply"}, {"recheck", "human_gate"}} {
		if err := g.AddEdge(e[0], e[1]); err != nil {
			return initial, err
		}
	}
	if err := g.AddBranch("apply", compose.NewGraphBranch(func(_ context.Context, in humanState) (string, error) {
		if in.Action.Type == "approve" {
			return compose.END, nil
		}
		return "recheck", nil
	}, map[string]bool{"recheck": true, compose.END: true})); err != nil {
		return initial, err
	}
	graph, err := g.Compile(ctx, compose.WithCheckPointStore(opts.Checkpoints), compose.WithGraphName(HumanWorkflowVersion), compose.WithMaxRunSteps(8))
	if err != nil {
		return initial, err
	}
	result, err := graph.Invoke(ctx, humanState{Chapter: initial}, compose.WithCheckPointID(opts.RunID))
	return result.Chapter, err
}
