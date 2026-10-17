package evaluation

import (
	"context"
	"fmt"
	"reflect"
	"strings"
	"time"
	"unicode"

	"inkloom/internal/agents/model"
	"inkloom/internal/agents/prompts"
	"inkloom/internal/domain/manuscript"
	"inkloom/internal/orchestration"
)

// ChapterWorkflow is a synthetic, unpublished chapter. Expected checks never enter model material.
func ChapterWorkflowInput() manuscript.ContextBundle {
	b := manuscript.ContextBundle{ProjectID: "chapter-workflow-evaluation", ChapterID: "night-shift", BranchID: "isolated", POV: "第三人称限知，林宁"}
	titles := []string{"接班清点", "交付铜签", "封存登记簿"}
	actions := []string{
		"林宁在河堤值班室接夜班，清点蓝布袋里三枚铜签，核对交接手续，陈禾要走，林宁因字迹不清请他留下核对。展开两人的迟疑与协作，最后林宁拿着布袋走向窗口。不要提前交出铜签。",
		"承接前段，林宁在窗口将蓝布袋中的两枚铜签交给陈禾，用于领取两盏巡堤灯；陈禾当面核对数量，林宁把剩余一枚放回袋内，双方核对交付登记并签名。不要提前封存登记簿，不猜测第三段才出现的信封内容。",
		"承接交付和签名，林宁把登记簿放进抽屉再封好，收妥余下铜签；陈禾带着两枚铜签离开去领灯。林宁在值班桌下面发现一个封口完好的信封，只看见封面写着次日交站长，不拆封，不猜寄信人，以等待次日交接收尾。",
	}
	for i := range titles {
		t := b
		t.Targets = nil
		t.Beat = manuscript.Beat{ID: fmt.Sprintf("beat-%d", i+1), SceneID: "duty-room", Version: 1, Title: titles[i], Description: actions[i]}
		t.Facts = []manuscript.SourceRef{{ID: "tokens", Version: 1, Text: "夜班交接开始时蓝布袋中只有三枚铜签，每枚可领取一盏灯。本章没有其他铜签补入，也没有遗失。"}, {ID: "people", Version: 1, Text: "林宁与陈禾都是河堤值班员；林宁负责当晚交接登记，陈禾负责领灯。"}}
		t.WritingTask = &manuscript.WritingTask{Scope: "isolated", ChapterID: b.ChapterID, Opening: true, PlanVersion: 1, SourceDigest: strings.Repeat("a", 64), Versions: map[string]int{"input": 1, "direction": 1, "style": 1, "core": 1, "outline": 1, "bindings": 1}, StoryTime: int64(i), Genre: "现实生活", ChapterTargetWords: 2400, BeatTargetWords: 800,
			Brief: manuscript.WritingBrief{SelectedBeatID: t.Beat.ID, MustHappen: actions[i], CannotChange: "三枚铜签交出两枚后剩一枚；不增加人物或关键往事。", Withhold: "信封内文及寄信人尚未揭示，任何段落均不得揭示或猜成事实。", WritingGuidance: "全章约2400字，控制在2000–3000字，每段约800字。通过具体动作、对话和手续核对展开，避免重复清点凑字数。"},
			Style: manuscript.WritingStyle{POV: b.POV, Tense: "过去时", Tone: "克制、具体、略有生活幽默"}, SceneGoal: "完成夜班交接", SceneConflict: "手续需要核对，双方都想尽早完成", SceneOutcome: "铜签交付完毕，登记簿封存"}
		b.Targets = append(b.Targets, t)
	}
	targets := b.Targets
	b = targets[0]
	b.Targets = targets
	return b
}

type WorkflowCheck struct {
	Name   string `json:"name"`
	Passed bool   `json:"passed"`
	Detail string `json:"detail,omitempty"`
}
type WorkflowStage struct {
	Name          string                     `json:"name"`
	Input         manuscript.ContextBundle   `json:"input"`
	State         orchestration.ChapterState `json:"state"`
	Checks        []WorkflowCheck            `json:"checks"`
	Calls         []RevisionCall             `json:"calls"`
	Error         string                     `json:"error,omitempty"`
	ApprovalBlock string                     `json:"approvalBlock"`
}
type ChapterWorkflowReport struct {
	Dataset       string          `json:"dataset"`
	DatasetDigest string          `json:"datasetDigest"`
	Provider      string          `json:"provider"`
	Model         string          `json:"model"`
	StartedAt     time.Time       `json:"startedAt"`
	Total         int             `json:"total"`
	Attempted     int             `json:"attempted"`
	Passed        int             `json:"passed"`
	Usage         model.Usage     `json:"usage"`
	Stages        []WorkflowStage `json:"stages"`
	Error         string          `json:"error,omitempty"`
}

func proseLength(text string) int {
	n := 0
	for _, r := range text {
		if !unicode.IsSpace(r) {
			n++
		}
	}
	return n
}
func workflowPassage(s manuscript.Segment, position string, version int) manuscript.Passage {
	s.Version = version
	p := manuscript.Passage{BeatID: s.BeatID, Title: s.BeatID, DraftID: "evaluation-working-draft", RunID: "evaluation-working-run", Version: version, State: "candidate", Position: position, Segments: []manuscript.Segment{s}}
	p.Digest, _ = manuscript.ContentDigest(p.Segments)
	return p
}

// RunChapterWorkflow reuses the production graph for chapter generation and two author revisions.
// It never opens a store, adopts a candidate, or publishes facts. One guard covers all stages.
func RunChapterWorkflow(ctx context.Context, provider, name string, limits model.Limits, next model.ChatModel, experimental ...bool) (report ChapterWorkflowReport, runErr error) {
	b := ChapterWorkflowInput()
	if len(experimental) > 0 && experimental[0] {
		b.WritingTask.ExperimentalContinuity = true
		for i := range b.Targets {
			b.Targets[i].WritingTask.ExperimentalContinuity = true
		}
	}
	report = ChapterWorkflowReport{Dataset: "chapter-workflow-v1", Provider: provider, Model: name, StartedAt: time.Now().UTC(), Total: 3, Stages: []WorkflowStage{}}
	report.DatasetDigest, _ = manuscript.ContentDigest(b)
	capture := &revisionCapture{next: next}
	guard := model.NewGuard(capture, limits)
	chat := prompts.Bind(guard)
	defer func() {
		report.Usage = guard.Usage()
		if runErr != nil {
			report.Error = runErr.Error()
		}
	}()
	invoke := func(label string, in manuscript.ContextBundle, version int) (WorkflowStage, error) {
		capture.mu.Lock()
		start := len(capture.calls)
		capture.mu.Unlock()
		stage := WorkflowStage{Name: label, Input: in, Checks: []WorkflowCheck{}}
		var progress orchestration.ChapterState
		graph, err := orchestration.NewChapter(ctx, chat, orchestration.Options{BaseDraftVersion: version, AutoRevise: false, OnProgress: func(s orchestration.ChapterState) { progress = s }})
		if err == nil {
			stage.State, err = graph.Invoke(ctx, in)
		}
		if err != nil {
			stage.Error = err.Error()
			stage.State = orchestration.TerminalError(progress, err)
		} else {
			stage.ApprovalBlock = orchestration.ApprovalReason(stage.State)
			stage.Checks = append(stage.Checks, WorkflowCheck{Name: "approval-gate-clear", Passed: stage.ApprovalBlock == "", Detail: stage.ApprovalBlock})
		}
		capture.mu.Lock()
		stage.Calls = append([]RevisionCall{}, capture.calls[start:]...)
		capture.mu.Unlock()
		return stage, err
	}
	record := func(s WorkflowStage) {
		report.Attempted++
		good := s.Error == "" && len(s.Checks) > 0
		for _, c := range s.Checks {
			good = good && c.Passed
		}
		if good {
			report.Passed++
		}
		report.Stages = append(report.Stages, s)
	}
	first, err := invoke("generate-chapter", b, 0)
	if err != nil {
		record(first)
		return report, err
	}
	total := 0
	ordered := len(first.State.Segments) == 3
	for i, s := range first.State.Segments {
		total += proseLength(s.Text)
		ordered = ordered && i < len(b.Targets) && s.BeatID == b.Targets[i].Beat.ID
		first.Checks = append(first.Checks, WorkflowCheck{Name: "part-length/" + s.BeatID, Passed: proseLength(s.Text) >= 400, Detail: fmt.Sprintf("%d non-space characters, minimum 400", proseLength(s.Text))})
	}
	first.Checks = append(first.Checks, WorkflowCheck{Name: "ordered-complete-chapter", Passed: ordered}, WorkflowCheck{Name: "chapter-length", Passed: total >= 2000 && total <= 3000, Detail: fmt.Sprintf("%d non-space characters; target 2400, acceptance 2000–3000", total)}, WorkflowCheck{Name: "review-completed", Passed: len(first.State.CriticReviews) == 2})
	record(first)
	if !ordered {
		return report, fmt.Errorf("chapter workflow: incomplete chapter; dependent stages not attempted")
	}
	// Simulate an explicit author save of the left neighbor without adoption. The database suite
	// separately proves the same saved head is selected and subsequent edits invalidate approval.
	left := first.State.Segments[0]
	left.Text += "\n到窗口前，林宁把装有三枚铜签的蓝布袋系在左腕，右手空着，准备接登记簿。"
	middle := b.Targets[1]
	middle.Original = []manuscript.Segment{first.State.Segments[1]}
	middle.Neighbors = []manuscript.Passage{workflowPassage(left, "before", 2), workflowPassage(first.State.Segments[2], "after", 1)}
	req := manuscript.AuthorRewrite{SegmentID: middle.Original[0].ID, Original: middle.Original[0].Text, End: len([]rune(middle.Original[0].Text)), Instruction: "按最新前段收尾重写本段：蓝布袋已系在左腕，右手空着，请具体写清怎样打开袋口并取出两枚铜签，不能又从桌上或口袋拿袋子。保留交两枚后剩一枚、核对登记签名的结果，接到后段封存登记簿，不提前写信封。保持约800字，只改本段。"}
	middle.Rewrite = &req
	rewritten, err := invoke("rewrite-middle-with-unadopted-neighbors", middle, 1)
	if err == nil && len(rewritten.State.Segments) == 1 {
		text := rewritten.State.Segments[0].Text
		rewritten.Checks = append(rewritten.Checks, WorkflowCheck{Name: "middle-only", Passed: rewritten.State.Segments[0].ID == req.SegmentID && text != req.Original}, WorkflowCheck{Name: "neighbor-snapshots-unchanged", Passed: reflect.DeepEqual(middle.Neighbors, rewritten.State.Context.Neighbors)}, WorkflowCheck{Name: "left-wrist-continuity", Passed: strings.Contains(text, "左腕") && strings.Contains(text, "两枚") && strings.Contains(text, "一枚")}, WorkflowCheck{Name: "rewrite-length", Passed: proseLength(text) >= 400 && proseLength(text) <= 1400, Detail: fmt.Sprintf("%d non-space characters", proseLength(text))}, WorkflowCheck{Name: "author-request-addressed", Passed: authorRequestAddressed(rewritten.State)})
	}
	record(rewritten)
	if err != nil {
		return report, err
	}
	if len(rewritten.State.Segments) != 1 {
		return report, fmt.Errorf("chapter workflow: missing rewrite")
	}
	// Seed one explicit author typo in an otherwise long manuscript. Only this selected clause may change.
	s := rewritten.State.Segments[0]
	s.Text += "\n林宁又在备注栏写下：三枚铜签交出两枚后，还剩两枚。"
	selection := "还剩两枚"
	at := strings.LastIndex(s.Text, selection)
	start := len([]rune(s.Text[:at]))
	selected := middle
	selected.Original = []manuscript.Segment{s}
	selected.Rewrite = &manuscript.AuthorRewrite{SegmentID: s.ID, Original: s.Text, Start: start, End: start + len([]rune(selection)), Instruction: "备注里的算术错了。把选中的‘还剩两枚’改成‘还剩一枚’，只改这四个字。"}
	local, err := invoke("selected-correction-in-long-prose", selected, 2)
	if err == nil && len(local.State.Segments) == 1 {
		expected := s.Text[:at] + "还剩一枚" + s.Text[at+len(selection):]
		local.Checks = append(local.Checks, WorkflowCheck{Name: "exact-selection-and-outside-preserved", Passed: local.State.Segments[0].ID == s.ID && local.State.Segments[0].Text == expected}, WorkflowCheck{Name: "neighbors-unchanged", Passed: reflect.DeepEqual(selected.Neighbors, local.State.Context.Neighbors)}, WorkflowCheck{Name: "author-request-addressed", Passed: authorRequestAddressed(local.State)})
	}
	record(local)
	if err != nil {
		return report, err
	}
	if report.Passed != report.Total {
		return report, fmt.Errorf("chapter workflow: %d/%d stages passed; inspect checks and prose", report.Passed, report.Total)
	}
	return report, nil
}
func authorRequestAddressed(s orchestration.ChapterState) bool {
	for _, c := range s.CriticReviews {
		if c.Critic == "hard_consistency" && c.Status == "completed" && c.DraftVersion == s.DraftVersion && c.AuthorCheck != nil {
			return c.AuthorCheck.Status == "addressed"
		}
	}
	return false
}
